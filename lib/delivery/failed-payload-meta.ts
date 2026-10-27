// lib/delivery/failed-payload-meta.ts
//
// Shared helper for logging a FAILED callback delivery.
//
// Goal: capture EXACTLY what went on the wire, so a 400/timeout from the partner
// can be diagnosed by comparing the logged body against their API spec. The body
// is ALWAYS logged (all three modes) — only long values are shortened so a large
// ciphertext does not bloat the log.
//
// Three delivery shapes:
//
//   1. Plaintext (encryption OFF)
//      body = { operation_id, state, done, extracted_data, ... }
//      → logged in full (shortened per-value). This is exactly what we send the
//        partner; credentials live in headers, never the body. The logger's
//        SECRET layer still scrubs any credential-shaped text defensively.
//
//   2. Full-body encryption (encryption_mode = full)
//      body = { encrypted_payload, encryption:{ mode:'full', fields:[], nonce,
//               encrypted_key } }
//      → logged in full; the long `encrypted_payload` / `encrypted_key` values
//        are shortened to head…(len)…tail so the exact wire shape is visible
//        without dumping kilobytes of ciphertext.
//
//   3. Selective encryption (encryption_mode = selective)
//      body = { ...plaintext envelope, <configured fields = ciphertext>,
//               encryption:{ mode:'selective', fields:[...], nonce, encrypted_key } }
//      → logged in full; plaintext envelope stays readable, ciphertext fields are
//        shortened. `encryption_fields` lists which fields were encrypted.

/** Values longer than this are shortened to head…tail. */
const MAX_VALUE_CHARS = 120;
/** Head/tail kept when shortening a long string value. */
const VALUE_HEAD = 48;
const VALUE_TAIL = 24;
/** Absolute ceiling for the whole serialized sent_body (defence against bloat). */
const MAX_BODY_LOG_CHARS = 4_000;

/** Shorten a long string to `head…(len=N)…tail`; short strings pass through. */
function shortenValue(value: string): string {
  if (value.length <= MAX_VALUE_CHARS) return value;
  return `${value.slice(0, VALUE_HEAD)}…(len=${value.length})…${value.slice(-VALUE_TAIL)}`;
}

/** Recursively clone a parsed JSON value, shortening every long string leaf. */
function shortenDeep(value: unknown): unknown {
  if (typeof value === 'string') return shortenValue(value);
  if (Array.isArray(value)) return value.map(shortenDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = shortenDeep(v);
    }
    return out;
  }
  return value;
}

/** Final whole-string cap, applied after per-value shortening. */
function capBody(body: string): string {
  return body.length > MAX_BODY_LOG_CHARS
    ? `${body.slice(0, MAX_BODY_LOG_CHARS)}…(truncated, len=${body.length})`
    : body;
}

/**
 * Build log metadata describing the EXACT body sent to the callback endpoint.
 * Handles plaintext, full-body encryption, and selective encryption. Always
 * includes `sent_body` (long values shortened to head…tail).
 *
 * @param body   the serialized wire body (post-encryption when enabled)
 * @param extra  optional extra fields (e.g. last_error, http_status)
 */
export function describeSentBody(
  body: string | null | undefined,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...extra };

  if (typeof body !== 'string') {
    meta.sent_body = null;
    meta.body_bytes = 0;
    return meta;
  }

  meta.body_bytes = Buffer.byteLength(body, 'utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not JSON (unexpected) — log the raw, capped body so nothing is hidden.
    meta.encrypted = false;
    meta.sent_body = capBody(body);
    return meta;
  }

  if (!parsed || typeof parsed !== 'object') {
    meta.sent_body = capBody(body);
    return meta;
  }

  const obj = parsed as Record<string, unknown>;
  meta.wire_keys = Object.keys(obj);

  const encryption = obj.encryption as { mode?: unknown; fields?: unknown } | undefined;
  const mode = encryption && typeof encryption === 'object' ? encryption.mode : undefined;

  if (mode === 'full' || 'encrypted_payload' in obj) {
    meta.encrypted = true;
    meta.encryption_mode = mode ?? 'full';
    meta.encryption_fields = encryption?.fields ?? [];
  } else if (mode === 'selective') {
    meta.encrypted = true;
    meta.encryption_mode = 'selective';
    meta.encryption_fields = encryption?.fields ?? [];
  } else {
    meta.encrypted = false;
  }

  // Always surface the body with long values shortened to head…(len)…tail so the
  // exact wire shape is visible in every mode without dumping kilobytes.
  meta.sent_body = capBody(JSON.stringify(shortenDeep(obj)));
  return meta;
}
