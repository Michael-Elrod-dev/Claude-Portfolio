'use strict';

/**
 * Orchestrates the four data sources into the single JSON briefing that
 * gets handed to Claude. This is where the project's "humans control the
 * inputs" principle is materialized: every fact Claude sees flows through
 * here, in a stable shape, every week.
 *
 * Execution model:
 *   Phase 1 (parallel): AlpacaSource, MemoSource, CongressionalSource
 *   Phase 2 (depends on Phase 1): EarningsSource — needs the symbol list
 *   we derive from positions ∪ watchlist ∪ congressional tickers.
 *
 * Failure model:
 *   - Alpaca failure aborts the run. We can't make decisions without
 *     knowing what we currently hold or how much cash we have.
 *   - Any other source failure degrades gracefully: that section comes
 *     through as null and the failure is recorded in `errors[]`. Claude
 *     can read `errors[]` and weight its decisions accordingly.
 */
class BriefingAssembler {
  constructor({ alpaca, memo, congressional, earnings }) {
    if (!alpaca || !memo || !congressional || !earnings) {
      throw new Error(
        'BriefingAssembler requires alpaca, memo, congressional, earnings sources'
      );
    }
    this.alpaca = alpaca;
    this.memo = memo;
    this.congressional = congressional;
    this.earnings = earnings;
  }

  async assemble() {
    const errors = [];
    const startedAt = new Date().toISOString();

    // Phase 1 — parallel. Alpaca is critical; the others can fail soft.
    const [portfolio, memoData, congressionalData] = await Promise.all([
      this._fetchCritical(this.alpaca),
      this._fetchSoft(this.memo, errors),
      this._fetchSoft(this.congressional, errors),
    ]);

    // Phase 2 — earnings, which needs a symbol list from phase 1.
    const symbols = this._resolveSymbolsForEarnings(
      portfolio,
      memoData,
      congressionalData
    );
    const earningsData = await this._fetchSoft(this.earnings, errors, { symbols });

    return {
      generatedAt: startedAt,
      completedAt: new Date().toISOString(),
      portfolio,
      memo: memoData,
      congressional: congressionalData,
      earnings: earningsData,
      symbolsCovered: symbols,
      errors,
    };
  }

  /**
   * Fetch a critical source. Failures here abort the entire briefing —
   * there is no graceful degradation when we don't know the portfolio.
   */
  async _fetchCritical(source) {
    try {
      return await source.fetch();
    } catch (err) {
      throw new Error(`Critical source ${source.name} failed: ${err.message}`);
    }
  }

  /**
   * Fetch a soft source. Failures are caught, recorded in `errors[]`, and
   * the corresponding briefing section becomes null.
   */
  async _fetchSoft(source, errors, args) {
    try {
      return args ? await source.fetch(args) : await source.fetch();
    } catch (err) {
      errors.push({ source: source.name, message: err.message });
      return null;
    }
  }

  /**
   * Build the symbol list for the earnings calendar. We want to know about
   * upcoming earnings for everything Claude might consider this week:
   *   - tickers we currently hold (don't double-down before earnings)
   *   - tickers on Claude's watchlist (don't initiate before earnings)
   *   - tickers Congress just disclosed (Claude may evaluate them this run)
   *
   * Deduped and uppercased. If everything failed, returns [] and the
   * earnings call short-circuits to an empty result.
   */
  _resolveSymbolsForEarnings(portfolio, memoData, congressionalData) {
    const set = new Set();

    if (portfolio?.positions?.holdings) {
      for (const h of portfolio.positions.holdings) set.add(h.symbol);
    }
    if (memoData?.memo?.watchlist) {
      for (const sym of memoData.memo.watchlist) set.add(sym);
    }
    if (congressionalData?.trades) {
      for (const t of congressionalData.trades) set.add(t.ticker);
    }

    return Array.from(set).map((s) => s.toUpperCase()).sort();
  }
}

module.exports = BriefingAssembler;
