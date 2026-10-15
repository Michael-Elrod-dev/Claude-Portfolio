'use strict';

/**
 * The one place an Alpaca client gets built for the pipeline.
 *
 * This system trades a single real-money brokerage account. There is no
 * paper account and no account switching — that was removed deliberately,
 * so there is nothing here to configure and no way to point the pipeline
 * somewhere else by accident.
 *
 * Why `baseUrl` is set explicitly rather than left to the SDK:
 *   The SDK resolves its host as
 *     config.baseUrl || process.env.APCA_API_BASE_URL || (config.paper ? paper : live)
 *   Omitting `paper` does land on the live host, but only because the flag
 *   is falsy — and the env var sits ahead of that default, so a stray
 *   APCA_API_BASE_URL in the Lambda environment could silently redirect
 *   real orders to paper (or anywhere). Passing baseUrl ourselves wins
 *   over both and makes the target account an explicit, greppable fact.
 */

const Alpaca = require('@alpacahq/alpaca-trade-api');

/** The live brokerage host. Paper is `paper-api.alpaca.markets` — unused here. */
const LIVE_BASE_URL = 'https://api.alpaca.markets';

/**
 * @param {object}  opts
 * @param {string}  opts.keyId      live API key id (an `AK…` key)
 * @param {string}  opts.secretKey  live API secret
 * @returns {Alpaca} a client pinned to the live brokerage account
 */
function createLiveClient({ keyId, secretKey } = {}) {
  if (!keyId || !secretKey) {
    throw new Error('createLiveClient requires keyId and secretKey');
  }
  return new Alpaca({ keyId, secretKey, baseUrl: LIVE_BASE_URL });
}

module.exports = { createLiveClient, LIVE_BASE_URL };
