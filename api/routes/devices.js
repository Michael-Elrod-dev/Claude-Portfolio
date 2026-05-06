'use strict';

/**
 * POST /devices — upsert an FCM token for push notifications.
 *
 * The Android app calls this on first launch and again whenever the token
 * changes (FCM rotates them). We never delete; tokens that no longer work
 * get pruned the next time the publisher tries to send to them (FCM
 * returns an `UNREGISTERED` error and we skip).
 *
 * Body: { token: "...", platform?: "android", appVersion?: "..." }
 */

const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb, TABLES } = require('../services/ddb');
const { ok, badRequest } = require('../respond');

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

async function postDevice(event) {
  const body = parseBody(event);
  if (!body || typeof body.token !== 'string' || !body.token.trim()) {
    return badRequest('body must be { "token": "...", platform?: "android" }');
  }
  const item = {
    token: body.token.trim(),
    platform: body.platform || 'android',
    appVersion: body.appVersion || null,
    registeredAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLES.DEVICES, Item: item }));
  return ok({ registered: true });
}

module.exports = { postDevice };
