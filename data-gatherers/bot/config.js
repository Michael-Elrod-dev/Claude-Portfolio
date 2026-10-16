'use strict';

/**
 * API keys, read from the environment. On the laptop they come from
 * /etc/claude-portfolio/secrets.env via the systemd unit's EnvironmentFile;
 * locally, from data-gatherers/.env.
 */

const REQUIRED = ['ANTHROPIC_API_KEY', 'ALPACA_KEY_ID', 'ALPACA_SECRET_KEY', 'FINNHUB_API_KEY'];

/**
 * @returns {{ANTHROPIC_API_KEY: string, ALPACA_KEY_ID: string, ALPACA_SECRET_KEY: string, FINNHUB_API_KEY: string}}
 */
function loadSecrets(env = process.env) {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  return Object.fromEntries(REQUIRED.map((k) => [k, env[k]]));
}

module.exports = { loadSecrets };
