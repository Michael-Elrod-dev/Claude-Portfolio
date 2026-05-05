'use strict';

/**
 * Thin wrappers around AWS Secrets Manager and SSM Parameter Store.
 *
 * loadSecrets()
 *   Fetches the JSON secret at SECRET_NAME and returns it as a plain object.
 *   The Lambda handler caches the result across warm invocations so we only
 *   pay one Secrets Manager call per cold start.
 *
 *   Expected secret shape (JSON string stored in Secrets Manager):
 *   {
 *     "ANTHROPIC_API_KEY": "sk-ant-...",
 *     "ALPACA_KEY_ID":     "PK...",
 *     "ALPACA_SECRET_KEY": "...",
 *     "FINNHUB_API_KEY":   "..."
 *   }
 *
 * isActive()
 *   Reads the SSM string parameter "claude-portfolio-active".
 *   Returns true if the value is exactly "true", false otherwise.
 *   If the parameter doesn't exist yet, defaults to true so the very first
 *   deploy works without extra setup.
 *
 *   Flip it with the toggle script:
 *     bash infra/toggle.sh on   → sets the parameter to "true"
 *     bash infra/toggle.sh off  → sets the parameter to "false"
 */

const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

const REGION = process.env.AWS_REGION || 'us-east-1';
const SECRET_NAME = process.env.SECRET_NAME || 'claude-portfolio/api-keys';
const ACTIVE_PARAM = 'claude-portfolio-active';

const smClient = new SecretsManagerClient({ region: REGION });
const ssmClient = new SSMClient({ region: REGION });

/**
 * Fetch API keys from Secrets Manager.
 * @returns {Promise<{ANTHROPIC_API_KEY: string, ALPACA_KEY_ID: string, ALPACA_SECRET_KEY: string, FINNHUB_API_KEY: string}>}
 */
async function loadSecrets() {
  const response = await smClient.send(
    new GetSecretValueCommand({ SecretId: SECRET_NAME })
  );

  if (!response.SecretString) {
    throw new Error(`Secret "${SECRET_NAME}" exists but has no SecretString value.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(response.SecretString);
  } catch {
    throw new Error(`Secret "${SECRET_NAME}" is not valid JSON.`);
  }

  const required = ['ANTHROPIC_API_KEY', 'ALPACA_KEY_ID', 'ALPACA_SECRET_KEY', 'FINNHUB_API_KEY'];
  const missing = required.filter((k) => !parsed[k]);
  if (missing.length > 0) {
    throw new Error(`Secret "${SECRET_NAME}" is missing keys: ${missing.join(', ')}`);
  }

  return parsed;
}

/**
 * Check whether the bot is enabled.
 * Reads /claude-portfolio/active from SSM Parameter Store.
 * @returns {Promise<boolean>}
 */
async function isActive() {
  try {
    const response = await ssmClient.send(
      new GetParameterCommand({ Name: ACTIVE_PARAM })
    );
    return response.Parameter?.Value === 'true';
  } catch (err) {
    if (err.name === 'ParameterNotFound') {
      // First deploy before setup.sh runs the SSM step — default to active.
      console.warn(
        `SSM parameter "${ACTIVE_PARAM}" not found. Defaulting to active=true.`
      );
      return true;
    }
    throw err;
  }
}

module.exports = { loadSecrets, isActive };
