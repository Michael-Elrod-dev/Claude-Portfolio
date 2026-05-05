'use strict';

require('dotenv').config();
const CongressionalSource = require('./sources/CongressionalSource');

async function main() {
  const source = new CongressionalSource();
  const snapshot = await source.fetch();
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((err) => {
  console.error('CongressionalSource error:', err.message);
  process.exit(1);
});
