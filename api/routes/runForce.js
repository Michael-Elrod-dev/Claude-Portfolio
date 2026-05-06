'use strict';

/**
 * POST /run/force — fire the pipeline Lambda asynchronously with
 * { force: true } so the active flag is bypassed.
 *
 * Returns 202 immediately. The pipeline takes 3–8 minutes; the app should
 * wait for the FCM run_complete push (or poll /runs/latest).
 */

const {
  LambdaClient,
  InvokeCommand,
} = require('@aws-sdk/client-lambda');
const { accepted } = require('../respond');

const REGION = process.env.AWS_REGION || 'us-east-1';
const PIPELINE_FUNCTION =
  process.env.PIPELINE_FUNCTION_NAME || 'claude-portfolio-trader';

const lambda = new LambdaClient({ region: REGION });

async function postRunForce() {
  await lambda.send(
    new InvokeCommand({
      FunctionName: PIPELINE_FUNCTION,
      InvocationType: 'Event', // fire-and-forget
      Payload: Buffer.from(JSON.stringify({ force: true })),
    })
  );
  return accepted({ status: 'triggered', forced: true });
}

module.exports = { postRunForce };
