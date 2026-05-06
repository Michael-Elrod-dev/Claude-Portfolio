'use strict';

/**
 * Append-only event log read by the Android Settings → Recent activity
 * screen and surfaced via GET /activity?limit=N.
 *
 * Table: claude-portfolio-activity
 *   PK: pk (S)        — always literal "activity" (single partition is
 *                       fine at our volume; lets queries return events in
 *                       reverse-chronological order with one Query call).
 *   SK: timestamp (S) — ISO timestamp; query with ScanIndexForward=false
 *                       for newest-first.
 *   TTL on `expiresAt` epoch seconds — items auto-purge after 90 days.
 *
 * Event kinds the app cares about (matches the handoff README):
 *   - cron_start         — pipeline began (scheduled or forced)
 *   - briefing_complete  — assembler finished
 *   - run_complete       — full pipeline finished successfully
 *   - run_failed         — pipeline threw before completing
 *   - briefing_error     — non-fatal source failure (one event per source error)
 *   - memo_write         — memo updater wrote new memo
 *
 * Writes are best-effort: failures are logged but do not propagate.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
} = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-1';
const TABLE_NAME = process.env.ACTIVITY_TABLE || 'claude-portfolio-activity';
const TTL_DAYS = 30;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

/**
 * @param {string} kind - one of cron_start | briefing_complete | run_complete | run_failed | briefing_error | memo_write
 * @param {object} [payload] - event-specific data; rendered as a single short text on the device
 */
async function logActivity(kind, payload = {}) {
  const now = new Date();
  const item = {
    pk: 'activity',
    timestamp: now.toISOString(),
    kind,
    payload,
    expiresAt: Math.floor(now.getTime() / 1000) + TTL_DAYS * 24 * 60 * 60,
  };

  try {
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  } catch (err) {
    console.error(`[activityLogger] Failed to log ${kind}: ${err.message}`);
  }
}

module.exports = { logActivity };
