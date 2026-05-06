'use strict';

/**
 * Tiny response helpers so route handlers stay declarative.
 * Lambda Function URL response shape: { statusCode, headers, body }.
 */

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function ok(body) {
  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify(body),
  };
}

function accepted(body = { status: 'accepted' }) {
  return {
    statusCode: 202,
    headers: HEADERS,
    body: JSON.stringify(body),
  };
}

function badRequest(message) {
  return {
    statusCode: 400,
    headers: HEADERS,
    body: JSON.stringify({ error: message }),
  };
}

function unauthorized() {
  return {
    statusCode: 401,
    headers: HEADERS,
    body: JSON.stringify({ error: 'unauthorized' }),
  };
}

function notFound(message = 'not found') {
  return {
    statusCode: 404,
    headers: HEADERS,
    body: JSON.stringify({ error: message }),
  };
}

function serverError(message = 'internal error') {
  return {
    statusCode: 500,
    headers: HEADERS,
    body: JSON.stringify({ error: message }),
  };
}

module.exports = { ok, accepted, badRequest, unauthorized, notFound, serverError };
