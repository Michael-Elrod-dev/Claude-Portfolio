'use strict';

/**
 * GET /briefing/latest — extract the briefing JSON from the newest run
 * record. The pipeline embeds the full briefing in each archived run, so
 * the briefing inspector in the app's Settings screen is just a projection
 * over the runs table.
 */

const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb, TABLES } = require('../services/ddb');
const { ok, notFound } = require('../respond');

async function getBriefingLatest() {
  const out = await ddb.send(new ScanCommand({ TableName: TABLES.RUNS }));
  const items = out.Items || [];
  if (items.length === 0) return notFound('no runs archived yet');
  items.sort((a, b) => (a.runDate < b.runDate ? 1 : -1));
  const latest = items[0];
  if (!latest.briefing) return notFound('latest run has no briefing snapshot');
  return ok({ runDate: latest.runDate, briefing: latest.briefing });
}

module.exports = { getBriefingLatest };
