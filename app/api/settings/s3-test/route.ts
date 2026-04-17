// app/api/settings/s3-test/route.ts
// POST /api/settings/s3-test — Test S3 connectivity

import { NextResponse } from 'next/server';
import { Logger } from '@/lib/logger';
import { getSetting } from '@/lib/settings';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { requireAdmin } from '@/lib/rbac';

export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const [endpoint, bucket, accessKeyId, secretAccessKey, region] = await Promise.all([
      getSetting('s3_endpoint'),
      getSetting('s3_bucket'),
      getSetting('s3_access_key'),
      getSetting('s3_secret_key'),
      getSetting('s3_region'),
    ]);

    if (!bucket) {
      return NextResponse.json(
        { ok: false, error: 'S3 configuration is incomplete. Please specify a bucket.' },
        { status: 400 },
      );
    }

    const clientConfig: any = {
      region: region || 'us-east-1',
    };

    if (endpoint) {
      clientConfig.endpoint = endpoint;
      clientConfig.forcePathStyle = true; // Required for MinIO and S3-compatible services
    }
    
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = { accessKeyId, secretAccessKey };
    }

    const client = new S3Client(clientConfig);

    await client.send(new HeadBucketCommand({ Bucket: bucket }));

    return NextResponse.json({ ok: true, message: `Connected to bucket "${bucket}" successfully.` });
  } catch (err: unknown) {
    // Log full error server-side, return sanitized message to client
    new Logger({ service: 's3_test_api' }).error('Connection failed', undefined, err);
    const msg = err instanceof Error ? err.message : String(err);
    const errName = err instanceof Error ? (err as any).name ?? '' : '';
    const httpStatus = (err as any)?.$metadata?.httpStatusCode;
    // Only expose safe error hints
    // HeadBucketCommand returns errName='NotFound' (404) when bucket doesn't exist
    const safeMsg = msg.includes('Access Denied') || msg.includes('Forbidden') ? 'Access Denied — check credentials'
      : (msg.includes('NoSuchBucket') || errName === 'NotFound' || httpStatus === 404) ? 'Bucket not found'
      : msg.includes('ECONNREFUSED') ? 'Connection refused — check endpoint URL'
      : msg.includes('ENOTFOUND') ? 'Hostname not found — check endpoint URL'
      : 'Connection failed — check your S3 configuration';
    return NextResponse.json({ ok: false, error: safeMsg }, { status: 500 });
  }
}
