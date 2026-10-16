'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const store = require('./store');

function useTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-store-'));
  const prev = process.env.PORTFOLIO_DATA_DIR;
  process.env.PORTFOLIO_DATA_DIR = dir;
  t.after(() => {
    if (prev === undefined) delete process.env.PORTFOLIO_DATA_DIR;
    else process.env.PORTFOLIO_DATA_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

test('runs: newest first, same-day overwrite, unknown date is null', async (t) => {
  useTempDir(t);
  await store.archiveRun({ runDate: daysAgo(3), summary: 'older' });
  await store.archiveRun({ runDate: daysAgo(1), summary: 'first' });
  await store.archiveRun({ runDate: daysAgo(1), summary: 'forced rerun' });

  const runs = await store.listRuns();
  assert.deepEqual(runs.map((r) => r.summary), ['forced rerun', 'older']);
  assert.equal((await store.getRun(daysAgo(3))).summary, 'older');
  assert.equal(await store.getRun('2000-01-01'), null);
  assert.equal(await store.getRun('../etc/passwd'), null, 'only YYYY-MM-DD is a valid key');
});

test('runs older than the retention window are pruned on write', async (t) => {
  useTempDir(t);
  await store.archiveRun({ runDate: daysAgo(store.RETENTION_DAYS + 5), summary: 'stale' });
  await store.archiveRun({ runDate: daysAgo(0), summary: 'today' });
  assert.deepEqual((await store.listRuns()).map((r) => r.summary), ['today']);
});

test('archiveRun rejects a record without a valid runDate', async (t) => {
  useTempDir(t);
  await assert.rejects(store.archiveRun({ summary: 'x' }), /runDate/);
  await assert.rejects(store.archiveRun({ runDate: '../x' }), /runDate/);
});

test('activity: newest first, limited, and a torn line is skipped', async (t) => {
  const dir = useTempDir(t);
  await store.logActivity('cron_start', { runDate: 'a' });
  await store.logActivity('briefing_complete', { symbols: 3 });
  fs.appendFileSync(path.join(dir, 'activity.jsonl'), '{"timestamp":"torn');
  await store.logActivity('run_complete', {});

  const events = await store.listActivity(2);
  assert.deepEqual(events.map((e) => e.kind), ['run_complete', 'briefing_complete']);
  assert.equal((await store.listActivity(50)).length, 3);
});

test('activity older than the retention window is pruned at cron_start', async (t) => {
  const dir = useTempDir(t);
  const old = { timestamp: new Date(Date.now() - 40 * 86_400_000).toISOString(), kind: 'run_complete', payload: {} };
  fs.writeFileSync(path.join(dir, 'activity.jsonl'), `${JSON.stringify(old)}\n`);
  await store.logActivity('cron_start', {});
  assert.deepEqual((await store.listActivity(50)).map((e) => e.kind), ['cron_start']);
});

test('logActivity never throws, even when the data dir is unusable', async (t) => {
  const dir = useTempDir(t);
  fs.writeFileSync(path.join(dir, 'blocker'), 'x');
  process.env.PORTFOLIO_DATA_DIR = path.join(dir, 'blocker', 'nested');
  t.mock.method(console, 'error', () => {});
  await assert.doesNotReject(store.logActivity('cron_start', {}));
});

test('devices: upsert by token', async (t) => {
  useTempDir(t);
  await store.registerDevice({ token: 'a', appVersion: '1' });
  await store.registerDevice({ token: 'b' });
  await store.registerDevice({ token: 'a', appVersion: '2' });
  assert.deepEqual((await store.deviceTokens()).sort(), ['a', 'b']);
});

test('the switch reads as off until it is set', async (t) => {
  useTempDir(t);
  assert.equal(await store.isActive(), false);
  await store.setActive(true);
  assert.equal(await store.isActive(), true);
  await store.setActive(false);
  assert.equal(await store.isActive(), false);
});

test('a forced-run request is consumed exactly once', async (t) => {
  useTempDir(t);
  assert.equal(store.consumeForcedRun(), false);
  await store.requestForcedRun();
  assert.equal(store.consumeForcedRun(), true);
  assert.equal(store.consumeForcedRun(), false);
});

test('memo backend writes atomically and reads back', async (t) => {
  const dir = useTempDir(t);
  const memo = store.memoBackend();
  assert.equal(await memo.read(), null);
  await memo.write('{"watchlist":["AMD"]}');
  assert.equal(await memo.read(), '{"watchlist":["AMD"]}');
  assert.deepEqual(fs.readdirSync(dir), ['memo.json'], 'no temp files left behind');
});
