'use strict';

const Alpaca = require('@alpacahq/alpaca-trade-api');
const { resolveSizing } = require('./sizingResolver');

const MIN_NOTIONAL = 1.0;
const SELL_SETTLE_POLL_MS = 2000;
const SELL_SETTLE_TIMEOUT_MS = 120000;
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
 * Safety design:
 *   - dryRun is true by default. Live trading requires explicit opt-in.
 *   - All recommendations are executed regardless of confidence level.
 *     Confidence is informational only — Claude uses it to express
 *     conviction, but the executor trusts all of Claude's decisions.
 *   - Each order gets a deterministic client_order_id so re-runs of the
 *     same recommendation set don't double-submit (Alpaca rejects
 *     duplicates).
 *   - Sells run before buys to free cash. We submit all sells, poll
 *     them until they reach a terminal state (or hit a timeout), then
 *     refresh the account snapshot before placing buys — otherwise
 *     buys race ahead of the sell fills and Alpaca rejects them for
 *     insufficient buying power.
 *   - Below-minimum notionals are skipped.
 *
 * Trust boundary:
 *   - The Analyst is responsible for the four hard rules (no penny stocks,
 *     30% cap, no earnings-week buys, US equities only). The Executor
 *     does not re-validate those — it would require fetching quotes and
 *     the earnings calendar again, and the system prompt is the contract.
 *     If we ever see the Analyst violate a rule, we add validation here.
 *   - The Executor DOES validate: minimum notional, sufficient position
 *     for sells, and sane sizing.
 */
class Executor {
  constructor({
    keyId,
    secretKey,
    paper = true,
    dryRun = true,
    runDate = null,
    sellSettlePollMs = SELL_SETTLE_POLL_MS,
    sellSettleTimeoutMs = SELL_SETTLE_TIMEOUT_MS,
  } = {}) {
    if (!keyId || !secretKey) {
      throw new Error('Executor requires keyId and secretKey');
    }
    this.client = new Alpaca({ keyId, secretKey, paper });
    this.dryRun = dryRun;
    this.runDate = runDate || new Date().toISOString().slice(0, 10);
    this.sellSettlePollMs = sellSettlePollMs;
    this.sellSettleTimeoutMs = sellSettleTimeoutMs;
  }

  async execute(recommendationsObject) {
    const recs = recommendationsObject?.recommendations ?? [];

    if (recs.length === 0) {
      return {
        asOf: new Date().toISOString(),
        dryRun: this.dryRun,
        runDate: this.runDate,
        results: [],
        summary: { total: 0, executed: 0, skipped: 0, failed: 0, dryRun: 0, alreadySubmitted: 0 },
      };
    }

    // Sells first, buys second — frees cash before deploying.
    const sellRecs = recs.filter((r) => r.action === 'sell');
    const buyRecs = recs.filter((r) => r.action === 'buy');

    let snapshot = await this._accountSnapshot();

    // ── Pass 1: sells ─────────────────────────────────────────────────────
    const sellResults = [];
    for (const rec of sellRecs) {
      sellResults.push(await this._processOne(rec, snapshot));
    }

    // Wait for live sell orders to reach a terminal state before placing
    // buys. createOrder returns when Alpaca *accepts* the order, but
    // buying power isn't credited until it *fills* — without this gate,
    // buys race ahead and get rejected for insufficient buying power.
    // Skip the wait when there are no buys depending on the proceeds.
    let settleNotice = null;
    const liveSellIds = sellResults
      .filter((r) => r.status === 'executed' && r.orderId)
      .map((r) => r.orderId);
    if (liveSellIds.length > 0 && buyRecs.length > 0) {
      const { unsettled } = await this._waitForOrders(liveSellIds);
      if (unsettled.length > 0) {
        settleNotice = `${unsettled.length} of ${liveSellIds.length} sell order(s) did not reach a terminal state within ${this.sellSettleTimeoutMs}ms; buys submitted against whatever buying power Alpaca reports.`;
      }
      // Refresh snapshot so buy sizing reflects post-sell buying power
      // and updated position values.
      snapshot = await this._accountSnapshot();
    }

    // ── Pass 2: buys ──────────────────────────────────────────────────────
    const buyResults = [];
    for (const rec of buyRecs) {
      buyResults.push(await this._processOne(rec, snapshot));
    }

    const results = [...sellResults, ...buyResults];
    const summary = summarize(results);
    return {
      asOf: new Date().toISOString(),
      dryRun: this.dryRun,
      runDate: this.runDate,
      summary,
      results,
      ...(settleNotice ? { notice: settleNotice } : {}),
    };
  }

  async _accountSnapshot() {
    const [account, rawPositions] = await Promise.all([
      this.client.getAccount(),
      this.client.getPositions(),
    ]);
    const equity = Number(account.equity);
    const positionsBySymbol = new Map(
      rawPositions.map((p) => [
        p.symbol,
        {
          symbol: p.symbol,
          qty: Number(p.qty),
          marketValue: Number(p.market_value),
        },
      ])
    );
    return { equity, positionsBySymbol };
  }

  /**
   * Poll each submitted sell order until it reaches a terminal state
   * (filled, canceled, rejected, etc.) or the overall timeout elapses.
   * `partially_filled` is intentionally not terminal — we want the
   * order to finish before sizing buys against the freed cash.
   *
   * Transient read errors are swallowed; the next poll retries. Anything
   * still pending at the deadline is returned in `unsettled` so the
   * caller can surface it.
   */
  async _waitForOrders(orderIds) {
    const deadline = Date.now() + this.sellSettleTimeoutMs;
    const pending = new Set(orderIds);
    const settled = [];

    while (pending.size > 0 && Date.now() < deadline) {
      const checks = await Promise.all(
        [...pending].map(async (id) => {
          try {
            const o = await this.client.getOrder(id);
            return { id, status: o?.status ?? null };
          } catch (_err) {
            return { id, status: null };
          }
        })
      );
      for (const { id, status } of checks) {
        if (status && ORDER_TERMINAL_STATES.has(status)) {
          settled.push({ id, status });
          pending.delete(id);
        }
      }
      if (pending.size > 0 && Date.now() < deadline) {
        await sleep(this.sellSettlePollMs);
      }
    }

    return { settled, unsettled: [...pending] };
  }

  async _processOne(rec, { equity, positionsBySymbol }) {
    const base = { recommendation: rec, sizing: null, orderId: null, reason: null };

    // 1. Resolve sizing.
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

    // 2. Minimum-notional check (only meaningful when sizing in dollars).
    if (sizing.kind === 'notional' && sizing.value < MIN_NOTIONAL) {
      return {
        ...base,
        status: 'skipped',
        reason: `notional $${sizing.value.toFixed(2)} below Alpaca minimum $${MIN_NOTIONAL}`,
      };
    }

    // 3. Build the order payload.
    const orderBody = this._buildOrderBody(rec, sizing);

    // 4. Dry run? Stop here.
    if (this.dryRun) {
      return { ...base, status: 'dry_run', reason: 'dryRun=true' };
    }

    // 5. Live submit.
    try {
      const order = await this.client.createOrder(orderBody);
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
      return { ...base, status: 'failed', reason: extractAlpacaError(err) };
    }
  }

  _buildOrderBody(rec, sizing) {
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
  return err.message || String(err);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarize(results) {
  const tally = { total: results.length, executed: 0, skipped: 0, failed: 0, dryRun: 0, alreadySubmitted: 0 };
  for (const r of results) {
    if (r.status === 'executed') tally.executed++;
    else if (r.status === 'skipped') tally.skipped++;
    else if (r.status === 'failed') tally.failed++;
    else if (r.status === 'dry_run') tally.dryRun++;
    else if (r.status === 'already_submitted') tally.alreadySubmitted++;
  }
  return tally;
}

module.exports = Executor;
