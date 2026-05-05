'use strict';

const DataSource = require('./DataSource');
const { scanForTrades, extractRscStrings } = require('./utils/rscScanner');

const CAPITOL_TRADES_URL =
  'https://www.capitoltrades.com/trades?assetType=stock&pageSize=96&page=1';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,' +
    'image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  // Omit 'br' — Node's fetch can handle it but we want consistency with
  // the Python reference scraper which had no Brotli support.
  'Accept-Encoding': 'gzip, deflate',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

const TICKER_RE = /^[A-Z]{1,5}$/;
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_MIN_VALUE = 15_000;

const TX_TYPE_MAP = {
  buy: 'buy',
  purchase: 'buy',
  sell: 'sell',
  sale: 'sell',
  exchange: 'exchange',
};

/**
 * Pulls recently DISCLOSED congressional stock trades from Capitol Trades.
 *
 * Capitol Trades has no public API, but its Next.js front-end embeds the
 * full trade dataset in the page HTML as RSC payload strings. This source
 * fetches the page once, decodes the embedded JSON, and applies filters.
 * No API key required.
 *
 * The lookback window is applied to the FILING date (pubDate), not the
 * transaction date. Under the STOCK Act, members have up to 45 days to
 * disclose a trade, so a 7-day filter on transaction date would miss
 * almost everything. Filing date answers the question we actually care
 * about: "what trades have become public since the last weekly run?"
 */
class CongressionalSource extends DataSource {
  constructor({ lookbackDays = DEFAULT_LOOKBACK_DAYS, minValue = DEFAULT_MIN_VALUE } = {}) {
    super({ name: 'congressional' });
    this.lookbackDays = lookbackDays;
    this.minValue = minValue;
  }

  async fetch() {
    const html = await this._fetchHtml();

    // Pass 1: scan the raw HTML directly. Sometimes trade JSON is present
    // unescaped in the page (rare but cheap to check).
    let raw = scanForTrades(html);

    // Pass 2: decode the RSC payload strings and scan inside them. This is
    // where Capitol Trades actually puts the data.
    if (raw.length === 0) {
      const rscStrings = extractRscStrings(html);
      const seen = new Set();
      for (const content of rscStrings) {
        for (const t of scanForTrades(content)) {
          const uid = String(t._txId || `${t.txDate}-${t.txType}-${t._issuerId || ''}`);
          if (!seen.has(uid)) {
            seen.add(uid);
            raw.push(t);
          }
        }
      }
    }

    if (raw.length === 0) {
      throw new Error(
        `No trade objects found in Capitol Trades HTML (length=${html.length}). ` +
          'Page structure may have changed.'
      );
    }

    const cutoff = this._cutoffDate();
    const trades = raw
      .map((t) => this._normalize(t))
      .filter((t) => t !== null)
      .filter((t) => t.value >= this.minValue)
      .filter((t) => t.filedDate && t.filedDate >= cutoff)
      .sort((a, b) => b.filedDate.localeCompare(a.filedDate));

    return {
      windowDays: this.lookbackDays,
      minValue: this.minValue,
      fetchedAt: new Date().toISOString(),
      count: trades.length,
      trades,
    };
  }

  async _fetchHtml() {
    const res = await fetch(CAPITOL_TRADES_URL, { headers: BROWSER_HEADERS });
    if (res.status === 403) {
      throw new Error(
        'Capitol Trades returned 403 — IP may be blocked (common from Lambda).'
      );
    }
    if (!res.ok) {
      throw new Error(`Capitol Trades returned ${res.status}: ${await res.text()}`);
    }
    return res.text();
  }

  _normalize(t) {
    const issuer = t.issuer || {};
    const tickerRaw = String(issuer.issuerTicker || issuer.ticker || '').toUpperCase();
    const ticker = tickerRaw.split(':')[0].trim();
    if (!ticker || !TICKER_RE.test(ticker)) return null;

    const txDate = String(t.txDate || '').slice(0, 10);
    if (!txDate) return null;

    const value = Number(t.value) || 0;
    if (value <= 0) return null;

    const rawType = String(t.txType || '').toLowerCase();
    const txType = TX_TYPE_MAP[rawType] || rawType;

    const politician = t.politician || {};
    const politicianName = [politician.lastName, politician.firstName]
      .filter(Boolean)
      .join(', ') || null;

    return {
      ticker,
      txType,
      value,
      txDate,
      filedDate: t.pubDate ? String(t.pubDate).slice(0, 10) : null,
      politician: politicianName,
      party: politician.party || null,
      chamber: politician.chamber || null,
    };
  }

  _cutoffDate() {
    const d = new Date();
    d.setDate(d.getDate() - this.lookbackDays);
    return d.toISOString().slice(0, 10);
  }
}

module.exports = CongressionalSource;
