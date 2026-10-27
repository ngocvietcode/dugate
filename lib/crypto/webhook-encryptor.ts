// lib/crypto/webhook-encryptor.ts
//
// Unified encryption serializer for outbound payloads (webhook + poll/download).
//
// Two output styles share the SAME crypto core (AES-256-GCM + RSA-OAEP-256):
//
//   'pam-legacy'  → body { encrypt_mode:'full', nonce, encrypted_key, encrypted_payload }
//                   headers: {}   (PAM contract — MUST NOT change)
//
//   'spec'        → full:      body { encrypted_payload, encryption:{mode,fields,nonce,encrypted_key} }
//                   selective: body { ...envelope, <fields→ciphertext>, encryption:{...} }
//                   headers:   X-Encrypt-Mode, [X-Encrypt-Fields], X-Nonce, X-Enc-Key
//
// Migrating PAM to the spec format later is a one-line style switch — no crypto rewrite.

import { encryptPayload } from './payload-encrypt';
import { encryptSelective } from './selective-encrypt';

export type EncryptStyle = 'pam-legacy' | 'spec';
export type EncryptMode = 'full' | 'selective';

export interface WebhookEncryptOptions {
  style: EncryptStyle;
  mode: EncryptMode;
  /** Dot-path fields for selective mode. Ignored for full mode. */
  fields?: string[];
  publicKeyPem: string;
  /** Where spec-style metadata goes. Ignored for pam-legacy (always body-only). */
  metadataTarget?: 'body' | 'headers' | 'both';
  /** Selective mode: reject concrete paths missing from the payload structure. */
  strictPaths?: boolean;
}

export interface EncryptedOutput {
  body: string;
  headers: Record<string, string>;
}

/**
 * Encrypt a payload object and serialize it to a wire body + headers.
 * Pure function — no I/O, no ctx. Callers resolve the key first.
 */
export function encryptForWire(
  payload: Record<string, unknown>,
  opts: WebhookEncryptOptions,
): EncryptedOutput {
  // ── PAM legacy: full-body, body-only metadata, empty headers ──
  if (opts.style === 'pam-legacy') {
    const plaintext = JSON.stringify(payload);
    const { encryptedPayload, nonce, encKey } = encryptPayload(plaintext, opts.publicKeyPem);
    return {
      body: JSON.stringify({
        encrypt_mode: 'full',
        nonce,
        encrypted_key: encKey,
        encrypted_payload: encryptedPayload,
      }),
      headers: {},
    };
  }

  // ── Spec style ──
  const target = opts.metadataTarget ?? 'both';
  const wantBody = target === 'body' || target === 'both';
  const wantHeaders = target === 'headers' || target === 'both';

  if (opts.mode === 'full') {
    const plaintext = JSON.stringify(payload);
    const { encryptedPayload, nonce, encKey } = encryptPayload(plaintext, opts.publicKeyPem);
    const encryption = { mode: 'full' as const, fields: [] as string[], nonce, encrypted_key: encKey };
    const body: Record<string, unknown> = { encrypted_payload: encryptedPayload };
    if (wantBody) body.encryption = encryption;
    return {
      body: JSON.stringify(body),
      headers: wantHeaders
        ? { 'X-Encrypt-Mode': 'full', 'X-Nonce': nonce, 'X-Enc-Key': encKey }
        : {},
    };
  }

  // selective
  const { encryptedBody, fields, nonce, encryptedKey } = encryptSelective(
    payload,
    opts.fields ?? [],
    opts.publicKeyPem,
    { strictPaths: opts.strictPaths },
  );
  const encryption = { mode: 'selective' as const, fields, nonce, encrypted_key: encryptedKey };
  const outBody: Record<string, unknown> = { ...encryptedBody };
  if (wantBody) outBody.encryption = encryption;
  return {
    body: JSON.stringify(outBody),
    headers: wantHeaders
      ? {
          'X-Encrypt-Mode': 'selective',
          'X-Encrypt-Fields': fields.join(','),
          'X-Nonce': nonce,
          'X-Enc-Key': encryptedKey,
        }
      : {},
  };
}
