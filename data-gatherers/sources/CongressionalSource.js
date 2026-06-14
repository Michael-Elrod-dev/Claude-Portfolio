'use strict';

const DataSource = require('./DataSource');

const DEFAULT_BASE_URL = 'https://trade-parser-production.up.railway.app';
const DEFAULT_LOOKBACK_DAYS = 7;

// The API reports trade size as a bucket, not an exact dollar amount. Ranks:
//   1 => $1,001–$15,000, 2 => $15,001–$50,000, 3 => $50,001–$100,000, ...
// The old scraper filtered on an exact value >= $15,000. minSizeRank = 2
// reproduces that floor by excluding the smallest ($1K–$15K) bucket.
const DEFAULT_MIN_SIZE_RANK = 2;

const PAGE_SIZE = 96;
// Safety cap on pagination. A 7-day filing window is a tiny slice of the full
// history; this guards against an unbounded walk if the cutoff logic ever
// fails to terminate (e.g. unexpected sort order).
const MAX_PAGES = 30;

const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

const TX_TYPE_MAP = { buy: 'buy', sell: 'sell', exchange: 'exchange' };
const PARTY_MAP = { D: 'Democrat', R: 'Republican', I: 'Independent' };

/**
 * Pulls recently DISCLOSED congressional stock trades from the trade-parser
 * API (https://trade-parser-production.up.railway.app).
 *
 * This replaces the old Capitol Trades HTML scraper, which broke when the
 * site's page structure changed. The API exposes the same underlying data
 * (it parses the same disclosures) as clean JSON, so this source fetches it
 * directly instead of decoding embedded RSC payloads. Requires an API key
 * sent as the `X-API-Key` header (env: TRADE_PARSER_API_KEY).
 *
 * The lookback window is applied to the FILING date (the API's `published`
 * date), not the transaction date. Under the STOCK Act, members have up to
 * 45 days to disclose a trade, so a 7-day filter on transaction date would
 * miss almost everything. Filing date answers the question we actually care
 * about: "what trades have become public since the last weekly run?"
 *
 * NOTE: the API's `since` query param filters on the TRADED date, so we do
 * not use it. Instead we page through `sort=published&dir=desc` and stop
 * once we cross the filing-date cutoff.
 */
class CongressionalSource extends DataSource {
  constructor({
    apiKey = process.env.TRADE_PARSER_API_KEY,
    baseUrl = DEFAULT_BASE_URL,
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
    minSizeRank = DEFAULT_MIN_SIZE_RANK,
  } = {}) {
    super({ name: 'congressional' });
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.lookbackDays = lookbackDays;
    this.minSizeRank = minSizeRank;
  }

  async fetch() {
    if (!this.apiKey) {
      throw new Error(
        'TRADE_PARSER_API_KEY is not set — cannot fetch congressional trades.'
      );
    }

    const cutoff = this._cutoffDate();
    const politicians = await this._fetchPoliticianMap();
    const rawTrades = await this._fetchTradesUntilCutoff(cutoff);

    const trades = rawTrades
      .map((t) => this._normalize(t, politicians))
      .filter((t) => t !== null)
      .filter((t) => t.sizeRank >= this.minSizeRank)
      .filter((t) => t.filedDate && t.filedDate >= cutoff)
      .sort((a, b) => b.filedDate.localeCompare(a.filedDate));

    return {
      windowDays: this.lookbackDays,
      minSizeRank: this.minSizeRank,
      fetchedAt: new Date().toISOString(),
      count: trades.length,
      trades,
    };
  }

  /**
   * Page through trades newest-filed first, accumulating until we cross the
   * cutoff. Because the list is sorted by filing date descending, the first
   * trade older than the cutoff means every trade after it is older too, so
   * we can stop early.
   */
  async _fetchTradesUntilCutoff(cutoff) {
    const out = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      const body = await this._getJson(
        `/v1/trades?sort=published&dir=desc&limit=${PAGE_SIZE}&offset=${offset}`
      );
      const batch = Array.isArray(body.data) ? body.data : [];
      if (batch.length === 0) break;

      let crossedCutoff = false;
      for (const t of batch) {
        const filedDate = this._publishedToDate(t.published);
        if (filedDate && filedDate < cutoff) {
          crossedCutoff = true;
          break;
        }
        out.push(t);
      }

      if (crossedCutoff) break;
      if (offset + batch.length >= (body.total ?? 0)) break;
    }
    return out;
  }

  /**
   * Fetch all politicians once and index by id, so each trade's politicianId
   * can be resolved to a name, party, and chamber. Trades carry only the id
   * (e.g. "S-peters", "H-FL-salazar").
   */
  async _fetchPoliticianMap() {
    const list = await this._getJson('/v1/politicians?limit=1000');
    const map = new Map();
    if (Array.isArray(list)) {
      for (const p of list) {
        if (p && p.id) map.set(p.id, p);
      }
    }
    return map;
  }

  async _getJson(path) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { 'X-API-Key': this.apiKey, Accept: 'application/json' },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `trade-parser API returned ${res.status} — check TRADE_PARSER_API_KEY.`
      );
    }
    if (!res.ok) {
      throw new Error(`trade-parser API returned ${res.status} for ${path}.`);
    }
    return res.json();
  }

  _normalize(t, politicians) {
    const ticker = String(t.issuerId || '').toUpperCase().trim();
    if (!ticker) return null;

    const txDate = this._tradedToDate(t.traded);
    if (!txDate) return null;

    const filedDate = this._publishedToDate(t.published);

    const rawType = String(t.type || '').toLowerCase();
    const txType = TX_TYPE_MAP[rawType] || rawType;

    const p = politicians.get(t.politicianId) || {};
    const chamber = (p.chamber || this._chamberFromId(t.politicianId) || '')
      .toLowerCase() || null;
    const party = p.party ? PARTY_MAP[p.party] || p.party : null;

    return {
      ticker,
      txType,
      txDate,
      filedDate,
      owner: t.owner || null,
      sizeLabel: t.sizeLabel || null,
      sizeExact: t.sizeExact || null,
      sizeRank: Number(t.sizeRank) || 0,
      price: t.price ?? null,
      politician: p.name || t.politicianId || null,
      party,
      chamber,
      state: p.state || null,
    };
  }

  /** "S-peters" => senate, "H-FL-salazar" => house. */
  _chamberFromId(id) {
    if (typeof id !== 'string') return null;
    if (id.startsWith('S-')) return 'senate';
    if (id.startsWith('H-')) return 'house';
    return null;
  }

  /** { day: 21, month: "May", year: "2026" } => "2026-05-21". */
  _tradedToDate(traded) {
    if (!traded) return null;
    const mm = MONTHS[traded.month];
    const dd = String(traded.day).padStart(2, '0');
    if (!mm || !traded.day || !traded.year) return null;
    return `${traded.year}-${mm}-${dd}`;
  }

  /** { label: "11 Jun", year: "2026" } => "2026-06-11". */
  _publishedToDate(published) {
    if (!published || !published.label) return null;
    const m = /^(\d{1,2})\s+([A-Za-z]{3})$/.exec(published.label.trim());
    if (!m) return null;
    const mm = MONTHS[m[2]];
    if (!mm || !published.year) return null;
    return `${published.year}-${mm}-${m[1].padStart(2, '0')}`;
  }

  _cutoffDate() {
    const d = new Date();
    d.setDate(d.getDate() - this.lookbackDays);
    return d.toISOString().slice(0, 10);
  }
}

module.exports = CongressionalSource;
