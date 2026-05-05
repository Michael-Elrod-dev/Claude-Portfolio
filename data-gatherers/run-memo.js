'use strict';

require('dotenv').config();
const MemoSource = require('./sources/MemoSource');
const { memoBackendFromEnv } = require('./sources/memoBackendFactory');

async function main() {
  const source = new MemoSource({ backend: memoBackendFromEnv() });
  const snapshot = await source.fetch();
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((err) => {
  console.error('MemoSource error:', err.message);
  process.exit(1);
});
