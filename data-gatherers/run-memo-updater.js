'use strict';

/**
 * End-to-end runner for the full Sunday pipeline:
 *   1. Assemble briefing (reads current memo via the configured backend)
 *   2. Run Analyst       — Claude API call (web search enabled)
 *   3. Run MemoUpdater   — Claude API call (no tools)
 *   4. Write new memo    — back through the same backend MemoSource read
 *
 * The new memo is printed to stdout; telemetry to stderr.
 *
 * Backend selection: if MEMO_S3_BUCKET is set, S3Backend is used (read +
 * write the same key in production). Otherwise LocalFileBackend writes
 * memo.json locally. The backend instance is shared between the read and
 * write paths so the round trip is symmetric.
 *
 * NOTE: this hits the Anthropic API twice. Don't run it casually — it
 * costs real tokens.
 */
require('dotenv').config();

const AlpacaSource = require('./sources/AlpacaSource');
const EarningsSource = require('./sources/EarningsSource');
const CongressionalSource = require('./sources/CongressionalSource');
const MemoSource = require('./sources/MemoSource');
const { memoBackendFromEnv } = require('./sources/memoBackendFactory');
const BriefingAssembler = require('./briefing/BriefingAssembler');
const Analyst = require('./analyst/Analyst');
const MemoUpdater = require('./analyst/MemoUpdater');

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set in .env');
  }

  const memoBackend = memoBackendFromEnv();

  // 1. Briefing
  const assembler = new BriefingAssembler({
    alpaca: new AlpacaSource({
      keyId: process.env.ALPACA_KEY_ID,
      secretKey: process.env.ALPACA_SECRET_KEY,
      paper: true,
    }),
    memo: new MemoSource({ backend: memoBackend }),
    congressional: new CongressionalSource(),
    earnings: new EarningsSource({
      apiKey: process.env.FINNHUB_API_KEY,
      windowDays: 14,
    }),
  });

  console.error(`Memo backend: ${memoBackend.describe()}`);
  console.error('Assembling briefing...');
  const briefing = await assembler.assemble();
  console.error(
    `Briefing ready: ${briefing.symbolsCovered.length} symbols, ` +
      `${briefing.errors.length} source error(s).`
  );

  // 2. Analyst
  const analyst = new Analyst({ apiKey: process.env.ANTHROPIC_API_KEY });
  console.error('Calling Analyst (web search enabled, may take 1-2 minutes)...');
  const analysis = await analyst.analyze(briefing);

  // 3. MemoUpdater
  const updater = new MemoUpdater({ apiKey: process.env.ANTHROPIC_API_KEY });
  console.error('Calling MemoUpdater...');
  const result = await updater.update({
    priorMemo: briefing.memo?.memo || {},
    briefing,
    recommendations: analysis.recommendations,
  });

  // 4. Write new memo through the same backend the reader uses.
  console.error(`Writing new memo to ${memoBackend.describe()}...`);
  await memoBackend.write(JSON.stringify(result.memo, null, 2));
  console.error('Memo written.');

  // 5. Print + telemetry
  console.log(JSON.stringify(result.memo, null, 2));

  console.error('\n--- Analyst telemetry ---');
  console.error(`Stop reason:      ${analysis.meta.stopReason}`);
  console.error(`Web searches:     ${analysis.meta.webSearchesUsed} / 15`);
  console.error(`Input tokens:     ${analysis.meta.usage.inputTokens.toLocaleString()}`);
  console.error(`Output tokens:    ${analysis.meta.usage.outputTokens.toLocaleString()}`);

  console.error('\n--- MemoUpdater telemetry ---');
  console.error(`Stop reason:      ${result.meta.stopReason}`);
  console.error(`Input tokens:     ${result.meta.usage.inputTokens.toLocaleString()}`);
  console.error(`Output tokens:    ${result.meta.usage.outputTokens.toLocaleString()}`);
  console.error(`Cache reads:      ${result.meta.usage.cacheReadTokens.toLocaleString()}`);
}

main().catch((err) => {
  console.error('MemoUpdater run failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
