'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createServer } = require('./server');
const store = require('./services/store');

const TOKEN = 'test-token-123';

async function startApi(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-api-'));
  const saved = { dir: process.env.PORTFOLIO_DATA_DIR, token: process.env.API_BEARER_TOKEN };
  process.env.PORTFOLIO_DATA_DIR = dir;
  process.env.API_BEARER_TOKEN = TOKEN;
  t.mock.method(console, 'log', () => {});

  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const [k, v] of [['PORTFOLIO_DATA_DIR', saved.dir], ['API_BEARER_TOKEN', saved.token]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const call = async (method, urlPath, { body, token = TOKEN } = {}) => {
    const res = await fetch(base + urlPath, {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
  return { dir, call };
}

test('/health is open; everything else needs the token', async (t) => {
  const { call } = await startApi(t);
  assert.equal((await call('GET', '/health', { token: null })).status, 200);
  assert.equal((await call('GET', '/memo', { token: null })).status, 401);
  assert.equal((await call('GET', '/memo', { token: 'wrong' })).status, 401);
  assert.equal((await call('GET', '/nope')).status, 404);
});

test('a missing API_BEARER_TOKEN refuses every request', async (t) => {
  const { call } = await startApi(t);
  delete process.env.API_BEARER_TOKEN;
  t.mock.method(console, 'error', () => {});
  assert.equal((await call('GET', '/memo', { token: '' })).status, 401);
  assert.equal((await call('GET', '/memo')).status, 401);
});

test('the on/off switch round-trips and rejects a bad body', async (t) => {
  const { call } = await startApi(t);
  assert.deepEqual((await call('GET', '/flags/active')).json, { name: 'claude-portfolio-active', value: false });
  assert.equal((await call('PUT', '/flags/active', { body: { value: true } })).status, 200);
  assert.equal(await store.isActive(), true);
  assert.equal((await call('PUT', '/flags/active', { body: 'not json' })).status, 400);
  assert.equal((await call('PUT', '/flags/active', { body: { value: 'yes' } })).status, 400);
});

test('POST /run/force queues exactly one forced run', async (t) => {
  const { call } = await startApi(t);
  const res = await call('POST', '/run/force');
  assert.equal(res.status, 202);
  assert.deepEqual(res.json, { status: 'triggered', forced: true });
  assert.equal(store.consumeForcedRun(), true);
  assert.equal(store.consumeForcedRun(), false);
});

test('POST /run/force is refused while a run is in progress or already queued', async (t) => {
  const { call } = await startApi(t);
  store.markRunStarted();
  const busy = await call('POST', '/run/force');
  assert.equal(busy.status, 409);
  assert.match(busy.json.error, /already in progress/);
  assert.equal(store.forcedRunQueued(), false, 'nothing was queued');
  store.markRunFinished();

  assert.equal((await call('POST', '/run/force')).status, 202);
  const again = await call('POST', '/run/force');
  assert.equal(again.status, 409);
  assert.match(again.json.error, /already queued/);
});

test('a running marker left by a dead process does not block a forced run', async (t) => {
  const { dir, call } = await startApi(t);
  fs.writeFileSync(path.join(dir, 'running'), JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: 'earlier' }));
  assert.equal((await call('POST', '/run/force')).status, 202);
});

test('POST /devices registers a token', async (t) => {
  const { call } = await startApi(t);
  assert.equal((await call('POST', '/devices', { body: {} })).status, 400);
  assert.equal((await call('POST', '/devices', { body: { token: ' abc ' } })).status, 200);
  assert.deepEqual(await store.deviceTokens(), ['abc']);
});

test('runs, briefing, memo and activity read from the store', async (t) => {
  const { call } = await startApi(t);
  assert.equal((await call('GET', '/runs/latest')).status, 404);
  assert.equal((await call('GET', '/memo')).status, 404);

  const today = new Date().toISOString().slice(0, 10);
  await store.archiveRun({
    runDate: today, timestamp: 't', durationSec: 5, forced: false, summary: 's',
    recommendations: [{ ticker: 'X' }], executor: { total: 1 }, briefingErrors: [],
    briefing: { generatedAt: 'g' },
  });
  await store.memoBackend().write('{"watchlist":["AMD"]}');
  await store.logActivity('run_complete', { runDate: today });

  assert.equal((await call('GET', '/runs/latest')).json.run.summary, 's');
  assert.equal((await call('GET', `/runs/${today}`)).json.run.runDate, today);
  assert.equal((await call('GET', '/runs/2000-01-01')).status, 404);
  const list = (await call('GET', '/runs?limit=5')).json;
  assert.equal(list.total, 1);
  assert.equal(list.runs[0].recCount, 1);
  assert.equal(list.runs[0].briefing, undefined, 'list rows are compact');
  assert.deepEqual((await call('GET', '/briefing/latest')).json, { runDate: today, briefing: { generatedAt: 'g' } });
  assert.deepEqual((await call('GET', '/memo')).json, { memo: { watchlist: ['AMD'] } });
  assert.equal((await call('GET', '/activity?limit=1')).json.events[0].kind, 'run_complete');
});

test('an oversized body is refused', async (t) => {
  const { call } = await startApi(t);
  const res = await call('POST', '/devices', { body: { token: 'x'.repeat(70 * 1024) } }).catch((e) => ({ status: 'reset', e }));
  assert.ok(res.status === 413 || res.status === 'reset', `got ${res.status}`);
});
