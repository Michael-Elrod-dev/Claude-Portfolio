'use strict';

/**
 * Thin wrapper around SSM Parameter Store for the two flag params:
 *   /claude-portfolio-active  — bot enabled?
 *   /claude-portfolio-live    — placing real orders?
 *
 * Flags are stored as plain "true" / "false" strings to match the
 * convention the pipeline already uses.
 */

const {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
} = require('@aws-sdk/client-ssm');

const REGION = process.env.AWS_REGION || 'us-east-1';
const ssm = new SSMClient({ region: REGION });

async function getFlag(name) {
  try {
    const response = await ssm.send(new GetParameterCommand({ Name: name }));
    return response.Parameter?.Value === 'true';
  } catch (err) {
    if (err.name === 'ParameterNotFound') return false;
    throw err;
  }
}

async function setFlag(name, value) {
  await ssm.send(
    new PutParameterCommand({
      Name: name,
      Value: value ? 'true' : 'false',
      Type: 'String',
      Overwrite: true,
    })
  );
}

module.exports = { getFlag, setFlag };
