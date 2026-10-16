'use strict';

// The run's ordering and failure handling, with every network collaborator
// faked and the real store pointed at a temp directory.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const store = require('./store');
const { run } = require('./run');
const buildMemoUpdaterUserPrompt = require('../prompts/buildMemoUpdaterUserPrompt');

const PRIOR_MEMO = { lastUpdated: 'prior', openTheses: [], closedTheses: [], watchlist: ['OLD'], generalObservations: '' };
const REC = { action: 'buy', ticker: 'AMD', amount: { type: 'dollars', value: 5 }, rationale: 'r', confidence: 'high' };
const META = { model: 'claude-opus-5-5', stopReason: 'end_turn', webSearchesUsed: 3, usage: { inputTokens: 1, outputTokens: 2 } };

function setup(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-run-'));
  const prev = process.env.PORTFOLIO_DATA_DIR;
  process.env.PORTFOLIO_DATA_DIR = dir;
  t.after(() => {
    if (prev === undefined) delete process.env.PORTFOLIO_DATA_DIR;
    else process.env.PORTFOLIO_DATA_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  t.mock.method(console, 'log', () => {});
  fs.writeFileSync(path.join(dir, 'memo.json'), JSON.stringify(PRIOR_MEMO));

  const calls = [];
  const pushes = [];
  const execution = {
    summary: { total: 1, executed: 0, skipped: 0, failed: 1, alreadySubmitted: 0 },
    results: [{ recommendation: REC, status: 'failed', orderId: null, reason: 'HTTP 403: insufficient buying power' }],
  };
  const deps = {
    loadSecrets: () => ({ ANTHROPIC_API_KEY: 'k', ALPACA_KEY_ID: 'k', ALPACA_SECRET_KEY: 'k', FINNHUB_API_KEY: 'k' }),
    fcmPublish: async (kind, data) => { pushes.push({ kind, data }); return { sent: 0 }; },
    makeAssembler: () => ({
      assemble: async () => ({ generatedAt: new Date().toISOString(), symbolsCovered: ['AMD'], errors: [], memo: { memo: PRIOR_MEMO } }),
    }),
    makeAnalyst: () => ({
      analyze: async () => { calls.push('analyst'); return { recommendations: { summary: 's', recommendations: [REC] }, meta: META }; },
    }),
    makeExecutor: () => ({
      execute: async () => { calls.push('executor'); return execution; },
    }),
    makeMemoUpdater: () => ({
      update: async (args) => {
        calls.push({ memo: args });
        return { memo: { ...PRIOR_MEMO, lastUpdated: 'new', watchlist: ['AMD'] }, meta: { ...META, model: 'claude-opus-5-5' } };
      },
    }),
    ...overrides,
  };
  return { dir, deps, calls, pushes, execution };
}

test('the memo is rewritten after the orders, from what the executor did', async (t) => {
  const { dir, deps, calls, pushes, execution } = setup(t);
  await store.setActive(true);
  await run({ deps });

  assert.deepEqual(calls.slice(0, 2), ['analyst', 'executor']);
  assert.equal(calls[2].memo.execution, execution, 'the MemoUpdater gets the executor result');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'memo.json'), 'utf8')).lastUpdated, 'new');

  const [archived] = await store.listRuns();
  assert.equal(archived.recommendations[0].status, 'failed');
  assert.equal(archived.analystMeta.memoModel, 'claude-opus-5-5');
  assert.equal(pushes[0].kind, 'run_complete');
});

test('a memo failure after the orders keeps the old memo but still archives the run', async (t) => {
  const { dir, deps, pushes } = setup(t, {
    makeMemoUpdater: () => ({ update: async () => { throw new Error('memo exploded'); } }),
  });
  await store.setActive(true);
  await assert.rejects(run({ deps }), /orders placed, memo not updated: memo exploded/);

  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'memo.json'), 'utf8')).lastUpdated, 'prior');
  const [archived] = await store.listRuns();
  assert.ok(archived, 'the run is archived even though the memo failed');
  assert.equal(archived.analystMeta.memoModel, null);
  assert.deepEqual(pushes.map((p) => p.kind), ['run_failed']);
  const failed = (await store.listActivity(50)).find((e) => e.kind === 'run_failed');
  assert.equal(failed.payload.ordersPlaced, true);
});

test('an Analyst failure places no orders and archives nothing', async (t) => {
  const { deps, calls } = setup(t, {
    makeAnalyst: () => ({ analyze: async () => { throw new Error('refused'); } }),
  });
  await store.setActive(true);
  await assert.rejects(run({ deps }), /refused/);
  assert.equal(calls.includes('executor'), false);
  assert.deepEqual(await store.listRuns(), []);
  const failed = (await store.listActivity(50)).find((e) => e.kind === 'run_failed');
  assert.equal(failed.payload.ordersPlaced, false);
});

test('a scheduled run with the switch off does nothing', async (t) => {
  const { deps, calls } = setup(t);
  const result = await run({ deps });
  assert.equal(result.status, 'inactive');
  assert.deepEqual(calls, []);
});

test('the memo prompt lists each order with its outcome and reason', () => {
  const prompt = buildMemoUpdaterUserPrompt({
    priorMemo: PRIOR_MEMO,
    briefing: { generatedAt: '2026-10-19T13:00:00Z' },
    recommendations: { recommendations: [REC] },
    execution: {
      summary: { total: 1, failed: 1 },
      results: [{ recommendation: REC, status: 'failed', reason: 'HTTP 403: insufficient buying power' }],
    },
  });
  assert.match(prompt, /# What the executor did/);
  assert.match(prompt, /"status": "failed"/);
  assert.match(prompt, /insufficient buying power/);
  assert.doesNotMatch(prompt, /week/i);
});
