'use strict';

/**
 * Bearer-token auth. The token is one shared random string in
 * API_BEARER_TOKEN (from /etc/claude-portfolio/secrets.env on the laptop),
 * pasted into the Android app once. Comparison is constant-time so response
 * latency can't leak the token.
 */

const crypto = require('node:crypto');

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

/** @returns {{ok: boolean}} */
function checkAuth(event, expected = process.env.API_BEARER_TOKEN) {
  if (!expected) {
    console.error('[auth] API_BEARER_TOKEN is not set; refusing every request.');
    return { ok: false };
  }
  const header = event.headers?.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/);
  if (!match) return { ok: false };
  return { ok: constantTimeEquals(match[1], expected) };
}

module.exports = { checkAuth };
