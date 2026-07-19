'use strict';

const DataSource = require('./DataSource');
const S3Backend = require('./backends/S3Backend');

// Object key of the snapshot inside the project's S3 bucket (the same bucket
// that holds memo.json — the Lambda role already reads the whole bucket).
const DEFAULT_S3_KEY = 'congressional.json';
const DEFAULT_LOOKBACK_DAYS = 7;

// The exporter runs Mon + Thu, hours before each pipeline run. A snapshot
// older than this means the export workflow is failing — or GitHub disabled
// its cron after 60 days without repo activity (it does that). Fail loudly:
// BriefingAssembler records the error in briefing.errors, which reaches the
// phone as a briefing_error FCM push. Re-enable the workflow from the
// Trade-Parser repo's Actions tab.
const MAX_SNAPSHOT_AGE_DAYS = 8;

// The API reports trade size as a bucket, not an exact dollar amount. Ranks:
//   1 => $1,001–$15,000, 2 => $15,001–$50,000, 3 => $50,001–$100,000, ...
// The old scraper filtered on an exact value >= $15,000. minSizeRank = 2
// reproduces that floor by excluding the smallest ($1K–$15K) bucket.
const DEFAULT_MIN_SIZE_RANK = 2;

const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

const TX_TYPE_MAP = { buy: 'buy', sell: 'sell', exchange: 'exchange' };
const PARTY_MAP = { D: 'Democrat', R: 'Republican', I: 'Independent' };

/**
 * Pulls recently DISCLOSED congressional stock trades from the Trade-Parser
 * S3 snapshot.
 *
 * History: this began as a Capitol Trades HTML scraper, became a client of
 * the hosted trade-parser API (https://api.congress-trades.com), and — when
 * that hosting was retired in July 2026 — moved to this shape: the same
 * parser now runs as a scheduled GitHub Action in the Trade-Parser repo
 * (Mon + Thu 08:00 UTC) and drops a JSON snapshot in this project's S3
 * bucket. The snapshot carries the raw /v1 row shapes the API served
 * (trades filed in the last ~14 days + the politician directory), so the
 * normalization below is unchanged from the API era.
 *
 * The lookback window is applied to the FILING date, not the transaction
 * date. Under the STOCK Act, members have up to 45 days to disclose a
 * trade, so a 7-day filter on transaction date would miss almost
 * everything. Filing date answers the question we actually care about:
 * "what trades have become public since the last weekly run?"
 */
class CongressionalSource extends DataSource {
  constructor({
    bucket = process.env.MEMO_S3_BUCKET,
    s3Key = DEFAULT_S3_KEY,
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
    minSizeRank = DEFAULT_MIN_SIZE_RANK,
    backend = null, // injectable for tests; defaults to S3
  } = {}) {
    super({ name: 'congressional' });
    this.bucket = bucket;
    this.s3Key = s3Key;
    this.lookbackDays = lookbackDays;
    this.minSizeRank = minSizeRank;
    this.backend = backend;
  }

  async fetch() {
    if (!this.backend) {
      if (!this.bucket) {
        throw new Error(
          'MEMO_S3_BUCKET is not set — cannot read the congressional snapshot.'
        );
      }
      this.backend = new S3Backend({ bucket: this.bucket, key: this.s3Key });
    }

    const raw = await this.backend.read();
    if (raw === null) {
      throw new Error(
        `Congressional snapshot missing at ${this.backend.describe()} — ` +
          'has the Trade-Parser export workflow ever run?'
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
          'check the Trade-Parser "Congressional export" workflow ' +
          '(GitHub disables scheduled workflows after ~60 idle days).'
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

  /** { day: 3, month: "Jul", year: "2026" } => "2026-07-03". (Same shape as
   *  `traded`; it used to be a "11 Jun" label string in the very old API.) */
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
