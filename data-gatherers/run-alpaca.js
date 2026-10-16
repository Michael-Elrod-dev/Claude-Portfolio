'use strict';

require('dotenv').config({ quiet: true });
const AlpacaSource = require('./sources/AlpacaSource');

async function main() {
  const source = new AlpacaSource({
    keyId: process.env.ALPACA_KEY_ID,
    secretKey: process.env.ALPACA_SECRET_KEY,
  });
  const snapshot = await source.fetch();
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((err) => {
  console.error('AlpacaSource error:', err.message);
  process.exit(1);
});
