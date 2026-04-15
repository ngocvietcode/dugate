// lib/storage/s3-backend.ts
// S3-compatible storage backend (AWS S3, MinIO, R2, etc.)

import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable, PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { StorageBackend, UploadResult, StorageMetadata } from './types';

export interface S3BackendConfig {
  endpoint?: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region: string;
}

export class S3StorageBackend implements StorageBackend {
  private client: S3Client;
  private bucket: string;

  constructor(config: S3BackendConfig) {
    this.bucket = config.bucket;

    const hasExplicitCredentials = config.accessKeyId && config.secretAccessKey;

    this.client = new S3Client({
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
      region: config.region || 'us-east-1',
      // Only set explicit credentials if provided; otherwise let SDK use
      // default credential chain (env vars, EC2 instance profile, ECS task role, etc.)
      ...(hasExplicitCredentials
        ? { credentials: { accessKeyId: config.accessKeyId!, secretAccessKey: config.secretAccessKey! } }
        : {}),
    });
  }

  async upload(key: string, stream: Readable, opts?: { contentType?: string }): Promise<UploadResult> {
    const hash = crypto.createHash('md5');
    let bytesWritten = 0;

    // Tee the stream: one side computes MD5, the other goes to S3
    const passThrough = new PassThrough();
    const hashPromise = new Promise<string>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(buf);
        bytesWritten += buf.length;
      });
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });

    stream.pipe(passThrough);

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: passThrough,
        ContentType: opts?.contentType ?? 'application/octet-stream',
      },
      // 10MB parts for multipart upload — streams without buffering entire file
      partSize: 10 * 1024 * 1024,
      leavePartsOnError: false,
    });

    try {
      await upload.done();
      const md5 = await hashPromise;
      return { bytesWritten, md5, s3Key: key };
    } catch (err) {
      // Clean up on failure
      await this.delete(key).catch(() => {});
      throw err;
    }
  }

  async download(key: string): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) {
      throw new Error(`S3 object '${key}' has no body`);
    }
    return response.Body as Readable;
  }

  async downloadToTempFile(key: string, tmpDir: string): Promise<string> {
    await fs.mkdir(tmpDir, { recursive: true });
    const fileName = path.basename(key);
    const tmpPath = path.join(tmpDir, fileName);

    const readable = await this.download(key);
    const writeStream = createWriteStream(tmpPath);

    try {
      await pipeline(readable, writeStream);
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {});
      throw err;
    }

    return tmpPath;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    // S3 DeleteObjects supports max 1000 keys per request
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((k) => ({ Key: k })) },
        }),
      );
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(key: string): Promise<StorageMetadata | null> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: response.ContentLength ?? 0,
        md5: response.ETag?.replace(/"/g, ''),
      };
    } catch {
      return null;
    }
  }

  /** Expose client for test-connection use (HeadBucket). */
  getClient(): S3Client {
    return this.client;
  }

  getBucket(): string {
    return this.bucket;
  }
}
