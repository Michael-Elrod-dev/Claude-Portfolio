'use strict';

require('dotenv').config();

const AlpacaSource = require('./sources/AlpacaSource');
const EarningsSource = require('./sources/EarningsSource');
const CongressionalSource = require('./sources/CongressionalSource');
const MemoSource = require('./sources/MemoSource');
const { memoBackendFromEnv } = require('./sources/memoBackendFactory');
const BriefingAssembler = require('./briefing/BriefingAssembler');
const Analyst = require('./analyst/Analyst');

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set in .env');
  }

  // 1. Assemble the briefing.
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

  console.error('Assembling briefing...');
  const briefing = await assembler.assemble();
  console.error(
    `Briefing ready: ${briefing.symbolsCovered.length} symbols, ` +
      `${briefing.errors.length} source error(s).`
  );

  // 2. Hand it to the Analyst.
  const analyst = new Analyst({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.error('Calling Claude (this may take a minute or two with web search)...');
  const result = await analyst.analyze(briefing);

  // 3. Print the recommendations + telemetry.
  console.log(JSON.stringify(result.recommendations, null, 2));

  console.error('\n--- Run telemetry ---');
  console.error(`Model:            ${result.meta.model}`);
  console.error(`Stop reason:      ${result.meta.stopReason}`);
  console.error(`Web searches:     ${result.meta.webSearchesUsed} / 15`);
  console.error(`Input tokens:     ${result.meta.usage.inputTokens.toLocaleString()}`);
  console.error(`Output tokens:    ${result.meta.usage.outputTokens.toLocaleString()}`);
  console.error(`Cache reads:      ${result.meta.usage.cacheReadTokens.toLocaleString()}`);
  console.error(`Cache writes:     ${result.meta.usage.cacheCreationTokens.toLocaleString()}`);
}

main().catch((err) => {
  console.error('Analyst run failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
