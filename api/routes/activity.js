'use strict';

/**
 * GET /activity?limit=N — newest-first event log.
 *
 * The activity table uses a single partition (pk = "activity"), so a
 * Query with ScanIndexForward=false returns events in reverse-chronological
 * order with one DDB call.
 */

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb, TABLES } = require('../services/ddb');
const { ok } = require('../respond');

async function getActivity(event) {
  const limit = Math.min(
    parseInt(event.queryStringParameters?.limit, 10) || 50,
    200
  );
  const out = await ddb.send(
    new QueryCommand({
      TableName: TABLES.ACTIVITY,
      KeyConditionExpression: 'pk = :p',
      ExpressionAttributeValues: { ':p': 'activity' },
      ScanIndexForward: false, // newest first
      Limit: limit,
    })
  );
  return ok({ events: out.Items || [] });
}

module.exports = { getActivity };
