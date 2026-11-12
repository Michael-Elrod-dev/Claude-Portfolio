'use strict';

/**
 * Alpaca client + portfolio enrichment for the API.
 *
 * The pipeline already has a comprehensive AlpacaSource for the briefing,
 * but the API needs slightly different shapes (Android-friendly camelCase,
 * windowed P/L computed from the portfolio-history endpoint, per-position
 * `opened` joined from order history, and per-position `thesis` joined
 * from the memo).
 */

const Alpaca = require('@alpacahq/alpaca-trade-api');

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
  const { ALPACA_KEY_ID, ALPACA_SECRET_KEY } = process.env;
  if (!ALPACA_KEY_ID || !ALPACA_SECRET_KEY) {
    throw new Error('ALPACA_KEY_ID / ALPACA_SECRET_KEY are not set');
  }
  cachedClient = new Alpaca({
    keyId: ALPACA_KEY_ID,
    secretKey: ALPACA_SECRET_KEY,
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
 * Helper: return the windowed change result only if it represents a
 * window strictly shorter than the all-time series. If the window starts
 * on the same bar as the all-time series, the requested window doesn't
 * extend past the account's funded history, and showing its (necessarily
 * identical) value alongside totalPl is misleading.
 */
function _windowOrNull(window, allTime) {
  if (!window || !allTime) return null;
  if (window.startTs === allTime.startTs) return null;
  return window;
}

/**
 * Money moved into or out of the account. It changes equity without being a
 * gain or a loss, so every P/L figure here subtracts it. Alpaca's own
 * portfolio-history `profit_loss` does NOT: the $250 deposit on 2026-11-12
 * showed there as +$250.85 of profit, and its `cashflow_types` option changed
 * nothing. Dividends, fees and interest are returns, so they stay in.
 * Securities moved in kind (JNLS, ACATS) carry no cash amount and aren't
 * counted.
 */
const CASH_FLOW_TYPES = ['CSD', 'CSW', 'JNLC', 'ACATC'];
const ACTIVITY_PAGE_SIZE = 100;

const etDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Eastern calendar date (YYYY-MM-DD) of a Unix timestamp in seconds. */
function etDate(sec) {
  return etDateFormat.format(new Date(sec * 1000));
}

/**
 * Every executed transfer as { date: 'YYYY-MM-DD' (Eastern), amount }, with
 * deposits positive and withdrawals negative. Returns null (and logs) on
 * failure: without them no P/L figure can be trusted.
 */
async function loadCashFlows(client) {
  const flows = [];
  let pageToken;
  try {
    for (;;) {
      const page = await client.getAccountActivities({
        activityTypes: CASH_FLOW_TYPES,
        direction: 'asc',
        pageSize: ACTIVITY_PAGE_SIZE,
        pageToken,
      });
      for (const a of page || []) {
        if (a.status && a.status !== 'executed') continue;
        const raw = num(a.net_amount);
        const date = a.date || (a.created_at ? etDate(Date.parse(a.created_at) / 1000) : null);
        if (raw === null || !date) continue;
        // CSD/CSW have a fixed direction whatever the sign Alpaca sends;
        // journals and ACATS cash carry theirs in net_amount.
        const amount = a.activity_type === 'CSD' ? Math.abs(raw)
          : a.activity_type === 'CSW' ? -Math.abs(raw)
            : raw;
        flows.push({ date: date.slice(0, 10), amount });
      }
      if (!page || page.length < ACTIVITY_PAGE_SIZE) return flows;
      pageToken = page[page.length - 1].id;
    }
  } catch (err) {
    console.warn(`[alpaca] account transfers failed: ${err.message}`);
    return null;
  }
}

/** Sum of the transfers dated after `afterDate`, up to and including `throughDate`. */
function flowsBetween(flows, afterDate, throughDate) {
  let sum = 0;
  for (const f of flows) {
    if (f.date > afterDate && f.date <= throughDate) sum += f.amount;
  }
  return sum;
}

/**
 * The funded closes of a daily series, as { ts, date, equity }.
 *
 * Null AND zero values are dropped. Zero shows up at the start of a window
 * when the account didn't exist yet; including it makes "change since zero"
 * come out as the whole current equity, which is meaningless.
 */
function fundedCloses(hist) {
  const ts = hist?.timestamp || [];
  const eq = hist?.equity || [];
  const out = [];
  for (let i = 0; i < eq.length; i++) {
    const v = eq[i];
    if (v === null || !(v > 0)) continue;
    out.push({ ts: ts[i], date: etDate(ts[i]), equity: v });
  }
  return out;
}

/**
 * Change from closes[startIdx] to the last close, net of transfers.
 *
 * `pl` is the dollar gain: the equity change minus the money moved in.
 * `plPct` is the time-weighted return, each day's gain over the equity that
 * earned it, chained. Dividing pl by the starting equity would credit a
 * deposit's dollars to a base that never held them, and dividing by start
 * plus deposits would dilute the days before the deposit. A transfer counts
 * at the close of the day it posts (a deposit earns nothing until it is
 * invested, which happens on a later run).
 */
function changeSince(closes, startIdx, flows) {
  if (!flows || startIdx < 0 || startIdx >= closes.length - 1) return null;
  const start = closes[startIdx];
  const end = closes[closes.length - 1];
  let growth = 1;
  for (let i = startIdx + 1; i < closes.length; i++) {
    const moved = flowsBetween(flows, closes[i - 1].date, closes[i].date);
    growth *= (closes[i].equity - moved) / closes[i - 1].equity;
  }
  const pl = end.equity - start.equity - flowsBetween(flows, start.date, end.date);
  return { startTs: start.ts, first: start.equity, last: end.equity, pl, plPct: growth - 1 };
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

/** First-to-last change across a series, net of transfers. */
function changeFromSeries(hist, flows) {
  return changeSince(fundedCloses(hist), 0, flows);
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
function ytdFromSeries(hist, flows, now = new Date()) {
  const closes = fundedCloses(hist);
  const yearStartSec = Date.UTC(now.getUTCFullYear(), 0, 1) / 1000;
  if (!closes.length || closes[closes.length - 1].ts < yearStartSec) return null;
  // The latest close before the year began, or inception if there is none.
  let base = 0;
  for (let i = 0; i < closes.length; i++) {
    if (closes[i].ts < yearStartSec) base = i;
  }
  return changeSince(closes, base, flows);
}

/**
 * Today's change: live equity against the previous trading day's close, net
 * of transfers since that close (a deposit lands in `equity` the moment it
 * posts). The app's model declares these two fields non-null, so when the
 * transfers couldn't be read this falls back to the raw difference rather
 * than null; it is only wrong on a day money moves.
 */
function dayChange(equity, lastEquity, closes, flows, now = new Date()) {
  if (equity === null || lastEquity === null) return { dayPl: null, dayPlPct: null };
  const today = etDate(now.getTime() / 1000);
  // Daily bars exist only for trading days, so the newest one dated before
  // today is the close `last_equity` reports. Without the series, assume
  // yesterday.
  let prevClose = etDate(now.getTime() / 1000 - 86400);
  for (const c of closes) {
    if (c.date < today) prevClose = c.date;
  }
  const moved = flows ? flowsBetween(flows, prevClose, '9999-12-31') : 0;
  const dayPl = equity - lastEquity - moved;
  return { dayPl, dayPlPct: lastEquity > 0 ? dayPl / lastEquity : null };
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
 * @param {object} [client]   an Alpaca client; tests pass a fake.
 * @param {Date} [now]
 */
async function buildPortfolio({ memo, client, now = new Date() } = {}) {
  client = client || await getClient();

  const [
    account,
    rawPositions,
    weekHist,
    monthHist,
    allHist,
    openedDates,
    flows,
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
    loadCashFlows(client),
  ]);

  // Every window below is null when the transfers couldn't be read.
  const weekChange = changeFromSeries(weekHist, flows);
  const monthChange = changeFromSeries(monthHist, flows);
  const allTime = changeFromSeries(allHist, flows);
  const ytdChange = ytdFromSeries(allHist, flows, now);

  const equity = num(account.equity);
  const lastEquity = num(account.last_equity);
  const { dayPl, dayPlPct } = dayChange(equity, lastEquity, fundedCloses(allHist), flows, now);

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
    asOf: now.toISOString(),
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
      // starts on the same bar as the all-time series (since
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

module.exports = { buildPortfolio, loadCashFlows };
