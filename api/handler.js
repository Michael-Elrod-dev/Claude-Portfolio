'use strict';

/**
 * Lambda Function URL entry point for the Claude Portfolio HTTP API.
 *
 * Behaviour:
 *   - All requests must include `Authorization: Bearer <token>` matching
 *     the secret stored at claude-portfolio/api-bearer-token.
 *   - Routes are matched by [method, regex] tuples; first match wins.
 *   - Handler errors return JSON 500 with the message; only the message is
 *     sent (no stack) so we don't leak internals on the wire.
 *
 * Lambda Function URL event shape:
 *   event.requestContext.http.{method,path}
 *   event.rawPath (preferred), event.queryStringParameters, event.headers
 *   event.body (string, possibly base64-encoded if isBase64Encoded=true)
 */

const { checkAuth } = require('./auth');
const {
  notFound,
  unauthorized,
  serverError,
  ok,
} = require('./respond');

const portfolio = require('./routes/portfolio');
const memo = require('./routes/memo');
const runs = require('./routes/runs');
const briefing = require('./routes/briefing');
const activity = require('./routes/activity');
const flags = require('./routes/flags');
const devices = require('./routes/devices');
const runForce = require('./routes/runForce');

// [method, regex, handler]. Path captures (regex groups) are passed as the
// second arg to the handler. /health is handled separately, before auth.
const ROUTES = [
  ['GET',  /^\/portfolio$/,                   portfolio.getPortfolio],
  ['GET',  /^\/memo$/,                        memo.getMemo],
  ['GET',  /^\/runs\/latest$/,                runs.getRunsLatest],
  ['GET',  /^\/runs\/(\d{4}-\d{2}-\d{2})$/,   runs.getRunByDate],
  ['GET',  /^\/runs$/,                        runs.getRunsList],
  ['GET',  /^\/briefing\/latest$/,            briefing.getBriefingLatest],
  ['GET',  /^\/activity$/,                    activity.getActivity],
  ['GET',  /^\/flags\/active$/,               flags.getActive],
  ['PUT',  /^\/flags\/active$/,               flags.putActive],
  ['GET',  /^\/flags\/live$/,                 flags.getLive],
  ['PUT',  /^\/flags\/live$/,                 flags.putLive],
  ['POST', /^\/devices$/,                     devices.postDevice],
  ['POST', /^\/run\/force$/,                  runForce.postRunForce],
];

function getMethodAndPath(event) {
  const method = event.requestContext?.http?.method
    || event.httpMethod
    || event.method;
  const path = event.rawPath
    || event.requestContext?.http?.path
    || event.path
    || '/';
  return { method, path };
}

async function dispatch(event) {
  const { method, path } = getMethodAndPath(event);
  for (const [m, re, fn] of ROUTES) {
    if (m !== method) continue;
    const match = path.match(re);
    if (match) {
      return fn(event, match.slice(1));
    }
  }
  return notFound(`no route for ${method} ${path}`);
}

exports.handler = async (event = {}) => {
  const startedAt = Date.now();
  const { method, path } = getMethodAndPath(event);
  console.log(`[api] ${method} ${path}`);

  // Health check is open — useful for `curl` smoke tests without the token.
  if (method === 'GET' && (event.rawPath === '/health' || event.path === '/health')) {
    return ok({ status: 'ok' });
  }

  const auth = await checkAuth(event);
  if (!auth.ok) {
    console.log(`[api] 401 ${method} ${path}`);
    return unauthorized();
  }

  try {
    const result = await dispatch(event);
    const ms = Date.now() - startedAt;
    console.log(`[api] ${result.statusCode} ${method} ${path} (${ms}ms)`);
    return result;
  } catch (err) {
    console.error(`[api] 500 ${method} ${path}: ${err.stack || err.message}`);
    return serverError(err.message || 'internal error');
  }
};
