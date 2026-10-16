'use strict';

require('dotenv').config({ quiet: true });
const MemoSource = require('./sources/MemoSource');
const store = require('./bot/store');

async function main() {
  const source = new MemoSource({ backend: store.memoBackend() });
  const snapshot = await source.fetch();
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((err) => {
  console.error('MemoSource error:', err.message);
  process.exit(1);
});
