'use strict';

const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  NoSuchKey,
} = require('@aws-sdk/client-s3');

/**
 * Reads and writes a single object in S3, used as the production backend
 * for MemoSource (and eventually anywhere else we need durable shared
 * state).
 *
 * Implements the same { read(), write(), describe() } contract as
 * LocalFileBackend, so MemoSource itself doesn't change between
 * development and production — swap the backend, that's it.
 *
 * Credentials and region come from the standard AWS SDK chain (env vars,
 * shared credentials file, IAM role). No keys live in this code.
 */
class S3Backend {
  constructor({ bucket, key, region = process.env.AWS_REGION || 'us-east-1' } = {}) {
    if (!bucket) throw new Error('S3Backend requires a bucket');
    if (!key) throw new Error('S3Backend requires a key');
    this.bucket = bucket;
    this.key = key;
    this.region = region;
    this.client = new S3Client({ region });
  }

  /**
   * Returns the object body as a UTF-8 string, or null if the key does
   * not exist (so callers can distinguish "missing" from "empty"). Other
   * errors (permission denied, network) propagate as-is — those should
   * fail loudly.
   */
  async read() {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key })
      );
      return await res.Body.transformToString('utf8');
    } catch (err) {
      if (err instanceof NoSuchKey || err.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  /**
   * Overwrites the object with the given string. ContentType is set to
   * application/json since the only consumer today is MemoSource (which
   * stores JSON). If we ever store non-JSON, accept ContentType in the
   * options.
   */
  async write(body) {
    if (typeof body !== 'string') {
      throw new Error('S3Backend.write expects a string body');
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key,
        Body: body,
        ContentType: 'application/json',
      })
    );
  }

  describe() {
    return `s3://${this.bucket}/${this.key}`;
  }
}

module.exports = S3Backend;
