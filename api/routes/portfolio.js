'use strict';

/**
 * GET /portfolio — live Alpaca state enriched with weekPl, sinceInception,
 * per-position dayPl, opened (from order history), and thesis (from memo).
 */

const { buildPortfolio } = require('../services/alpaca');
const { readMemo } = require('../services/s3memo');
const { ok } = require('../respond');

async function getPortfolio() {
  // Memo is best-effort — if the read fails, we just don't enrich theses.
  let memo = null;
  try {
    memo = await readMemo();
  } catch (err) {
    console.warn(`[portfolio] memo read failed (continuing): ${err.message}`);
  }
  const portfolio = await buildPortfolio({ memo });
  return ok(portfolio);
}

module.exports = { getPortfolio };
