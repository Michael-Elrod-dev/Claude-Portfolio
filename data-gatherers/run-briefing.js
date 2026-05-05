'use strict';

require('dotenv').config();

const AlpacaSource = require('./sources/AlpacaSource');
const EarningsSource = require('./sources/EarningsSource');
const CongressionalSource = require('./sources/CongressionalSource');
const MemoSource = require('./sources/MemoSource');
const { memoBackendFromEnv } = require('./sources/memoBackendFactory');
const BriefingAssembler = require('./briefing/BriefingAssembler');

async function main() {
  const assembler = new BriefingAssembler({
    alpaca: new AlpacaSource({
      keyId: process.env.ALPACA_KEY_ID,
      secretKey: process.env.ALPACA_SECRET_KEY,
      paper: true,
    }),
    memo: new MemoSource({ backend: memoBackendFromEnv() }),
    congressional: new CongressionalSource(),
    earnings: new EarningsSource({
      apiKey: process.env.FINNHUB_API_KEY,
      windowDays: 14,
    }),
  });

  const briefing = await assembler.assemble();
  console.log(JSON.stringify(briefing, null, 2));
}

main().catch((err) => {
  console.error('BriefingAssembler error:', err.message);
  process.exit(1);
});
