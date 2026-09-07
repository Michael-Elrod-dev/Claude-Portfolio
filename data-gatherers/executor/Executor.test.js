'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Executor = require('./Executor');

// Positions come off the Alpaca API in snake_case with string numbers.
const pos = (symbol, qty, marketValue) => ({
  symbol,
  qty: String(qty),
  market_value: String(marketValue),
});

const UNH = pos('UNH', 0.015883847, 6.308111);
const JPM_DUST = pos('JPM', 0.000094648, 0.033945);
const NVDA = pos('NVDA', 0.093358451, 21.506053);

const alpacaError = (status, message) => {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data: { message } };
  return err;
};

function fakeClient({ equity = 127.91, positions = [], closePosition, createOrder, orderStatus } = {}) {
  const calls = { createOrder: [], closePosition: [], getOrder: [], getAccount: 0 };
  return {
    calls,
    getAccount: async () => {
      calls.getAccount += 1;
      return { equity: String(equity) };
    },
    getPositions: async () => positions,
    createOrder: async (body) => {
      calls.createOrder.push(body);
      if (createOrder) return createOrder(body);
      return { id: `order-${calls.createOrder.length}` };
    },
    closePosition: async (symbol) => {
      calls.closePosition.push(symbol);
      if (closePosition) return closePosition(symbol);
      return { id: `close-${calls.closePosition.length}` };
    },
    getOrder: async (id) => {
      calls.getOrder.push(id);
      return { id, status: orderStatus ?? 'filled' };
    },
  };
}

function build(clientOpts, executorOpts = {}) {
  const ex = new Executor({
    keyId: 'k',
    secretKey: 's',
    paper: true,
    dryRun: false,
    runDate: '2026-09-07',
    sellSettlePollMs: 1,
    sellSettleTimeoutMs: 20,
    ...executorOpts,
  });
  ex.client = fakeClient(clientOpts);
  return ex;
}

const recs = (...recommendations) => ({ recommendations });
const sellAll = (ticker) => ({ action: 'sell', ticker, amount: { type: 'percent', value: 100 } });
const byResult = (out, ticker) => out.results.find((r) => r.recommendation.ticker === ticker);

// ── Full exits ───────────────────────────────────────────────────────────

test('a 100% sell closes the position instead of submitting an order', async () => {
  const ex = build({ positions: [UNH] });
  const out = await ex.execute(recs(sellAll('UNH')));

  assert.deepEqual(ex.client.calls.closePosition, ['UNH']);
  assert.deepEqual(ex.client.calls.createOrder, [], 'must not touch the order API');
  assert.equal(byResult(out, 'UNH').status, 'executed');
  assert.equal(byResult(out, 'UNH').orderId, 'close-1');
  assert.equal(out.summary.executed, 1);
});

test('the 9/7 UNH exit no longer sends a notional', async () => {
  // Previously: notional "6.31" implied 0.015900214 sh against 0.015883847
  // held, which Alpaca rejected with HTTP 403 insufficient qty.
  const ex = build({ positions: [UNH] });
  await ex.execute(recs(sellAll('UNH')));
  assert.deepEqual(ex.client.calls.createOrder, []);
});

test('a dry-run full exit touches nothing', async () => {
  const ex = build({ positions: [UNH] }, { dryRun: true });
  const out = await ex.execute(recs(sellAll('UNH')));

  assert.deepEqual(ex.client.calls.closePosition, []);
  assert.deepEqual(ex.client.calls.createOrder, []);
  assert.equal(byResult(out, 'UNH').status, 'dry_run');
});

test('an already-closed position reports as already_submitted, not failed', async () => {
  const ex = build({
    positions: [UNH],
    closePosition: () => {
      throw alpacaError(404, 'position does not exist');
    },
  });
  const out = await ex.execute(recs(sellAll('UNH')));

  assert.equal(byResult(out, 'UNH').status, 'already_submitted');
  assert.equal(out.summary.failed, 0);
});

test('a genuine close failure is still reported as failed', async () => {
  const ex = build({
    positions: [UNH],
    closePosition: () => {
      throw alpacaError(403, 'account is not authorized to trade');
    },
  });
  const out = await ex.execute(recs(sellAll('UNH')));

  const r = byResult(out, 'UNH');
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /not authorized/);
});

// ── The stranded JPM dust ────────────────────────────────────────────────

test('a sub-$1 exit is attempted rather than pre-skipped', async () => {
  // The old executor skipped this at the MIN_NOTIONAL gate on every run,
  // so the stub could never leave the account.
  const ex = build({ positions: [JPM_DUST] });
  const out = await ex.execute(recs(sellAll('JPM')));

  assert.deepEqual(ex.client.calls.closePosition, ['JPM'], 'the exit must reach Alpaca');
  assert.equal(byResult(out, 'JPM').status, 'executed');
});

test('dust Alpaca refuses to trade is a skip, not a failure', async () => {
  const ex = build({
    positions: [JPM_DUST],
    closePosition: () => {
      throw alpacaError(422, 'notional increment does not fulfill minimum pricing criteria');
    },
  });
  const out = await ex.execute(recs(sellAll('JPM')));

  const r = byResult(out, 'JPM');
  assert.equal(r.status, 'skipped');
  assert.equal(out.summary.failed, 0, 'must not inflate the failure count every run');
  assert.match(r.reason, /below Alpaca's minimum tradable size/);
});

// ── Partial trims ────────────────────────────────────────────────────────

test('a partial trim submits shares, never a dollar amount', async () => {
  const ex = build({ positions: [NVDA] });
  await ex.execute(
    recs({ action: 'sell', ticker: 'NVDA', amount: { type: 'percent', value: 40 } })
  );

  const [body] = ex.client.calls.createOrder;
  assert.equal(body.symbol, 'NVDA');
  assert.equal(body.side, 'sell');
  assert.equal(body.qty, '0.03734338');
  assert.equal(body.notional, undefined, 'notional sizing is what caused the 403s');
  assert.ok(Number(body.qty) < Number(NVDA.qty));
});

test('trims keep their deterministic client_order_id', async () => {
  const ex = build({ positions: [NVDA] });
  await ex.execute(
    recs({ action: 'sell', ticker: 'NVDA', amount: { type: 'percent', value: 25 } })
  );
  assert.equal(ex.client.calls.createOrder[0].client_order_id, 'cp-20260907-NVDA-sell');
});

// ── Buy-side minimum is untouched ────────────────────────────────────────

test('buys below $1 are still skipped', async () => {
  const ex = build({});
  const out = await ex.execute(
    recs({ action: 'buy', ticker: 'META', amount: { type: 'dollars', value: 0.4 } })
  );

  assert.equal(byResult(out, 'META').status, 'skipped');
  assert.match(byResult(out, 'META').reason, /below Alpaca minimum/);
  assert.deepEqual(ex.client.calls.createOrder, []);
});

test('a sub-$1 partial sell is attempted even though the buy floor would block it', async () => {
  const ex = build({ positions: [NVDA] });
  const out = await ex.execute(
    recs({ action: 'sell', ticker: 'NVDA', amount: { type: 'dollars', value: 0.5 } })
  );

  assert.equal(byResult(out, 'NVDA').status, 'executed');
  assert.equal(ex.client.calls.createOrder[0].notional, '0.5');
});

// ── Ordering and settlement ──────────────────────────────────────────────

test('sells settle before buys are sized', async () => {
  const ex = build({ positions: [UNH] });
  const out = await ex.execute(
    recs(sellAll('UNH'), { action: 'buy', ticker: 'META', amount: { type: 'dollars', value: 5 } })
  );

  assert.deepEqual(ex.client.calls.closePosition, ['UNH']);
  assert.ok(ex.client.calls.getOrder.includes('close-1'), 'the close order must be polled');
  assert.equal(ex.client.calls.getAccount, 2, 'snapshot refreshed after the exit settles');
  assert.equal(out.summary.executed, 2);
});

test('an unsettled exit still lets buys through, with a notice', async () => {
  const ex = build({ positions: [UNH], orderStatus: 'new' });
  const out = await ex.execute(
    recs(sellAll('UNH'), { action: 'buy', ticker: 'META', amount: { type: 'dollars', value: 5 } })
  );

  assert.match(out.notice, /did not reach a terminal state/);
  assert.equal(out.summary.executed, 2);
});

// ── The whole 9/7 run, replayed ──────────────────────────────────────────

test('the 9/7 recommendation set now executes instead of failing 4 of 5', async () => {
  const ex = build({ positions: [UNH, JPM_DUST] });
  const out = await ex.execute(
    recs(
      sellAll('UNH'),
      sellAll('JPM'),
      { action: 'buy', ticker: 'META', amount: { type: 'dollars', value: 3.6 } },
      { action: 'buy', ticker: 'VRT', amount: { type: 'dollars', value: 1.8 } },
      { action: 'buy', ticker: 'XOM', amount: { type: 'dollars', value: 1.6 } }
    )
  );

  assert.equal(out.summary.total, 5);
  assert.equal(out.summary.failed, 0, 'the run that failed 4 of 5 now fails none');
  assert.equal(out.summary.executed, 5);
  assert.deepEqual(ex.client.calls.closePosition, ['UNH', 'JPM']);
  assert.equal(ex.client.calls.createOrder.length, 3, 'only the three buys use the order API');
});
