'use strict';

const fs = require('node:fs/promises');

/**
 * Reads a string from the local filesystem. Returns null when the file
 * doesn't exist (so callers can distinguish "missing" from "empty").
 *
 * Used as the development backend for MemoSource. The S3 equivalent will
 * implement the same { read() } contract so MemoSource itself doesn't
 * change when we deploy.
 */
class LocalFileBackend {
  constructor({ path }) {
    if (!path) throw new Error('LocalFileBackend requires a path');
    this.path = path;
  }

  async read() {
    try {
      return await fs.readFile(this.path, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(body) {
    if (typeof body !== 'string') {
      throw new Error('LocalFileBackend.write expects a string body');
    }
    await fs.writeFile(this.path, body, 'utf8');
  }

  describe() {
    return `local:${this.path}`;
  }
}

module.exports = LocalFileBackend;
