'use strict';

/**
 * The HTTP API's router. server.js turns each request into
 *   { method, path, queryStringParameters, headers, body }
 * (headers lower-cased, body a string) and writes back whatever this
 * returns: { statusCode, headers, body }.
 *
 *   - Every route but GET /health needs `Authorization: Bearer <token>`.
 *   - Routes are [method, regex] tuples; first match wins, and regex
 *     groups are passed to the handler as its second argument.
 *   - A handler error becomes a JSON 500 carrying only the message, so no
 *     stack goes out on the wire.
 */

const { checkAuth } = require('./auth');
const { notFound, unauthorized, serverError, ok } = require('./respond');

const portfolio = require('./routes/portfolio');
const memo = require('./routes/memo');
const runs = require('./routes/runs');
const briefing = require('./routes/briefing');
const activity = require('./routes/activity');
const flags = require('./routes/flags');
const devices = require('./routes/devices');
const runForce = require('./routes/runForce');

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
  ['POST', /^\/devices$/,                     devices.postDevice],
  ['POST', /^\/run\/force$/,                  runForce.postRunForce],
];

async function dispatch(event) {
  for (const [m, re, fn] of ROUTES) {
    if (m !== event.method) continue;
    const match = event.path.match(re);
    if (match) return fn(event, match.slice(1));
  }
  return notFound(`no route for ${event.method} ${event.path}`);
}

async function handle(event) {
  const startedAt = Date.now();
  const { method, path } = event;

  // Open, so a plain curl can check the service is up.
  if (method === 'GET' && path === '/health') return ok({ status: 'ok' });

  if (!checkAuth(event).ok) {
    console.log(`[api] 401 ${method} ${path}`);
    return unauthorized();
  }

  try {
    const result = await dispatch(event);
    console.log(`[api] ${result.statusCode} ${method} ${path} (${Date.now() - startedAt}ms)`);
    return result;
  } catch (err) {
    console.error(`[api] 500 ${method} ${path}: ${err.stack || err.message}`);
    return serverError(err.message || 'internal error');
  }
}

module.exports = { handle };
