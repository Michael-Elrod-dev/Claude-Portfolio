'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Reads and writes one file. Returns null from read() when the file doesn't
 * exist, so callers can distinguish "missing" from "empty". Writes go to a
 * temp file first and are renamed into place, so a reader (the API serving
 * the memo while the bot rewrites it) never sees half a file.
 */
class LocalFileBackend {
  constructor({ path: filePath }) {
    if (!filePath) throw new Error('LocalFileBackend requires a path');
    this.path = filePath;
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
    await fs.mkdir(path.dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await fs.writeFile(tmp, body, 'utf8');
    await fs.rename(tmp, this.path);
  }

  describe() {
    return `file:${this.path}`;
  }
}

module.exports = LocalFileBackend;
