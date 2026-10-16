'use strict';

/**
 * Run-archive endpoints, read from the store's runs/ directory.
 *
 *   GET /runs/latest    — most recent run record
 *   GET /runs/{date}    — exact record by runDate
 *   GET /runs?limit=N   — compact rows for the History screen
 */

const { listRuns, getRun } = require('../services/store');
const { ok, notFound, badRequest } = require('../respond');

function compactRow(item) {
  return {
    runDate: item.runDate,
    timestamp: item.timestamp,
    durationSec: item.durationSec,
    forced: item.forced,
    summary: item.summary,
    recCount: Array.isArray(item.recommendations) ? item.recommendations.length : 0,
    executor: item.executor,
    briefingErrors: item.briefingErrors || [],
  };
}

async function getRunsLatest() {
  const [latest] = await listRuns();
  if (!latest) return notFound('no runs archived yet');
  return ok({ run: latest });
}

async function getRunByDate(_event, params) {
  const date = params[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return badRequest('runDate must be YYYY-MM-DD');
  }
  const run = await getRun(date);
  if (!run) return notFound(`no run for ${date}`);
  return ok({ run });
}

async function getRunsList(event) {
  const limit = Math.min(parseInt(event.queryStringParameters?.limit, 10) || 20, 100);
  const items = await listRuns();
  return ok({
    runs: items.slice(0, limit).map(compactRow),
    total: items.length,
  });
}

module.exports = { getRunsLatest, getRunByDate, getRunsList };
