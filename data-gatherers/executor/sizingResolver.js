'use strict';

/**
 * Pure sizing logic — converts the Analyst's `amount: { type, value }`
 * into the shape Alpaca's order APIs expect.
 *
 * Lives separate from the Executor so it can be unit-tested in isolation
 * without touching the Alpaca API.
 *
 * Returns one of:
 *   { kind: 'qty',      value: number }    // share count, floored to 9dp
 *   { kind: 'notional', value: number }    // dollar amount, 2dp
 *   { kind: 'close',    value: number }    // full exit; value is the snapshot
 *                                          // position size, informational only
 *   { kind: 'error',    message: string }  // sizing impossible — caller skips
 *
 * Convention for "percent":
 *   - on a BUY:  percent of current portfolio equity (deploys cash)
 *   - on a SELL: percent of the current position in that ticker (trims)
 *
 * Why sells size in SHARES, and full exits get their own kind
 * -----------------------------------------------------------
 * Sells used to be sized as a dollar notional (marketValue * pct). Alpaca
 * converts a notional back into shares at the *execution* price, so any
 * tick between our snapshot and the fill changes the implied share count:
 *
 *   - price ticks down -> implied qty exceeds the position ->
 *     403 "insufficient qty available for order"
 *   - price ticks up   -> implied qty falls short -> partial exit that
 *     strands a sub-$1 stub we can no longer sell
 *
 * A 100% exit sized that way is a coin flip between those two outcomes,
 * and both were observed in production: UNH was rejected on 8/31, 9/3 and
 * 9/7, while JPM filled short on 8/10 and 8/20 and left 0.000094648 sh of
 * dust behind. Rounding the notional up (round2) guaranteed a small
 * over-request even before any price movement.
 *
 * Share counts do not move with price, so sizing sells in shares removes
 * the race entirely, and a full exit is delegated to Alpaca's
 * close-position endpoint, which resolves the exact quantity server-side.
 * This matches Alpaca's own guidance for the insufficient-qty error:
 * validate size-sensitive orders against current position data.
 *
 * Share quantities are floored, never rounded — rounding up is precisely
 * the over-request this is meant to eliminate. Sell notionals are floored
 * to the cent for the same reason.
 */

// A dollar-denominated sell within this fraction of the position's market
// value is treated as a full exit. Without it, "sell $6.31" against a
// $6.308111 position hits the same over-request bug percent sells did.
const FULL_EXIT_TOLERANCE = 0.01;

const VALID_TYPES = new Set(['dollars', 'shares', 'percent']);

function resolveSizing({ action, ticker, amount, currentEquity, currentPosition }) {
  if (
    !amount ||
    typeof amount.value !== 'number' ||
    !Number.isFinite(amount.value) ||
    amount.value <= 0
  ) {
    return { kind: 'error', message: `invalid amount on ${action} ${ticker}` };
  }
  if (!VALID_TYPES.has(amount.type)) {
    return { kind: 'error', message: `unknown amount type "${amount.type}" on ${ticker}` };
  }
  if (action !== 'buy' && action !== 'sell') {
    return { kind: 'error', message: `unknown action "${action}" on ${ticker}` };
  }

  return action === 'buy'
    ? resolveBuy({ ticker, amount, currentEquity })
    : resolveSell({ ticker, amount, currentPosition });
}

function resolveBuy({ ticker, amount, currentEquity }) {
  switch (amount.type) {
    case 'shares':
      return { kind: 'qty', value: amount.value };

    case 'dollars':
      return { kind: 'notional', value: round2(amount.value) };

    case 'percent': {
      if (amount.value > 100) {
        return { kind: 'error', message: `percent > 100 on buy ${ticker}` };
      }
      if (!currentEquity || currentEquity <= 0) {
        return { kind: 'error', message: `no portfolio equity to size buy of ${ticker}` };
      }
      return { kind: 'notional', value: round2(currentEquity * (amount.value / 100)) };
    }
  }
}

function resolveSell({ ticker, amount, currentPosition }) {
  const qtyHeld = Number(currentPosition?.qty);
  if (!currentPosition || !Number.isFinite(qtyHeld) || qtyHeld <= 0) {
    return { kind: 'error', message: `cannot sell ${ticker} — no current position` };
  }

  switch (amount.type) {
    case 'percent': {
      if (amount.value > 100) {
        return { kind: 'error', message: `percent > 100 on sell ${ticker}` };
      }
      if (amount.value >= 100) {
        return { kind: 'close', value: qtyHeld };
      }
      return asQty(floor9(qtyHeld * (amount.value / 100)), ticker);
    }

    case 'shares': {
      // Asking for at least what we hold is a full exit — clamp rather
      // than let Alpaca reject the over-request.
      if (amount.value >= qtyHeld) {
        return { kind: 'close', value: qtyHeld };
      }
      return asQty(floor9(amount.value), ticker);
    }

    case 'dollars': {
      const marketValue = Number(currentPosition.marketValue);
      if (!Number.isFinite(marketValue) || marketValue <= 0) {
        return { kind: 'error', message: `cannot sell ${ticker} — position has no market value` };
      }
      if (amount.value >= marketValue * (1 - FULL_EXIT_TOLERANCE)) {
        return { kind: 'close', value: qtyHeld };
      }
      return { kind: 'notional', value: floor2(amount.value) };
    }
  }
}

function asQty(value, ticker) {
  if (!(value > 0)) {
    return { kind: 'error', message: `sell of ${ticker} rounds to zero shares` };
  }
  return { kind: 'qty', value };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Sells floor rather than round: a fraction of a cent too much is a
// rejected order, a fraction of a cent too little is a filled one.
function floor2(n) {
  return Math.floor(n * 100) / 100;
}

// Alpaca accepts up to 9 decimal places on qty.
function floor9(n) {
  return Math.floor(n * 1e9) / 1e9;
}

module.exports = { resolveSizing };
