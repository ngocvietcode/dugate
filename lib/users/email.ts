// lib/users/email.ts
// Validation for the User.email field used to link an SSO identity.
//
// Sign-in matches an incoming OIDC subject against a pre-provisioned row by email
// before falling back to username (lib/auth.ts). Two rows sharing an address would
// therefore make that match ambiguous, and the column carries no unique constraint,
// so uniqueness is enforced by the callers that write it.

/** Longest address accepted. RFC 5321 caps a path at 254 characters. */
export const EMAIL_MAX_LENGTH = 254;

/** Deliberately permissive: one @, no whitespace, a dot in the domain. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export type EmailParseResult =
  | { ok: true; email: string | null }
  | { ok: false; error: string };

/**
 * Normalise and validate an email supplied by an administrator.
 *
 * `undefined` means "not supplied" and leaves the stored value untouched; an empty
 * string means "clear it", which is how an admin removes a wrong address.
 * Addresses are lower-cased so a match cannot be missed on capitalisation alone.
 */
export function parseUserEmail(value: unknown): EmailParseResult {
  if (value === undefined) return { ok: true, email: null };

  if (typeof value !== 'string') {
    return { ok: false, error: 'Email không hợp lệ' };
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return { ok: true, email: null };

  if (normalized.length > EMAIL_MAX_LENGTH) {
    return { ok: false, error: `Email không được dài hơn ${EMAIL_MAX_LENGTH} ký tự` };
  }

  if (!EMAIL_PATTERN.test(normalized)) {
    return { ok: false, error: 'Email không hợp lệ' };
  }

  return { ok: true, email: normalized };
}
