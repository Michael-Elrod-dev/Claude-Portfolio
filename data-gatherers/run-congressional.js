'use strict';

require('dotenv').config({ quiet: true });
const CongressionalSource = require('./sources/CongressionalSource');
const store = require('./bot/store');

async function main() {
  const source = new CongressionalSource({ backend: store.congressionalBackend() });
  const snapshot = await source.fetch();
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((err) => {
  console.error('CongressionalSource error:', err.message);
  process.exit(1);
});
