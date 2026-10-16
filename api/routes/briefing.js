'use strict';

/**
 * GET /briefing/latest — the briefing JSON embedded in the newest run
 * record. The briefing inspector in the app's Settings screen is just a
 * projection over the runs archive.
 */

const { listRuns } = require('../services/store');
const { ok, notFound } = require('../respond');

async function getBriefingLatest() {
  const [latest] = await listRuns();
  if (!latest) return notFound('no runs archived yet');
  if (!latest.briefing) return notFound('latest run has no briefing snapshot');
  return ok({ runDate: latest.runDate, briefing: latest.briefing });
}

module.exports = { getBriefingLatest };
