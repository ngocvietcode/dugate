// lib/storage/index.ts
// Storage backend factory — returns LocalStorageBackend or S3StorageBackend
// based on AppSetting configuration. Singleton per process.

import { getSetting } from '@/lib/settings';
import { LocalStorageBackend } from './local-backend';
import { S3StorageBackend } from './s3-backend';
import type { StorageBackend } from './types';

export type { StorageBackend, UploadResult, StorageMetadata } from './types';
export { LocalStorageBackend } from './local-backend';
export { S3StorageBackend } from './s3-backend';

let _backend: StorageBackend | null = null;

/**
 * Get the configured storage backend.
 * Returns S3StorageBackend if s3_endpoint is configured, otherwise LocalStorageBackend.
 * Cached per process — call resetStorageBackend() when settings change.
 */
export async function getStorageBackend(): Promise<StorageBackend> {
  if (_backend) return _backend;

  const [bucket, endpoint, accessKeyId, secretAccessKey, region] = await Promise.all([
    getSetting('s3_bucket'),
    getSetting('s3_endpoint'),
    getSetting('s3_access_key'),
    getSetting('s3_secret_key'),
    getSetting('s3_region'),
  ]);

  if (bucket) {
    _backend = new S3StorageBackend({
      endpoint: endpoint || undefined,
      bucket,
      // Optional: if empty, SDK uses default credential chain (EC2 instance profile, ECS task role, env vars)
      accessKeyId: accessKeyId || undefined,
      secretAccessKey: secretAccessKey || undefined,
      region: region || 'us-east-1',
    });
    return _backend;
  }

  _backend = new LocalStorageBackend();
  return _backend;
}

/** Reset cached backend — call when S3 settings are changed via admin UI. */
export function resetStorageBackend(): void {
  _backend = null;
}

/** Check if current backend is S3. */
export function isS3Backend(): boolean {
  return _backend instanceof S3StorageBackend;
}
