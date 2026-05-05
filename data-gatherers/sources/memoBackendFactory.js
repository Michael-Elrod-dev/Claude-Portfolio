'use strict';

const path = require('node:path');
const LocalFileBackend = require('./backends/LocalFileBackend');
const S3Backend = require('./backends/S3Backend');

/**
 * Picks the right memo backend based on environment variables.
 *
 *   MEMO_S3_BUCKET set    → S3Backend (production)
 *   otherwise             → LocalFileBackend (development)
 *
 * Centralized so every runner that touches the memo (run-memo,
 * run-briefing, run-analyst, run-memo-updater, eventually the Lambda
 * handler) makes the same choice the same way.
 */
function memoBackendFromEnv() {
  if (process.env.MEMO_S3_BUCKET) {
    return new S3Backend({
      bucket: process.env.MEMO_S3_BUCKET,
      key: process.env.MEMO_S3_KEY || 'memo.json',
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }
  return new LocalFileBackend({
    path: process.env.MEMO_LOCAL_PATH || path.join(__dirname, '..', 'memo.json'),
  });
}

module.exports = { memoBackendFromEnv };
