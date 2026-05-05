'use strict';

/**
 * Standalone runner for the Executor.
 *
 * Usage:
 *   node run-executor.js path/to/recommendations.json     # dry run
 *   EXECUTOR_LIVE=true node run-executor.js path/to/recs.json   # actually trade
 *
 * The recommendations file must be the JSON object produced by the
 * Analyst (the whole envelope, not just the recommendations array).
 *
 * SAFETY:
 *   - Dry run is the default. To actually submit orders, set
 *     EXECUTOR_LIVE=true in the environment. There is no CLI flag for
 *     this — the env-var requirement is intentional.
 *   - Even live, all orders are placed against the paper-trading
 *     account configured by ALPACA_KEY_ID / ALPACA_SECRET_KEY.
 */
require('dotenv').config();
const fs = require('node:fs/promises');
const Executor = require('./executor/Executor');

async function main() {
  const recsPath = process.argv[2];
  if (!recsPath) {
    console.error('Usage: node run-executor.js <path-to-recommendations.json>');
    process.exit(1);
  }

  const raw = await fs.readFile(recsPath, 'utf8');
  const recommendations = JSON.parse(raw);

  const live = process.env.EXECUTOR_LIVE === 'true';
  const executor = new Executor({
    keyId: process.env.ALPACA_KEY_ID,
    secretKey: process.env.ALPACA_SECRET_KEY,
    paper: true,
    dryRun: !live,
  });

  console.error(`Mode: ${live ? 'LIVE — orders will be submitted' : 'DRY RUN'}`);
  console.error(`Run date: ${executor.runDate}`);
  console.error(`Loaded ${recommendations.recommendations?.length ?? 0} recommendations from ${recsPath}\n`);

  const result = await executor.execute(recommendations);
  console.log(JSON.stringify(result, null, 2));

  console.error('\n--- Summary ---');
  for (const [k, v] of Object.entries(result.summary)) {
    console.error(`  ${k.padEnd(10)} ${v}`);
  }
}

main().catch((err) => {
  console.error('Executor failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
