'use strict';

const { createLiveClient } = require('../alpacaClient');
const { resolveSizing } = require('./sizingResolver');
const { readMarketClock } = require('../market');

const MIN_NOTIONAL = 1.0;
const MINUTE = 60_000;
const DEFAULT_BUDGET_MS = 70 * MINUTE;

const DEFAULT_TIMING = {
  postOpenWaitMs: 20 * MINUTE,   // how long after the open to wait for this run's sells
  closeMarginMs: 5 * MINUTE,     // no proceeds-funded buys this close to the bell
  buyStageMs: 5 * MINUTE,        // what the buys need after the wait (reconcile, submit, fills)
  preOpenPollMs: 30_000,         // nothing can fill before the open, so poll slowly
  openPollMs: 3_000,
  reconcileMaxMs: 60_000,        // how long to wait for buying power to show the proceeds
  reconcilePollMs: 2_000,
  openGuardBeforeMs: 3 * MINUTE, // keep buys out of the minutes around the open
  openGuardAfterMs: MINUTE,
  fillWaitMs: 3 * MINUTE,        // after the open, wait this long to record fills
};

const ORDER_TERMINAL_STATES = new Set([
  'filled',
  'canceled',
  'expired',
  'rejected',
  'done_for_day',
  'replaced',
  'stopped',
  'suspended',
]);

/**
 * Takes the Analyst's recommendations and submits the corresponding
 * orders to Alpaca, with safety rails.
 *
 * This executor always submits real orders to the live brokerage account.
 * There is no dry-run mode and no paper account: every recommendation it
 * is handed is placed. The kill switch lives upstream — the store's
 * `active` switch decides whether a scheduled run happens at all (see
 * bot/run.js).
 *
 * How a run's buys get funded by its own sells
 * --------------------------------------------
 * Accounts under $2,000 are "limited margin" at Alpaca: buying power is
 * cash, but proceeds can be spent as soon as a sell fills. A scheduled run
 * places its orders before the 09:30 open, when nothing can fill, so:
 *   1. Sells are submitted at once and fill at the open.
 *   2. Buys are held while ANY sell on the account is open (this run's, or
 *      one left from an earlier run). The wait ends when they are all
 *      terminal, or at a deadline: 20 min after the open (or after now, if
 *      the market is already open), never past 5 min before the close, and
 *      never past the run's own time budget. If waiting for the next open
 *      doesn't fit the budget (a forced run in the evening), sells are
 *      queued and buys are sized to the cash available now.
 *   3. Buying power is re-read until it reflects the filled proceeds.
 *   4. Buys are sized to what's really there: if they ask for more, every
 *      one is scaled down by the same factor (never up), and any that fall
 *      under $1 are dropped. Buys always go in as dollar amounts, so the
 *      reserved amount is the order amount; an asset that can't trade in
 *      fractions gets whole shares instead.
 *   5. Fills are recorded, so the run record and the memo say what filled.
 *
 * Other safety design:
 *   - All recommendations are executed regardless of confidence level.
 *   - Each order gets a deterministic client_order_id (cp-YYYYMMDD-TICKER-
 *     action) so a same-day re-run is rejected by Alpaca, not doubled.
 *   - Below-minimum notionals are skipped on buys. Sells are always
 *     attempted: Alpaca's $1 floor is a buy-entry rule.
 *   - Full exits go through DELETE /v2/positions/{symbol}, so Alpaca
 *     computes the share count at execution.
 *   - A buy is skipped while a sell of the same symbol is open (Alpaca's
 *     wash-trade protection would reject it).
 *   - A buy rejected for buying power is retried once at 98% with a new
 *     client_order_id; a network error is checked against the
 *     client_order_id before the order is called failed.
 *
 * Trust boundary: the Analyst is responsible for the four hard rules (no
 * penny stocks, 30% cap, no earnings-week buys, US equities only). Scaling
 * only ever shrinks a buy, so it can't break the cap.
 */
class Executor {
  constructor({
    keyId,
    secretKey,
    runDate = null,
    deadlineAt = null,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    priceLookup = null,
    onProgress = null,
    timing = {},
  } = {}) {
    if (!keyId || !secretKey) {
      throw new Error('Executor requires keyId and secretKey');
    }
    this.client = createLiveClient({ keyId, secretKey });
    this.runDate = runDate || new Date().toISOString().slice(0, 10);
    this.deadlineAt = deadlineAt;
    this.now = now;
    this.sleep = sleep;
    this.priceLookup = priceLookup || ((symbol) => iexLatestPrice(symbol, { keyId, secretKey }));
    this.onProgress = onProgress;
    this.timing = { ...DEFAULT_TIMING, ...timing };
    this.assetCache = new Map();
  }

  async execute(recommendationsObject) {
    const recs = recommendationsObject?.recommendations ?? [];

    if (recs.length === 0) {
      return {
        asOf: new Date(this.now()).toISOString(),
        runDate: this.runDate,
        results: [],
        summary: summarize([]),
        timeline: {},
        notices: [],
      };
    }

    const notices = [];
    const timeline = { startedAt: iso(this.now()) };
    const deadlineAt = this.deadlineAt ?? this.now() + DEFAULT_BUDGET_MS;

    const clock = await readMarketClock(this.client, this.now());
    timeline.market = {
      isOpen: clock.isOpen,
      sessionOpen: iso(clock.sessionOpen),
      nextClose: iso(clock.nextClose),
    };

    let snapshot = await this._accountSnapshot();
    timeline.buyingPowerBefore = finiteOrNull(snapshot.buyingPower);

    const sellRecs = recs.filter((r) => r.action === 'sell');
    const buyRecs = recs.filter((r) => r.action === 'buy');

    // ── Sells ─────────────────────────────────────────────────────────────
    const sellResults = [];
    for (const rec of sellRecs) {
      sellResults.push(await this._processSell(rec, snapshot));
    }
    if (sellRecs.length > 0) timeline.sellsSubmittedAt = iso(this.now());

    // ── Buys, funded by whatever the sells actually raise ─────────────────
    let buyResults = [];
    if (buyRecs.length > 0) {
      const thisRun = sellResults.filter((r) => r.status === 'executed' && r.orderId).map((r) => r.orderId);
      const openSells = (await this._openOrders()).filter((o) => o.side === 'sell').map((o) => String(o.id));
      const waitIds = [...new Set([...thisRun, ...openSells])];
      let skipAll = null;

      if (waitIds.length > 0) {
        const plan = this._waitPlan(clock, deadlineAt);
        timeline.waitMode = plan.mode;
        timeline.waitedOn = waitIds.length;

        if (plan.mode === 'closed') {
          notices.push(
            `The market is closed until ${iso(clock.sessionOpen)}, too far to wait within this run: ` +
              'sells are queued for the open, and buys were sized to the cash available now.'
          );
        } else {
          timeline.waitUntil = iso(plan.until);
          await this._report({ stage: 'waiting-for-sells', sellResults, deferredBuys: buyRecs, waitUntil: plan.until });

          const { settled, unsettled } = await this._waitForOrders(waitIds, plan.until, clock);
          timeline.sellsSettledAt = iso(this.now());
          if (unsettled.length > 0) {
            notices.push(
              `${unsettled.length} of ${waitIds.length} sell order(s) were still open at ${iso(plan.until)}; ` +
                'buys were sized to the cash available without them.'
            );
          }
          const proceeds = settled.filter((o) => o.side === 'sell').reduce((sum, o) => sum + filledValue(o), 0);
          timeline.sellProceeds = round2(proceeds);
          snapshot = await this._reconcile(snapshot.buyingPower, proceeds, deadlineAt, notices);

          if (this.now() >= clock.nextClose - this.timing.closeMarginMs) {
            skipAll = `the session closes at ${iso(clock.nextClose)}; buys funded by this run's sells aren't placed this close to the bell`;
          } else {
            await this._respectOpenGuard(clock);
          }
        }
      }

      timeline.buyingPowerForBuys = finiteOrNull(snapshot.buyingPower);
      buyResults = skipAll
        ? buyRecs.map((rec) => ({ recommendation: rec, sizing: null, orderId: null, status: 'skipped', reason: skipAll }))
        : await this._placeBuys(buyRecs, snapshot, notices);
      timeline.buysSubmittedAt = iso(this.now());
    }

    const results = [...sellResults, ...buyResults];
    await this._recordFills(results, clock, deadlineAt);
    timeline.finishedAt = iso(this.now());

    return {
      asOf: new Date(this.now()).toISOString(),
      runDate: this.runDate,
      summary: summarize(results),
      results,
      timeline,
      notices,
      ...(notices.length ? { notice: notices.join(' ') } : {}),
    };
  }

  // ── Account, orders, assets, prices ─────────────────────────────────────

  async _accountSnapshot() {
    const [account, rawPositions] = await Promise.all([
      this.client.getAccount(),
      this.client.getPositions(),
    ]);
    const equity = Number(account.equity);
    const bp = [account.buying_power, account.non_marginable_buying_power]
      .filter((v) => v !== undefined && v !== null)
      .map(Number)
      .filter(Number.isFinite);
    const positionsBySymbol = new Map(
      rawPositions.map((p) => [
        p.symbol,
        {
          symbol: p.symbol,
          qty: Number(p.qty),
          marketValue: Number(p.market_value),
          currentPrice: Number(p.current_price),
        },
      ])
    );
    // Unknown buying power (never in production) reads as unlimited, so
    // nothing is scaled on a guess.
    return { equity, buyingPower: bp.length ? Math.min(...bp) : Infinity, positionsBySymbol };
  }

  async _openOrders() {
    try {
      return (await this.client.getOrders({ status: 'open', limit: 500, nested: false })) || [];
    } catch (_err) {
      return [];
    }
  }

  /** {tradable, fractionable}, or null when Alpaca has no such asset. */
  async _asset(symbol) {
    if (this.assetCache.has(symbol)) return this.assetCache.get(symbol);
    let asset;
    try {
      const a = await this.client.getAsset(symbol);
      asset = { tradable: a?.tradable !== false, fractionable: a?.fractionable !== false };
    } catch (err) {
      // A lookup failure other than "not found" shouldn't block the order;
      // Alpaca still rejects anything it can't trade.
      asset = err?.response?.status === 404 ? null : { tradable: true, fractionable: true };
    }
    this.assetCache.set(symbol, asset);
    return asset;
  }

  async _price(symbol, snapshot) {
    const held = snapshot.positionsBySymbol.get(symbol)?.currentPrice;
    if (Number.isFinite(held) && held > 0) return held;
    try {
      const p = await this.priceLookup(symbol);
      return Number.isFinite(p) && p > 0 ? p : null;
    } catch (_err) {
      return null;
    }
  }

  // ── Waiting ─────────────────────────────────────────────────────────────

  /**
   * How long buys wait for the sells. While the market is open, Alpaca's
   * next_open is tomorrow, so the deadline counts from now instead.
   */
  _waitPlan(clock, deadlineAt) {
    const t = this.timing;
    const now = this.now();
    const budgetEnd = deadlineAt - t.buyStageMs;
    if (clock.isOpen) {
      return { mode: 'open', until: Math.min(now + t.postOpenWaitMs, clock.nextClose - t.closeMarginMs, budgetEnd) };
    }
    const until = Math.min(clock.sessionOpen + t.postOpenWaitMs, clock.nextClose - t.closeMarginMs);
    if (until <= budgetEnd) return { mode: 'pre-open', until };
    return { mode: 'closed', until: null };
  }

  /**
   * Poll orders until each is terminal or `until` passes. Transient read
   * errors are swallowed; the next poll retries. Returns the final order
   * objects for the settled ones.
   */
  async _waitForOrders(orderIds, until, clock) {
    const pending = new Set(orderIds);
    const settled = [];
    for (;;) {
      for (const id of [...pending]) {
        try {
          const o = await this.client.getOrder(id);
          if (o && ORDER_TERMINAL_STATES.has(o.status)) {
            settled.push(o);
            pending.delete(id);
          }
        } catch (_err) {
          /* retried on the next poll */
        }
      }
      const now = this.now();
      if (pending.size === 0 || now >= until) break;
      const interval = now < clock.sessionOpen ? this.timing.preOpenPollMs : this.timing.openPollMs;
      await this.sleep(Math.min(interval, until - now));
    }
    return { settled, unsettled: [...pending] };
  }

  /** Re-read the account until buying power shows the sells' proceeds. */
  async _reconcile(bpBefore, proceeds, deadlineAt, notices) {
    let snap = await this._accountSnapshot();
    if (!(proceeds > 0) || !Number.isFinite(bpBefore)) return snap;
    const target = bpBefore + proceeds - 0.01;
    const stopAt = Math.min(this.now() + this.timing.reconcileMaxMs, deadlineAt);
    while (snap.buyingPower < target && this.now() < stopAt) {
      await this.sleep(this.timing.reconcilePollMs);
      snap = await this._accountSnapshot();
    }
    if (snap.buyingPower < target) {
      notices.push(
        `Buying power showed $${round2(snap.buyingPower)} after the sells filled, short of the ` +
          `$${round2(target)} expected; buys were sized to what Alpaca reported.`
      );
    }
    return snap;
  }

  /** Keep buys out of the few minutes around the open. */
  async _respectOpenGuard(clock) {
    const now = this.now();
    const { openGuardBeforeMs, openGuardAfterMs } = this.timing;
    if (now >= clock.sessionOpen - openGuardBeforeMs && now < clock.sessionOpen + openGuardAfterMs) {
      await this.sleep(clock.sessionOpen + openGuardAfterMs - now);
    }
  }

  /** Wait (within the budget) for submitted orders to fill, and record what happened. */
  async _recordFills(results, clock, deadlineAt) {
    const tracked = results.filter((r) => r.status === 'executed' && r.orderId);
    if (tracked.length === 0) return;
    // Orders queued for an open beyond the budget are read once, not waited on.
    const until = clock.sessionOpen >= deadlineAt
      ? this.now()
      : Math.min(Math.max(this.now(), clock.sessionOpen) + this.timing.fillWaitMs, deadlineAt);
    const byId = new Map();
    const { settled } = await this._waitForOrders(tracked.map((r) => r.orderId), until, clock);
    for (const o of settled) byId.set(String(o.id), o);
    for (const r of tracked) {
      let o = byId.get(r.orderId);
      if (!o) {
        try {
          o = await this.client.getOrder(r.orderId);
        } catch (_err) {
          o = null;
        }
      }
      if (o) {
        r.fill = {
          status: o.status,
          filledQty: numOrNull(o.filled_qty),
          filledAvgPrice: numOrNull(o.filled_avg_price),
          filledAt: o.filled_at || null,
        };
      }
    }
  }

  async _report(progress) {
    if (!this.onProgress) return;
    try {
      await this.onProgress(progress);
    } catch (_err) {
      /* progress reporting must never block trading */
    }
  }

  // ── Sells ───────────────────────────────────────────────────────────────

  async _processSell(rec, { equity, positionsBySymbol }) {
    const base = { recommendation: rec, sizing: null, orderId: null, reason: null };

    const sizing = resolveSizing({
      action: rec.action,
      ticker: rec.ticker,
      amount: rec.amount,
      currentEquity: equity,
      currentPosition: positionsBySymbol.get(rec.ticker),
    });
    if (sizing.kind === 'error') {
      return { ...base, status: 'skipped', reason: sizing.message };
    }
    base.sizing = sizing;

    // Full exit — DELETE /v2/positions/{symbol}. Alpaca resolves the exact
    // share count server-side at execution. Sub-$1 exits are attempted:
    // Alpaca's $1 floor is a buy-entry rule.
    if (sizing.kind === 'close') {
      return this._closePosition(rec, base);
    }
    return this._submit(rec, base, this._orderBody(rec, sizing));
  }

  /**
   * Liquidate the whole position via DELETE /v2/positions/{symbol}.
   *
   * Unlike createOrder this carries no client_order_id, so the duplicate
   * guard that protects re-runs does not apply. The position check in
   * resolveSizing covers it instead: once the exit fills there is no
   * position left, and a repeat run resolves to "no current position"
   * and skips.
   */
  async _closePosition(rec, base) {
    try {
      const order = await this.client.closePosition(rec.ticker);
      return { ...base, status: 'executed', orderId: order?.id ? String(order.id) : null };
    } catch (err) {
      if (isPositionNotFound(err)) {
        return {
          ...base,
          status: 'already_submitted',
          reason: 'position already closed before this order was placed',
        };
      }
      // A position too small for Alpaca to trade is a standing condition,
      // not a failure worth retrying — report it as a skip.
      if (isMinimumSizeRejection(err)) {
        const value = Number(base.sizing?.value);
        const held = Number.isFinite(value) ? `${value} sh` : 'position';
        return {
          ...base,
          status: 'skipped',
          reason: `${held} of ${rec.ticker} is below Alpaca's minimum tradable size and cannot be liquidated through the API (${extractAlpacaError(err)})`,
        };
      }
      return { ...base, status: 'failed', reason: extractAlpacaError(err) };
    }
  }

  // ── Buys ────────────────────────────────────────────────────────────────

  async _placeBuys(buyRecs, snapshot, notices) {
    const openSellSymbols = new Set(
      (await this._openOrders()).filter((o) => o.side === 'sell').map((o) => o.symbol)
    );
    const results = new Array(buyRecs.length);
    const planned = [];

    for (const [i, rec] of buyRecs.entries()) {
      const base = { recommendation: rec, sizing: null, orderId: null, reason: null };
      const skip = (reason) => { results[i] = { ...base, status: 'skipped', reason }; };

      const sizing = resolveSizing({
        action: rec.action,
        ticker: rec.ticker,
        amount: rec.amount,
        currentEquity: snapshot.equity,
        currentPosition: snapshot.positionsBySymbol.get(rec.ticker),
      });
      if (sizing.kind === 'error') { skip(sizing.message); continue; }
      base.sizing = sizing;

      if (openSellSymbols.has(rec.ticker)) {
        skip(`a sell of ${rec.ticker} is still open, and Alpaca rejects a buy against it (wash-trade protection)`);
        continue;
      }
      const asset = await this._asset(rec.ticker);
      if (!asset) { skip(`Alpaca has no asset ${rec.ticker}`); continue; }
      if (!asset.tradable) { skip(`${rec.ticker} is not tradable at Alpaca`); continue; }

      let dollars;
      let price = null;
      if (sizing.kind === 'qty') {
        price = await this._price(rec.ticker, snapshot);
        if (!price) { skip(`no price for ${rec.ticker} to turn ${sizing.value} shares into dollars`); continue; }
        dollars = sizing.value * price;
      } else {
        dollars = sizing.value;
      }
      if (dollars < MIN_NOTIONAL) {
        skip(`notional $${dollars.toFixed(2)} below Alpaca minimum $${MIN_NOTIONAL}`);
        continue;
      }
      planned.push({ i, rec, base, dollars, price, fractionable: asset.fractionable });
    }

    // Fit the buys to the buying power that's really there. Never scale up.
    const bp = snapshot.buyingPower;
    const available = Number.isFinite(bp) ? Math.max(0, bp - Math.max(0.02, bp * 0.01)) : Infinity;
    const total = planned.reduce((sum, p) => sum + p.dollars, 0);
    const factor = total > available ? available / total : 1;
    if (factor < 1 && planned.length > 0) {
      notices.push(
        `Buys asked for $${round2(total)} with $${round2(available)} available; ` +
          `each was scaled to ${Math.floor(factor * 1000) / 10}% of its size.`
      );
    }

    for (const p of planned) {
      const target = floor2(p.dollars * factor);
      const base = { ...p.base };
      if (factor < 1) {
        base.scaled = {
          from: round2(p.dollars),
          to: target,
          reason: "the cash available after this run's sells was short of the planned buys",
        };
      }
      const body = { ...this._orderBody(p.rec, { kind: 'notional', value: target }) };

      if (!p.fractionable) {
        const price = p.price ?? (await this._price(p.rec.ticker, snapshot));
        const shares = price ? Math.floor(target / price) : 0;
        if (shares < 1) {
          results[p.i] = {
            ...base,
            status: 'skipped',
            reason: price
              ? `${p.rec.ticker} can't be bought in fractions, and $${target.toFixed(2)} buys less than one share`
              : `${p.rec.ticker} can't be bought in fractions, and there is no price to size whole shares`,
          };
          continue;
        }
        delete body.notional;
        body.qty = String(shares);
        base.sizing = { kind: 'qty', value: shares, wholeShares: true };
      } else {
        if (target < MIN_NOTIONAL) {
          results[p.i] = {
            ...base,
            status: 'skipped',
            reason: `scaled to $${target.toFixed(2)}, below Alpaca's $${MIN_NOTIONAL} minimum`,
          };
          continue;
        }
        base.sizing = {
          kind: 'notional',
          value: target,
          ...(p.base.sizing.kind === 'qty' ? { convertedFrom: { kind: 'qty', value: p.base.sizing.value } } : {}),
        };
      }
      results[p.i] = await this._submit(p.rec, base, body, { retryOnBuyingPower: true });
    }
    return results;
  }

  // ── Submitting ──────────────────────────────────────────────────────────

  async _submit(rec, base, body, { retryOnBuyingPower = false } = {}) {
    try {
      const order = await this.client.createOrder(body);
      return { ...base, status: 'executed', orderId: String(order.id) };
    } catch (err) {
      // A duplicate client_order_id means this order was already placed in an
      // earlier run today. Treat it as already-submitted, not a failure.
      if (isDuplicateClientOrderId(err)) {
        return {
          ...base,
          status: 'already_submitted',
          reason: 'order already placed in a prior run today (same client_order_id)',
        };
      }
      // No HTTP response: the order may have been created anyway.
      if (!err?.response) {
        try {
          const found = await this.client.getOrderByClientId(body.client_order_id);
          if (found?.id) {
            return {
              ...base,
              status: 'executed',
              orderId: String(found.id),
              reason: `confirmed by client_order_id after: ${err.message || err}`,
            };
          }
        } catch (_lookupErr) {
          /* not found: fall through to failed */
        }
      }
      if (retryOnBuyingPower && body.notional && isInsufficientBuyingPower(err)) {
        const retry = floor2(Number(body.notional) * 0.98);
        if (retry >= MIN_NOTIONAL) {
          const retryBody = { ...body, notional: String(retry), client_order_id: `${body.client_order_id}-r1` };
          try {
            const order = await this.client.createOrder(retryBody);
            return {
              ...base,
              sizing: { ...base.sizing, value: retry },
              status: 'executed',
              orderId: String(order.id),
              reason: `retried at $${retry.toFixed(2)} after: ${extractAlpacaError(err)}`,
            };
          } catch (err2) {
            return {
              ...base,
              status: 'failed',
              reason: `${extractAlpacaError(err)}; retry at $${retry.toFixed(2)} also failed: ${extractAlpacaError(err2)}`,
            };
          }
        }
      }
      return { ...base, status: 'failed', reason: extractAlpacaError(err) };
    }
  }

  _orderBody(rec, sizing) {
    const body = {
      symbol: rec.ticker,
      side: rec.action,
      type: 'market',
      time_in_force: 'day',
      client_order_id: this._clientOrderId(rec),
    };
    if (sizing.kind === 'qty') {
      body.qty = String(sizing.value);
    } else {
      body.notional = String(sizing.value);
    }
    return body;
  }

  /**
   * Deterministic across retries within the same run date so a duplicate
   * submission is rejected by Alpaca rather than placing two orders.
   * Format: cp-YYYYMMDD-TICKER-action  (max 48 chars; well within limit)
   */
  _clientOrderId(rec) {
    const date = this.runDate.replace(/-/g, '');
    return `cp-${date}-${rec.ticker.toUpperCase()}-${rec.action}`;
  }
}

/** The latest IEX trade price (the free data plan can't read recent SIP data). */
async function iexLatestPrice(symbol, { keyId, secretKey }) {
  const res = await fetch(
    `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=iex`,
    { headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secretKey } }
  );
  if (!res.ok) return null;
  const price = Number((await res.json())?.trade?.p);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function errorText(err) {
  const data = err?.response?.data;
  if (data) return typeof data === 'string' ? data : (data.message || JSON.stringify(data));
  return err?.message || String(err);
}

function isPositionNotFound(err) {
  if (err?.response?.status === 404) return true;
  const msg = errorText(err).toLowerCase();
  return msg.includes('position does not exist') || msg.includes('position not found');
}

/**
 * Alpaca rejects sub-minimum orders with a few different wordings
 * depending on the path taken; match on the distinctive phrases rather
 * than the status code, which it shares with ordinary rejections.
 */
function isMinimumSizeRejection(err) {
  const msg = errorText(err).toLowerCase();
  return (
    msg.includes('minimum pricing criteria') ||
    msg.includes('notional increment') ||
    (msg.includes('minimum') && (msg.includes('notional') || msg.includes('qty')))
  );
}

function isInsufficientBuyingPower(err) {
  return err?.response?.status === 403 && errorText(err).toLowerCase().includes('insufficient buying power');
}

function isDuplicateClientOrderId(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  if (status !== 422 || !data) return false;
  const msg = typeof data === 'string' ? data : (data.message || JSON.stringify(data));
  return msg.toLowerCase().includes('client_order_id') && msg.toLowerCase().includes('unique');
}

/**
 * The Alpaca SDK wraps axios errors and surfaces only the HTTP status by
 * default ("Request failed with status code 422"). The actual rejection
 * reason lives in err.response.data — extract it so failed orders log
 * something actionable.
 */
function extractAlpacaError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  if (status && data) {
    const body = typeof data === 'string' ? data : (data.message || JSON.stringify(data));
    return `HTTP ${status}: ${body}`;
  }
  return err?.message || String(err);
}

function filledValue(order) {
  const qty = Number(order.filled_qty);
  const price = Number(order.filled_avg_price);
  return Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0;
}

const round2 = (x) => Math.round(x * 100) / 100;
const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100;
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const finiteOrNull = (x) => (Number.isFinite(x) ? round2(x) : null);
const numOrNull = (x) => (x === null || x === undefined || x === '' ? null : Number(x));

function summarize(results) {
  const tally = { total: results.length, executed: 0, skipped: 0, failed: 0, alreadySubmitted: 0, filled: 0 };
  for (const r of results) {
    if (r.status === 'executed') tally.executed++;
    else if (r.status === 'skipped') tally.skipped++;
    else if (r.status === 'failed') tally.failed++;
    else if (r.status === 'already_submitted') tally.alreadySubmitted++;
    if (r.fill?.status === 'filled') tally.filled++;
  }
  return tally;
}

module.exports = Executor;
module.exports.DEFAULT_TIMING = DEFAULT_TIMING;
