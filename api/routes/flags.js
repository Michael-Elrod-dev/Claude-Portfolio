'use strict';

/**
 * GET/PUT /flags/active and /flags/live.
 *
 * Active controls scheduled cron runs. The pipeline handler reads it on
 * every invocation and exits early if false (unless invoked with force).
 *
 * Live controls real order placement. The pipeline reads it from SSM
 * with a fallback to the EXECUTOR_LIVE env var. Defaults to false (dry-run).
 *
 * PUT body: { value: true | false }.
 */

const { getFlag, setFlag } = require('../services/ssm');
const { ok, badRequest } = require('../respond');

const ACTIVE = 'claude-portfolio-active';
const LIVE = 'claude-portfolio-live';

function parseBody(event) {
  if (!event.body) return null;
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getActive() {
  return ok({ name: ACTIVE, value: await getFlag(ACTIVE) });
}

async function getLive() {
  return ok({ name: LIVE, value: await getFlag(LIVE) });
}

async function putActive(event) {
  const body = parseBody(event);
  if (body === null || typeof body.value !== 'boolean') {
    return badRequest('body must be { "value": true | false }');
  }
  await setFlag(ACTIVE, body.value);
  return ok({ name: ACTIVE, value: body.value });
}

async function putLive(event) {
  const body = parseBody(event);
  if (body === null || typeof body.value !== 'boolean') {
    return badRequest('body must be { "value": true | false }');
  }
  await setFlag(LIVE, body.value);
  return ok({ name: LIVE, value: body.value });
}

module.exports = { getActive, getLive, putActive, putLive };
