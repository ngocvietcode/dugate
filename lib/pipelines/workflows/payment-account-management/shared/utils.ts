// lib/pipelines/workflows/payment-account-management/shared/utils.ts
// Shared low-level utilities for all payment-account-management modes.

import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { getStorageBackend } from '@/lib/storage';
import type { FieldSpec, FieldType, FieldValue } from './schemas';
import { fieldTypeOf } from './schemas';

/**
 * Read a file buffer from the storage backend into memory.
 * Handles both local filesystem paths and S3 keys transparently.
 * Downloads into a per-operation tmp dir to avoid cross-operation collisions.
 */
export async function readFileBuffer(filePath: string, operationId: string): Promise<Buffer> {
  const backend = await getStorageBackend();
  const tmpDir = path.join(os.tmpdir(), 'dugate', operationId);
  const localPath = await backend.downloadToTempFile(filePath, tmpDir);
  return fsPromises.readFile(localPath);
}

/** Lowercase file extension including the dot. Empty string when no extension. */
export function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx < 0) return '';
  return fileName.slice(idx).toLowerCase();
}

/**
 * Remove Vietnamese diacritics, turning accented text into plain ASCII.
 * Example: "CỤC TRƯỞNG CỤC CẢNH SÁT" -> "CUC TRUONG CUC CANH SAT".
 *
 * Case is preserved (unlike the filename-safe helpers elsewhere): "Đ" -> "D",
 * "đ" -> "d". We handle đ/Đ explicitly because Unicode NFD does not decompose
 * them into a base letter + a combining mark.
 */
export function removeVietnameseDiacritics(text: string): string {
  return text
    .normalize('NFD')                     // split accented letters into base + accent mark
    .replace(/[̀-ͯ]/g, '')      // drop the combining accent marks
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

// ─── Field confidence (per-field extraction confidence) ────────────────────────

/** Keep a number within [0, 1]; non-numbers become 0. */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// Matches a trailing " ⟨conf:0.95⟩" marker. End-anchored so a stray ⟨ mid-value
// (e.g. inside an address) cannot false-match — only the final marker is stripped.
const CONF_MARKER = /\s*⟨conf:([0-9.]+)⟩\s*$/;

/**
 * Split ONE AI leaf value into its clean value + confidence. Handles only the
 * scalar cases; containers are the caller's job (see parseFieldConfidence).
 *   "Nguyễn Văn A ⟨conf:0.95⟩" → { value: "Nguyễn Văn A", confidence: 0.95 }
 *
 * The marker text is LLM-generated, so this NEVER throws and defends against
 * malformed output:
 *   - non-string (number/boolean)       → { value: raw,  confidence: null }
 *   - no marker                         → { value: raw,  confidence: null }
 *   - marker with an unparseable number → { value: raw,  confidence: null }
 *     (e.g. "⟨conf:0.9.9⟩", "⟨conf:...⟩"): keep the value INTACT and report
 *     unknown confidence rather than stripping it and inventing a bogus 0.
 *   - valid number                      → strip marker, clamp confidence to 0..1
 */
function parseScalarConfidence(raw: unknown): FieldValue {
  if (typeof raw !== 'string') return { value: raw, confidence: null };
  const m = raw.match(CONF_MARKER);
  if (!m) return { value: raw, confidence: null };
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return { value: raw, confidence: null };
  return { value: raw.replace(CONF_MARKER, ''), confidence: clamp01(n) };
}

/**
 * Parse a `string[]` field into ONE field-level FieldValue.
 *
 * A JSON array cannot carry a trailing ⟨conf:…⟩ marker of its own (a marker after
 * the closing `]` would not parse), so the prompt asks the model to mark each
 * ELEMENT. Confidence is per-field for these, not per-value, so we strip every
 * element's marker and average them into a single number:
 *
 *   ["Quản lý dòng tiền ⟨conf:0.95⟩", "Nhận lương ⟨conf:0.89⟩"]
 *     → { value: ["Quản lý dòng tiền", "Nhận lương"], confidence: 0.92 }
 *
 * "No data" is reported as a bare null — the same shape parseFieldConfidence
 * already returns for a field the model sent as null, so a blank checkbox group
 * reads exactly like any other absent field. The prompt asks for null directly;
 * an empty array from the model is normalized to it here. Returning
 * { value: null } instead would give "no data" two shapes to handle.
 *
 * confidence is null when there is nothing to average (no data, or a model that
 * returned no markers at all). That matches how every other unmarked value is
 * reported rather than inventing a score.
 *
 * Non-string elements are kept as-is and contribute no confidence.
 */
function parseStringArrayConfidence(raw: unknown[]): FieldValue | null {
  // No data → bare null, exactly like a field the model returned as null.
  // NOT { value: null } — that would give "no data" two different shapes.
  if (raw.length === 0) return null;
  const values: unknown[] = [];
  const confidences: number[] = [];
  for (const el of raw) {
    const parsed = parseScalarConfidence(el);
    values.push(parsed.value);
    if (parsed.confidence !== null) confidences.push(parsed.confidence);
  }
  // Rounded to 2dp: the average of two markers is otherwise a long float
  // (0.95 + 0.89) / 2 → 0.9199999999999999, which reads as false precision.
  const confidence =
    confidences.length > 0
      ? clamp01(
          Math.round(
            (confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100,
          ) / 100,
        )
      : null;
  return { value: values, confidence };
}

/**
 * Recursively parse an AI-extracted field into a value + confidence structure.
 *
 * Confidence markers only ever appear on scalar STRING leaves, so we recurse
 * through arrays and objects and wrap the leaves — the container shape is kept
 * intact. This is what makes array-of-object and nested-object fields (e.g.
 * "legal_representatives") come out with per-leaf { value, confidence } instead
 * of the whole blob stuffed into one value with markers left embedded.
 *
 * Shape rules:
 *   - string        → { value, confidence }        (marker stripped)
 *   - number/boolean→ { value, confidence: null }  (never carries a marker)
 *   - null          → null                         (kept as-is, not wrapped)
 *   - array         → array of parsed elements      (container NOT wrapped)
 *   - object        → object of parsed fields       (container NOT wrapped)
 *
 * Because containers are returned unwrapped, a top-level scalar field still ends
 * up wrapped (it hits the scalar branch), while a top-level array/object field
 * comes back as a plain array/object of wrapped leaves.
 *
 * EXCEPTION — `fieldType: 'string[]'`: confidence on a list of ticked checkbox
 * labels is a property of the FIELD, not of each label, so such a field is
 * wrapped as ONE { value: string[], confidence } with the element markers
 * averaged, or bare null when nothing was ticked (see
 * parseStringArrayConfidence). Callers pass the declared type from the schema;
 * omitting it keeps the original shape-agnostic behavior.
 *
 * This function is a hard boundary: it must NEVER throw, so a malformed field can
 * never abort a document's extraction.
 */
export function parseFieldConfidence(
  raw: unknown,
  fieldType?: FieldType,
): unknown {
  try {
    // null → keep literal null (do not wrap).
    if (raw === null) return null;

    if (Array.isArray(raw)) {
      // string[] → ONE field-level wrapper, element markers averaged.
      if (fieldType === 'string[]') return parseStringArrayConfidence(raw);
      // Any other array → recurse each element; container stays a plain array.
      return raw.map((el) => parseFieldConfidence(el));
    }

    // Plain object → recurse each field; container stays a plain object.
    // Sub-keys whose value is an array of strings (a checkbox array inside a
    // person/record block) are treated as string[] automatically — the schema
    // only stores types at the top-level FieldSpec, not inside recordLabels,
    // so we infer the type from the shape: [string, string, ...] === string[].
    if (typeof raw === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (v !== null && Array.isArray(v) && v.every((el) => typeof el === 'string')) {
          // Sub-key is an array of strings → same path as a top-level string[] field.
          out[k] = parseFieldConfidence(v, 'string[]');
        } else {
          out[k] = parseFieldConfidence(v);
        }
      }
      return out;
    }

    // A string[] field that came back as a plain string — the model fell back to
    // the older "join the ticked labels with ;" format. Recover it by splitting
    // rather than failing the field: the marker sits at the end of the whole
    // string, so strip it first, then split, then re-wrap at field level.
    if (fieldType === 'string[]' && typeof raw === 'string') {
      const { value, confidence } = parseScalarConfidence(raw);
      const text = typeof value === 'string' ? value : '';
      const parts = text
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      // "" / ";;" carry no data → bare null, same as an empty array.
      if (parts.length === 0) return null;
      return { value: parts, confidence };
    }

    // Scalar leaf (string / number / boolean) → wrap as { value, confidence }.
    return parseScalarConfidence(raw);
  } catch {
    // Anything unexpected → keep the raw value, unknown confidence.
    return { value: raw, confidence: null };
  }
}

/** Read the underlying value from a FieldValue wrapper; pass through raw values unchanged. */
export function unwrap(v: unknown): unknown {
  if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
    return (v as FieldValue).value;
  }
  return v;
}

// ─── Type validation (extraction shape check, runs BEFORE parseFieldConfidence) ─

/**
 * Short human-readable description of a runtime JSON value's type — used in
 * validator error messages so the LLM sees exactly what shape it returned.
 * Distinguishes null / array / plain object / scalar since `typeof` alone
 * cannot tell array vs object.
 */
function describeRuntimeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Verify ONE extracted value matches its declared FieldType. Returns null when
 * the shape is correct, or a short human-readable reason when it is not.
 *
 * This is a SHAPE-ONLY check — value semantics (e.g. is the date well-formed,
 * is the number positive) are the caller's concern. Confidence markers on
 * string leaves are ignored: a string carrying "⟨conf:0.9⟩" still validates
 * as a string.
 *
 * `null` and missing keys are ALWAYS valid — the schema convention is
 * "field absent → null" and every type accepts that.
 *
 * The extract retry loop calls this BEFORE parseFieldConfidence so a type
 * mismatch surfaces as a retryable error (with the offending field named)
 * instead of silently producing garbage-shaped output.
 */
export function validateFieldType(
  value: unknown,
  fieldType: FieldType,
): string | null {
  if (value === null || value === undefined) return null;

  switch (fieldType) {
    case 'string':
    case 'date':
      return typeof value === 'string'
        ? null
        : `expected string, got ${describeRuntimeType(value)}`;

    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : `expected number, got ${describeRuntimeType(value)}`;

    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : `expected boolean, got ${describeRuntimeType(value)}`;

    case 'string[]': {
      if (!Array.isArray(value)) {
        return `expected array of strings, got ${describeRuntimeType(value)}`;
      }
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'string') {
          return `expected array of strings, but element ${i} is ${describeRuntimeType(value[i])}`;
        }
      }
      return null;
    }

    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        return `expected object, got ${describeRuntimeType(value)}`;
      }
      return null;
    }

    case 'object[]': {
      if (!Array.isArray(value)) {
        return `expected array of objects, got ${describeRuntimeType(value)}`;
      }
      for (let i = 0; i < value.length; i++) {
        const el = value[i];
        if (typeof el !== 'object' || el === null || Array.isArray(el)) {
          return `expected array of objects, but element ${i} is ${describeRuntimeType(el)}`;
        }
      }
      return null;
    }
  }
}

/**
 * One field-level type-mismatch violation, formatted so the retry error
 * message can render it verbatim to the LLM.
 * - `key`     — the declared field key (e.g. "legal_representatives")
 * - `expected`— the declared FieldType (e.g. "object[]")
 * - `reason`  — the shape mismatch (e.g. `expected array of objects, got string`)
 */
export interface TypeViolation {
  key: string;
  expected: FieldType;
  reason: string;
}

/**
 * Walk every declared field on a schema group / single-call schema and check
 * that the parsed JSON value matches the declared type. Returns the list of
 * violations (empty when everything is correctly shaped).
 *
 * Missing keys are NOT violations — a field the LLM omitted is treated as null,
 * which is always valid. Extra keys the LLM invented are also not violations
 * here: the engine filters unknown keys via its `allowed` set separately.
 *
 * Called from runExtractCallWithRetry after parseExtractedObject succeeds and
 * BEFORE parseFieldConfidence; when violations exist, the engine throws a
 * dedicated `EXTRACT_TYPE_MISMATCH: …` error that the retry loop feeds back to
 * the LLM so it can self-correct.
 */
export function validateExtractedTypes(
  parsed: Record<string, unknown>,
  aiFields: readonly FieldSpec[],
): TypeViolation[] {
  const violations: TypeViolation[] = [];
  for (const f of aiFields) {
    if (!(f.key in parsed)) continue; // omitted key → treated as null → ok
    const declared = fieldTypeOf(f);
    const reason = validateFieldType(parsed[f.key], declared);
    if (reason !== null) violations.push({ key: f.key, expected: declared, reason });
  }
  return violations;
}

/** Sentinel prefix on the retry-error message so the retry loop can detect
 *  a type-mismatch failure and use a specifically tailored correction prompt. */
export const EXTRACT_TYPE_MISMATCH_ERROR_PREFIX = 'EXTRACT_TYPE_MISMATCH: ';

/**
 * Render a list of `TypeViolation`s into the string that goes into the
 * `EXTRACT_TYPE_MISMATCH: …` error thrown by the retry loop.
 *
 *   [
 *     { key: 'legal_representatives', expected: 'object[]', reason: 'expected array of objects, got string' },
 *     { key: 'residency_status',      expected: 'string[]', reason: 'expected array of strings, got string' },
 *   ]
 *     → `legal_representatives (type=object[]): expected array of objects, got string; residency_status (type=string[]): expected array of strings, got string`
 */
export function formatTypeViolations(violations: TypeViolation[]): string {
  return violations
    .map((v) => `${v.key} (type=${v.expected}): ${v.reason}`)
    .join('; ');
}
