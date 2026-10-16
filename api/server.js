#!/usr/bin/env node
'use strict';

/**
 * The API's HTTP server. On the laptop it listens on a Unix socket that
 * AlmostHadAI's Caddy proxies to (PORTFOLIO_API_SOCKET); locally, set PORT
 * instead to listen on 127.0.0.1.
 */

const fs = require('node:fs');
const http = require('node:http');
const { handle } = require('./app');

const MAX_BODY = 64 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    let result;
    try {
      const url = new URL(req.url, 'http://localhost');
      result = await handle({
        method: req.method,
        path: url.pathname,
        queryStringParameters: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body: await readBody(req),
      });
    } catch (err) {
      result = {
        statusCode: err.status || 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: err.message }),
      };
    }
    res.writeHead(result.statusCode, result.headers);
    res.end(result.body);
  });
}

function listen(server, { socket = process.env.PORTFOLIO_API_SOCKET, port = process.env.PORT } = {}) {
  if (socket) {
    fs.rmSync(socket, { force: true });
    server.listen(socket, () => {
      fs.chmodSync(socket, 0o660);
      console.log(`[api] listening on ${socket}`);
    });
  } else {
    server.listen(Number(port) || 8787, '127.0.0.1', () => {
      console.log(`[api] listening on http://127.0.0.1:${server.address().port}`);
    });
  }
}

module.exports = { createServer };

if (require.main === module) {
  const server = createServer();
  listen(server);
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
