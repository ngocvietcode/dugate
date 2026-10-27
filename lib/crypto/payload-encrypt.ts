// lib/crypto/payload-encrypt.ts
//
// Hybrid encryption for outbound webhook payloads:
//   AES-256-GCM  — encrypts the plaintext body
//   RSA-OAEP-256 — wraps the AES key with the partner's public key
//
// All operations use Node's built-in `crypto` module — no third-party deps.
//
// Base64 encoding: URL-safe (RFC 4648 §5) — uses - and _ instead of + and /,
// matching Python's base64.urlsafe_b64encode used by partner implementations.

import crypto from 'crypto';

/** Encode buffer to URL-safe base64 — uses Node native support (v14.18+) */
function toBase64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/** Decode URL-safe base64 back to Buffer */
function fromBase64url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

export interface EncryptResult {
  /** AES-256-GCM ciphertext + 16-byte auth tag, URL-safe base64. */
  encryptedPayload: string;
  /** AES nonce (12 bytes), URL-safe base64. Sent in nonce header. */
  nonce: string;
  /** RSA-OAEP-256 wrapped AES key, URL-safe base64. Sent in encrypted_key header. */
  encKey: string;
}

/**
 * Encrypt `plaintext` (the serialized webhook JSON body) for a partner.
 *
 * Steps:
 *  1. Generate a fresh AES-256 key + 12-byte nonce.
 *  2. Encrypt plaintext with AES-256-GCM → ciphertext + auth tag.
 *  3. Wrap the AES key with the partner's RSA public key (OAEP-SHA-256).
 *
 * Wire format for encryptedPayload: ciphertext || tag (tag = last 16 bytes).
 * This matches Python's AESGCM which appends the tag automatically.
 * All binary values are URL-safe base64 encoded.
 */
export function encryptPayload(
  plaintext: string,
  partnerPublicKeyPem: string,
): EncryptResult {
  // Guard: fail fast with a descriptive error if PEM header is missing
  if (!partnerPublicKeyPem.includes('-----BEGIN PUBLIC KEY-----')) {
    throw new Error(
      'partner_public_key is not a valid PEM public key — ' +
      'expected "-----BEGIN PUBLIC KEY-----" header.',
    );
  }

  // 1. Fresh AES-256 key + nonce
  const aesKey = crypto.randomBytes(32);
  const nonce  = crypto.randomBytes(12);

  // 2. AES-256-GCM encrypt
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, nonce);
  const ct  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes

  // Wire: ciphertext || tag  (matches Python AESGCM which appends tag automatically)
  const ciphertextWithTag = Buffer.concat([ct, tag]);

  // 3. Wrap AES key with partner's RSA-2048 public key (OAEP-SHA-256)
  const wrappedKey = crypto.publicEncrypt(
    {
      key: partnerPublicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    aesKey,
  );

  return {
    encryptedPayload: toBase64url(ciphertextWithTag),
    nonce:            toBase64url(nonce),
    encKey:           toBase64url(wrappedKey),
  };
}

/**
 * Decrypt a payload encrypted by `encryptPayload`.
 * Intended for testing and for any future inbound decryption path.
 *
 * Throws on GCM auth tag failure (tampered ciphertext).
 */
export function decryptPayload(
  encryptedPayload: string,
  nonce: string,
  encKey: string,
  partnerPrivateKeyPem: string,
): string {
  const ciphertextWithTag = fromBase64url(encryptedPayload);
  const nonceBytes        = fromBase64url(nonce);

  // 1. Unwrap AES key with partner's private key
  const aesKey = crypto.privateDecrypt(
    {
      key: partnerPrivateKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    fromBase64url(encKey),
  );

  // 2. Split ciphertext and GCM tag (tag = last 16 bytes)
  const TAG_LENGTH = 16;
  const ct  = ciphertextWithTag.subarray(0, ciphertextWithTag.length - TAG_LENGTH);
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - TAG_LENGTH);

  // 3. AES-256-GCM decrypt — throws if tag mismatch
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, nonceBytes);
  decipher.setAuthTag(tag);
  return decipher.update(ct).toString('utf8') + decipher.final('utf8');
}
