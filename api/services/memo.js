'use strict';

/** The memo the bot rewrites each run, parsed. null until the first run. */

const { memoBackend } = require('./store');

async function readMemo() {
  const raw = await memoBackend().read();
  return raw === null ? null : JSON.parse(raw);
}

module.exports = { readMemo };
