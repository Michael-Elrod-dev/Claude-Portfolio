'use strict';

const DataSource = require('./DataSource');

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const DEFAULT_WINDOW_DAYS = 14;

// Finnhub's free tier rate-limits bursts. We fetch in small batches rather
// than firing one request per symbol all at once, retry transient failures
// (429 / 5xx) with a short backoff, and isolate per-symbol failures so one
// rate-limited ticker can't drop the entire earnings guardrail.
const CONCURRENCY = 5;
const BATCH_DELAY_MS = 250;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;

const TIME_MAP = {
  bmo: 'before_open',
  amc: 'after_close',
  dmh: 'during_hours',
};

/**
 * Pulls upcoming earnings dates from Finnhub. The role of this source is
 * purely as a guardrail: the briefing should let Claude see when held or
 * watched tickers are about to report, so it can avoid initiating positions
 * into a binary event.
 *
 * Symbols are passed to fetch() rather than the constructor because the
 * list is only known at briefing-assembly time (= held positions ∪
 * watchlist ∪ tickers in the past week's congressional trades).
 */
class EarningsSource extends DataSource {
  constructor({ apiKey, windowDays = DEFAULT_WINDOW_DAYS } = {}) {
    super({ name: 'earnings' });
    if (!apiKey) throw new Error('EarningsSource requires apiKey');
    this.apiKey = apiKey;
    this.windowDays = windowDays;
  }

  async fetch({ symbols = [] } = {}) {
    if (symbols.length === 0) {
      return { windowDays: this.windowDays, events: [] };
    }

    const { from, to } = this._windowDates();

    // Fetch in small batches to stay under Finnhub's burst limit. Each symbol
    // is isolated: a persistent failure lands in `skipped` instead of
    // rejecting the whole run.
    const results = [];
    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      const batch = symbols.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((symbol) => this._fetchSymbolSafe(symbol, from, to))
      );
      results.push(...batchResults);
      if (i + CONCURRENCY < symbols.length) {
        await this._sleep(BATCH_DELAY_MS);
      }
    }

    const failed = results.filter((r) => r.error);

    // If every symbol failed, this is a real outage (or a bad key) rather than
    // a flaky ticker — surface it as a source error so the assembler records
    // it, matching the original fail-loud behaviour.
    if (failed.length === symbols.length) {
      throw new Error(
        `Finnhub failed for all ${symbols.length} symbol(s). First error: ${failed[0].error}`
      );
    }

    const events = results
      .filter((r) => !r.error)
      .flatMap((r) => r.events)
      .sort((a, b) => a.date.localeCompare(b.date));

    const snapshot = { windowDays: this.windowDays, from, to, events };
    if (failed.length > 0) {
      snapshot.skipped = failed.map((r) => ({ symbol: r.symbol, reason: r.error }));
    }
    return snapshot;
  }

  /**
   * Wrap _fetchSymbol so a single symbol's failure is contained: returns
   * { symbol, events } on success or { symbol, error } on persistent failure.
   */
  async _fetchSymbolSafe(symbol, from, to) {
    try {
      const events = await this._fetchSymbol(symbol, from, to);
      return { symbol, events };
    } catch (err) {
      return { symbol, error: err.message };
    }
  }

  async _fetchSymbol(symbol, from, to) {
    const url = new URL(`${FINNHUB_BASE_URL}/calendar/earnings`);
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('token', this.apiKey);

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const calendar = Array.isArray(data.earningsCalendar)
          ? data.earningsCalendar
          : [];
        return calendar.map((row) => ({
          symbol: row.symbol,
          date: row.date,
          time: TIME_MAP[row.hour] || row.hour || 'unknown',
          epsEstimate: row.epsEstimate ?? null,
          revenueEstimate: row.revenueEstimate ?? null,
          quarter: row.quarter ?? null,
          year: row.year ?? null,
        }));
      }

      // 429 (rate limit) and 5xx are transient — back off and retry. Other
      // 4xx (bad symbol, bad key) won't improve on retry, so fail fast.
      const transient = res.status === 429 || res.status >= 500;
      if (transient && attempt < MAX_RETRIES) {
        await this._sleep(RETRY_BASE_MS * 2 ** attempt);
        continue;
      }
      throw new Error(`Finnhub ${res.status} for ${symbol}: ${await res.text()}`);
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _windowDates() {
    const today = new Date();
    const future = new Date(today);
    future.setDate(future.getDate() + this.windowDays);
    return { from: this._iso(today), to: this._iso(future) };
  }

  _iso(d) {
    return d.toISOString().slice(0, 10);
  }
}

module.exports = EarningsSource;
