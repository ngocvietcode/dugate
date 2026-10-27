// Save-time validators for Profile integration configuration.

export type CallbackPayloadMode = 'WITH_RESULT' | null;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Profile callback payload mode. `null` preserves the byte-for-byte legacy
 * status payload; `'WITH_RESULT'` also embeds extracted data.
 */
export function validateCallbackPayloadMode(value: unknown): ValidationResult<CallbackPayloadMode> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (value === 'WITH_RESULT') return { ok: true, value: 'WITH_RESULT' };
  return { ok: false, error: "callbackPayload must be null or 'WITH_RESULT'" };
}

/** fileUrlDefaultChunks: integer 1..1000, or null to clear. */
export function validateFileUrlDefaultChunks(value: unknown): ValidationResult<number | null> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1000) {
    return { ok: false, error: 'fileUrlDefaultChunks must be an integer between 1 and 1000, or null' };
  }
  return { ok: true, value };
}
