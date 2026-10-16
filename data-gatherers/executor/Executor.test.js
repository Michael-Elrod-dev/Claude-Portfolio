'use strict';

// The Executor against a simulated Alpaca: a fake clock (no real waiting),
// orders that fill at the open, and an account whose buying power moves with
// fills and reservations the way Alpaca's does for a limited-margin account.

const test = require('node:test');
const assert = require('node:assert/strict');
const Executor = require('./Executor');

const MIN = 60_000;
const OPEN = Date.parse('2026-10-19T09:30:00-04:00');  // a Monday session
const CLOSE = Date.parse('2026-10-19T16:00:00-04:00');
const at = (hhmm, day = '2026-10-19') => Date.parse(`${day}T${hhmm}:00-04:00`);

const pos = (symbol, qty, price) => ({
  symbol,
  qty: String(qty),
  market_value: String(qty * price),
  current_price: String(price),
});

const UNH = pos('UNH', 0.015883847, 397.15);
const JPM_DUST = pos('JPM', 0.000094648, 358.65);
const NVDA = pos('NVDA', 0.093358451, 230.37);
const META = pos('META', 0.004719, 725.51);

const alpacaError = (status, message) => {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data: { message } };
  return err;
};

/**
 * A small simulated broker.
 *   cash          settled cash at the start
 *   positions     Alpaca-shaped positions
 *   start         fake "now"
 *   open/close    the session; a sell or buy fills at max(created, open) + fillDelayMs
 *   fillPrice     per-symbol sell fill price (default: the position's price)
 *   sellOutcome   per-symbol 'rejected' | 'never' (stays open)
 *   bpLagMs       how long after a fill buying power reflects it (Infinity = never)
 *   openOrders    orders already open before the run
 *   assets        per-symbol {tradable, fractionable}
 */
function sim({
  cash = 100,
  positions = [],
  start = at('10:00'),
  open = OPEN,
  close = CLOSE,
  fillDelayMs = 1000,
  fillPrice = {},
  sellOutcome = {},
  bpLagMs = 0,
  openOrders = [],
  assets = {},
  createOrder,
  closePosition,
  getOrderByClientId,
} = {}) {
  let t = start;
  const orders = new Map();
  const calls = { createOrder: [], closePosition: [], getOrder: [], getAccount: 0, createdAt: [] };
  let n = 0;

  for (const o of openOrders) {
    orders.set(o.id, { status: 'new', filled_qty: '0', ...o, _fillAt: o._fillAt ?? open + fillDelayMs });
  }

  const statusOf = (o) => {
    if (o._final) return o._final;
    if (t >= o._fillAt) return 'filled';
    return t < open ? 'accepted' : 'new';
  };
  const view = (o) => {
    const status = statusOf(o);
    const filled = status === 'filled';
    return {
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      status,
      client_order_id: o.client_order_id,
      filled_qty: filled ? String(o._qty) : '0',
      filled_avg_price: filled ? String(o._price) : null,
      filled_at: filled ? new Date(o._fillAt).toISOString() : null,
    };
  };
  const buyingPower = () => {
    let bp = cash;
    for (const o of orders.values()) {
      const status = statusOf(o);
      if (o.side === 'buy' && status !== 'rejected' && status !== 'canceled') bp -= o._cost;
      if (o.side === 'sell' && status === 'filled' && t >= o._fillAt + bpLagMs) bp += o._qty * o._price;
    }
    return Math.round(bp * 100) / 100;
  };
  const place = (o) => {
    orders.set(o.id, o);
    return { id: o.id };
  };
  const posOf = (symbol) => positions.find((p) => p.symbol === symbol);

  const client = {
    calls,
    getClock: async () => {
      const isOpen = t >= open && t < close;
      return {
        is_open: isOpen,
        next_open: new Date(t < open ? open : open + 24 * 60 * MIN).toISOString(),
        next_close: new Date(t < close ? close : close + 24 * 60 * MIN).toISOString(),
      };
    },
    getCalendar: async () => [{ date: '2026-10-19', open: '09:30', close: '16:00' }],
    getAccount: async () => {
      calls.getAccount += 1;
      const bp = String(buyingPower());
      return { equity: '131.52', buying_power: bp, non_marginable_buying_power: bp };
    },
    getPositions: async () => positions,
    getOrders: async () => [...orders.values()].map(view).filter((o) => !['filled', 'canceled', 'expired', 'rejected'].includes(o.status)),
    getOrder: async (id) => {
      calls.getOrder.push(id);
      return view(orders.get(id));
    },
    getOrderByClientId: async (cid) => {
      if (getOrderByClientId) return getOrderByClientId(cid);
      const o = [...orders.values()].find((x) => x.client_order_id === cid);
      if (!o) throw alpacaError(404, 'order not found');
      return view(o);
    },
    getAsset: async (symbol) => ({ tradable: true, fractionable: true, ...(assets[symbol] || {}) }),
    createOrder: async (body) => {
      calls.createOrder.push(body);
      calls.createdAt.push(t);
      if (createOrder) {
        const r = await createOrder(body, { buyingPower: buyingPower() });
        if (r) return r;
      }
      if (body.side === 'buy') {
        const cost = body.notional ? Number(body.notional) : Number(body.qty) * 100;
        if (cost > buyingPower() + 1e-9) throw alpacaError(403, 'insufficient buying power');
        return place({ id: `order-${++n}`, ...body, _cost: cost, _qty: cost / 100, _price: 100, _fillAt: Math.max(t, open) + fillDelayMs });
      }
      const p = posOf(body.symbol);
      const qty = Number(body.qty ?? Number(body.notional) / Number(p.current_price));
      const price = fillPrice[body.symbol] ?? Number(p.current_price);
      const o = { id: `order-${++n}`, ...body, _qty: qty, _price: price, _fillAt: Math.max(t, open) + fillDelayMs };
      if (sellOutcome[body.symbol] === 'rejected') { o._final = 'rejected'; o._fillAt = Infinity; }
      if (sellOutcome[body.symbol] === 'never') o._fillAt = Infinity;
      return place(o);
    },
    closePosition: async (symbol) => {
      calls.closePosition.push(symbol);
      if (closePosition) return closePosition(symbol);
      const p = posOf(symbol);
      const id = `close-${calls.closePosition.length}`;
      const o = { id, symbol, side: 'sell', _qty: Number(p.qty), _price: fillPrice[symbol] ?? Number(p.current_price), _fillAt: Math.max(t, open) + fillDelayMs };
      if (sellOutcome[symbol] === 'rejected') { o._final = 'rejected'; o._fillAt = Infinity; }
      if (sellOutcome[symbol] === 'never') o._fillAt = Infinity;
      place(o);
      return { id };
    },
  };
  return {
    client,
    calls,
    now: () => t,
    sleep: async (ms) => { t += Math.max(0, ms); },
  };
}

function build(simOpts = {}, executorOpts = {}) {
  const s = sim(simOpts);
  const ex = new Executor({
    keyId: 'k',
    secretKey: 's',
    runDate: '2026-09-07',
    now: s.now,
    sleep: s.sleep,
    priceLookup: async () => null,
    ...executorOpts,
  });
  ex.client = s.client;
  return { ex, s };
}

const recs = (...recommendations) => ({ recommendations });
const sellAll = (ticker) => ({ action: 'sell', ticker, amount: { type: 'percent', value: 100 } });
const trim = (ticker, pct) => ({ action: 'sell', ticker, amount: { type: 'percent', value: pct } });
const buy = (ticker, dollars) => ({ action: 'buy', ticker, amount: { type: 'dollars', value: dollars } });
const byResult = (out, ticker, action) =>
  out.results.find((r) => r.recommendation.ticker === ticker && (!action || r.recommendation.action === action));
const buyBodies = (s) => s.calls.createOrder.filter((b) => b.side === 'buy');

// ── Full exits ───────────────────────────────────────────────────────────

test('a 100% sell closes the position instead of submitting an order', async () => {
  const { ex, s } = build({ positions: [UNH] });
  const out = await ex.execute(recs(sellAll('UNH')));

  assert.deepEqual(s.calls.closePosition, ['UNH']);
  assert.deepEqual(s.calls.createOrder, [], 'must not touch the order API');
  assert.equal(byResult(out, 'UNH').status, 'executed');
  assert.equal(byResult(out, 'UNH').orderId, 'close-1');
  assert.equal(out.summary.executed, 1);
});

test('the 9/7 UNH exit no longer sends a notional', async () => {
  // Previously: notional "6.31" implied 0.015900214 sh against 0.015883847
  // held, which Alpaca rejected with HTTP 403 insufficient qty.
  const { ex, s } = build({ positions: [UNH] });
  await ex.execute(recs(sellAll('UNH')));
  assert.deepEqual(s.calls.createOrder, []);
});

test('there is no dry-run escape hatch: a full exit always hits the API', async () => {
  // Passing a dryRun option (or anything else) must not create a no-op
  // path — the position is closed for real, and no result ever carries a
  // dry_run status.
  const { ex, s } = build({ positions: [UNH] }, { dryRun: true });
  const out = await ex.execute(recs(sellAll('UNH')));

  assert.deepEqual(s.calls.closePosition, ['UNH']);
  assert.equal(byResult(out, 'UNH').status, 'executed');
  assert.equal(out.summary.dryRun, undefined, 'summary must not report a dryRun tally');
  assert.ok(out.results.every((r) => r.status !== 'dry_run'), 'no result may be dry_run');
});

test('an already-closed position reports as already_submitted, not failed', async () => {
  const { ex } = build({
    positions: [UNH],
    closePosition: async () => { throw alpacaError(404, 'position does not exist'); },
  });
  const out = await ex.execute(recs(sellAll('UNH')));
  assert.equal(byResult(out, 'UNH').status, 'already_submitted');
  assert.equal(out.summary.failed, 0);
});

test('a genuine close failure is still reported as failed', async () => {
  const { ex } = build({
    positions: [UNH],
    closePosition: async () => { throw alpacaError(403, 'account is restricted'); },
  });
  const out = await ex.execute(recs(sellAll('UNH')));
  assert.equal(byResult(out, 'UNH').status, 'failed');
  assert.match(byResult(out, 'UNH').reason, /account is restricted/);
});

// ── The stranded JPM dust ────────────────────────────────────────────────

test('a sub-$1 exit is attempted rather than pre-skipped', async () => {
  // Pre-skipping this at the MIN_NOTIONAL gate would mean the stub could
  // never leave the account.
  const { ex, s } = build({ positions: [JPM_DUST] });
  const out = await ex.execute(recs(sellAll('JPM')));

  assert.deepEqual(s.calls.closePosition, ['JPM'], 'the exit must reach Alpaca');
  assert.equal(byResult(out, 'JPM').status, 'executed');
});

test('dust Alpaca refuses to trade is a skip, not a failure', async () => {
  const { ex } = build({
    positions: [JPM_DUST],
    closePosition: async () => {
      throw alpacaError(422, 'order notional or qty does not meet minimum pricing criteria');
    },
  });
  const out = await ex.execute(recs(sellAll('JPM')));

  assert.equal(byResult(out, 'JPM').status, 'skipped');
  assert.match(byResult(out, 'JPM').reason, /below Alpaca's minimum tradable size/);
  assert.equal(out.summary.failed, 0);
});

// ── Partial trims ────────────────────────────────────────────────────────

test('a partial trim submits shares, never a dollar amount', async () => {
  const { ex, s } = build({ positions: [NVDA] });
  await ex.execute(recs(trim('NVDA', 40)));

  const [body] = s.calls.createOrder;
  assert.equal(body.symbol, 'NVDA');
  assert.equal(body.side, 'sell');
  assert.equal(body.qty, '0.03734338');
  assert.equal(body.notional, undefined, 'notional sizing is what caused the 403s');
});

test('trims keep their deterministic client_order_id', async () => {
  const { ex, s } = build({ positions: [NVDA] });
  await ex.execute(recs(trim('NVDA', 25)));
  assert.equal(s.calls.createOrder[0].client_order_id, 'cp-20260907-NVDA-sell');
});

test('buys below $1 are still skipped', async () => {
  const { ex, s } = build({});
  const out = await ex.execute(recs(buy('META', 0.4)));

  assert.equal(byResult(out, 'META').status, 'skipped');
  assert.match(byResult(out, 'META').reason, /below Alpaca minimum/);
  assert.deepEqual(s.calls.createOrder, []);
});

test('a sub-$1 partial sell is attempted even though the buy floor would block it', async () => {
  const { ex, s } = build({ positions: [NVDA] });
  const out = await ex.execute(recs({ action: 'sell', ticker: 'NVDA', amount: { type: 'dollars', value: 0.5 } }));

  assert.equal(byResult(out, 'NVDA').status, 'executed');
  assert.equal(s.calls.createOrder[0].notional, '0.5');
});

// ── Funding buys from the same run's sells ───────────────────────────────

test('the 10/15 run: pre-open buys wait for the sell, then both fit', async () => {
  // Cash $4.05; the META trim raises ~$2.40 at the open; buys total $6.20.
  // Today the WMB buy is rejected. Now both go in after the sell fills.
  const { ex, s } = build({ cash: 4.05, positions: [META], start: at('09:08') });
  const out = await ex.execute(recs(trim('META', 70), buy('UNH', 3.9), buy('WMB', 2.3)));

  assert.equal(byResult(out, 'UNH').status, 'executed');
  assert.equal(byResult(out, 'WMB').status, 'executed');
  assert.equal(out.summary.failed, 0);
  const buyTimes = s.calls.createOrder.map((b, i) => [b, s.calls.createdAt[i]]).filter(([b]) => b.side === 'buy').map(([, ts]) => ts);
  assert.ok(buyTimes.every((ts) => ts >= OPEN + MIN), 'buys go in after the open guard, once the sell has filled');
  assert.equal(out.timeline.waitMode, 'pre-open');
  assert.equal(byResult(out, 'UNH').scaled, undefined, 'nothing scaled when the cash is there');
  assert.equal(byResult(out, 'META').fill.status, 'filled');
  assert.equal(byResult(out, 'UNH').fill.status, 'filled');
});

test('proceeds short of plan: every buy is scaled by the same factor', async () => {
  // The trim fills ~20% below the snapshot price.
  const { ex, s } = build({ cash: 2, positions: [META], start: at('09:08'), fillPrice: { META: 580 } });
  const out = await ex.execute(recs(trim('META', 100 * 0.004 / 0.004719), buy('UNH', 3), buy('WMB', 2)));

  const unh = byResult(out, 'UNH');
  const wmb = byResult(out, 'WMB');
  assert.equal(unh.status, 'executed');
  assert.equal(wmb.status, 'executed');
  assert.ok(unh.scaled && wmb.scaled, 'both carry a scaling note');
  const ratio = (r) => r.scaled.to / r.scaled.from;
  assert.ok(Math.abs(ratio(unh) - ratio(wmb)) < 0.01, 'same factor for both');
  const spent = buyBodies(s).reduce((sum, b) => sum + Number(b.notional), 0);
  assert.ok(spent <= 2 + 0.004 * 580, 'never spends more than cash + proceeds');
  assert.match(out.notice, /scaled/);
});

test('a buy scaled under $1 is dropped, and its dollars are not redistributed', async () => {
  const { ex, s } = build({ cash: 3 });
  const out = await ex.execute(recs(buy('UNH', 4), buy('WMB', 1.1)));

  assert.equal(byResult(out, 'UNH').status, 'executed');
  assert.equal(byResult(out, 'WMB').status, 'skipped');
  assert.match(byResult(out, 'WMB').reason, /below Alpaca's \$1 minimum/);
  assert.equal(buyBodies(s).length, 1);
  assert.ok(Number(buyBodies(s)[0].notional) < 3, 'UNH keeps its scaled size, not the dropped dollars');
});

test('buys are never scaled up when there is more cash than asked', async () => {
  const { ex, s } = build({ cash: 50 });
  const out = await ex.execute(recs(buy('UNH', 4), buy('WMB', 2)));
  assert.deepEqual(buyBodies(s).map((b) => b.notional), ['4', '2']);
  assert.equal(byResult(out, 'UNH').scaled, undefined);
});

test('a rejected sell: buys are sized to the cash alone', async () => {
  const { ex, s } = build({ cash: 3, positions: [META], start: at('09:08'), sellOutcome: { META: 'rejected' } });
  const out = await ex.execute(recs(trim('META', 50), buy('UNH', 4)));

  assert.equal(byResult(out, 'UNH').status, 'executed');
  assert.ok(Number(buyBodies(s)[0].notional) <= 3);
  assert.ok(byResult(out, 'UNH').scaled);
});

test('all sells rejected pre-open: buys go in at once and still catch the open', async () => {
  const { ex, s } = build({ cash: 10, positions: [META], start: at('09:08'), sellOutcome: { META: 'rejected' } });
  await ex.execute(recs(trim('META', 50), buy('UNH', 4)));
  const buyAt = s.calls.createdAt[s.calls.createOrder.findIndex((b) => b.side === 'buy')];
  assert.ok(buyAt < OPEN, 'no reason to wait for the open once no sell is pending');
});

test('a sell still open at the deadline: buys go ahead on the cash there is', async () => {
  const { ex, s } = build({ cash: 3, positions: [META], start: at('09:08'), sellOutcome: { META: 'never' } });
  const out = await ex.execute(recs(trim('META', 50), buy('UNH', 2)));

  assert.match(out.notice, /still open/);
  assert.equal(byResult(out, 'UNH').status, 'executed');
  assert.ok(s.now() >= OPEN + 20 * MIN, 'waited until the deadline');
  assert.ok(s.now() < OPEN + 30 * MIN, 'but no longer');
});

test('market already open: the wait counts from now, not from tomorrow', async () => {
  // Alpaca's next_open is tomorrow while the market is open. A deadline from
  // it would wait overnight and the run would be killed.
  const { ex, s } = build({ cash: 3, positions: [META], start: at('11:00'), sellOutcome: { META: 'never' } });
  const out = await ex.execute(recs(trim('META', 50), buy('UNH', 2)));

  assert.equal(out.timeline.waitMode, 'open');
  assert.ok(s.now() - at('11:00') <= 25 * MIN, `finished in ${(s.now() - at('11:00')) / MIN} min`);
  assert.equal(byResult(out, 'UNH').status, 'executed');
});

test('a slow account update after the fill: buys wait for the proceeds to show', async () => {
  const { ex, s } = build({ cash: 2, positions: [META], start: at('09:08'), bpLagMs: 6000 });
  const out = await ex.execute(recs(trim('META', 60), buy('UNH', 3.9)));

  assert.equal(byResult(out, 'UNH').status, 'executed');
  assert.equal(byResult(out, 'UNH').scaled, undefined, 'sized after the proceeds showed up');
  assert.ok(s.calls.getAccount >= 3);
});

test('an account that never shows the proceeds: sized to what is reported, with a notice', async () => {
  const { ex, s } = build({ cash: 2, positions: [META], start: at('09:08'), bpLagMs: Infinity });
  const out = await ex.execute(recs(trim('META', 60), buy('UNH', 3.9)));

  assert.match(out.notice, /short of the/);
  assert.ok(Number(buyBodies(s)[0].notional) <= 2);
});

test('near the close: buys that need this run\'s sells are not placed', async () => {
  const { ex, s } = build({ cash: 1, positions: [META], start: at('15:57') });
  const out = await ex.execute(recs(trim('META', 50), buy('UNH', 2)));

  assert.equal(byResult(out, 'UNH').status, 'skipped');
  assert.match(byResult(out, 'UNH').reason, /close/);
  assert.equal(buyBodies(s).length, 0);
});

test('a forced run on a weekend: sells are queued, buys sized to cash now, no waiting', async () => {
  const sat = Date.parse('2026-10-17T14:00:00-04:00');
  const { ex, s } = build({ cash: 3, positions: [META], start: sat });
  const out = await ex.execute(recs(trim('META', 50), buy('UNH', 4)));

  assert.equal(out.timeline.waitMode, 'closed');
  assert.match(out.notice, /closed until/);
  assert.ok(Number(buyBodies(s)[0].notional) <= 3);
  assert.ok(s.now() - sat < 5 * MIN, 'no hours-long wait');
});

test('the run budget bounds the wait: an early forced run does not wait for the open', async () => {
  const start = at('07:50');
  const { ex, s } = build({ cash: 3, positions: [META], start }, { deadlineAt: at('08:55') });
  const out = await ex.execute(recs(trim('META', 50), buy('UNH', 4)));

  assert.equal(out.timeline.waitMode, 'closed');
  assert.ok(s.now() <= at('08:55'));
});

test('a sell left open by an earlier run also holds the buys', async () => {
  const { ex, s } = build({
    cash: 1,
    start: at('09:08'),
    openOrders: [{ id: 'earlier-1', symbol: 'XOM', side: 'sell', _qty: 0.02, _price: 170, _fillAt: OPEN + 2000 }],
  });
  const out = await ex.execute(recs(buy('UNH', 4)));

  assert.equal(out.timeline.waitedOn, 1);
  assert.equal(byResult(out, 'UNH').status, 'executed');
  assert.ok(s.calls.createdAt[0] >= OPEN, 'the buy waited for the earlier sell to fill');
});

test('a close order without an id is still waited on, through the open-orders list', async () => {
  const s0 = { cash: 1, positions: [META], start: at('09:08') };
  const { ex, s } = build({
    ...s0,
    closePosition: async () => {
      // The position is closed by an order Alpaca reports, but the response carries no id.
      return {};
    },
    openOrders: [{ id: 'close-x', symbol: 'META', side: 'sell', _qty: 0.004719, _price: 725.51, _fillAt: OPEN + 1000 }],
  });
  const out = await ex.execute(recs(sellAll('META'), buy('UNH', 3)));

  assert.equal(byResult(out, 'META', 'sell').orderId, null);
  assert.equal(byResult(out, 'UNH').status, 'executed');
  assert.ok(s.calls.createdAt[0] >= OPEN, 'the buy waited for the close to fill');
});

test('a run with no sells submits buys right away, and records the fills after the open', async () => {
  const { ex, s } = build({ cash: 10, start: at('09:08') });
  const out = await ex.execute(recs(buy('UNH', 4)));

  assert.ok(s.calls.createdAt[0] < OPEN, 'no sells, so nothing to wait for');
  assert.equal(byResult(out, 'UNH').fill.status, 'filled');
  assert.equal(out.summary.filled, 1);
});

test('a non-fractionable asset gets whole shares, or a skip when one share is too much', async () => {
  const { ex, s } = build({ cash: 500, assets: { BRK: { fractionable: false }, NVR: { fractionable: false } } }, { priceLookup: async (sym) => (sym === 'BRK' ? 100 : 7000) });
  const out = await ex.execute(recs(buy('BRK', 250), buy('NVR', 200)));

  assert.equal(byResult(out, 'BRK').status, 'executed');
  assert.equal(buyBodies(s)[0].qty, '2');
  assert.equal(buyBodies(s)[0].notional, undefined);
  assert.equal(byResult(out, 'NVR').status, 'skipped');
  assert.match(byResult(out, 'NVR').reason, /less than one share/);
});

test('a shares-sized buy becomes dollars at the held price, or a skip with no price', async () => {
  const { ex, s } = build({ cash: 50, positions: [pos('AMZN', 0.05, 250)] });
  const out = await ex.execute(recs(
    { action: 'buy', ticker: 'AMZN', amount: { type: 'shares', value: 0.0141 } },
    { action: 'buy', ticker: 'ZZZZ', amount: { type: 'shares', value: 1 } }
  ));

  const amzn = byResult(out, 'AMZN');
  assert.equal(amzn.status, 'executed');
  assert.equal(buyBodies(s)[0].notional, '3.52');
  assert.deepEqual(amzn.sizing.convertedFrom, { kind: 'qty', value: 0.0141 });
  assert.equal(byResult(out, 'ZZZZ').status, 'skipped');
  assert.match(byResult(out, 'ZZZZ').reason, /no price/);
});

test('a buy rejected for buying power is retried once, smaller, with a new id', async () => {
  let n = 0;
  const { ex, s } = build({
    cash: 10,
    createOrder: async (body) => {
      if (body.side === 'buy' && ++n === 1) throw alpacaError(403, 'insufficient buying power');
      return null; // fall through to the simulator
    },
  });
  const out = await ex.execute(recs(buy('UNH', 5)));

  assert.equal(byResult(out, 'UNH').status, 'executed');
  assert.deepEqual(buyBodies(s).map((b) => [b.notional, b.client_order_id]), [
    ['5', 'cp-20260907-UNH-buy'],
    ['4.9', 'cp-20260907-UNH-buy-r1'],
  ]);
  assert.match(byResult(out, 'UNH').reason, /retried at \$4.90/);
});

test('a second buying-power rejection is a failure, with no loop', async () => {
  const { ex, s } = build({
    cash: 10,
    createOrder: async (body) => {
      if (body.side === 'buy') throw alpacaError(403, 'insufficient buying power');
      return null;
    },
  });
  const out = await ex.execute(recs(buy('UNH', 5)));
  assert.equal(byResult(out, 'UNH').status, 'failed');
  assert.equal(buyBodies(s).length, 2);
});

test('a network error is checked against the client_order_id before calling it failed', async () => {
  const { ex, s } = build({
    cash: 10,
    createOrder: async (body) => {
      if (body.side === 'buy') throw new Error('socket hang up');
      return null;
    },
    getOrderByClientId: async (cid) => ({ id: 'found-1', client_order_id: cid, status: 'accepted' }),
  });
  const out = await ex.execute(recs(buy('UNH', 5)));

  assert.equal(byResult(out, 'UNH').status, 'executed');
  assert.equal(byResult(out, 'UNH').orderId, 'found-1');
  assert.equal(buyBodies(s).length, 1, 'no resubmit');
});

test('a buy of a symbol with an open sell is skipped (wash-trade protection)', async () => {
  const { ex, s } = build({
    cash: 10,
    start: at('09:08'),
    openOrders: [{ id: 'old-sell', symbol: 'UNH', side: 'sell', _qty: 0.01, _price: 400, _fillAt: Infinity }],
  });
  const out = await ex.execute(recs(buy('UNH', 3), buy('WMB', 2)));

  assert.equal(byResult(out, 'UNH').status, 'skipped');
  assert.match(byResult(out, 'UNH').reason, /wash-trade/);
  assert.equal(byResult(out, 'WMB').status, 'executed');
  assert.equal(buyBodies(s).length, 1);
});

test('the 9/7 recommendation set now executes instead of failing 4 of 5', async () => {
  const { ex, s } = build({ cash: 0.12, positions: [UNH, JPM_DUST], start: at('09:08', '2026-10-19') });
  const out = await ex.execute(recs(sellAll('UNH'), sellAll('JPM'), buy('META', 3.6), buy('VRT', 1.8), buy('XOM', 1.6)));

  assert.equal(out.summary.total, 5);
  assert.equal(out.summary.failed, 0, 'the run that failed 4 of 5 now fails none');
  assert.deepEqual(s.calls.closePosition, ['UNH', 'JPM']);
  assert.equal(buyBodies(s).length, 3, 'only the three buys use the order API');
  const spent = buyBodies(s).reduce((sum, b) => sum + Number(b.notional), 0);
  assert.ok(spent <= 0.12 + 6.31 + 0.04, 'the buys fit inside cash + proceeds');
});
