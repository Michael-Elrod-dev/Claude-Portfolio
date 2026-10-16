'use strict';

/**
 * GET/PUT /flags/active.
 *
 * Active controls scheduled runs. The bot reads it on every scheduled run
 * and exits early if false (forced runs bypass it). Every run that gets
 * past it places real orders, so this endpoint is the off switch for the
 * whole system.
 *
 * PUT body: { value: true | false }.
 */

const { isActive, setActive } = require('../services/store');
const { ok, badRequest } = require('../respond');
const { parseBody } = require('../body');

// The wire name the app already knows.
const ACTIVE = 'claude-portfolio-active';

async function getActive() {
  return ok({ name: ACTIVE, value: await isActive() });
}

async function putActive(event) {
  const body = parseBody(event);
  if (body === null || typeof body.value !== 'boolean') {
    return badRequest('body must be { "value": true | false }');
  }
  await setActive(body.value);
  return ok({ name: ACTIVE, value: body.value });
}

module.exports = { getActive, putActive };
