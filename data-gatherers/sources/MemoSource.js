'use strict';

const DataSource = require('./DataSource');

/**
 * Empty memo returned on the very first run, before Claude has written
 * anything. All subsequent runs read the prior memo and Claude rewrites
 * it via a separate "memo updater" prompt at the end of the run.
 *
 * Schema is intentionally structured rather than free-form prose. A wall
 * of text gradually becomes hard to audit and eats context. Structured
 * sections keep Claude's running state inspectable.
 */
const EMPTY_MEMO = Object.freeze({
  lastUpdated: null,
  openTheses: [],
  closedTheses: [],
  watchlist: [],
  generalObservations: '',
});

/**
 * Reads the persistent memo that Claude maintains across runs. The memo
 * is Claude's working memory: open theses, closed theses, a watchlist of
 * tickers it wants to monitor, and free-form observations about the
 * broader market.
 *
 * The backend is pluggable — LocalFileBackend for development, an S3
 * backend (future) for production. Both implement { read() } returning
 * the raw memo string or null when missing.
 */
class MemoSource extends DataSource {
  constructor({ backend } = {}) {
    super({ name: 'memo' });
    if (!backend || typeof backend.read !== 'function') {
      throw new Error('MemoSource requires a backend with a read() method');
    }
    this.backend = backend;
  }

  async fetch() {
    const raw = await this.backend.read();
    if (raw == null) {
      return {
        source: this.backend.describe?.() || 'unknown',
        firstRun: true,
        memo: { ...EMPTY_MEMO },
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Memo at ${this.backend.describe?.() || 'unknown'} is not valid JSON: ${err.message}`
      );
    }

    return {
      source: this.backend.describe?.() || 'unknown',
      firstRun: false,
      memo: this._normalize(parsed),
    };
  }

  _normalize(parsed) {
    return {
      lastUpdated: parsed.lastUpdated || null,
      openTheses: Array.isArray(parsed.openTheses) ? parsed.openTheses : [],
      closedTheses: Array.isArray(parsed.closedTheses) ? parsed.closedTheses : [],
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      generalObservations:
        typeof parsed.generalObservations === 'string' ? parsed.generalObservations : '',
    };
  }
}

module.exports = MemoSource;
module.exports.EMPTY_MEMO = EMPTY_MEMO;
