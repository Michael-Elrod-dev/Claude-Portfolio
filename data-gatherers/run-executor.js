'use strict';

/**
 * Standalone runner for the Executor.
 *
 * Usage:
 *   CONFIRM_LIVE_TRADES=yes node run-executor.js path/to/recommendations.json
 *
 * The recommendations file must be the JSON object produced by the
 * Analyst (the whole envelope, not just the recommendations array).
 *
 * READ THIS BEFORE RUNNING:
 *   The Executor has no dry-run mode. It submits real orders to the live
 *   brokerage account named by ALPACA_KEY_ID / ALPACA_SECRET_KEY in .env.
 *   There is no "show me what you would do" path — if this script runs to
 *   completion, money moved.
 *
 *   Because this file is wired to `npm run executor`, it refuses to do
 *   anything unless CONFIRM_LIVE_TRADES=yes is set. That guard exists only
 *   to stop an accidental invocation; it is not a safety mode and it does
 *   not gate the scheduled Lambda pipeline, which always trades.
 */
require('dotenv').config();
const fs = require('node:fs/promises');
const Executor = require('./executor/Executor');

async function main() {
  const recsPath = process.argv[2];
  if (!recsPath) {
    console.error('Usage: CONFIRM_LIVE_TRADES=yes node run-executor.js <path-to-recommendations.json>');
    process.exit(1);
  }

  if (process.env.CONFIRM_LIVE_TRADES !== 'yes') {
    console.error('Refusing to run: this submits REAL orders to the live brokerage account.');
    console.error('There is no dry-run mode. Re-run with CONFIRM_LIVE_TRADES=yes if that is what you want.');
    process.exit(1);
  }

  const raw = await fs.readFile(recsPath, 'utf8');
  const recommendations = JSON.parse(raw);

  const executor = new Executor({
    keyId: process.env.ALPACA_KEY_ID,
    secretKey: process.env.ALPACA_SECRET_KEY,
  });

  console.error('Mode: LIVE — orders WILL be submitted to the real account');
  console.error(`Run date: ${executor.runDate}`);
  console.error(`Loaded ${recommendations.recommendations?.length ?? 0} recommendations from ${recsPath}\n`);

  const result = await executor.execute(recommendations);
  console.log(JSON.stringify(result, null, 2));

  console.error('\n--- Summary ---');
  for (const [k, v] of Object.entries(result.summary)) {
    console.error(`  ${k.padEnd(16)} ${v}`);
  }
}

main().catch((err) => {
  console.error('Executor failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
