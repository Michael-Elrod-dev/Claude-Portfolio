'use strict';

/**
 * Read API keys from Secrets Manager. Same shape and secret name as the
 * pipeline: claude-portfolio/api-keys → { ANTHROPIC_API_KEY, ALPACA_KEY_ID,
 * ALPACA_SECRET_KEY, FINNHUB_API_KEY }. Cached across warm invocations.
 */

const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');

const REGION = process.env.AWS_REGION || 'us-east-1';
const SECRET_NAME = process.env.SECRET_NAME || 'claude-portfolio/api-keys';

const sm = new SecretsManagerClient({ region: REGION });

let cached = null;

async function loadApiKeys() {
  if (cached) return cached;
  const out = await sm.send(
    new GetSecretValueCommand({ SecretId: SECRET_NAME })
  );
  cached = JSON.parse(out.SecretString);
  return cached;
}

module.exports = { loadApiKeys };
