'use strict';

/** GET /activity?limit=N — newest-first event log. */

const { listActivity } = require('../services/store');
const { ok } = require('../respond');

async function getActivity(event) {
  const limit = Math.min(parseInt(event.queryStringParameters?.limit, 10) || 50, 200);
  return ok({ events: await listActivity(limit) });
}

module.exports = { getActivity };
