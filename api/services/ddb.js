'use strict';

/**
 * Shared DynamoDB document client + table-name constants.
 * Cached at module load — survives warm invocations.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-1';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const TABLES = {
  RUNS: process.env.RUNS_TABLE || 'claude-portfolio-runs',
  ACTIVITY: process.env.ACTIVITY_TABLE || 'claude-portfolio-activity',
  DEVICES: process.env.DEVICES_TABLE || 'claude-portfolio-devices',
};

module.exports = { ddb, TABLES };
