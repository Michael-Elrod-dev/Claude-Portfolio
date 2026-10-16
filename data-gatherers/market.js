'use strict';

/**
 * Market time: Eastern dates, Alpaca's clock and calendar, and the run
 * schedule. Everything here works in epoch milliseconds so tests can pass
 * a fake "now".
 */

const TZ = 'America/New_York';
const DAY_MS = 86_400_000;

function etParts(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(ms));
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** The Eastern calendar date, YYYY-MM-DD. */
function etDate(ms = Date.now()) {
  const p = etParts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The Eastern weekday: Mon, Tue, ... */
function etWeekday(ms = Date.now()) {
  return etParts(ms).weekday;
}

function etOffsetMinutes(ms) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
    .formatToParts(new Date(ms))
    .find((p) => p.type === 'timeZoneName').value; // "GMT-4"
  const m = name.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/** "2026-10-16" + "09:30" Eastern → epoch ms. */
function etToMs(date, hhmm) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  return asUtc - etOffsetMinutes(asUtc) * 60_000;
}

/**
 * Alpaca's clock, plus when the current or next session opens.
 * While the market is open, Alpaca's `next_open` is the NEXT session's open
 * (tomorrow), so today's open comes from the calendar instead.
 *
 * @returns {Promise<{isOpen: boolean, nextOpen: number, nextClose: number, sessionOpen: number}>}
 */
async function readMarketClock(client, nowMs) {
  const c = await client.getClock();
  const isOpen = Boolean(c.is_open);
  const nextOpen = Date.parse(c.next_open);
  const nextClose = Date.parse(c.next_close);
  let sessionOpen = nextOpen;
  if (isOpen) {
    const today = etDate(nowMs);
    const [day] = (await client.getCalendar({ start: today, end: today })) || [];
    sessionOpen = day ? etToMs(day.date, day.open) : nowMs;
  }
  return { isOpen, nextOpen, nextClose, sessionOpen };
}

/**
 * Whether a scheduled (timer-started) run should trade today. The timer fires
 * Mon, Tue and Thu at 09:00 Eastern:
 *   - Mon / Thu: run if the market opens today; on a holiday, skip.
 *   - Tue: run only as a make-up when Monday was a market holiday.
 * A Thursday holiday is not made up: the next run is Monday.
 *
 * @returns {Promise<{run: boolean, reason: string, quiet?: boolean}>}
 *   `quiet` marks the ordinary non-run (a normal Tuesday) that shouldn't be logged.
 */
async function scheduledRunDecision(client, nowMs) {
  const today = etDate(nowMs);
  const weekday = etWeekday(nowMs);
  const days = (await client.getCalendar({ start: etDate(nowMs - 6 * DAY_MS), end: today })) || [];
  const open = new Set(days.map((d) => d.date));
  const tradingToday = open.has(today);

  if (weekday === 'Mon' || weekday === 'Thu') {
    if (tradingToday) return { run: true, reason: `scheduled ${weekday} run` };
    return {
      run: false,
      reason: weekday === 'Mon'
        ? 'Monday is a market holiday; the run moves to Tuesday'
        : 'Thursday is a market holiday; the next run is Monday',
    };
  }
  if (weekday === 'Tue') {
    const monday = etDate(nowMs - DAY_MS);
    if (open.has(monday)) return { run: false, quiet: true, reason: 'Tuesday runs only after a Monday holiday' };
    if (tradingToday) return { run: true, reason: 'make-up run: Monday was a market holiday' };
    return { run: false, reason: 'Monday and Tuesday are both market holidays; the next run is Thursday' };
  }
  return { run: false, quiet: true, reason: `${weekday} is not a run day` };
}

module.exports = { TZ, etDate, etWeekday, etToMs, readMarketClock, scheduledRunDecision };
