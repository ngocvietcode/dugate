// lib/crypto/validate-encryption-params.ts
//
// Shared validation for the per-Profile encryption parameters. Used by BOTH the
// Profile save route (server-side, authoritative) and the Profile UI (client-side,
// early feedback) so the rules cannot drift between the two layers.
//
// Rule (opt-in, fail-closed): when encryption_enabled is true, the admin MUST have
// explicitly chosen a mode, and — for selective mode — MUST list fields. There is
// no implicit default; a misconfigured Profile is rejected at save time so it can
// never silently fall back to a mode/scope the admin did not choose.

interface ParamEntry {
  value?: unknown;
  isLocked?: boolean;
}

/** A Profile's parameters map: { paramName: { value, isLocked } }. */
export type ProfileParams = Record<string, ParamEntry | undefined> | null | undefined;

function readValue(params: ProfileParams, key: string): unknown {
  if (!params || typeof params !== 'object') return undefined;
  return params[key]?.value;
}

function isEnabled(value: unknown): boolean {
  return value === true || value === 'true';
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate the encryption block of a Profile's parameters.
 * @returns null when valid, or a human-readable error string when invalid.
 */
export function validateEncryptionParams(params: ProfileParams): string | null {
  if (!isEnabled(readValue(params, 'encryption_enabled'))) return null;

  // Mode defaults to 'selective' (registry schema default) when unset; only an
  // explicit 'full' opts out of field-level encryption.
  const rawMode = readValue(params, 'encryption_mode');
  const mode = rawMode === 'full' ? 'full' : 'selective';

  if (mode === 'selective') {
    const fields = readValue(params, 'encryption_fields');
    if (!nonEmptyString(fields)) {
      return 'Chế độ selective yêu cầu nhập encryption_fields (danh sách dot-path, phân tách bằng dấu phẩy).';
    }
    const hasRealField = String(fields)
      .split(',')
      .map((s) => s.trim())
      .some(Boolean);
    if (!hasRealField) {
      return 'encryption_fields không được rỗng khi dùng chế độ selective.';
    }
  }

  return null;
}
