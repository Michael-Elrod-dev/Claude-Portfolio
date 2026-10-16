'use strict';

const { readMemo } = require('../services/memo');
const { ok, notFound } = require('../respond');

async function getMemo() {
  const memo = await readMemo();
  if (!memo) return notFound('memo not found');
  return ok({ memo });
}

module.exports = { getMemo };
