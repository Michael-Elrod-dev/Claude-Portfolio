'use strict';

// P/L must not count money moved in or out of the account as gains.
// Numbers are the live account's: $100 deposited 2026-04-13, $250 deposited
// 2026-11-12 at 10:21 ET, which Alpaca's own history reported as +$250.85.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPortfolio, loadCashFlows } = require('./alpaca');

// Alpaca stamps each daily bar 20:00 Eastern on its trading day.
const bar = (iso) => Date.parse(iso) / 1000;
const series = (rows) => ({
  timestamp: rows.map(([iso]) => bar(iso)),
  equity: rows.map(([, eq]) => eq),
});

const APRIL_DEPOSIT = { activity_type: 'CSD', date: '2026-04-13', net_amount: '100', status: 'executed', id: 'a1' };
const NOV_DEPOSIT = { activity_type: 'CSD', date: '2026-11-12', net_amount: '250', status: 'executed', id: 'a2' };

function fakeClient({ account, all, week = all, month = all, activities = [], activitiesFail = false }) {
  return {
    getAccount: async () => account,
    getPositions: async () => [],
    getOrders: async () => [],
    getPortfolioHistory: async ({ period }) => ({ '1W': week, '1M': month, all })[period],
    getAccountActivities: async () => {
      if (activitiesFail) throw new Error('503');
      return activities;
    },
  };
}

const close = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: ${actual} != ${expected}`);

test('a deposit on the day it lands is not today\'s profit', async () => {
  // 2026-11-12 15:00 ET: the deposit is in live equity, not yet in the daily series.
  const p = await buildPortfolio({
    now: new Date('2026-11-12T20:00:00Z'),
    client: fakeClient({
      account: { equity: '376.22', last_equity: '126.41' },
      all: series([
        ['2026-04-11T00:00:00Z', 0],
        ['2026-04-14T00:00:00Z', 100],
        ['2026-11-11T01:00:00Z', 125.7],
        ['2026-11-12T01:00:00Z', 126.41],
      ]),
      activities: [APRIL_DEPOSIT, NOV_DEPOSIT],
    }),
  });
  close(p.account.dayPl, 376.22 - 126.41 - 250, 'dayPl');
  close(p.account.dayPlPct, (376.22 - 126.41 - 250) / 126.41, 'dayPlPct');
  close(p.account.totalPl, 26.41, 'totalPl');
});

test('once the deposit is in the daily series, no window counts it', async () => {
  const all = series([
    ['2026-04-11T00:00:00Z', 0],
    ['2026-04-14T00:00:00Z', 100],
    ['2026-10-14T00:00:00Z', 130],
    ['2026-11-07T01:00:00Z', 123.63],
    ['2026-11-11T01:00:00Z', 125.7],
    ['2026-11-12T01:00:00Z', 126.41],
    ['2026-11-13T01:00:00Z', 376],
  ]);
  const cut = (from) => ({ timestamp: all.timestamp.slice(from), equity: all.equity.slice(from) });
  const p = await buildPortfolio({
    now: new Date('2026-11-13T15:00:00Z'),
    client: fakeClient({
      account: { equity: '377', last_equity: '376' },
      all,
      month: cut(2),
      week: cut(3),
      activities: [APRIL_DEPOSIT, NOV_DEPOSIT],
    }),
  });
  const a = p.account;
  // The April deposit is the opening balance, not a flow inside any window.
  close(a.totalPl, 376 - 100 - 250, 'totalPl');
  close(a.totalPlPct, 0.26, 'totalPlPct (time-weighted)');
  close(a.yearPl, a.totalPl, 'yearPl (opened this year)');
  close(a.yearPlPct, a.totalPlPct, 'yearPlPct');
  close(a.monthPl, 376 - 130 - 250, 'monthPl');
  close(a.monthPlPct, 126 / 130 - 1, 'monthPlPct');
  close(a.weekPl, 376 - 123.63 - 250, 'weekPl');
  close(a.weekPlPct, 126 / 123.63 - 1, 'weekPlPct');
  close(a.dayPl, 1, 'dayPl');
});

test('a withdrawal is not a loss, whichever sign Alpaca gives it', async () => {
  for (const netAmount of ['-50', '50']) {
    const p = await buildPortfolio({
      now: new Date('2026-06-04T15:00:00Z'),
      client: fakeClient({
        account: { equity: '66', last_equity: '66' },
        all: series([
          ['2026-06-02T00:00:00Z', 100],
          ['2026-06-03T00:00:00Z', 110],
          ['2026-06-04T00:00:00Z', 66],
        ]),
        activities: [{ activity_type: 'CSW', date: '2026-06-03', net_amount: netAmount, status: 'executed', id: 'w' }],
      }),
    });
    close(p.account.totalPl, 66 - 100 + 50, `totalPl (net_amount ${netAmount})`);
    close(p.account.totalPlPct, 1.1 * (116 / 110) - 1, `totalPlPct (net_amount ${netAmount})`);
  }
});

test('a weekend deposit is not Monday\'s profit, and lands in Monday\'s bar', async () => {
  const flows = [APRIL_DEPOSIT, { ...NOV_DEPOSIT, date: '2026-11-14' }];
  const fridayClose = ['2026-11-14T01:00:00Z', 126];
  const pre = await buildPortfolio({
    now: new Date('2026-11-16T14:00:00Z'), // Monday 09:00 ET
    client: fakeClient({
      account: { equity: '376', last_equity: '126' },
      all: series([['2026-04-14T00:00:00Z', 100], fridayClose]),
      activities: flows,
    }),
  });
  close(pre.account.dayPl, 0, 'Monday dayPl');

  const post = await buildPortfolio({
    now: new Date('2026-11-17T14:00:00Z'),
    client: fakeClient({
      account: { equity: '377', last_equity: '377' },
      all: series([['2026-04-14T00:00:00Z', 100], fridayClose, ['2026-11-17T01:00:00Z', 377]]),
      activities: flows,
    }),
  });
  close(post.account.totalPl, 377 - 100 - 250, 'totalPl after Monday close');
  close(post.account.totalPlPct, 1.26 * (127 / 126) - 1, 'totalPlPct after Monday close');
});

test('unreadable transfers blank the windows instead of guessing', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const p = await buildPortfolio({
    now: new Date('2026-11-12T20:00:00Z'),
    client: fakeClient({
      account: { equity: '376.22', last_equity: '126.41' },
      all: series([['2026-04-14T00:00:00Z', 100], ['2026-11-12T01:00:00Z', 126.41]]),
      activitiesFail: true,
    }),
  });
  for (const k of ['weekPl', 'monthPl', 'yearPl', 'totalPl', 'weekPlPct', 'monthPlPct', 'yearPlPct', 'totalPlPct']) {
    assert.equal(p.account[k], null, k);
  }
  // The app declares these non-null, so they fall back to the raw figure.
  assert.equal(typeof p.account.dayPl, 'number');
  assert.equal(typeof p.account.dayPlPct, 'number');
});

test('loadCashFlows pages through every transfer and skips unexecuted ones', async () => {
  const calls = [];
  const full = Array.from({ length: 100 }, (_, i) => ({
    activity_type: 'CSD', date: '2026-05-01', net_amount: '1', status: 'executed', id: `p1-${i}`,
  }));
  const client = {
    getAccountActivities: async (q) => {
      calls.push(q);
      return calls.length === 1 ? full : [
        { activity_type: 'CSD', date: '2026-05-02', net_amount: '5', status: 'canceled', id: 'c' },
        { activity_type: 'CSW', date: '2026-05-03', net_amount: '-7', status: 'executed', id: 'w' },
      ];
    },
  };
  const flows = await loadCashFlows(client);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].pageToken, 'p1-99');
  assert.deepEqual(calls[0].activityTypes, ['CSD', 'CSW', 'JNLC', 'ACATC']);
  assert.equal(flows.length, 101);
  assert.deepEqual(flows.at(-1), { date: '2026-05-03', amount: -7 });
});
