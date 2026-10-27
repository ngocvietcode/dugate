// app/api/internal/crypto/encrypt/route.ts
//
// REST encryption endpoint for out-of-process consumers (VPExpress/.NET, UiPath).
// DUGate itself uses lib/crypto in-process; this HTTP surface exposes the same
// AES-256-GCM + RSA-OAEP-256 core for callers that cannot import the library.
//
// ADMIN-only (NextAuth session). Not part of the /api/v1 API-key surface.
//
// Request body:
//   {
//     "payload": { ... },                // required — JSON object to protect
//     "mode": "selective" | "full",      // optional, default "selective"
//     "fields": ["extracted_data", ...], // optional (selective), default ["extracted_data"]
//     "public_key": "-----BEGIN PUBLIC KEY----- ...",  // required (PEM)
//     "metadata_target": "both" | "body" | "headers"   // optional, default "both"
//   }
//
// Response: { body: <object>, headers: <object> } — body is the serialized wire
// object (already parsed back to JSON for convenience), headers carry X-Encrypt-*.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guard';
import { encryptForWire, type EncryptMode } from '@/lib/crypto/webhook-encryptor';

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  let input: {
    payload?: unknown;
    mode?: unknown;
    fields?: unknown;
    public_key?: unknown;
    metadata_target?: unknown;
  };
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    return NextResponse.json({ error: 'payload must be a JSON object' }, { status: 400 });
  }
  const publicKeyPem = typeof input.public_key === 'string' ? input.public_key.trim() : '';
  if (!publicKeyPem) {
    return NextResponse.json({ error: 'public_key (PEM) is required' }, { status: 400 });
  }

  const mode: EncryptMode = input.mode === 'full' ? 'full' : 'selective';
  const fields = Array.isArray(input.fields)
    ? input.fields.map(String).map(s => s.trim()).filter(Boolean)
    : ['extracted_data'];
  const metadataTarget =
    input.metadata_target === 'body' || input.metadata_target === 'headers'
      ? input.metadata_target
      : 'both';

  try {
    const out = encryptForWire(input.payload as Record<string, unknown>, {
      style: 'spec',
      mode,
      fields,
      publicKeyPem,
      metadataTarget,
    });
    return NextResponse.json({ body: JSON.parse(out.body), headers: out.headers });
  } catch (err) {
    console.error('[crypto/encrypt] encryption failed:', (err as Error).message);
    return NextResponse.json(
      { error: `Encryption failed: ${(err as Error).message}` },
      { status: 400 },
    );
  }
}
