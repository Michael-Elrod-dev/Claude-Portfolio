'use strict';

const Alpaca = require('@alpacahq/alpaca-trade-api');
const DataSource = require('./DataSource');

const DEFAULT_ORDER_WINDOW_DAYS = 30;
const DEFAULT_ORDER_LIMIT = 500;

/**
 * Pulls account state, open positions, and recent order history from Alpaca.
 * Alpaca is the source of truth for trades and cash — never trust the memo
 * for these facts.
 */
class AlpacaSource extends DataSource {
  constructor({ keyId, secretKey, paper = true, orderWindowDays = DEFAULT_ORDER_WINDOW_DAYS } = {}) {
    super({ name: 'alpaca' });
    if (!keyId || !secretKey) {
      throw new Error('AlpacaSource requires keyId and secretKey');
    }
    this.orderWindowDays = orderWindowDays;
    this.client = new Alpaca({ keyId, secretKey, paper });
  }

  async fetch() {
    const [account, rawPositions, rawOrders] = await Promise.all([
      this.client.getAccount(),
      this.client.getPositions(),
      this.client.getOrders({
        status: 'all',
        after: this._windowStart(),
        direction: 'desc',
        limit: DEFAULT_ORDER_LIMIT,
      }),
    ]);

    const positions = rawPositions.map(this._normalizePosition);
    const orders = rawOrders.map(this._normalizeOrder);

    const totalCostBasis = positions.reduce((sum, p) => sum + p.costBasis, 0);
    const totalMarketValue = positions.reduce((sum, p) => sum + p.marketValue, 0);

    return {
      asOf: new Date().toISOString(),
      account: {
        portfolioValue: Number(account.portfolio_value),
        cash: Number(account.cash),
        buyingPower: Number(account.buying_power),
        equity: Number(account.equity),
        lastEquity: Number(account.last_equity),
        dayPl: Number(account.equity) - Number(account.last_equity),
        dayPlPct:
          Number(account.last_equity) > 0
            ? (Number(account.equity) - Number(account.last_equity)) / Number(account.last_equity)
            : 0,
      },
      positions: {
        count: positions.length,
        totalCostBasis,
        totalMarketValue,
        totalUnrealizedPl: totalMarketValue - totalCostBasis,
        totalUnrealizedPlPct:
          totalCostBasis > 0 ? (totalMarketValue - totalCostBasis) / totalCostBasis : 0,
        holdings: positions,
      },
      recentOrders: {
        windowDays: this.orderWindowDays,
        count: orders.length,
        orders,
      },
    };
  }

  _windowStart() {
    const d = new Date();
    d.setDate(d.getDate() - this.orderWindowDays);
    return d.toISOString();
  }

  _normalizePosition(p) {
    return {
      symbol: p.symbol,
      qty: Number(p.qty),
      side: p.side,
      avgEntryPrice: Number(p.avg_entry_price),
      currentPrice: Number(p.current_price),
      marketValue: Number(p.market_value),
      costBasis: Number(p.cost_basis),
      unrealizedPl: Number(p.unrealized_pl),
      unrealizedPlPct: Number(p.unrealized_plpc),
      dayPl: Number(p.unrealized_intraday_pl),
      dayPlPct: Number(p.unrealized_intraday_plpc),
      assetClass: p.asset_class,
    };
  }

  _normalizeOrder(o) {
    return {
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      type: o.order_type,
      qty: Number(o.qty) || Number(o.notional) || null,
      filledQty: Number(o.filled_qty),
      filledAvgPrice: o.filled_avg_price != null ? Number(o.filled_avg_price) : null,
      limitPrice: o.limit_price != null ? Number(o.limit_price) : null,
      status: o.status,
      submittedAt: o.submitted_at,
      filledAt: o.filled_at,
      timeInForce: o.time_in_force,
    };
  }
}

module.exports = AlpacaSource;
