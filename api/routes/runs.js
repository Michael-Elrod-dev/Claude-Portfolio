'use strict';

/**
 * Run-archive endpoints. Reads from claude-portfolio-runs (PK runDate).
 *
 *   GET /runs/latest    — most recent row (Scan + sort by runDate desc, take 1)
 *   GET /runs/{date}    — exact item by runDate
 *   GET /runs?limit=N   — list of compact rows for the History screen
 *
 * Why Scan instead of Query: PK is `runDate` (single key), so we don't have
 * a partition we can Query on. The runs table is small (one row per
 * scheduled run, plus the occasional forced run). Even after a year that's
 * ~100 rows — Scan is comfortably fine and one read unit per call.
 */

const {
  ScanCommand,
  GetCommand,
} = require('@aws-sdk/lib-dynamodb');
const { ddb, TABLES } = require('../services/ddb');
const { ok, notFound, badRequest } = require('../respond');

function compactRow(item) {
  return {
    runDate: item.runDate,
    timestamp: item.timestamp,
    durationSec: item.durationSec,
    dryRun: item.dryRun,
    forced: item.forced,
    summary: item.summary,
    recCount: Array.isArray(item.recommendations) ? item.recommendations.length : 0,
    executor: item.executor,
    briefingErrors: item.briefingErrors || [],
  };
}

async function fetchAllRunsSorted() {
  const out = await ddb.send(new ScanCommand({ TableName: TABLES.RUNS }));
  const items = out.Items || [];
  items.sort((a, b) => (a.runDate < b.runDate ? 1 : -1)); // newest first
  return items;
}

async function getRunsLatest() {
  const items = await fetchAllRunsSorted();
  if (items.length === 0) return notFound('no runs archived yet');
  return ok({ run: items[0] });
}

async function getRunByDate(_event, params) {
  const date = params[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return badRequest('runDate must be YYYY-MM-DD');
  }
  const out = await ddb.send(
    new GetCommand({ TableName: TABLES.RUNS, Key: { runDate: date } })
  );
  if (!out.Item) return notFound(`no run for ${date}`);
  return ok({ run: out.Item });
}

async function getRunsList(event) {
  const limitStr = event.queryStringParameters?.limit;
  const limit = Math.min(
    parseInt(limitStr, 10) || 20,
    100
  );
  const items = await fetchAllRunsSorted();
  return ok({
    runs: items.slice(0, limit).map(compactRow),
    total: items.length,
  });
}

module.exports = { getRunsLatest, getRunByDate, getRunsList };
