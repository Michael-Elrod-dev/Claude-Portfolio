#!/usr/bin/env node
'use strict';

/**
 * The Claude Portfolio Trader. Run by claude-portfolio-bot.service on the
 * laptop: its timer fires Mon + Thu at 09:00 America/New_York (before the
 * 09:30 open, so orders fill at the open), and claude-portfolio-force.path
 * starts it when the app asks for a forced run.
 *
 *   node bot/run.js           scheduled run: exits early if the switch is off
 *   node bot/run.js --force   bypass the switch
 *
 * Full pipeline:
 *   1. Load API keys from the environment
 *   2. Check the on/off switch (store `active`) unless forced. A forced run
 *      is either --force or a queued `force-run` request from the API.
 *   3. Assemble the briefing from all four data sources
 *   4. Call the Analyst (Claude + web search) for trade recommendations
 *   5. Execute all recommendations against the live brokerage account
 *   6. Call the MemoUpdater (Claude, no tools) with what was actually
 *      submitted, rejected or skipped, and write the new memo
 *   7. Archive the run so the app can read it back through the API
 *   8. Send FCM push notifications — best-effort, never fails the run
 *
 * The memo is updated after the orders so it records what happened, not
 * just what was decided. Once orders are out, a memo failure keeps the old
 * memo, still archives the run, and reports run_failed.
 *
 * Activity events are appended throughout, so Settings → Recent activity
 * has something to show.
 *
 * There is no dry-run mode. Every run that gets past the switch places real
 * orders on the live brokerage account.
 */

const { loadSecrets } = require('./config');
const store = require('./store');
const { publish: fcmPublish } = require('./fcmPublisher');
const AlpacaSource = require('../sources/AlpacaSource');
const EarningsSource = require('../sources/EarningsSource');
const CongressionalSource = require('../sources/CongressionalSource');
const MemoSource = require('../sources/MemoSource');
const BriefingAssembler = require('../briefing/BriefingAssembler');
const Analyst = require('../analyst/Analyst');
const MemoUpdater = require('../analyst/MemoUpdater');
const Executor = require('../executor/Executor');

/** The real collaborators. Tests pass fakes for the ones that reach the network. */
const DEFAULT_DEPS = {
  loadSecrets,
  store,
  fcmPublish,
  makeAssembler: (secrets, memoBackend) =>
    new BriefingAssembler({
      alpaca: new AlpacaSource({
        keyId: secrets.ALPACA_KEY_ID,
        secretKey: secrets.ALPACA_SECRET_KEY,
      }),
      memo: new MemoSource({ backend: memoBackend }),
      // The snapshot congressional/ writes the evening before each run.
      congressional: new CongressionalSource({ backend: store.congressionalBackend() }),
      earnings: new EarningsSource({
        apiKey: secrets.FINNHUB_API_KEY,
        windowDays: 14,
      }),
    }),
  makeAnalyst: (secrets) => new Analyst({ apiKey: secrets.ANTHROPIC_API_KEY }),
  makeMemoUpdater: (secrets) => new MemoUpdater({ apiKey: secrets.ANTHROPIC_API_KEY }),
  makeExecutor: (secrets, runDate) =>
    new Executor({
      keyId: secrets.ALPACA_KEY_ID,
      secretKey: secrets.ALPACA_SECRET_KEY,
      runDate,
    }),
};

async function run({ force = false, deps = {} } = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const { store: st } = d;
  const startedAt = Date.now();
  const runDate = new Date().toISOString().slice(0, 10);
  const forced = force;
  let ordersPlaced = false;

  const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

  log(`Claude Portfolio Trader starting (runDate=${runDate}, forced=${forced})`);
  await st.logActivity('cron_start', { runDate, forced });

  try {
    // ── 1. Secrets ──────────────────────────────────────────────────────────
    const secrets = d.loadSecrets();

    // ── 2. On/off switch ────────────────────────────────────────────────────
    if (!forced) {
      if (!(await st.isActive())) {
        log('Bot is INACTIVE (store `active` is not "true"). Nothing to do.');
        return { status: 'inactive', runDate };
      }
      log('Bot is ACTIVE. Proceeding.');
    } else {
      log('Forced run: bypassing the on/off switch.');
    }

    // ── 3. Briefing ─────────────────────────────────────────────────────────
    const memoBackend = st.memoBackend();
    log(`Memo backend: ${memoBackend.describe()}`);

    log('Assembling briefing...');
    const briefing = await d.makeAssembler(secrets, memoBackend).assemble();
    log(
      `Briefing ready: ${briefing.symbolsCovered.length} symbols, ` +
        `${briefing.errors.length} source error(s).`
    );
    for (const e of briefing.errors) {
      log(`  Source error [${e.source}]: ${e.message}`);
      await st.logActivity('briefing_error', { source: e.source, message: e.message });
    }
    await st.logActivity('briefing_complete', {
      symbols: briefing.symbolsCovered.length,
      errors: briefing.errors.length,
    });

    // ── 4. Analyst ──────────────────────────────────────────────────────────
    log('Calling Analyst (Claude + web search)...');
    const analysis = await d.makeAnalyst(secrets).analyze(briefing);
    log(
      `Analyst done (${analysis.meta.model}${analysis.meta.fellBack ? ', FELL BACK' : ''}). ` +
        `Stop: ${analysis.meta.stopReason}, ` +
        `web searches: ${analysis.meta.webSearchesUsed}, ` +
        `output tokens: ${analysis.meta.usage.outputTokens.toLocaleString()}`
    );

    // ── 5. Execute ──────────────────────────────────────────────────────────
    // Orders go to the live brokerage account unconditionally. This is REAL
    // money and there is no dry-run rail: if a run reaches this line, it
    // trades. The switch checked in step 2 is the only gate.
    log('Running executor (live)...');
    ordersPlaced = true;
    const execResult = await d.makeExecutor(secrets, runDate).execute(analysis.recommendations);
    log(`Executor done: ${JSON.stringify(execResult.summary)}`);

    // ── 6. MemoUpdater ──────────────────────────────────────────────────────
    // Best-effort from here on: the orders are out, so a failure keeps the
    // prior memo and the run is still archived below.
    let memoResult = null;
    let memoError = null;
    try {
      log('Calling MemoUpdater...');
      memoResult = await d.makeMemoUpdater(secrets).update({
        priorMemo: briefing.memo?.memo || {},
        briefing,
        recommendations: analysis.recommendations,
        execution: execResult,
      });
      log(
        `MemoUpdater done (${memoResult.meta.model}${memoResult.meta.fellBack ? ', FELL BACK' : ''}). ` +
          `Stop: ${memoResult.meta.stopReason}, ` +
          `output tokens: ${memoResult.meta.usage.outputTokens.toLocaleString()}`
      );
      await memoBackend.write(JSON.stringify(memoResult.memo, null, 2));
      log(`Memo written to ${memoBackend.describe()}.`);
      await st.logActivity('memo_write', { lastUpdated: memoResult.memo?.lastUpdated || null });
    } catch (err) {
      memoError = err;
      log(`MemoUpdater FAILED after orders were placed; the prior memo stays: ${err.stack || err.message}`);
    }

    // ── 7. Archive the run ──────────────────────────────────────────────────
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
      forced,
      summary: analysis.recommendations?.summary || null,
      analystMeta: {
        model: analysis.meta.model,
        fellBack: analysis.meta.fellBack ?? false,
        memoModel: memoResult?.meta.model ?? null,
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
      await st.archiveRun(runRecord);
      log('Run archived.');
    } catch (archiveErr) {
      // Non-fatal: the run already happened. Just log loudly.
      log(`Run archive FAILED (non-fatal): ${archiveErr.message}`);
    }

    if (memoError) {
      // Reported as a failure (activity, push, exit code), with the orders noted.
      throw Object.assign(
        new Error(`orders placed, memo not updated: ${memoError.message}`),
        { cause: memoError }
      );
    }

    // ── 8. FCM push ─────────────────────────────────────────────────────────
    try {
      const fcmResult = await d.fcmPublish('run_complete', {
        runDate,
        recCount: enrichedRecs.length,
        executed: execResult.summary?.executed ?? 0,
        summary: (analysis.recommendations?.summary || '').slice(0, 240),
      });
      log(`FCM run_complete: ${JSON.stringify(fcmResult)}`);

      if (briefing.errors.length > 0) {
        await d.fcmPublish('briefing_error', {
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
      execution: execResult.summary,
      recommendationCount: (analysis.recommendations?.recommendations ?? []).length,
      briefingErrors: briefing.errors,
      analystMeta: analysis.meta,
      memoMeta: memoResult.meta,
    };

    log('Run complete: ' + JSON.stringify(result.execution));
    await st.logActivity('run_complete', {
      runDate,
      durationSec,
      recCount: enrichedRecs.length,
      summary: execResult.summary,
    });

    return result;
  } catch (err) {
    const durationSec = Math.round((Date.now() - startedAt) / 1000);
    log(`Pipeline FAILED after ${durationSec}s: ${err.stack || err.message}`);
    await st.logActivity('run_failed', {
      runDate,
      durationSec,
      ordersPlaced,
      error: err.message,
    });
    try {
      await d.fcmPublish('run_failed', { runDate, error: err.message.slice(0, 200) });
    } catch {
      /* swallow — failure inside failure handler is just noise */
    }
    throw err;
  }
}

module.exports = { run };

if (require.main === module) {
  // A queued request from the app (POST /run/force) counts as --force.
  const force = process.argv.includes('--force') || store.consumeForcedRun();
  run({ force })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
