'use strict';

/**
 * POST /run/force — queue a run that bypasses the schedule and the on/off
 * switch.
 *
 * Writes the store's `force-run` request; claude-portfolio-force.path sees
 * it and starts the bot, which removes it. Returns 202 at once: the run
 * takes several minutes, and the app waits for the run_complete push (or
 * polls /runs/latest).
 *
 * Refused with 409 while a run is in progress or another forced run is
 * already queued, so a second full run can't start right behind the first.
 */

const { requestForcedRun, runInProgress, forcedRunQueued } = require('../services/store');
const { accepted, conflict } = require('../respond');

async function postRunForce() {
  const running = runInProgress();
  if (running) {
    return conflict(`a run is already in progress (started ${running.startedAt})`);
  }
  if (forcedRunQueued()) return conflict('a forced run is already queued');
  await requestForcedRun();
  return accepted({ status: 'triggered', forced: true });
}

module.exports = { postRunForce };
