'use strict';

/**
 * GET/PUT /flags/active.
 *
 * Active controls scheduled cron runs. The pipeline handler reads it on
 * every invocation and exits early if false (unless invoked with force).
 *
 * This is the only flag. There used to be a `live` flag that chose between
 * dry-run and real order placement; it was removed along with the paper
 * account, so every run that gets past `active` places real orders. That
 * makes this endpoint — together with the two EventBridge rules — the off
 * switch for the whole system.
 *
 * PUT body: { value: true | false }.
 */

const { getFlag, setFlag } = require('../services/ssm');
const { ok, badRequest } = require('../respond');

const ACTIVE = 'claude-portfolio-active';

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

async function putActive(event) {
  const body = parseBody(event);
  if (body === null || typeof body.value !== 'boolean') {
    return badRequest('body must be { "value": true | false }');
  }
  await setFlag(ACTIVE, body.value);
  return ok({ name: ACTIVE, value: body.value });
}

module.exports = { getActive, putActive };
