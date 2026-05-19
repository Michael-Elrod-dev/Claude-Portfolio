'use strict';

/**
 * AWS Lambda entry point for the Claude Portfolio Trader.
 *
 * Full pipeline on every invocation:
 *   1. Load API keys from Secrets Manager (cached across warm starts)
 *   2. Check the active flag in SSM Parameter Store
 *      — exits early if inactive, unless the event has { "force": true }
 *   3. Assemble the weekly briefing from all four data sources
 *   4. Call the Analyst (Claude + web search) for trade recommendations
 *   5. Call the MemoUpdater (Claude, no tools) to rewrite the memo
 *   6. Write the new memo back to S3
 *   7. Execute all recommendations via Alpaca (live decided by SSM
 *      claude-portfolio-live with a fallback to env EXECUTOR_LIVE)
 *   8. Archive the run to DynamoDB (claude-portfolio-runs) so the Android
 *      app can read it back via the API
 *   9. Send notifications: SES email (legacy) and FCM push (new) — both
 *      best-effort and swallow errors so they never fail the run
 *
 * Activity events are appended to claude-portfolio-activity throughout, so
 * the Settings → Recent activity screen has something to show.
 *
 * Environment variables (set on the Lambda function, NOT secrets):
 *   MEMO_S3_BUCKET   — S3 bucket for memo + queued trades
 *   MEMO_S3_KEY      — S3 key for the memo (default: memo.json)
 *   EXECUTOR_LIVE    — fallback for live trading if SSM param is absent
 *   SECRET_NAME      — Secrets Manager secret name (default: claude-portfolio/api-keys)
 *   AWS_REGION       — auto-injected by Lambda
 *
 * Trigger:
 *   - EventBridge cron (Mon + Thu @ 13:00 UTC / 9 AM ET)
 *   - Lambda test event / CLI invoke for manual runs
 *     Pass { "force": true } in the event to bypass the active flag.
 */

const { loadSecrets, isActive } = require('./secretsLoader');
const { isLive } = require('./liveFlag');
const { archiveRun } = require('./runArchiver');
const { logActivity } = require('./activityLogger');
const { publish: fcmPublish } = require('./fcmPublisher');
const AlpacaSource = require('../sources/AlpacaSource');
const EarningsSource = require('../sources/EarningsSource');
const CongressionalSource = require('../sources/CongressionalSource');
const MemoSource = require('../sources/MemoSource');
const { memoBackendFromEnv } = require('../sources/memoBackendFactory');
const BriefingAssembler = require('../briefing/BriefingAssembler');
const Analyst = require('../analyst/Analyst');
const MemoUpdater = require('../analyst/MemoUpdater');
const Executor = require('../executor/Executor');
const Emailer = require('./emailer');

// Reused across warm invocations — avoids re-fetching secrets on every call.
let cachedSecrets = null;

exports.handler = async (event = {}) => {
  const startedAt = Date.now();
  const runDate = new Date().toISOString().slice(0, 10);
  const forced = event?.force === true;

  const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

  const notificationEmail = process.env.NOTIFICATION_EMAIL || null;
  const emailer = notificationEmail ? new Emailer(notificationEmail) : null;

  log(`Claude Portfolio Trader starting (runDate=${runDate}, forced=${forced})`);
  await logActivity('cron_start', { runDate, forced });

  try {
    // ── 1. Secrets ──────────────────────────────────────────────────────────
    if (!cachedSecrets) {
      log('Cold start: loading secrets from Secrets Manager...');
      cachedSecrets = await loadSecrets();
      log('Secrets loaded and cached.');
    }

    // ── 2. Active flag ──────────────────────────────────────────────────────
    if (!forced) {
      log('Checking active flag (SSM /claude-portfolio-active)...');
      const active = await isActive();
      if (!active) {
        log('Bot is INACTIVE. Set SSM /claude-portfolio-active=true to enable scheduled runs.');
        log('To run immediately regardless, invoke with event { "force": true }.');
        return {
          statusCode: 200,
          body: JSON.stringify({ status: 'inactive', runDate }),
        };
      }
      log('Bot is ACTIVE. Proceeding.');
    } else {
      log('force=true: bypassing active flag.');
    }

    // ── 3. Briefing ─────────────────────────────────────────────────────────
    const memoBackend = memoBackendFromEnv();
    log(`Memo backend: ${memoBackend.describe()}`);

    const assembler = new BriefingAssembler({
      alpaca: new AlpacaSource({
        keyId: cachedSecrets.ALPACA_KEY_ID,
        secretKey: cachedSecrets.ALPACA_SECRET_KEY,
        paper: true,
      }),
      memo: new MemoSource({ backend: memoBackend }),
      congressional: new CongressionalSource(),
      earnings: new EarningsSource({
        apiKey: cachedSecrets.FINNHUB_API_KEY,
        windowDays: 14,
      }),
    });

    log('Assembling briefing...');
    const briefing = await assembler.assemble();
    log(
      `Briefing ready: ${briefing.symbolsCovered.length} symbols, ` +
        `${briefing.errors.length} source error(s).`
    );
    if (briefing.errors.length > 0) {
      for (const e of briefing.errors) {
        log(`  Source error [${e.source}]: ${e.message}`);
        await logActivity('briefing_error', { source: e.source, message: e.message });
      }
    }
    await logActivity('briefing_complete', {
      symbols: briefing.symbolsCovered.length,
      errors: briefing.errors.length,
    });

    // ── 4. Analyst ──────────────────────────────────────────────────────────
    log('Calling Analyst (Claude + web search, may take 2–5 minutes)...');
    const analyst = new Analyst({ apiKey: cachedSecrets.ANTHROPIC_API_KEY });
    const analysis = await analyst.analyze(briefing);
    log(
      `Analyst done. Stop: ${analysis.meta.stopReason}, ` +
        `web searches: ${analysis.meta.webSearchesUsed}, ` +
        `output tokens: ${analysis.meta.usage.outputTokens.toLocaleString()}`
    );

    // ── 5. MemoUpdater ──────────────────────────────────────────────────────
    log('Calling MemoUpdater...');
    const updater = new MemoUpdater({ apiKey: cachedSecrets.ANTHROPIC_API_KEY });
    const memoResult = await updater.update({
      priorMemo: briefing.memo?.memo || {},
      briefing,
      recommendations: analysis.recommendations,
    });
    log(
      `MemoUpdater done. Stop: ${memoResult.meta.stopReason}, ` +
        `output tokens: ${memoResult.meta.usage.outputTokens.toLocaleString()}`
    );

    // ── 6. Write memo ───────────────────────────────────────────────────────
    log(`Writing new memo to ${memoBackend.describe()}...`);
    await memoBackend.write(JSON.stringify(memoResult.memo, null, 2));
    log('Memo written.');
    await logActivity('memo_write', { lastUpdated: memoResult.memo?.lastUpdated || null });

    // ── 7. Execute ──────────────────────────────────────────────────────────
    const dryRun = !(await isLive());
    const executor = new Executor({
      keyId: cachedSecrets.ALPACA_KEY_ID,
      secretKey: cachedSecrets.ALPACA_SECRET_KEY,
      paper: true,
      dryRun,
      runDate,
    });

    log(`Running executor (dryRun=${dryRun})...`);
    const execResult = await executor.execute(analysis.recommendations);
    log(`Executor done: ${JSON.stringify(execResult.summary)}`);

    // ── 8. Archive run to Dynamo ────────────────────────────────────────────
    const finishedAt = new Date();
    const durationSec = Math.round((finishedAt.getTime() - startedAt) / 1000);

    const enrichedRecs = (execResult.results || []).map((r) => ({
      ...(r.recommendation || {}),
      status: r.status,
      orderId: r.orderId || null,
      sizing: r.sizing || null,
      reason: r.reason || null,
    }));

    const runRecord = {
      runDate,
      timestamp: finishedAt.toISOString(),
      durationSec,
      dryRun,
      forced,
      summary: analysis.recommendations?.summary || null,
      analystMeta: {
        model: analysis.meta.model,
        stopReason: analysis.meta.stopReason,
        webSearchesUsed: analysis.meta.webSearchesUsed,
        inputTokens: analysis.meta.usage?.inputTokens ?? null,
        outputTokens: analysis.meta.usage?.outputTokens ?? null,
      },
      recommendations: enrichedRecs,
      executor: execResult.summary,
      briefingErrors: briefing.errors,
      briefing,
    };

    try {
      await archiveRun(runRecord);
      log('Run archived to DynamoDB.');
    } catch (archiveErr) {
      // Non-fatal: the run already happened. Just log loudly.
      log(`Run archive FAILED (non-fatal): ${archiveErr.message}`);
    }

    // ── 9a. Email notification ──────────────────────────────────────────────
    if (emailer) {
      log('Sending email notification...');
      try {
        const alpacaForEmail = new AlpacaSource({
          keyId: cachedSecrets.ALPACA_KEY_ID,
          secretKey: cachedSecrets.ALPACA_SECRET_KEY,
          paper: true,
        });
        const alpacaData = await alpacaForEmail.fetch();
        const positions = alpacaData.positions.holdings;
        await emailer.sendRunSummary({
          runDate,
          dryRun,
          execResult,
          positions,
          analystSummary: analysis.recommendations?.summary || null,
        });
        log('Email sent.');
      } catch (emailErr) {
        log(`Email send failed (non-fatal): ${emailErr.message}`);
      }
    }

    // ── 9b. FCM push ────────────────────────────────────────────────────────
    try {
      const queuedCount = execResult.summary?.queuedForReview
        ?? execResult.summary?.queued
        ?? 0;

      const fcmResult = await fcmPublish('run_complete', {
        runDate,
        recCount: enrichedRecs.length,
        executed: execResult.summary?.executed ?? 0,
        queuedForReview: queuedCount,
        summary: (analysis.recommendations?.summary || '').slice(0, 240),
      });
      log(`FCM run_complete: ${JSON.stringify(fcmResult)}`);

      if (queuedCount > 0) {
        await fcmPublish('queued_for_review', { runDate, count: queuedCount });
      }
      if (briefing.errors.length > 0) {
        await fcmPublish('briefing_error', {
          runDate,
          errorCount: briefing.errors.length,
        });
      }
    } catch (pushErr) {
      log(`FCM publish failed (non-fatal): ${pushErr.message}`);
    }

    // ── Result ──────────────────────────────────────────────────────────────
    const result = {
      status: 'ok',
      runDate,
      dryRun,
      execution: execResult.summary,
      recommendationCount: (analysis.recommendations?.recommendations ?? []).length,
      briefingErrors: briefing.errors,
      analystMeta: analysis.meta,
      memoMeta: memoResult.meta,
    };

    log('Run complete: ' + JSON.stringify(result.execution));
    await logActivity('run_complete', {
      runDate,
      durationSec,
      recCount: enrichedRecs.length,
      summary: execResult.summary,
    });

    return { statusCode: 200, body: JSON.stringify(result, null, 2) };
  } catch (err) {
    const durationSec = Math.round((Date.now() - startedAt) / 1000);
    log(`Pipeline FAILED after ${durationSec}s: ${err.stack || err.message}`);
    await logActivity('run_failed', {
      runDate,
      durationSec,
      error: err.message,
    });
    try {
      await fcmPublish('run_failed', { runDate, error: err.message.slice(0, 200) });
    } catch {
      /* swallow — failure inside failure handler is just noise */
    }
    throw err;
  }
};
