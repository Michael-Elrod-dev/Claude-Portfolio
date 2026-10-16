'use strict';

/**
 * POST /run/force — queue a run that bypasses the on/off switch.
 *
 * Writes the store's `force-run` request; claude-portfolio-force.path sees
 * it and starts the bot, which removes it. Returns 202 at once: the run
 * takes several minutes, and the app waits for the run_complete push (or
 * polls /runs/latest).
 */

const { requestForcedRun } = require('../services/store');
const { accepted } = require('../respond');

async function postRunForce() {
  await requestForcedRun();
  return accepted({ status: 'triggered', forced: true });
}

module.exports = { postRunForce };
