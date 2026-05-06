'use strict';

const { readMemo } = require('../services/s3memo');
const { ok, notFound } = require('../respond');

async function getMemo() {
  const memo = await readMemo();
  if (!memo) return notFound('memo not found');
  return ok({ memo });
}

module.exports = { getMemo };
