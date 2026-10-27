// lib/crypto/selective-encrypt.ts
//
// Selective field-level encryption for API payloads (spec: DESIGN-API-SECURITY-ENCRYPTION.md).
// Encrypts ONLY the fields named by dot-path (with [] array notation), leaving the
// envelope plaintext so clients can route/log/monitor without decrypting.
//
// Crypto scheme is identical to lib/crypto/payload-encrypt.ts:
//   AES-256-GCM (fresh 32-byte key + 12-byte nonce per response)
//   RSA-OAEP-256 wraps the AES key with the receiver's public key.
// All selective fields in one response share ONE AES key + ONE nonce (per ITSEC spec):
// the partner unwraps the key once and decrypts each field.
//
// URL-safe base64 (RFC 4648 §5) throughout, matching payload-encrypt.ts.

import crypto from 'crypto';

const AES_KEY_LENGTH = 32; // 256 bits
const NONCE_LENGTH = 12; // GCM standard IV
const TAG_LENGTH = 16; // GCM auth tag

/**
 * Thrown when selective mode is configured but NONE of the dot-path fields match
 * the payload. This is an admin misconfiguration (wrong encryption_fields), not a
 * server fault — routes map it to HTTP 422 with a corrective hint instead of 500.
 */
export class SelectiveEncryptionFieldError extends Error {
  readonly configuredFields: string[];
  readonly availableTopLevelKeys: string[];
  constructor(configuredFields: string[], availableTopLevelKeys: string[]) {
    super(
      'Selective encryption produced no encrypted fields — none of the configured ' +
        `encryption_fields matched the payload: ${JSON.stringify(configuredFields)}. ` +
        'Fix encryption_fields (dot-path) or switch encryption_mode to "full".',
    );
    this.name = 'SelectiveEncryptionFieldError';
    this.configuredFields = configuredFields;
    this.availableTopLevelKeys = availableTopLevelKeys;
  }
}

/**
 * Strict-path variant: at least one configured concrete dot-path does not exist
 * in the payload structure at all (stale path from an older payload shape).
 * Subclass of SelectiveEncryptionFieldError so routes keep mapping it to 422.
 */
export class SelectiveEncryptionPathError extends SelectiveEncryptionFieldError {
  constructor(unresolvedFields: string[], availableTopLevelKeys: string[]) {
    super(unresolvedFields, availableTopLevelKeys);
    this.name = 'SelectiveEncryptionPathError';
    this.message =
      'Selective encryption refused — these encryption_fields do not exist in the ' +
      `payload structure: ${JSON.stringify(unresolvedFields)}. Fix the dot-path, use ` +
      '"**.<field>", or switch encryption_mode to "full".';
  }
}

export interface SelectiveEncryptOptions {
  /**
   * Fail closed when ANY concrete (non-`**`) path does not resolve structurally,
   * instead of only when NO path matched. Use for payloads whose shape differs
   * from what existing Profiles were configured against.
   */
  strictPaths?: boolean;
}

/**
 * AES-256-GCM encrypt with a GIVEN key + nonce (shared across selective fields).
 * Wire format: ciphertext || tag (tag = last 16 bytes) — matches Python AESGCM.
 */
export function encryptWithKey(plaintext: string, aesKey: Buffer, nonce: Buffer): string {
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ct, tag]).toString('base64url');
}

/**
 * AES-256-GCM decrypt with a GIVEN key + nonce. Throws on tag mismatch.
 * Exposed for round-trip testing and any inbound decryption path.
 */
export function decryptWithKey(ciphertextB64: string, aesKey: Buffer, nonce: Buffer): string {
  const buf = Buffer.from(ciphertextB64, 'base64url');
  const ct = buf.subarray(0, buf.length - TAG_LENGTH);
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, nonce);
  decipher.setAuthTag(tag);
  return decipher.update(ct).toString('utf8') + decipher.final('utf8');
}

/** Wrap an AES key with the receiver's RSA-2048 public key (OAEP-SHA-256). */
export function wrapAesKey(aesKey: Buffer, publicKeyPem: string): string {
  if (!publicKeyPem.includes('-----BEGIN PUBLIC KEY-----')) {
    throw new Error(
      'encryption_public_key is not a valid PEM public key — ' +
        'expected "-----BEGIN PUBLIC KEY-----" header.',
    );
  }
  const wrapped = crypto.publicEncrypt(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    aesKey,
  );
  return wrapped.toString('base64url');
}

export interface SelectiveEncryptResult {
  /** The payload clone with named fields replaced by ciphertext strings. */
  encryptedBody: Record<string, unknown>;
  /** The field paths that were actually present and encrypted (in requested order). */
  fields: string[];
  /** base64url 12-byte nonce shared by all fields. */
  nonce: string;
  /** base64url RSA-OAEP wrapped AES key. */
  encryptedKey: string;
}

/**
 * Encrypt only the named fields inside `payload`.
 * @param payload   Response JSON (NOT mutated — a structuredClone is returned).
 * @param fieldPaths Dot-paths, with two array/scan operators:
 *                   - `[]` iterates every element of an array of objects, e.g.
 *                     "danh_sach_tai_lieu[].extracted_data.ma_may".
 *                   - `**` (deep wildcard) matches the remaining path at ANY depth,
 *                     so ONE logical field is encrypted everywhere it appears. E.g.
 *                     "**.ma_may" encrypts every `ma_may` under result, under
 *                     result.pipeline_steps[].extracted_data[], AND under
 *                     metadata.pipeline_steps[].extracted_data[] in a single rule.
 *                     `**` may only appear once, and never as the final segment.
 * @param publicKeyPem Receiver RSA-2048 public key (PEM).
 */
export function encryptSelective(
  payload: Record<string, unknown>,
  fieldPaths: string[],
  publicKeyPem: string,
  options: SelectiveEncryptOptions = {},
): SelectiveEncryptResult {
  // [SEC 29/09 LA-S1] The loan-appraisal integration payload (webhook +
  // GET /operations/{id}?view=integration) has a different shape from the legacy
  // result. A Profile listing several concrete paths written for the old shape plus
  // one path that still matches (e.g. "**.id_number") passed the "at least one
  // path matched" check below, so every stale path silently went out as PLAINTEXT
  // (see the `applied.length === 0` guard). Strict mode rejects any concrete path
  // that does not exist in the payload structure, before anything is emitted.
  if (options.strictPaths) {
    const unresolved = fieldPaths.filter((path) => !path.split('.').includes('**')
      && !pathResolves(payload, path.split('.'), 0));
    if (unresolved.length > 0) {
      throw new SelectiveEncryptionPathError(unresolved, Object.keys(payload));
    }
  }

  const aesKey = crypto.randomBytes(AES_KEY_LENGTH);
  const nonce = crypto.randomBytes(NONCE_LENGTH);
  const body = structuredClone(payload);

  // Tracks which (parentObject, key) leaves were already encrypted in THIS pass,
  // so a field reachable by two overlapping rules (or by `**` scanning a node and
  // then its child) is never double-encrypted into ciphertext-of-ciphertext.
  const encryptedLeaves = new WeakMap<object, Set<string>>();

  const applied: string[] = [];
  for (const path of fieldPaths) {
    const didEncrypt = encryptFieldAtPath(body, path.split('.'), 0, aesKey, nonce, encryptedLeaves);
    if (didEncrypt) applied.push(path);
  }

  // Fail closed: selective mode was requested but NONE of the configured field
  // paths matched the payload (e.g. a typo in encryption_fields, or the endpoint
  // simply has no such field). Returning here would emit the whole envelope as
  // plaintext — a silent confidentiality bypass. Surface it as an error instead so
  // the misconfiguration is visible on the response/webhook path.
  if (fieldPaths.length > 0 && applied.length === 0) {
    throw new SelectiveEncryptionFieldError(fieldPaths, Object.keys(payload));
  }

  return {
    encryptedBody: body,
    fields: applied,
    nonce: nonce.toString('base64url'),
    encryptedKey: wrapAesKey(aesKey, publicKeyPem),
  };
}

/**
 * Structural check for strict mode: does the path exist in the payload shape?
 * A leaf key that exists with a null value resolves (the field is part of the
 * schema, just empty for this record). An intermediate null resolves too. An
 * array segment resolves when it is empty or when any element resolves.
 */
function pathResolves(obj: Record<string, unknown>, segments: string[], index: number): boolean {
  if (index >= segments.length) return false;
  const segment = segments[index];
  const isLast = index === segments.length - 1;

  if (segment.endsWith('[]')) {
    if (isLast) return false;
    const arr = obj[segment.slice(0, -2)];
    if (!Array.isArray(arr)) return false;
    if (arr.length === 0) return true;
    return arr.some((item) => item !== null && typeof item === 'object' && !Array.isArray(item)
      && pathResolves(item as Record<string, unknown>, segments, index + 1));
  }

  if (!Object.prototype.hasOwnProperty.call(obj, segment)) return false;
  if (isLast) return true;
  const child = obj[segment];
  if (child === null) return true;
  if (typeof child === 'object' && !Array.isArray(child)) {
    return pathResolves(child as Record<string, unknown>, segments, index + 1);
  }
  return false;
}

/**
 * Recursively walk `obj` by `segments`, encrypting the leaf value.
 * A segment ending in `[]` iterates an array of objects.
 * Returns true if at least one leaf was encrypted (for accurate `fields` reporting).
 */
function encryptFieldAtPath(
  obj: Record<string, unknown>,
  segments: string[],
  index: number,
  aesKey: Buffer,
  nonce: Buffer,
  encryptedLeaves?: WeakMap<object, Set<string>>,
): boolean {
  if (index >= segments.length) return false;

  const segment = segments[index];
  const isLast = index === segments.length - 1;

  // Deep wildcard: "**" matches the remaining path (segments after `**`) at ANY
  // depth. This lets one rule encrypt a logical field wherever it appears — e.g.
  // "**.ma_may" covers result.extracted_data.danh_sach_tai_lieu[].extracted_data.ma_may,
  // result.pipeline_steps[].extracted_data[].extracted_data.ma_may AND the metadata
  // copy — without listing each base path. `**` is never a leaf (there must be a
  // concrete field name after it) and is intended to appear at most once.
  if (segment === '**') {
    const rest = segments.slice(index + 1);
    if (rest.length === 0) return false; // "**" alone is not a valid target
    return encryptDeepMatch(obj, rest, aesKey, nonce, new WeakSet(), encryptedLeaves);
  }

  // Array notation: "items[]" — iterate each object element.
  if (segment.endsWith('[]')) {
    const key = segment.slice(0, -2);
    const arr = obj[key];
    if (!Array.isArray(arr)) return false;
    if (isLast) return false; // encrypting whole array items is unsupported by design
    let any = false;
    for (const item of arr) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        if (encryptFieldAtPath(item as Record<string, unknown>, segments, index + 1, aesKey, nonce, encryptedLeaves)) {
          any = true;
        }
      }
    }
    return any;
  }

  if (isLast) {
    const value = obj[segment];
    if (value === undefined || value === null) return false;
    // Skip a leaf already encrypted in this pass to avoid ciphertext-of-ciphertext
    // when overlapping rules (or `**` scanning) reach the same field twice.
    if (encryptedLeaves) {
      const done = encryptedLeaves.get(obj);
      if (done?.has(segment)) return false;
    }
    const plaintext = typeof value === 'string' ? value : JSON.stringify(value);
    obj[segment] = encryptWithKey(plaintext, aesKey, nonce);
    if (encryptedLeaves) {
      const done = encryptedLeaves.get(obj) ?? new Set<string>();
      done.add(segment);
      encryptedLeaves.set(obj, done);
    }
    return true;
  }

  const child = obj[segment];
  if (child && typeof child === 'object' && !Array.isArray(child)) {
    return encryptFieldAtPath(child as Record<string, unknown>, segments, index + 1, aesKey, nonce, encryptedLeaves);
  }
  return false;
}

/**
 * Deep-match implementation for the `**` wildcard: walk the ENTIRE subtree and,
 * at every object node, attempt to apply the concrete tail path `rest`. Returns
 * true if at least one leaf was encrypted anywhere. Arrays are traversed too, so
 * `**` reaches into pipeline_steps[], extracted_data[], etc.
 *
 * A visited set guards against cyclic references (the payload is JSON-derived so
 * cycles are not expected, but this keeps the traversal total and safe).
 */
function encryptDeepMatch(
  node: unknown,
  rest: string[],
  aesKey: Buffer,
  nonce: Buffer,
  seen: WeakSet<object> = new WeakSet(),
  encryptedLeaves?: WeakMap<object, Set<string>>,
): boolean {
  if (!node || typeof node !== 'object') return false;
  if (seen.has(node as object)) return false;
  seen.add(node as object);

  let any = false;

  if (Array.isArray(node)) {
    for (const item of node) {
      if (encryptDeepMatch(item, rest, aesKey, nonce, seen, encryptedLeaves)) any = true;
    }
    return any;
  }

  const obj = node as Record<string, unknown>;

  // Try to satisfy the tail path starting at THIS object node.
  if (encryptFieldAtPath(obj, rest, 0, aesKey, nonce, encryptedLeaves)) any = true;

  // Continue scanning deeper so the same field is caught at every nesting level.
  for (const key of Object.keys(obj)) {
    if (encryptDeepMatch(obj[key], rest, aesKey, nonce, seen, encryptedLeaves)) any = true;
  }

  return any;
}
