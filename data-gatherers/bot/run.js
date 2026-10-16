#!/usr/bin/env node
'use strict';

/**
 * The Claude Portfolio Trader. Run by claude-portfolio-bot.service on the
 * laptop: its timer fires Mon, Tue and Thu at 09:00 America/New_York, and
 * claude-portfolio-force.path starts it when the app asks for a forced run.
 *
 *   node bot/run.js           scheduled run (see the schedule below)
 *   node bot/run.js --force   bypass the schedule and the on/off switch
 *
 * Schedule (market.js scheduledRunDecision): Mon and Thu when the market is
 * open; Tue only as a make-up when Monday was a market holiday. A Thursday
 * holiday is not made up. The decision is made before any Claude call, so a
 * skipped day costs nothing.
 *
 * Full pipeline:
 *   1. Load API keys from the environment
 *   2. Scheduled runs: check the market calendar and the on/off switch
 *   3. Assemble the briefing from all four data sources
 *   4. Call the Analyst (Claude + web search) for trade recommendations
 *   5. Execute: sells first; buys wait for them to fill, then are sized to
 *      the cash actually available (executor/Executor.js)
 *   6. Call the MemoUpdater (Claude, no tools) with what was submitted,
 *      filled, scaled, rejected or skipped, and write the new memo
 *   7. Archive the run so the app can read it back through the API
 *   8. Send FCM push notifications — best-effort, never fails the run
 *
 * While the executor waits for sells, a partial run record is archived, and
 * a SIGTERM (systemd timeout, reboot) archives what is known before exiting.
 * Once orders are out, a memo failure keeps the old memo, still archives the
 * run, and reports run_failed. A `running` marker in the store lets the API
 * refuse a forced run while this one is in progress.
 *
 * There is no dry-run mode. Every run that gets past the switch places real
 * orders on the live brokerage account.
 */

const { loadSecrets } = require('./config');
const store = require('./store');
const { publish: fcmPublish } = require('./fcmPublisher');
const { createLiveClient } = require('../alpacaClient');
const { etDate, scheduledRunDecision } = require('../market');
const AlpacaSource = require('../sources/AlpacaSource');
const EarningsSource = require('../sources/EarningsSource');
const CongressionalSource = require('../sources/CongressionalSource');
const MemoSource = require('../sources/MemoSource');
const BriefingAssembler = require('../briefing/BriefingAssembler');
const Analyst = require('../analyst/Analyst');
const MemoUpdater = require('../analyst/MemoUpdater');
const Executor = require('../executor/Executor');

// The unit's TimeoutStartSec is 90 min. The executor must hand back early
// enough for the memo update and the archive.
const RUN_BUDGET_MS = 85 * 60_000;
const MEMO_RESERVE_MS = 12 * 60_000;

/** The real collaborators. Tests pass fakes for the ones that reach the network. */
const DEFAULT_DEPS = {
  loadSecrets,
  store,
  fcmPublish,
  now: () => Date.now(),
  decideSchedule: (secrets, nowMs) =>
    scheduledRunDecision(
      createLiveClient({ keyId: secrets.ALPACA_KEY_ID, secretKey: secrets.ALPACA_SECRET_KEY }),
      nowMs
    ),
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
  makeExecutor: (secrets, runDate, opts) =>
    new Executor({
      keyId: secrets.ALPACA_KEY_ID,
      secretKey: secrets.ALPACA_SECRET_KEY,
      runDate,
      ...opts,
    }),
};

/** One record per recommendation: the recommendation plus everything the executor learned. */
function enrich(results) {
  return (results || []).map(({ recommendation, ...outcome }) => ({
    ...(recommendation || {}),
    ...outcome,
    orderId: outcome.orderId || null,
    reason: outcome.reason || null,
  }));
}

async function run({ force = false, deps = {} } = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const { store: st } = d;
  const startedAt = d.now();
  const runDate = etDate(startedAt);
  const forced = force;
  let ordersPlaced = false;
  let partialRecord = null;
  let onSigterm = null;

  const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
  const secondsSince = () => Math.round((d.now() - startedAt) / 1000);

  st.markRunStarted();
  try {
    // ── 1. Secrets ──────────────────────────────────────────────────────────
    const secrets = d.loadSecrets();

    // ── 2. Schedule and on/off switch (scheduled runs only) ─────────────────
    if (!forced) {
      const decision = await d.decideSchedule(secrets, startedAt);
      if (!decision.run) {
        log(`Not running today: ${decision.reason}.`);
        if (!decision.quiet) {
          await st.logActivity('run_skipped', { runDate, text: `Run skipped: ${decision.reason}` });
        }
        return { status: 'skipped', runDate, reason: decision.reason };
      }
      log(`Schedule: ${decision.reason}.`);
    }

    log(`Claude Portfolio Trader starting (runDate=${runDate}, forced=${forced})`);
    await st.logActivity('cron_start', { runDate, forced });

    if (!forced) {
      if (!(await st.isActive())) {
        log('Bot is INACTIVE (store `active` is not "true"). Nothing to do.');
        return { status: 'inactive', runDate };
      }
      log('Bot is ACTIVE. Proceeding.');
    } else {
      log('Forced run: bypassing the schedule and the on/off switch.');
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

    const analystMeta = (memoModel) => ({
      model: analysis.meta.model,
      fellBack: analysis.meta.fellBack ?? false,
      memoModel,
      stopReason: analysis.meta.stopReason,
      webSearchesUsed: analysis.meta.webSearchesUsed,
      inputTokens: analysis.meta.usage?.inputTokens ?? null,
      outputTokens: analysis.meta.usage?.outputTokens ?? null,
    });
    const recordFrom = (results, extra) => ({
      runDate,
      timestamp: new Date(d.now()).toISOString(),
      durationSec: secondsSince(),
      forced,
      summary: analysis.recommendations?.summary || null,
      briefingErrors: briefing.errors,
      briefing,
      recommendations: enrich(results),
      ...extra,
    });

    // If systemd stops the run while orders are out, archive what is known.
    onSigterm = async () => {
      log('SIGTERM while orders were out: archiving what is known.');
      try {
        if (partialRecord) {
          await st.archiveRun({ ...partialRecord, status: 'interrupted', durationSec: secondsSince() });
        }
        await st.logActivity('run_failed', {
          runDate,
          ordersPlaced,
          error: 'interrupted (SIGTERM) before the run finished',
          text: 'Run interrupted after orders were placed; see the run record',
        });
      } finally {
        process.exit(1);
      }
    };
    process.once('SIGTERM', onSigterm);

    // ── 5. Execute ──────────────────────────────────────────────────────────
    // Orders go to the live brokerage account unconditionally. This is REAL
    // money and there is no dry-run rail: if a run reaches this line, it
    // trades.
    log('Running executor (live)...');
    ordersPlaced = true;
    const onProgress = async ({ sellResults, deferredBuys, waitUntil }) => {
      const until = new Date(waitUntil).toISOString();
      partialRecord = recordFrom(
        [
          ...sellResults,
          ...deferredBuys.map((rec) => ({ recommendation: rec, status: 'pending', reason: `waiting for sells to fill (until ${until})` })),
        ],
        {
          status: 'in_progress',
          analystMeta: analystMeta(null),
          executor: { total: sellResults.length + deferredBuys.length, executed: sellResults.filter((r) => r.status === 'executed').length, skipped: 0, failed: 0, alreadySubmitted: 0 },
        }
      );
      await st.archiveRun(partialRecord);
      await st.logActivity('orders_waiting', {
        runDate,
        text: `Sells submitted; ${deferredBuys.length} buy(s) wait for them to fill (until ${until})`,
      });
      log(`Sells submitted; ${deferredBuys.length} buy(s) waiting for fills until ${until}. Partial record archived.`);
    };
    const execResult = await d
      .makeExecutor(secrets, runDate, { deadlineAt: startedAt + RUN_BUDGET_MS - MEMO_RESERVE_MS, onProgress })
      .execute(analysis.recommendations);
    log(`Executor done: ${JSON.stringify(execResult.summary)}`);
    for (const notice of execResult.notices || []) log(`  Executor notice: ${notice}`);

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
    const runRecord = recordFrom(execResult.results, {
      analystMeta: analystMeta(memoResult?.meta.model ?? null),
      executor: execResult.summary,
      executorTimeline: execResult.timeline || null,
      executorNotices: execResult.notices || [],
    });

    try {
      await st.archiveRun(runRecord);
      partialRecord = null;
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
    const enrichedRecs = runRecord.recommendations;
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
      durationSec: secondsSince(),
      recCount: enrichedRecs.length,
      summary: execResult.summary,
    });

    return result;
  } catch (err) {
    const durationSec = secondsSince();
    log(`Pipeline FAILED after ${durationSec}s: ${err.stack || err.message}`);
    if (partialRecord) {
      try {
        await st.archiveRun({ ...partialRecord, status: 'failed', durationSec });
      } catch {
        /* the activity entry below still records the failure */
      }
    }
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
  } finally {
    if (onSigterm) process.removeListener('SIGTERM', onSigterm);
    st.markRunFinished();
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
