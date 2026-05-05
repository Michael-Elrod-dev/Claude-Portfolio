'use strict';

/**
 * Pure sizing logic — converts the Analyst's `amount: { type, value }`
 * into the shape Alpaca's createOrder expects: either { qty } or
 * { notional }.
 *
 * Lives separate from the Executor so it can be unit-tested in isolation
 * without touching the Alpaca API.
 *
 * Returns one of:
 *   { kind: 'qty',      value: number }       // Alpaca takes qty as a string
 *   { kind: 'notional', value: number }       // dollar amount, rounded to cents
 *   { kind: 'error',    message: string }     // sizing impossible — caller should skip
 *
 * Convention for "percent":
 *   - on a BUY:  percent of current portfolio equity (deploys cash)
 *   - on a SELL: percent of the current position's market value (trims)
 *
 * The "percent on sell = percent of position" interpretation is the
 * intuitive read for "trim my NVDA by 25%" and avoids ever recommending
 * an oversize sell. The Analyst's system prompt is updated to match.
 */
function resolveSizing({ action, ticker, amount, currentEquity, currentPosition }) {
  if (!amount || typeof amount.value !== 'number' || amount.value <= 0) {
    return { kind: 'error', message: `invalid amount on ${action} ${ticker}` };
  }

  switch (amount.type) {
    case 'shares':
      return { kind: 'qty', value: amount.value };

    case 'dollars':
      return { kind: 'notional', value: round2(amount.value) };

    case 'percent': {
      if (amount.value > 100) {
        return { kind: 'error', message: `percent > 100 on ${action} ${ticker}` };
      }
      if (action === 'buy') {
        if (!currentEquity || currentEquity <= 0) {
          return { kind: 'error', message: `no portfolio equity to size buy of ${ticker}` };
        }
        return { kind: 'notional', value: round2(currentEquity * (amount.value / 100)) };
      }
      // sell
      if (!currentPosition || currentPosition.marketValue <= 0) {
        return { kind: 'error', message: `cannot sell ${ticker} — no current position` };
      }
      return {
        kind: 'notional',
        value: round2(currentPosition.marketValue * (amount.value / 100)),
      };
    }

    default:
      return { kind: 'error', message: `unknown amount type "${amount.type}" on ${ticker}` };
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { resolveSizing };
