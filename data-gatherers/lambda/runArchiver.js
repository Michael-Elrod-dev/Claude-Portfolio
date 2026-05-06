'use strict';

/**
 * Persists the per-run record that the Android app reads back through
 * GET /runs/latest, GET /runs/{date}, GET /runs?limit=N, and
 * GET /briefing/latest.
 *
 * Table: claude-portfolio-runs
 *   PK: runDate (S)  — ISO date "YYYY-MM-DD"
 *
 * If two runs happen on the same date (e.g. a forced manual run after a
 * scheduled run), the later one overwrites the earlier one. That matches
 * the app's "one row per run date" UX. The activity log preserves both.
 *
 * Writes are best-effort: a failure here logs to CloudWatch but does NOT
 * abort the pipeline run. The run already happened on Alpaca; losing the
 * archive is annoying but not catastrophic.
 */

const {
  DynamoDBClient,
} = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
} = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-1';
const TABLE_NAME = process.env.RUNS_TABLE || 'claude-portfolio-runs';
const TTL_DAYS = 30;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

/**
 * @param {object} record - shape consumed by the Android app
 * @param {string} record.runDate - "YYYY-MM-DD"
 * @param {string} record.timestamp - ISO timestamp the run finished
 * @param {number} record.durationSec
 * @param {boolean} record.dryRun
 * @param {boolean} record.forced
 * @param {string} record.summary - Analyst's prose summary
 * @param {object} record.analystMeta - { model, stopReason, webSearchesUsed, inputTokens, outputTokens, costUsd }
 * @param {Array}  record.recommendations - enriched with status, orderId, sizing
 * @param {object} record.executor - tally { total, executed, queuedForReview, skipped, failed, dryRun, alreadySubmitted }
 * @param {Array}  record.briefingErrors
 * @param {object} record.briefing - full briefing JSON for the inspector
 */
async function archiveRun(record) {
  if (!record || !record.runDate) {
    throw new Error('archiveRun requires a record with runDate');
  }

  // expiresAt = epoch seconds, 30 days from write time. Dynamo TTL on the
  // runs table reads this attribute and purges the row when it elapses.
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_DAYS * 24 * 60 * 60;

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { ...record, expiresAt },
    })
  );
}

module.exports = { archiveRun };
