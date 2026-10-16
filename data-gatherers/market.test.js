'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { etDate, etWeekday, etToMs, readMarketClock, scheduledRunDecision } = require('./market');

const at = (s) => Date.parse(s);

/** A calendar of trading days; `closed` lists dates the market is shut. */
function calendarClient(closed = []) {
  return {
    getCalendar: async ({ start, end }) => {
      const out = [];
      for (let d = new Date(`${start}T12:00:00Z`); d <= new Date(`${end}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
        const date = d.toISOString().slice(0, 10);
        const wd = d.getUTCDay();
        if (wd !== 0 && wd !== 6 && !closed.includes(date)) out.push({ date, open: '09:30', close: '16:00' });
      }
      return out;
    },
  };
}

test('Eastern dates: an evening run is still "today", across daylight saving', () => {
  assert.equal(etDate(at('2026-10-20T01:30:00Z')), '2026-10-19'); // 21:30 EDT
  assert.equal(etDate(at('2026-11-03T02:30:00Z')), '2026-11-02'); // 21:30 EST
  assert.equal(etWeekday(at('2026-10-19T13:00:00Z')), 'Mon');
});

test('09:30 Eastern converts to the right UTC instant in summer and winter', () => {
  assert.equal(new Date(etToMs('2026-10-19', '09:30')).toISOString(), '2026-10-19T13:30:00.000Z');
  assert.equal(new Date(etToMs('2026-11-02', '09:30')).toISOString(), '2026-11-02T14:30:00.000Z');
});

test('a Monday or Thursday trading day runs', async () => {
  const c = calendarClient();
  assert.equal((await scheduledRunDecision(c, at('2026-10-19T09:00:00-04:00'))).run, true);
  assert.equal((await scheduledRunDecision(c, at('2026-10-22T09:00:00-04:00'))).run, true);
});

test('a Monday holiday moves the run to Tuesday', async () => {
  const c = calendarClient(['2027-01-18']); // MLK Day
  const mon = await scheduledRunDecision(c, at('2027-01-18T09:00:00-05:00'));
  assert.equal(mon.run, false);
  assert.ok(!mon.quiet, 'the skipped Monday is logged');
  assert.match(mon.reason, /moves to Tuesday/);
  const tue = await scheduledRunDecision(c, at('2027-01-19T09:00:00-05:00'));
  assert.equal(tue.run, true);
  assert.match(tue.reason, /make-up/);
});

test('an ordinary Tuesday is a quiet no-op', async () => {
  const tue = await scheduledRunDecision(calendarClient(), at('2026-10-20T09:00:00-04:00'));
  assert.equal(tue.run, false);
  assert.equal(tue.quiet, true);
});

test('a Thursday holiday is skipped until Monday, with no Friday make-up', async () => {
  const c = calendarClient(['2026-11-26']); // Thanksgiving
  const thu = await scheduledRunDecision(c, at('2026-11-26T09:00:00-05:00'));
  assert.equal(thu.run, false);
  assert.match(thu.reason, /next run is Monday/);
  const fri = await scheduledRunDecision(c, at('2026-11-27T09:00:00-05:00'));
  assert.equal(fri.run, false);
  assert.equal(fri.quiet, true);
});

test('while the market is open, the session open comes from the calendar, not next_open', async () => {
  const client = {
    ...calendarClient(),
    getClock: async () => ({
      is_open: true,
      next_open: '2026-10-20T09:30:00-04:00', // tomorrow, as Alpaca reports it
      next_close: '2026-10-19T16:00:00-04:00',
    }),
  };
  const c = await readMarketClock(client, at('2026-10-19T11:00:00-04:00'));
  assert.equal(c.isOpen, true);
  assert.equal(new Date(c.sessionOpen).toISOString(), '2026-10-19T13:30:00.000Z');
});
