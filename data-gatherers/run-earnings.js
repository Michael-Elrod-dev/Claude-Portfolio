'use strict';

require('dotenv').config();
const AlpacaSource = require('./sources/AlpacaSource');
const EarningsSource = require('./sources/EarningsSource');

async function main() {
  // For testing: derive the symbol list from current Alpaca holdings.
  // In the real briefing assembler, this list will come from
  // (held positions) ∪ (watchlist from the S3 memo).
  const alpaca = new AlpacaSource({
    keyId: process.env.ALPACA_KEY_ID,
    secretKey: process.env.ALPACA_SECRET_KEY,
    paper: true,
  });
  const portfolio = await alpaca.fetch();
  const symbols = portfolio.positions.holdings.map((h) => h.symbol);

  const earnings = new EarningsSource({
    apiKey: process.env.FINNHUB_API_KEY,
    windowDays: 14,
  });
  const snapshot = await earnings.fetch({ symbols });
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((err) => {
  console.error('EarningsSource error:', err.message);
  process.exit(1);
});
