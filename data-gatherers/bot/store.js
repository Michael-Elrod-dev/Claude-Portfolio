'use strict';

/**
 * Everything the bot and the API persist, as plain files in one directory.
 * Both processes run as the same user on the same box, so there is no
 * database: each file is small and written atomically (tmp + rename), so a
 * reader never sees half a write.
 *
 * Layout under PORTFOLIO_DATA_DIR (default ./data next to this package):
 *   memo.json            Claude's working memory, rewritten every run
 *   congressional.json   snapshot written by the congressional runner
 *   runs/YYYY-MM-DD.json one record per run date (a same-day forced run
 *                        overwrites the scheduled one; the activity log keeps both)
 *   activity.jsonl       append-only event log, newest last
 *   devices.json         FCM tokens keyed by token
 *   active               "true" or "false": the only on/off switch for scheduled runs
 *   force-run            present while a forced run is queued (the API makes it,
 *                        a systemd path unit starts the bot, the bot removes it)
 *
 * Runs and activity older than RETENTION_DAYS are pruned on write.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const LocalFileBackend = require('../sources/backends/LocalFileBackend');

const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

function dataDir() {
  return process.env.PORTFOLIO_DATA_DIR || path.join(__dirname, '..', 'data');
}

function file(...parts) {
  return path.join(dataDir(), ...parts);
}

async function writeAtomic(target, body) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, body, 'utf8');
  await fsp.rename(tmp, target);
}

async function readJson(target, fallback) {
  try {
    return JSON.parse(await fsp.readFile(target, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

// ── memo + congressional snapshot ───────────────────────────────────────────

function memoBackend() {
  return new LocalFileBackend({ path: file('memo.json') });
}

function congressionalBackend() {
  return new LocalFileBackend({ path: file('congressional.json') });
}

// ── runs ────────────────────────────────────────────────────────────────────

const RUN_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

async function archiveRun(record) {
  if (!record || !RUN_FILE.test(`${record.runDate}.json`)) {
    throw new Error('archiveRun requires a record with runDate YYYY-MM-DD');
  }
  await writeAtomic(file('runs', `${record.runDate}.json`), JSON.stringify(record));
  await pruneRuns();
}

async function runDates() {
  let names;
  try {
    names = await fsp.readdir(file('runs'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return names
    .map((n) => n.match(RUN_FILE)?.[1])
    .filter(Boolean)
    .sort()
    .reverse(); // newest first
}

async function getRun(runDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) return null;
  return readJson(file('runs', `${runDate}.json`), null);
}

/** Every archived run, newest first. */
async function listRuns() {
  const dates = await runDates();
  const runs = await Promise.all(dates.map(getRun));
  return runs.filter(Boolean);
}

async function pruneRuns(now = Date.now()) {
  const cutoff = new Date(now - RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10);
  for (const d of await runDates()) {
    if (d < cutoff) await fsp.rm(file('runs', `${d}.json`), { force: true });
  }
}

// ── activity ────────────────────────────────────────────────────────────────

/**
 * Appends one event. Best-effort: a failure is logged, never thrown, so a
 * full disk can't abort a run that is already placing orders.
 */
async function logActivity(kind, payload = {}) {
  const event = { timestamp: new Date().toISOString(), kind, payload };
  try {
    await fsp.mkdir(dataDir(), { recursive: true });
    // If a crash left a torn last line, start on a fresh one so this event
    // isn't glued onto it and lost with it.
    const sep = (await endsWithNewline(file('activity.jsonl'))) ? '' : '\n';
    await fsp.appendFile(file('activity.jsonl'), `${sep}${JSON.stringify(event)}\n`, 'utf8');
    if (kind === 'cron_start') await pruneActivity();
  } catch (err) {
    console.error(`[store] Failed to log ${kind}: ${err.message}`);
  }
}

async function endsWithNewline(target) {
  let fh;
  try {
    fh = await fsp.open(target, 'r');
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    throw err;
  }
  try {
    const { size } = await fh.stat();
    if (size === 0) return true;
    const buf = Buffer.alloc(1);
    await fh.read(buf, 0, 1, size - 1);
    return buf[0] === 0x0a;
  } finally {
    await fh.close();
  }
}

async function readActivity() {
  let raw;
  try {
    raw = await fsp.readFile(file('activity.jsonl'), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const events = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* a torn last line from a crash: skip it */
    }
  }
  return events;
}

/** Newest-first, at most `limit` events. */
async function listActivity(limit = 50) {
  return (await readActivity()).reverse().slice(0, limit);
}

async function pruneActivity(now = Date.now()) {
  const cutoff = new Date(now - RETENTION_DAYS * DAY_MS).toISOString();
  const events = await readActivity();
  const kept = events.filter((e) => e.timestamp >= cutoff);
  if (kept.length === events.length) return;
  await writeAtomic(file('activity.jsonl'), kept.map((e) => `${JSON.stringify(e)}\n`).join(''));
}

// ── devices ─────────────────────────────────────────────────────────────────

async function registerDevice({ token, platform = 'android', appVersion = null }) {
  const devices = await readJson(file('devices.json'), {});
  devices[token] = { token, platform, appVersion, registeredAt: new Date().toISOString() };
  await writeAtomic(file('devices.json'), JSON.stringify(devices, null, 2));
}

async function deviceTokens() {
  return Object.keys(await readJson(file('devices.json'), {}));
}

// ── on/off switch + forced runs ─────────────────────────────────────────────

/** A missing switch reads as off, so a fresh box never trades by accident. */
async function isActive() {
  try {
    return (await fsp.readFile(file('active'), 'utf8')).trim() === 'true';
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

async function setActive(value) {
  await writeAtomic(file('active'), value ? 'true\n' : 'false\n');
}

async function requestForcedRun() {
  await writeAtomic(file('force-run'), `${new Date().toISOString()}\n`);
}

/** True if a forced run was queued; removes the request either way. */
function consumeForcedRun() {
  try {
    fs.rmSync(file('force-run'));
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

module.exports = {
  RETENTION_DAYS,
  dataDir,
  memoBackend,
  congressionalBackend,
  archiveRun,
  getRun,
  listRuns,
  pruneRuns,
  logActivity,
  listActivity,
  pruneActivity,
  registerDevice,
  deviceTokens,
  isActive,
  setActive,
  requestForcedRun,
  consumeForcedRun,
};
