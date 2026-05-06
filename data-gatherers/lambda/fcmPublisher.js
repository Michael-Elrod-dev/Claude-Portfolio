'use strict';

/**
 * Publishes push notifications to all registered Android devices.
 *
 * This module is intentionally **lazy and degraded by default** so the
 * pipeline can ship before Firebase is configured. If the FCM service
 * account secret doesn't exist yet, publish() is a no-op that logs and
 * returns — it never fails the pipeline run.
 *
 * Notification kinds (mirror the handoff README):
 *   - run_complete       — fired after every successful run
 *   - queued_for_review  — fired when at least one rec is queued for review
 *   - briefing_error     — fired when briefing.errors[] is non-empty
 *   - run_failed         — fired when the pipeline threw before completing
 *
 * Secret layout: a single JSON blob in Secrets Manager at
 *   claude-portfolio/fcm-sa
 * containing the Firebase service-account key downloaded from the Firebase
 * console (Project Settings → Service Accounts → Generate new private key).
 *
 * Tokens table: claude-portfolio-devices, PK `token` (S). The API Lambda
 * upserts into this table when the app POSTs /devices.
 */

const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
} = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-1';
const FCM_SECRET_NAME = process.env.FCM_SECRET_NAME || 'claude-portfolio/fcm-sa';
const DEVICES_TABLE = process.env.DEVICES_TABLE || 'claude-portfolio-devices';

const sm = new SecretsManagerClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

let cachedAdmin = null;
let initFailed = false;

async function getFirebaseAdmin() {
  if (cachedAdmin) return cachedAdmin;
  if (initFailed) return null;

  let serviceAccount;
  try {
    const response = await sm.send(
      new GetSecretValueCommand({ SecretId: FCM_SECRET_NAME })
    );
    serviceAccount = JSON.parse(response.SecretString);
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      console.log(
        `[fcmPublisher] Secret ${FCM_SECRET_NAME} not configured yet — skipping push.`
      );
    } else {
      console.warn(`[fcmPublisher] Could not load FCM secret: ${err.message}`);
    }
    initFailed = true;
    return null;
  }

  let admin;
  try {
    // Lazy require so the lambda bundle can ship before firebase-admin is
    // installed. If the package isn't there, we skip cleanly.
    admin = require('firebase-admin');
  } catch (err) {
    console.log(
      '[fcmPublisher] firebase-admin not installed — skipping push.'
    );
    initFailed = true;
    return null;
  }

  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
  cachedAdmin = admin;
  return admin;
}

async function loadTokens() {
  const out = await ddb.send(new ScanCommand({ TableName: DEVICES_TABLE }));
  return (out.Items || []).map((i) => i.token).filter(Boolean);
}

/**
 * @param {string} kind  - run_complete | queued_for_review | briefing_error | run_failed
 * @param {object} data  - small key/value payload, all string-stringified by the Android client
 *                         (FCM data-only payloads must be flat strings)
 */
async function publish(kind, data = {}) {
  const admin = await getFirebaseAdmin();
  if (!admin) return { sent: 0, skipped: true };

  let tokens;
  try {
    tokens = await loadTokens();
  } catch (err) {
    console.warn(`[fcmPublisher] Could not list device tokens: ${err.message}`);
    return { sent: 0, error: err.message };
  }
  if (tokens.length === 0) return { sent: 0, skipped: 'no-devices' };

  const stringData = Object.fromEntries(
    Object.entries({ kind, ...data }).map(([k, v]) => [k, String(v)])
  );

  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      data: stringData,
      android: { priority: 'high' },
    });
    return { sent: response.successCount, failed: response.failureCount };
  } catch (err) {
    console.warn(`[fcmPublisher] Send failed: ${err.message}`);
    return { sent: 0, error: err.message };
  }
}

module.exports = { publish };
