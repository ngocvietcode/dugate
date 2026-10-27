// app/api/internal/crypto/decrypt/route.ts
//
// REST decryption endpoint for out-of-process consumers (VPExpress/.NET, UiPath)
// that hold the RSA private key and need to recover an encrypted payload.
//
// ADMIN-only (NextAuth session). Not part of the /api/v1 API-key surface.
//
// Request body (full mode):
//   {
//     "mode": "full",
//     "encrypted_payload": "base64url...",
//     "nonce": "base64url...",
//     "encrypted_key": "base64url...",
//     "private_key": "<PEM-encoded RSA private key, PKCS#8>"
//   }
//   → { payload: <decrypted JSON> }
//
// Request body (selective mode): decrypt individual field ciphertexts sharing one key+nonce:
//   {
//     "mode": "selective",
//     "ciphertexts": ["base64url...", ...],
//     "nonce": "base64url...",
//     "encrypted_key": "base64url...",
//     "private_key": "..."
//   }
//   → { values: ["<plaintext>", ...] }

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAdmin } from '@/lib/auth-guard';
import { decryptPayload } from '@/lib/crypto/payload-encrypt';
import { decryptWithKey } from '@/lib/crypto/selective-encrypt';

function unwrapKey(encryptedKeyB64: string, privateKeyPem: string): Buffer {
  return crypto.privateDecrypt(
    { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(encryptedKeyB64, 'base64url'),
  );
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const privateKeyPem = typeof input.private_key === 'string' ? input.private_key.trim() : '';
  const nonce = typeof input.nonce === 'string' ? input.nonce : '';
  const encryptedKey = typeof input.encrypted_key === 'string' ? input.encrypted_key : '';
  if (!privateKeyPem || !nonce || !encryptedKey) {
    return NextResponse.json(
      { error: 'private_key, nonce, and encrypted_key are required' },
      { status: 400 },
    );
  }

  const mode = input.mode === 'selective' ? 'selective' : 'full';

  try {
    if (mode === 'full') {
      const encryptedPayload = typeof input.encrypted_payload === 'string' ? input.encrypted_payload : '';
      if (!encryptedPayload) {
        return NextResponse.json({ error: 'encrypted_payload is required for full mode' }, { status: 400 });
      }
      const plaintext = decryptPayload(encryptedPayload, nonce, encryptedKey, privateKeyPem);
      return NextResponse.json({ payload: JSON.parse(plaintext) });
    }

    // selective
    if (!Array.isArray(input.ciphertexts)) {
      return NextResponse.json({ error: 'ciphertexts (array) is required for selective mode' }, { status: 400 });
    }
    const aesKey = unwrapKey(encryptedKey, privateKeyPem);
    const nonceBytes = Buffer.from(nonce, 'base64url');
    const values = (input.ciphertexts as unknown[]).map(ct =>
      decryptWithKey(String(ct), aesKey, nonceBytes),
    );
    return NextResponse.json({ values });
  } catch (err) {
    console.error('[crypto/decrypt] decryption failed:', (err as Error).message);
    return NextResponse.json(
      { error: `Decryption failed: ${(err as Error).message}` },
      { status: 400 },
    );
  }
}
