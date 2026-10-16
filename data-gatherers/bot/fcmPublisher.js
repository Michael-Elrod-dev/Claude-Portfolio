'use strict';

/**
 * Publishes push notifications to all registered Android devices.
 *
 * Best-effort by design: if the Firebase service-account file isn't
 * configured, publish() logs and returns without failing the run.
 *
 * Notification kinds:
 *   - run_complete       — fired after every successful run
 *   - briefing_error     — fired when briefing.errors[] is non-empty
 *   - run_failed         — fired when the pipeline threw before completing
 *
 * FCM_SERVICE_ACCOUNT_FILE points at the Firebase service-account key
 * (Firebase console → Project Settings → Service Accounts → Generate new
 * private key). Device tokens come from the store; the API's POST /devices
 * registers them.
 */

const fs = require('node:fs');
const { deviceTokens } = require('./store');

let cachedAdmin = null;
let initFailed = false;

function getFirebaseAdmin() {
  if (cachedAdmin) return cachedAdmin;
  if (initFailed) return null;

  const keyFile = process.env.FCM_SERVICE_ACCOUNT_FILE;
  let serviceAccount;
  try {
    if (!keyFile) throw Object.assign(new Error('FCM_SERVICE_ACCOUNT_FILE is not set'), { code: 'UNSET' });
    serviceAccount = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  } catch (err) {
    console.log(`[fcmPublisher] No Firebase key (${err.code || err.message}) — skipping push.`);
    initFailed = true;
    return null;
  }

  const admin = require('firebase-admin');
  if (admin.apps.length === 0) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  cachedAdmin = admin;
  return admin;
}

/**
 * @param {string} kind  - run_complete | briefing_error | run_failed
 * @param {object} data  - small key/value payload (FCM data-only payloads must be flat strings)
 */
async function publish(kind, data = {}) {
  const admin = getFirebaseAdmin();
  if (!admin) return { sent: 0, skipped: true };

  let tokens;
  try {
    tokens = await deviceTokens();
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
