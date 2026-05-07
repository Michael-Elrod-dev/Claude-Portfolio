'use strict';

/**
 * Alpaca client + portfolio enrichment for the API Lambda.
 *
 * The pipeline already has a comprehensive AlpacaSource for the briefing,
 * but the API needs slightly different shapes (Android-friendly camelCase,
 * weekPl / sinceInception computed from the portfolio-history endpoint,
 * per-position `opened` joined from order history, and per-position
 * `thesis` joined from the memo).
 */

const Alpaca = require('@alpacahq/alpaca-trade-api');
const { loadApiKeys } = require('./secrets');

let cachedClient = null;

async function getClient() {
  if (cachedClient) return cachedClient;
  const keys = await loadApiKeys();
  cachedClient = new Alpaca({
    keyId: keys.ALPACA_KEY_ID,
    secretKey: keys.ALPACA_SECRET_KEY,
    paper: true,
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
async function periodChange(client, period) {
  try {
    const hist = await client.getPortfolioHistory({
      period,
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
    console.warn(`[alpaca] portfolio history (${period}) failed: ${err.message}`);
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

  const [account, rawPositions, monthChange, yearChange, allTime, openedDates] = await Promise.all([
    client.getAccount(),
    client.getPositions(),
    periodChange(client, '1M'),
    periodChange(client, '1A'),
    periodChange(client, 'all'),
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

  const portfolio = {
    asOf: new Date().toISOString(),
    account: {
      portfolioValue: num(account.portfolio_value),
      cash: num(account.cash),
      buyingPower: num(account.buying_power),
      equity,
      lastEquity,
      dayPl,
      dayPlPct,
      monthPl: monthChange?.pl ?? null,
      monthPlPct: monthChange?.plPct ?? null,
      yearPl: yearChange?.pl ?? null,
      yearPlPct: yearChange?.plPct ?? null,
      totalPl: allTime?.pl ?? null,
      totalPlPct: allTime?.plPct ?? null,
    },
    positions: {
      count: holdings.length,
      totalCostBasis: holdings.reduce((s, h) => s + (h.costBasis || 0), 0),
      totalMarketValue: holdings.reduce((s, h) => s + (h.marketValue || 0), 0),
      totalUnrealizedPl: holdings.reduce((s, h) => s + (h.unrealizedPl || 0), 0),
      holdings,
    },
  };

  return portfolio;
}

module.exports = { buildPortfolio };
