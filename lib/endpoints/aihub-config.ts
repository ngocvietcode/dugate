// lib/endpoints/aihub-config.ts
// Pure (React-free) serialize/parse helpers for the API_Connection_UI.
//
// These functions translate between a persisted ExternalApiConnection record and
// the editable form state used by app/api-connections/page.tsx. Keeping them pure
// lets them be unit / property tested without rendering React.
//
// Core invariant (backward compatibility): AIHub mode is signalled ONLY by the
// Mode_Marker ("X-Connection-Mode": "AIHUB") in `extraHeaders`. A connection
// without that marker ALWAYS round-trips as a legacy multipart connection.

import { isAiHubMode } from '@/lib/endpoints/json-body-helper';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Connection send mode — derived from extraHeaders on load, defaults to MULTIPART. */
export type ConnectionMode = 'MULTIPART' | 'AIHUB';

/** A single key/value entry as edited in the static-fields / extra-headers editors. */
export interface StaticField {
  key: string;
  value: string;
}

/** The editable base connection fields (mirrors Omit<Connection, 'id'> in the UI). */
export interface ConnectionFormFields {
  name: string;
  slug: string;
  description: string | null;
  endpointUrl: string;
  httpMethod: string;
  authType: string;
  authKeyHeader: string;
  authSecret: string;
  vaultSecretPath: string | null;
  promptFieldName: string;
  fileFieldName: string;
  defaultPrompt: string;
  staticFormFields: string | null;
  extraHeaders: string | null;
  responseContentPath: string | null;
  sessionIdResponsePath: string | null;
  sessionIdFieldName: string | null;
  timeoutSec: number;
  state: string;
}

/** The AIHub-specific field values surfaced in the UI when in AIHUB mode. */
export interface AiHubFormFields {
  model: string;
  systemMessage: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
  /**
   * OpenAI-compatible `reasoning_effort` (minimal | low | medium | high).
   * Empty string = omit the field entirely (for models that don't support it).
   */
  reasoningEffort: string;
}

/**
 * Allowed OpenAI-compatible `reasoning_effort` values. Empty string means the
 * field is omitted from the request body (default for non-reasoning models).
 */
export const REASONING_EFFORT_VALUES = ['', 'minimal', 'low', 'medium', 'high'] as const;
export type ReasoningEffort = typeof REASONING_EFFORT_VALUES[number];

/** Normalize an arbitrary value to a valid reasoning_effort (else empty). */
export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (REASONING_EFFORT_VALUES as readonly string[]).includes(v) ? (v as ReasoningEffort) : '';
}

/**
 * Validate a reasoning_effort OVERRIDE value coming from an API request.
 * Accepts null / undefined / '' (meaning "no override") or a valid enum value.
 * Used by the override APIs to reject bad input with a 400.
 */
export function isValidReasoningEffortOverride(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value !== 'string') return false;
  return (REASONING_EFFORT_VALUES as readonly string[]).includes(value.trim().toLowerCase());
}

/** Result of parsing a connection record into editable form state. */
export interface ParsedConnectionForm {
  mode: ConnectionMode;
  staticFields: StaticField[];
  extraHeadersList: StaticField[];
  aihub: AiHubFormFields;
}

/** Full editable form snapshot consumed by buildPayloadFromForm. */
export interface SaveFormInput {
  form: ConnectionFormFields;
  staticFields: StaticField[];
  extraHeadersList: StaticField[];
  aihubModel: string;
  aihubSystemMessage: string;
  aihubUserMessage: string;
  aihubMaxTokens: number;
  aihubTemperature: number;
  aihubReasoningEffort: string;
}

/** Default max_tokens used when none is configured / value is invalid. */
export const DEFAULT_MAX_TOKENS = 4096;

// AIHub field keys persisted inside `staticFormFields`.
const KEY_MODEL = 'model';
const KEY_SYSTEM_PROMPT = 'system_prompt';
const KEY_USER_PROMPT = 'user_prompt';
const KEY_MAX_TOKENS = 'max_tokens';
const KEY_TEMPERATURE = 'temperature';
const KEY_REASONING_EFFORT = 'reasoning_effort';

// ─── Mode detection ───────────────────────────────────────────────────────────

/**
 * Detect connection mode from the (JSON string) `extraHeaders`.
 * Wraps isAiHubMode: presence of Mode_Marker "X-Connection-Mode":"AIHUB" → AIHUB,
 * otherwise (empty / unparseable / no marker) → MULTIPART.
 */
export function detectMode(extraHeaders: string | null): ConnectionMode {
  return isAiHubMode(extraHeaders) ? 'AIHUB' : 'MULTIPART';
}

// ─── Parse: connection record → editable form state ─────────────────────────

/**
 * Parse a persisted connection record into editable form state.
 *
 * - `staticFields` / `extraHeadersList` are decoded from their JSON columns.
 * - When the record is in AIHUB mode, the AIHub field values are pulled from
 *   `staticFormFields` (model / system_prompt / user_prompt / max_tokens).
 * - When not in AIHUB mode, AIHub fields reset to their defaults.
 */
export function parseConnectionToForm(connection: {
  extraHeaders: string | null;
  staticFormFields: string | null;
}): ParsedConnectionForm {
  const staticFields = parseStaticFieldsArray(connection.staticFormFields);
  const mode = detectMode(connection.extraHeaders);
  const extraHeadersList = parseHeadersToList(connection.extraHeaders);

  let aihub: AiHubFormFields;
  if (mode === 'AIHUB') {
    const findField = (key: string) => staticFields.find(f => f.key === key)?.value ?? '';
    const mt = Number(findField(KEY_MAX_TOKENS));
    aihub = {
      model: findField(KEY_MODEL),
      systemMessage: findField(KEY_SYSTEM_PROMPT),
      userMessage: findField(KEY_USER_PROMPT),
      maxTokens: Number.isInteger(mt) && mt > 0 ? mt : DEFAULT_MAX_TOKENS,
      temperature: isNaN(Number(findField(KEY_TEMPERATURE))) ? 0 : Number(findField(KEY_TEMPERATURE)),
      reasoningEffort: normalizeReasoningEffort(findField(KEY_REASONING_EFFORT)),
    };
  } else {
    aihub = { model: '', systemMessage: '', userMessage: '', maxTokens: DEFAULT_MAX_TOKENS, temperature: 0, reasoningEffort: '' };
  }

  return { mode, staticFields, extraHeadersList, aihub };
}

// ─── Serialize: editable form state → persistable payload ────────────────────

/**
 * Build the payload sent to Connection_API from the current editable form state.
 *
 * AIHUB mode:
 *   - writes the Mode_Marker + "Content-Type: application/json" into `extraHeaders`
 *   - stores model / system_prompt / user_prompt / max_tokens into `staticFormFields`
 *   - generates a JSON Chat_Completion_Body template into `defaultPrompt`
 *     (a role:"system" entry is only included when System_Message is non-empty)
 *   - keeps `responseContentPath`
 *
 * MULTIPART mode (incl. AIHUB → MULTIPART conversion):
 *   - strips the Mode_Marker and "Content-Type: application/json" from `extraHeaders`
 *   - otherwise produces the exact same legacy multipart payload as before
 */
export function buildPayloadFromForm(input: SaveFormInput, mode: ConnectionMode): ConnectionFormFields {
  const { form, staticFields, extraHeadersList, aihubModel, aihubSystemMessage, aihubUserMessage, aihubMaxTokens, aihubTemperature, aihubReasoningEffort } = input;

  if (mode === 'AIHUB') {
    const reasoningEffort = normalizeReasoningEffort(aihubReasoningEffort);
    const aihubStaticFields: StaticField[] = [
      { key: KEY_MODEL, value: aihubModel },
      { key: KEY_SYSTEM_PROMPT, value: aihubSystemMessage },
      { key: KEY_USER_PROMPT, value: aihubUserMessage },
      { key: KEY_MAX_TOKENS, value: String(aihubMaxTokens) },
      { key: KEY_TEMPERATURE, value: String(aihubTemperature) },
    ];
    // reasoning_effort is optional: only persist it when a value is chosen, so
    // models that don't support it never receive the field.
    if (reasoningEffort) {
      aihubStaticFields.push({ key: KEY_REASONING_EFFORT, value: reasoningEffort });
    }

    // Start from the current headers, then ensure the AIHub markers are present.
    const headersObj = listToHeadersObj(extraHeadersList);
    headersObj['Content-Type'] = 'application/json';
    headersObj['X-Connection-Mode'] = 'AIHUB';

    return {
      ...form,
      promptFieldName: KEY_USER_PROMPT,
      defaultPrompt: buildAiHubTemplate(aihubSystemMessage, reasoningEffort),
      staticFormFields: JSON.stringify(aihubStaticFields),
      extraHeaders: JSON.stringify(headersObj),
    };
  }

  // ── MULTIPART (legacy) — preserve exact existing behavior, minus AIHub markers ──
  const headersObj = stripModeMarkers(listToHeadersObj(extraHeadersList));

  return {
    ...form,
    staticFormFields: staticFields.length > 0 ? JSON.stringify(staticFields) : null,
    extraHeaders: Object.keys(headersObj).length > 0 ? JSON.stringify(headersObj) : null,
  };
}

/**
 * Build the JSON Chat_Completion_Body template stored in `defaultPrompt`.
 * Uses {{model}}, {{user_prompt}}, {{max_tokens}} markers consistent with
 * buildJsonBody; the {{system_prompt}} role:"system" entry is only emitted when
 * the System Message is non-empty. The OpenAI-compatible `reasoning_effort`
 * field is only emitted when a value is provided.
 */
export function buildAiHubTemplate(systemMessage: string, reasoningEffort = ''): string {
  const messages: string[] = [];
  if (systemMessage.trim()) {
    messages.push('{"role":"system","content":"{{system_prompt}}"}');
  }
  messages.push('{"role":"user","content":"{{user_prompt}}"}');
  const reasoning = normalizeReasoningEffort(reasoningEffort)
    ? ',"reasoning_effort":"{{reasoning_effort}}"'
    : '';
  return `{"model":"{{model}}","messages":[${messages.join(',')}],"max_tokens":{{max_tokens}},"temperature":{{temperature}}${reasoning}}`;
}

// ─── Effective prompt resolution (for UI display / override baseline) ─────────

/** Human-facing prompt of a connection, resolved per mode. */
export interface ResolvedConnectionPrompt {
  mode: ConnectionMode;
  /**
   * The prompt a per-endpoint promptOverride replaces at runtime.
   * - MULTIPART: the connector's `defaultPrompt` (the whole template).
   * - AIHUB: the `user_prompt` static field (runAiHubBranch resolves the user
   *   message as _prompt > promptOverride > user_prompt).
   */
  effectivePrompt: string;
  /** AIHub `system_prompt` (read-only context). Empty string in MULTIPART mode. */
  systemPrompt: string;
}

/**
 * Resolve the human-facing prompt of a connection for display/editing in the UI.
 *
 * In AIHUB mode the connector's `defaultPrompt` only stores the JSON chat-body
 * wrapper (`{{system_prompt}}` / `{{user_prompt}}` placeholders); showing that as
 * the "default prompt" is misleading. The real editable prompt lives in the
 * `system_prompt` / `user_prompt` static fields — this helper surfaces them so the
 * profile UI and connector test can present/seed the correct prompt.
 */
export function resolveConnectionPrompt(connection: {
  extraHeaders: string | null;
  staticFormFields: string | null;
  defaultPrompt: string | null;
}): ResolvedConnectionPrompt {
  const { mode, aihub } = parseConnectionToForm({
    extraHeaders: connection.extraHeaders,
    staticFormFields: connection.staticFormFields,
  });
  if (mode === 'AIHUB') {
    return { mode, effectivePrompt: aihub.userMessage ?? '', systemPrompt: aihub.systemMessage ?? '' };
  }
  return { mode, effectivePrompt: connection.defaultPrompt ?? '', systemPrompt: '' };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Decode the `staticFormFields` JSON-array column into a normalized StaticField[]. */
function parseStaticFieldsArray(raw: string | null): StaticField[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is { key: unknown; value?: unknown } => !!e && typeof e === 'object' && typeof (e as { key: unknown }).key === 'string')
      .map(e => ({
        key: String(e.key),
        value: typeof e.value === 'string' ? e.value : String(e.value ?? ''),
      }));
  } catch {
    return [];
  }
}

/** Decode the `extraHeaders` JSON-object column into an editable StaticField[]. */
function parseHeadersToList(raw: string | null): StaticField[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.entries(parsed).map(([k, v]) => ({ key: k, value: String(v) }));
  } catch {
    return [];
  }
}

/** Collapse an editable header list into a header object, dropping blank keys. */
function listToHeadersObj(list: StaticField[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const h of list) {
    if (h.key.trim()) obj[h.key.trim()] = h.value;
  }
  return obj;
}

/**
 * Remove the AIHub markers from a header object during an AIHUB → MULTIPART save.
 *
 * The "Content-Type: application/json" marker is only stripped when the
 * "X-Connection-Mode" marker is also present (i.e. the connection was previously
 * AIHUB). This guarantees a genuine legacy multipart connection — which never
 * carries the Mode_Marker — round-trips byte-for-byte unchanged (Property 6),
 * even if it happens to carry a coincidental Content-Type header.
 */
function stripModeMarkers(obj: Record<string, string>): Record<string, string> {
  const hasMarker = Object.keys(obj).some(k => k.toLowerCase() === 'x-connection-mode');
  if (!hasMarker) return obj;

  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const lk = k.toLowerCase();
    if (lk === 'x-connection-mode') continue;
    if (lk === 'content-type' && v.toLowerCase().includes('application/json')) continue;
    result[k] = v;
  }
  return result;
}
