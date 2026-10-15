'use strict';

/**
 * Alpaca client + portfolio enrichment for the API Lambda.
 *
 * The pipeline already has a comprehensive AlpacaSource for the briefing,
 * but the API needs slightly different shapes (Android-friendly camelCase,
 * windowed P/L computed from the portfolio-history endpoint, per-position
 * `opened` joined from order history, and per-position `thesis` joined
 * from the memo).
 */

const Alpaca = require('@alpacahq/alpaca-trade-api');
const { loadApiKeys } = require('./secrets');

/**
 * The live brokerage host. This system has one real-money account and no
 * paper account, so the target is pinned here rather than derived from a
 * `paper` flag. Passing baseUrl explicitly also beats the SDK's
 * APCA_API_BASE_URL env fallback, which could otherwise redirect reads to
 * a different account than the pipeline trades on.
 */
const LIVE_BASE_URL = 'https://api.alpaca.markets';

let cachedClient = null;

async function getClient() {
  if (cachedClient) return cachedClient;
  const keys = await loadApiKeys();
  cachedClient = new Alpaca({
    keyId: keys.ALPACA_KEY_ID,
    secretKey: keys.ALPACA_SECRET_KEY,
    baseUrl: LIVE_BASE_URL,
  });
  return cachedClient;
}

function num(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch portfolio history for a period and return the {first, last, pl, plPct}
 * across that window. Returns null if the data isn't available.
 */
/**
 * Helper: return the windowed change result only if it represents a
 * window strictly shorter than the all-time series. If the window's
 * starting equity equals the all-time starting equity, the requested
 * window doesn't extend past the account's funded history, and showing
 * its (necessarily identical) value alongside totalPl is misleading.
 */
function _windowOrNull(window, allTime) {
  if (!window || !allTime) return null;
  // Compare on `first` — the equity value at the start of the window.
  // Identical first values → the window degenerates to all-time.
  if (window.first === allTime.first) return null;
  return window;
}

/**
 * January 1st of the current year, as YYYY-MM-DD, for the year-to-date
 * window. Uses UTC so the boundary doesn't wobble with the server's zone.
 */
function startOfYear() {
  return `${new Date().getUTCFullYear()}-01-01`;
}

/**
 * @param {object} window  either { period: '1W' } or { date_start: 'YYYY-MM-DD' }
 */
async function periodChange(client, window) {
  try {
    const hist = await client.getPortfolioHistory({
      ...window,
      timeframe: '1D',
    });
    // Filter out null AND zero values. Zero shows up at the start of a
    // history window when the account didn't exist yet (or had no equity);
    // including it makes "change since zero" come out as the current equity
    // value, which is misleading. Once the account has had funded equity
    // for the full window, this is a no-op.
    const equity = (hist?.equity || []).filter((v) => v !== null && v > 0);
    if (equity.length < 2) return null;
    const first = equity[0];
    const last = equity[equity.length - 1];
    const pl = last - first;
    const plPct = pl / first;
    return { first, last, pl, plPct };
  } catch (err) {
    const label = window.period || `since ${window.date_start}`;
    console.warn(`[alpaca] portfolio history (${label}) failed: ${err.message}`);
    return null;
  }
}

/**
 * Scan recent filled orders to find the earliest buy date per symbol.
 * Limited to the last 365 days to keep the call cheap; sufficient for the
 * small personal portfolio we expect.
 */
async function loadOpenedDates(client) {
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  let orders;
  try {
    orders = await client.getOrders({
      status: 'closed',
      after: oneYearAgo,
      direction: 'asc',
      limit: 500,
    });
  } catch (err) {
    console.warn(`[alpaca] order history failed: ${err.message}`);
    return {};
  }

  const opened = {};
  for (const o of orders || []) {
    if (o.side !== 'buy' || o.status !== 'filled') continue;
    const sym = o.symbol;
    const date = (o.filled_at || o.submitted_at || '').slice(0, 10);
    if (!sym || !date) continue;
    if (!opened[sym] || date < opened[sym]) {
      opened[sym] = date;
    }
  }
  return opened;
}

/**
 * Build the enriched portfolio payload the Android app consumes.
 *
 * @param {object|null} memo  the memo JSON, used to join thesis text per position.
 *                            Pass null/undefined if you'd rather skip thesis enrichment.
 */
async function buildPortfolio({ memo } = {}) {
  const client = await getClient();

  const [
    account,
    rawPositions,
    weekChange,
    monthChange,
    ytdChange,
    allTime,
    openedDates,
  ] = await Promise.all([
    client.getAccount(),
    client.getPositions(),
    periodChange(client, { period: '1W' }),
    periodChange(client, { period: '1M' }),
    // "Year" means year-to-date (Jan 1 → now), not a trailing 12 months.
    // A trailing-1A window on an account younger than a year collapses
    // into all-time and gets suppressed by _windowOrNull; YTD at least
    // becomes a distinct, meaningful number as soon as the account has
    // lived through a New Year.
    periodChange(client, { date_start: startOfYear() }),
    periodChange(client, { period: 'all' }),
    loadOpenedDates(client),
  ]);

  const equity = num(account.equity);
  const lastEquity = num(account.last_equity);
  const dayPl = equity !== null && lastEquity !== null ? equity - lastEquity : null;
  const dayPlPct = lastEquity > 0 && dayPl !== null ? dayPl / lastEquity : null;

  // Build a thesis lookup from the memo's openTheses, by ticker symbol.
  const thesisByTicker = {};
  for (const t of memo?.openTheses || []) {
    if (t?.ticker) thesisByTicker[t.ticker] = t.thesis || null;
  }

  const holdings = (rawPositions || []).map((p) => {
    const symbol = p.symbol;
    const qty = num(p.qty);
    const avgEntryPrice = num(p.avg_entry_price);
    const currentPrice = num(p.current_price);
    const marketValue = num(p.market_value);
    const costBasis = num(p.cost_basis);
    const unrealizedPl = num(p.unrealized_pl);
    const unrealizedPlPct = num(p.unrealized_plpc);
    const dPl = num(p.unrealized_intraday_pl);
    const dPlPct = num(p.unrealized_intraday_plpc);
    return {
      symbol,
      qty,
      avgEntryPrice,
      currentPrice,
      marketValue,
      costBasis,
      unrealizedPl,
      unrealizedPlPct,
      dayPl: dPl,
      dayPlPct: dPlPct,
      opened: openedDates[symbol] || null,
      thesis: thesisByTicker[symbol] || null,
    };
  });

  const totalCostBasis = holdings.reduce((s, h) => s + (h.costBasis || 0), 0);

  const portfolio = {
    asOf: new Date().toISOString(),
    account: {
      portfolioValue: num(account.portfolio_value),
      cash: num(account.cash),
      buyingPower: num(account.buying_power),
      // Sum of cost basis across all open positions. Surfaced on the
      // account block (mirrors positions.totalCostBasis below) so the
      // Portfolio screen's cash row can show it alongside cash and
      // buying power.
      costBasis: totalCostBasis,
      equity,
      lastEquity,
      dayPl,
      dayPlPct,
      // For each shorter window, only surface a value if it actually
      // covers a different starting point than the all-time series. If
      // the account is younger than the requested window, periodChange
      // returns the same first equity as the all-time series (since
      // the zero-pre-funding values get filtered out in either case),
      // and we'd just be showing the same number twice. Null instead
      // → UI renders "—" so it's obvious the window is too short.
      //
      // Current state of this account (funded 2026-04-13): week and month
      // populate; yearPl is null because a year-to-date window still
      // reaches back before funding, so it equals totalPl. It starts
      // returning a distinct number on 2027-01-01.
      weekPl: _windowOrNull(weekChange, allTime)?.pl ?? null,
      weekPlPct: _windowOrNull(weekChange, allTime)?.plPct ?? null,
      monthPl: _windowOrNull(monthChange, allTime)?.pl ?? null,
      monthPlPct: _windowOrNull(monthChange, allTime)?.plPct ?? null,
      yearPl: _windowOrNull(ytdChange, allTime)?.pl ?? null,
      yearPlPct: _windowOrNull(ytdChange, allTime)?.plPct ?? null,
      totalPl: allTime?.pl ?? null,
      totalPlPct: allTime?.plPct ?? null,
    },
    positions: {
      count: holdings.length,
      totalCostBasis,
      totalMarketValue: holdings.reduce((s, h) => s + (h.marketValue || 0), 0),
      totalUnrealizedPl: holdings.reduce((s, h) => s + (h.unrealizedPl || 0), 0),
      holdings,
    },
  };

  return portfolio;
}

module.exports = { buildPortfolio };
