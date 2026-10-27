// lib/endpoints/aihub-validation.ts
// Validation for AIHub-mode connection payloads used by Connection_API (POST/PUT).
// Convention: AIHub mode is signalled ONLY by the Mode_Marker
// ("X-Connection-Mode": "AIHUB") in `extraHeaders`. For non-AIHub payloads the
// validator returns null so the existing general validation stays untouched.
//
// The AIHub config (model, user_prompt, max_tokens) is stored in `staticFormFields`
// as a JSON array of { key, value } entries — the same shape buildJsonBody consumes.

import { isAiHubMode } from '@/lib/endpoints/json-body-helper';

interface StaticField {
  key: string;
  value: string;
}

/**
 * Parse the `staticFormFields` column (a JSON array of key/value entries) into a
 * flat key → value map. Returns an empty map when the input is missing or malformed.
 */
function parseStaticFields(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const entry of parsed as StaticField[]) {
      if (entry && typeof entry.key === 'string') {
        result[entry.key] = typeof entry.value === 'string' ? entry.value : '';
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Validate an AIHub-mode connection payload.
 *
 * @returns a Vietnamese error message when the payload is invalid, or `null` when
 *          the payload is valid OR is not an AIHub payload (skip — keep general
 *          validation untouched).
 */
export function validateAiHubPayload(body: {
  extraHeaders?: string | null;
  endpointUrl?: string | null;
  staticFormFields?: string | null;
}): string | null {
  // Not AIHub mode → skip; the existing general validation handles it.
  if (!isAiHubMode(body.extraHeaders ?? null)) return null;

  const sf = parseStaticFields(body.staticFormFields);

  if (!sf.model?.trim()) return 'Model là bắt buộc ở chế độ AIHub';
  if (!sf.user_prompt?.trim()) return 'User Message là bắt buộc ở chế độ AIHub';

  const mt = Number(sf.max_tokens);
  if (!Number.isInteger(mt) || mt <= 0) return 'max_tokens phải là số nguyên dương';

  if (!body.endpointUrl?.trim()) return 'Endpoint URL là bắt buộc ở chế độ AIHub';

  return null;
}
