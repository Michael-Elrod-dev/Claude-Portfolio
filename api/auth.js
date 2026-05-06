'use strict';

/**
 * Bearer-token auth for the API Lambda.
 *
 * The token is a single shared random string stored in Secrets Manager at
 *   claude-portfolio/api-bearer-token
 * and copy-pasted into the Android app on first launch.
 *
 * Comparison is constant-time so timing attacks can't leak the token by
 * probing the response latency. Cached across warm invocations — we only
 * pay one Secrets Manager call per cold start.
 */

const crypto = require('crypto');
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');

const REGION = process.env.AWS_REGION || 'us-east-1';
const BEARER_SECRET_NAME =
  process.env.BEARER_SECRET_NAME || 'claude-portfolio/api-bearer-token';

const sm = new SecretsManagerClient({ region: REGION });

let cachedToken = null;

async function loadToken() {
  if (cachedToken) return cachedToken;
  const out = await sm.send(
    new GetSecretValueCommand({ SecretId: BEARER_SECRET_NAME })
  );
  if (!out.SecretString) {
    throw new Error(
      `Secret ${BEARER_SECRET_NAME} exists but has no SecretString.`
    );
  }
  // Allow either a raw string or a JSON object { token: "..." }.
  let token;
  try {
    const parsed = JSON.parse(out.SecretString);
    token = parsed.token || parsed.value || null;
  } catch {
    token = out.SecretString.trim();
  }
  if (!token) throw new Error(`Secret ${BEARER_SECRET_NAME} has no token.`);
  cachedToken = token;
  return cachedToken;
}

function constantTimeEquals(a, b) {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still do a comparison so timing doesn't leak the length difference.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * @param {object} event - Lambda Function URL event
 * @returns {Promise<{ok: boolean}>}
 */
async function checkAuth(event) {
  const headers = event.headers || {};
  const auth = headers.authorization || headers.Authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/);
  if (!match) return { ok: false };

  let expected;
  try {
    expected = await loadToken();
  } catch (err) {
    console.error(`[auth] Could not load bearer token: ${err.message}`);
    return { ok: false };
  }

  return { ok: constantTimeEquals(match[1], expected) };
}

module.exports = { checkAuth };
