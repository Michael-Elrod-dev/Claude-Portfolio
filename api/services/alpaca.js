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
 * Fetch one daily portfolio-history series. Returns null (and logs) on
 * failure so a single bad window can't take the whole payload down.
 *
 * @param {object} window  e.g. { period: '1W' } or { period: 'all' }
 */
async function fetchHistory(client, window) {
  try {
    return await client.getPortfolioHistory({ ...window, timeframe: '1D' });
  } catch (err) {
    console.warn(`[alpaca] portfolio history (${window.period}) failed: ${err.message}`);
    return null;
  }
}

/**
 * First-to-last change across a series.
 *
 * Null AND zero values are filtered out. Zero shows up at the start of a
 * window when the account didn't exist yet; including it makes "change since
 * zero" come out as the whole current equity, which is meaningless. Once the
 * account has funded equity for the full window, this is a no-op.
 */
function changeFromSeries(hist) {
  const equity = (hist?.equity || []).filter((v) => v !== null && v > 0);
  if (equity.length < 2) return null;
  const first = equity[0];
  const last = equity[equity.length - 1];
  const pl = last - first;
  return { first, last, pl, plPct: pl / first };
}

/**
 * Year-to-date change, derived from the all-time daily series.
 *
 * NOT computed with a `date_start` query. That was the original approach and
 * it was wrong: given only a start date, Alpaca returns ONE MONTH from that
 * date, so `date_start=2026-01-01` came back as Jan 1-31 -- a month in which
 * this account held nothing -- and YTD was null every day of the year. It
 * would have kept measuring only January in every later year too.
 *
 * Baseline is the last funded close BEFORE Jan 1 (standard YTD). If the
 * account has no history before Jan 1 -- it opened this year -- the baseline
 * is its first funded close, i.e. YTD is measured from inception, which is
 * how brokerages report a mid-year account.
 */
function ytdFromSeries(hist, now = new Date()) {
  const ts = hist?.timestamp || [];
  const eq = hist?.equity || [];
  const yearStartSec = Date.UTC(now.getUTCFullYear(), 0, 1) / 1000;
  let base = null;
  let last = null;
  for (let i = 0; i < eq.length; i++) {
    const v = eq[i];
    if (v === null || !(v > 0)) continue;
    if (ts[i] < yearStartSec) {
      base = v; // keeps the latest close before the year began
    } else {
      if (base === null) base = v; // opened this year: start from inception
      last = v;
    }
  }
  if (base === null || last === null) return null;
  const pl = last - base;
  return { first: base, last, pl, plPct: pl / base };
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
    weekHist,
    monthHist,
    allHist,
    openedDates,
  ] = await Promise.all([
    client.getAccount(),
    client.getPositions(),
    fetchHistory(client, { period: '1W' }),
    fetchHistory(client, { period: '1M' }),
    // One all-time series feeds both the lifetime figure and year-to-date
    // ("year" means Jan 1 → now, not a trailing 12 months). See
    // ytdFromSeries for why YTD is not its own query.
    fetchHistory(client, { period: 'all' }),
    loadOpenedDates(client),
  ]);

  const weekChange = changeFromSeries(weekHist);
  const monthChange = changeFromSeries(monthHist);
  const allTime = changeFromSeries(allHist);
  const ytdChange = ytdFromSeries(allHist);

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
      // the account is younger than the requested window, changeFromSeries
      // returns the same first equity as the all-time series (since
      // the zero-pre-funding values get filtered out in either case),
      // and we'd just be showing the same number twice. Null instead
      // → UI renders "—" so it's obvious the window is too short.
      //
      // Year-to-date is the one window NOT passed through _windowOrNull.
      // For an account opened during the current year, YTD is measured from
      // inception -- that is how brokerages report it -- so on this account
      // (funded 2026-04-13) it legitimately equals totalPl until 2027-01-01
      // and diverges after. The guard existed to stop the app printing the
      // same figure in two sibling grid cells; the Kiln redesign moved the
      // lifetime figure out of the grid into the equity hero, so a null
      // here would only blank a cell that has a true answer.
      weekPl: _windowOrNull(weekChange, allTime)?.pl ?? null,
      weekPlPct: _windowOrNull(weekChange, allTime)?.plPct ?? null,
      monthPl: _windowOrNull(monthChange, allTime)?.pl ?? null,
      monthPlPct: _windowOrNull(monthChange, allTime)?.plPct ?? null,
      yearPl: ytdChange?.pl ?? null,
      yearPlPct: ytdChange?.plPct ?? null,
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
