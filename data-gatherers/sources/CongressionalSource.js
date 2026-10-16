'use strict';

const DataSource = require('./DataSource');

const DEFAULT_LOOKBACK_DAYS = 7;

// The congressional runner writes the snapshot the evening before each run
// (Sun + Wed). One older than this means the runner is failing. Fail loudly:
// BriefingAssembler records the error in briefing.errors, which reaches the
// phone as a briefing_error FCM push.
const MAX_SNAPSHOT_AGE_DAYS = 8;

// Trade size is a bucket, not an exact dollar amount. Ranks:
//   1 => $1,001–$15,000, 2 => $15,001–$50,000, 3 => $50,001–$100,000, ...
// minSizeRank = 2 excludes the smallest ($1K–$15K) bucket.
const DEFAULT_MIN_SIZE_RANK = 2;

const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

const TX_TYPE_MAP = { buy: 'buy', sell: 'sell', exchange: 'exchange' };
const PARTY_MAP = { D: 'Democrat', R: 'Republican', I: 'Independent' };

/**
 * Pulls recently DISCLOSED congressional stock trades from the snapshot
 * that this repo's congressional/ pipeline writes. It holds trades filed in
 * the last ~14 days plus the politician directory, as camelCase rows
 * (congressional/src/congressional/schema.py).
 *
 * The lookback window is applied to the FILING date, not the transaction
 * date. Under the STOCK Act, members have up to 45 days to disclose a
 * trade, so a 7-day filter on transaction date would miss almost
 * everything. Filing date answers the question we actually care about:
 * "what trades have become public since the last weekly run?"
 */
class CongressionalSource extends DataSource {
  constructor({
    backend,
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
    minSizeRank = DEFAULT_MIN_SIZE_RANK,
  } = {}) {
    super({ name: 'congressional' });
    if (!backend || typeof backend.read !== 'function') {
      throw new Error('CongressionalSource requires a backend with a read() method');
    }
    this.lookbackDays = lookbackDays;
    this.minSizeRank = minSizeRank;
    this.backend = backend;
  }

  async fetch() {
    const raw = await this.backend.read();
    if (raw === null) {
      throw new Error(
        `Congressional snapshot missing at ${this.backend.describe()} — ` +
          'has claude-portfolio-congressional.service ever run?'
      );
    }

    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch {
      throw new Error('Congressional snapshot is not valid JSON.');
    }

    const ageDays = this._ageDays(snapshot.exportedAt);
    if (ageDays === null || ageDays > MAX_SNAPSHOT_AGE_DAYS) {
      throw new Error(
        `Congressional snapshot is stale (exportedAt=${snapshot.exportedAt}) — ` +
          'check claude-portfolio-congressional.timer.'
      );
    }

    const cutoff = this._cutoffDate();
    const politicians = new Map();
    for (const p of snapshot.politicians || []) {
      if (p && p.id) politicians.set(p.id, p);
    }

    const trades = (snapshot.trades || [])
      .map((t) => this._normalize(t, politicians))
      .filter((t) => t !== null)
      .filter((t) => t.sizeRank >= this.minSizeRank)
      .filter((t) => t.filedDate && t.filedDate >= cutoff)
      .sort((a, b) => b.filedDate.localeCompare(a.filedDate));

    return {
      windowDays: this.lookbackDays,
      minSizeRank: this.minSizeRank,
      snapshotAt: snapshot.exportedAt || null,
      fetchedAt: new Date().toISOString(),
      count: trades.length,
      trades,
    };
  }

  /** Age of the snapshot in (fractional) days, or null if unparsable. */
  _ageDays(exportedAt) {
    if (!exportedAt) return null;
    const ts = Date.parse(exportedAt);
    if (Number.isNaN(ts)) return null;
    return (Date.now() - ts) / 86_400_000;
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

  /** { day: 3, month: "Jul", year: "2026" } => "2026-07-03". Same shape as
   *  `traded`. */
  _publishedToDate(published) {
    if (!published) return null;
    const mm = MONTHS[published.month];
    if (!mm || !published.day || !published.year) return null;
    return `${published.year}-${mm}-${String(published.day).padStart(2, '0')}`;
  }

  _cutoffDate() {
    const d = new Date();
    d.setDate(d.getDate() - this.lookbackDays);
    return d.toISOString().slice(0, 10);
  }
}

module.exports = CongressionalSource;
