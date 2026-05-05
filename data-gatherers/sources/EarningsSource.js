'use strict';

const DataSource = require('./DataSource');

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const DEFAULT_WINDOW_DAYS = 14;

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
    const results = await Promise.all(
      symbols.map((symbol) => this._fetchSymbol(symbol, from, to))
    );

    const events = results
      .flat()
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      windowDays: this.windowDays,
      from,
      to,
      events,
    };
  }

  async _fetchSymbol(symbol, from, to) {
    const url = new URL(`${FINNHUB_BASE_URL}/calendar/earnings`);
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('token', this.apiKey);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Finnhub ${res.status} for ${symbol}: ${await res.text()}`);
    }
    const data = await res.json();
    const calendar = Array.isArray(data.earningsCalendar) ? data.earningsCalendar : [];

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
