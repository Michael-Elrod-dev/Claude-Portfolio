'use strict';

/**
 * POST /devices — upsert an FCM token for push notifications.
 *
 * The Android app calls this on first launch and again whenever the token
 * changes (FCM rotates them).
 *
 * Body: { token: "...", platform?: "android", appVersion?: "..." }
 */

const { registerDevice } = require('../services/store');
const { ok, badRequest } = require('../respond');
const { parseBody } = require('../body');

async function postDevice(event) {
  const body = parseBody(event);
  if (!body || typeof body.token !== 'string' || !body.token.trim()) {
    return badRequest('body must be { "token": "...", platform?: "android" }');
  }
  await registerDevice({
    token: body.token.trim(),
    platform: body.platform || 'android',
    appVersion: body.appVersion || null,
  });
  return ok({ registered: true });
}

module.exports = { postDevice };
