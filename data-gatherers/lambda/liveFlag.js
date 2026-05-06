'use strict';

/**
 * The runtime decision for "is the executor placing real orders".
 *
 * Today this lives only in the Lambda env var EXECUTOR_LIVE. The Android
 * app needs to flip it from outside the Lambda config, so we mirror it to
 * SSM Parameter Store at /claude-portfolio-live and have the handler read
 * SSM at runtime with a fallback to the env var.
 *
 * Resolution order:
 *   1. SSM /claude-portfolio-live  → "true" or "false"
 *   2. env EXECUTOR_LIVE           → "true" or "false"
 *   3. default false               → dry-run if neither is set
 *
 * The PUT side lives in the API Lambda (Phase 2). This module is read-only.
 */

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

const REGION = process.env.AWS_REGION || 'us-east-1';
const LIVE_PARAM = 'claude-portfolio-live';

const ssm = new SSMClient({ region: REGION });

/**
 * @returns {Promise<boolean>} true if live trading is enabled
 */
async function isLive() {
  try {
    const response = await ssm.send(
      new GetParameterCommand({ Name: LIVE_PARAM })
    );
    return response.Parameter?.Value === 'true';
  } catch (err) {
    if (err.name === 'ParameterNotFound') {
      return process.env.EXECUTOR_LIVE === 'true';
    }
    console.warn(
      `[liveFlag] SSM read failed (${err.message}); falling back to env.`
    );
    return process.env.EXECUTOR_LIVE === 'true';
  }
}

module.exports = { isLive };
