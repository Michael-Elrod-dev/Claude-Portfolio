'use strict';

/**
 * Read the persistent memo from S3. Mirrors the LocalFileBackend +
 * S3Backend pattern in data-gatherers/sources/backends, but the API only
 * needs read access so we keep this trivially small.
 */

const {
  S3Client,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');

const REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.MEMO_S3_BUCKET || `claude-portfolio-${process.env.AWS_ACCOUNT_ID || ''}`;
const KEY = process.env.MEMO_S3_KEY || 'memo.json';

const s3 = new S3Client({ region: REGION });

async function readMemo() {
  if (!BUCKET || BUCKET.endsWith('-')) {
    throw new Error(
      'MEMO_S3_BUCKET env var is not set on the API Lambda.'
    );
  }
  try {
    const out = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: KEY })
    );
    const body = await out.Body.transformToString();
    return JSON.parse(body);
  } catch (err) {
    if (err.name === 'NoSuchKey') return null;
    throw err;
  }
}

module.exports = { readMemo };
