'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSizing } = require('./sizingResolver');

// Real position snapshots from the runs that failed in production, so the
// regressions below are anchored to actual numbers rather than invented ones.
const UNH = { symbol: 'UNH', qty: 0.015883847, marketValue: 6.308111 };
const JPM_DUST = { symbol: 'JPM', qty: 0.000094648, marketValue: 0.033945 };
const NVDA = { symbol: 'NVDA', qty: 0.093358451, marketValue: 21.506053 };

const sell = (amount, position, ticker = 'UNH') =>
  resolveSizing({ action: 'sell', ticker, amount, currentPosition: position });
const buy = (amount, currentEquity = 127.91, ticker = 'META') =>
  resolveSizing({ action: 'buy', ticker, amount, currentEquity });

// ── Regressions for the production failures ──────────────────────────────

test('full exit resolves to close, never a notional', () => {
  const r = sell({ type: 'percent', value: 100 }, UNH);
  assert.equal(r.kind, 'close');
  assert.equal(r.value, UNH.qty);
});

test('full exit does not re-create the 9/7 UNH over-request', () => {
  // Old behaviour: round2(6.308111) = 6.31, which at the $396.85 fill price
  // implied 0.015900214 sh against 0.015883847 held -> HTTP 403.
  const r = sell({ type: 'percent', value: 100 }, UNH);
  assert.notEqual(r.kind, 'notional');
  assert.ok(r.value <= UNH.qty, 'must never ask for more than is held');
});

test('sub-$1 dust still resolves to a close rather than an error', () => {
  // JPM has been skipped every run since 8/24 by the executor's notional
  // floor. Sizing must hand the executor something actionable; whether
  // Alpaca accepts it is the executor's problem to report.
  const r = sell({ type: 'percent', value: 100 }, JPM_DUST, 'JPM');
  assert.equal(r.kind, 'close');
  assert.equal(r.value, JPM_DUST.qty);
});

test('partial trims size in shares, floored to 9dp', () => {
  const r = sell({ type: 'percent', value: 40 }, UNH);
  assert.equal(r.kind, 'qty');
  assert.equal(r.value, 0.006353538); // 0.0063535388 truncated, not rounded up
  assert.ok(r.value < UNH.qty * 0.4, 'floored, so strictly below the exact share');
});

test('a trim never exceeds the position', () => {
  for (const pct of [1, 25, 33.3, 50, 99, 99.999]) {
    const r = sell({ type: 'percent', value: pct }, NVDA, 'NVDA');
    assert.equal(r.kind, 'qty');
    assert.ok(r.value <= NVDA.qty, `${pct}% asked for more than held`);
  }
});

// ── Percent sells ────────────────────────────────────────────────────────

test('percent > 100 on a sell is an error', () => {
  const r = sell({ type: 'percent', value: 101 }, UNH);
  assert.equal(r.kind, 'error');
  assert.match(r.message, /percent > 100/);
});

test('selling with no position is an error, not a close', () => {
  for (const pos of [null, undefined, { qty: 0 }, { qty: -1 }]) {
    const r = sell({ type: 'percent', value: 100 }, pos);
    assert.equal(r.kind, 'error');
    assert.match(r.message, /no current position/);
  }
});

test('a trim that floors to zero shares errors instead of sending qty 0', () => {
  const r = sell({ type: 'percent', value: 0.0001 }, JPM_DUST, 'JPM');
  assert.equal(r.kind, 'error');
  assert.match(r.message, /rounds to zero/);
});

// ── Share-denominated sells ──────────────────────────────────────────────

test('asking for more shares than held clamps to a full exit', () => {
  const r = sell({ type: 'shares', value: 0.02 }, UNH);
  assert.equal(r.kind, 'close');
  assert.equal(r.value, UNH.qty);
});

test('asking for exactly the held quantity is a full exit', () => {
  const r = sell({ type: 'shares', value: UNH.qty }, UNH);
  assert.equal(r.kind, 'close');
});

test('a partial share sell passes through, floored', () => {
  const r = sell({ type: 'shares', value: 0.0123456789 }, UNH);
  assert.equal(r.kind, 'qty');
  assert.equal(r.value, 0.012345678);
});

// ── Dollar-denominated sells ─────────────────────────────────────────────

test('a dollar sell at the position value is treated as a full exit', () => {
  // "sell $6.31 of UNH" against a $6.308111 position is the same
  // over-request bug wearing a different hat.
  const r = sell({ type: 'dollars', value: 6.31 }, UNH);
  assert.equal(r.kind, 'close');
});

test('a dollar sell just under the position value is still a full exit', () => {
  const r = sell({ type: 'dollars', value: 6.28 }, UNH); // within 1%
  assert.equal(r.kind, 'close');
});

test('a genuinely partial dollar sell stays a notional, floored to the cent', () => {
  const r = sell({ type: 'dollars', value: 3.999 }, UNH);
  assert.equal(r.kind, 'notional');
  assert.equal(r.value, 3.99);
});

test('a dollar sell against a valueless position errors', () => {
  const r = sell({ type: 'dollars', value: 5 }, { qty: 0.01, marketValue: 0 });
  assert.equal(r.kind, 'error');
  assert.match(r.message, /no market value/);
});

// ── Buys are unchanged ───────────────────────────────────────────────────

test('dollar buys round to cents', () => {
  assert.deepEqual(buy({ type: 'dollars', value: 3.567 }), { kind: 'notional', value: 3.57 });
});

test('share buys pass through', () => {
  assert.deepEqual(buy({ type: 'shares', value: 1.5 }), { kind: 'qty', value: 1.5 });
});

test('percent buys size against portfolio equity', () => {
  assert.deepEqual(buy({ type: 'percent', value: 10 }, 127.91), {
    kind: 'notional',
    value: 12.79,
  });
});

test('percent buy with no equity is an error', () => {
  const r = buy({ type: 'percent', value: 10 }, 0);
  assert.equal(r.kind, 'error');
  assert.match(r.message, /no portfolio equity/);
});

test('percent > 100 on a buy is an error', () => {
  assert.equal(buy({ type: 'percent', value: 150 }).kind, 'error');
});

// ── Input validation ─────────────────────────────────────────────────────

test('malformed amounts are rejected', () => {
  const bad = [
    null,
    undefined,
    {},
    { type: 'dollars' },
    { type: 'dollars', value: 0 },
    { type: 'dollars', value: -5 },
    { type: 'dollars', value: NaN },
    { type: 'dollars', value: Infinity },
    { type: 'dollars', value: '5' },
  ];
  for (const amount of bad) {
    const r = resolveSizing({ action: 'buy', ticker: 'META', amount, currentEquity: 100 });
    assert.equal(r.kind, 'error', `expected error for ${JSON.stringify(amount)}`);
  }
});

test('unknown amount types are rejected', () => {
  const r = buy({ type: 'lots', value: 1 });
  assert.equal(r.kind, 'error');
  assert.match(r.message, /unknown amount type/);
});

test('unknown actions are rejected rather than falling through to sell', () => {
  const r = resolveSizing({
    action: 'short',
    ticker: 'UNH',
    amount: { type: 'percent', value: 100 },
    currentPosition: UNH,
  });
  assert.equal(r.kind, 'error');
  assert.match(r.message, /unknown action/);
});
