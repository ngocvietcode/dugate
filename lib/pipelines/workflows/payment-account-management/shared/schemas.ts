// lib/pipelines/workflows/payment-account-management/shared/schemas.ts
// Extraction-schema FRAMEWORK shared across all payment-account-management modes.
//
// Each document type (identified by its `code`) has a different set of fields to
// extract. A mode declares one ExtractSchema per code, then the extractor uses it
// to (1) build the AI prompt and (2) shape/validate the JSON output.
//
// This file is intentionally domain-neutral — it defines the SHAPE of a schema,
// not the fields of any specific document. The concrete field lists (e.g. for
// can_cuoc_cong_dan) live inside the mode folder, per the shared-folder rule.

/**
 * One extracted field: the value plus the LLM's confidence (0..1) that it is correct.
 * confidence is null when no ⟨conf:x⟩ marker was present on the value; code-injected
 * fixed fields set confidence to 1 explicitly (they are certain, not AI-read).
 */
export interface FieldValue {
  value: unknown;
  confidence: number | null;
}

/**
 * The data type of an extracted field's value.
 *
 * Naming follows JSON Schema vocabulary so the prompt can state the type in the
 * form an LLM is most likely to have seen, with two additions:
 *   - 'date'   is a string constrained to DD/MM/YYYY — declared separately so the
 *              prompt can state the format once instead of per-field prose.
 *   - the `[]` suffix forms are flattened rather than nested ({type:'array',
 *              items:…}) to keep the dense schema files greppable and one line
 *              per field.
 *
 * 'object' is a SINGLE record (e.g. the DKKD `owner` block); 'object[]' is a
 * repeating list (e.g. `legal_representatives`). Both use `recordLabels` to name
 * their sub-keys.
 */
export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'string[]'
  | 'object'
  | 'object[]';

/**
 * One field the AI must extract from the document.
 * - key:          the JSON key in the output (e.g. "id_no")
 * - desc:         a short instruction telling the AI what to read for this field
 * - label:        the Vietnamese, user-facing label to show in the UI (required
 *                 — every field must be nameable to a reviewer). Falling back to
 *                 `key` is done at the lookup helper, never here, so a missing
 *                 label surfaces as a compile error rather than an ugly UI.
 * - type:         the value's data type. OPTIONAL and defaults to 'string' — the
 *                 vast majority of fields are plain strings, so only the ones
 *                 that are not need to say so. Read it through `fieldTypeOf`
 *                 rather than the raw property so the default is applied in one
 *                 place.
 * - enum:         the closed set of values this field can take, when there is
 *                 one. For a single-choice checkbox group ('string') the value is
 *                 one of these; for a multi-choice group ('string[]') every array
 *                 element is one of these. Declaring the options here rather than
 *                 spelling them out in `desc` lets the prompt render them
 *                 consistently and gives a downstream validator something to
 *                 check against. Omit for free-text fields.
 * - recordLabels: when the field's extracted value is an ARRAY OF RECORDS (e.g.
 *                 "legal_representatives" → one object per person), this maps
 *                 each sub-key inside a record to its own display label. Only
 *                 meaningful on 'object' / 'object[]' fields; omit for scalars.
 */
export interface FieldSpec {
  key: string;
  desc: string;
  label: string;
  type?: FieldType;
  enum?: string[];
  recordLabels?: Record<string, string>;
}

/**
 * The declared type of a field, applying the 'string' default in ONE place so
 * callers never have to repeat `f.type ?? 'string'`.
 */
export function fieldTypeOf(f: FieldSpec): FieldType {
  return f.type ?? 'string';
}

/**
 * One hard-coded field that is NOT read from the document but injected by code
 * with a fixed value (e.g. a standard issuing-authority line).
 * - key:   the JSON key in the output
 * - value: the constant value to set
 * - label: the Vietnamese, user-facing label to show in the UI
 */
export interface FixedField {
  key: string;
  value: string;
  label: string;
}

/**
 * Full extraction schema for one document code.
 * - aiFields:    fields the AI extracts from the file
 * - fixedFields: fields the code fills in with constant values (optional)
 */
export interface ExtractSchema {
  aiFields: FieldSpec[];
  fixedFields?: FixedField[];
}

/**
 * A registry mapping document code -> its extraction schema.
 * A value of `null` means the code is known (from classification) but its schema
 * is not defined yet — a placeholder we can fill in later.
 *
 * The value is `AnyExtractSchema` so a code may be either a single-call schema
 * (the common case) or a multi-call schema (large forms — see MB02). The
 * extractor picks the code path via `isMultiCallSchema`.
 */
export type ExtractSchemaRegistry = Record<string, AnyExtractSchema | null>;

/**
 * Look up the schema for a code. Returns undefined when the code has no schema
 * yet — either it is absent from the registry, or present as a `null` placeholder.
 * Callers can treat "no schema" as a single case (skip extraction gracefully).
 */
export function getExtractSchema(
  registry: ExtractSchemaRegistry,
  code: string,
): AnyExtractSchema | undefined {
  return registry[code] ?? undefined;
}

/**
 * Build the object of hard-coded fields for a schema.
 * Returns {} when the schema declares none. Works for both single- and multi-
 * call schemas — `fixedFields` sits at the top level on both shapes.
 */
export function buildFixedFields(schema: AnyExtractSchema): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of schema.fixedFields ?? []) {
    out[f.key] = f.value;
  }
  return out;
}

/**
 * Look up the display label for a top-level field key. Searches every AI field
 * (across all groups on a multi-call schema) plus `fixedFields`, and falls back
 * to the raw key when the schema is missing or the key is unknown — so backend
 * consumers can render something sensible even for legacy data.
 *
 * The frontend keeps its OWN duplicate label map (see
 * `app/payment-account-management/components/field-labels.ts`) to avoid a
 * cross-layer import; both maps intentionally live side-by-side.
 */
export function fieldLabelFor(
  schema: AnyExtractSchema | undefined,
  key: string,
): string {
  if (!schema) return key;
  const ai = allAiFields(schema).find((f) => f.key === key);
  if (ai) return ai.label;
  const fx = schema.fixedFields?.find((f) => f.key === key);
  if (fx) return fx.label;
  return key;
}

/**
 * Look up the display label for a sub-key inside a repeating-list field's
 * record. E.g. `recordLabelFor(MB01, 'legal_representatives', 'full_name')`
 * → 'Họ và tên'. Falls back to the raw sub-key when unmapped.
 *
 * Works for both single- and multi-call schemas — the parent field is located
 * via `allAiFields`, which flattens groups when present.
 */
export function recordLabelFor(
  schema: AnyExtractSchema | undefined,
  parentKey: string,
  key: string,
): string {
  const parent = schema
    ? allAiFields(schema).find((f) => f.key === parentKey)
    : undefined;
  return parent?.recordLabels?.[key] ?? key;
}

// ─── Multi-call schemas ────────────────────────────────────────────────────────
// Large forms (e.g. MB02, ~85 top-level fields plus 4 repeating people lists)
// hit quality issues when the extractor has to fill everything in a single LLM
// call. A multi-call schema splits its fields into named GROUPS; the extraction
// engine issues one call per group in parallel and merges the results (field
// keys are unique across groups, guarded by validateGroupKeyUniqueness below).
//
// Design keeps single-call schemas unchanged: ExtractSchema stays exactly as
// declared above. Multi-call schemas use MultiCallExtractSchema, and any helper
// that needs to accept either shape takes the AnyExtractSchema union.
//
// The engine's per-group retry policy lives in extract-engine.ts, not here —
// the schema only describes structure, not runtime behavior.

/**
 * One group inside a MultiCallExtractSchema — extracted with its own LLM call.
 * - name:        internal identifier; appears in logs and per-group error keys.
 *                Human-readable slugs (e.g. "org_and_branch") are recommended.
 * - contextHint: optional single-line hint the prompt inserts to focus the
 *                model on this group's section of the form. Keep it short —
 *                e.g. 'Focus ONLY on Section "I. THÔNG TIN KHÁCH HÀNG"'.
 * - aiFields:    the fields this group's LLM call must return. Combined with
 *                other groups' aiFields, keys must be globally unique on the
 *                schema (checked by validateGroupKeyUniqueness).
 */
export interface ExtractSchemaGroup {
  name: string;
  contextHint?: string;
  aiFields: FieldSpec[];
}

/**
 * Full extraction schema for one document code that is EXTRACTED IN N CALLS.
 * One LLM call per group; results are merged into a single JSON object using
 * plain Object.assign (keys are globally unique across groups).
 *
 * `fixedFields` still lives at the top level — it is injected once after the
 * merge, exactly like on a single-call schema.
 */
export interface MultiCallExtractSchema {
  groups: ExtractSchemaGroup[];
  fixedFields?: FixedField[];
}

/**
 * Either shape of extraction schema. Helpers that accept either take this
 * union; helpers that only make sense for one shape take the concrete type.
 */
export type AnyExtractSchema = ExtractSchema | MultiCallExtractSchema;

/**
 * Type guard: does this schema use per-group extraction?
 * Uses `'groups' in s` so the narrowing works even when the caller passed the
 * union (TypeScript sees both branches).
 */
export function isMultiCallSchema(
  s: AnyExtractSchema,
): s is MultiCallExtractSchema {
  return 'groups' in s;
}

/**
 * Flat view of every AI field on a schema, regardless of shape.
 * On a single-call schema this is just `s.aiFields`; on a multi-call schema
 * it is the concatenation of every group's `aiFields`. Callers that need
 * "all fields at once" (label lookups, output-shape validation, tests) use
 * this and stay shape-agnostic.
 */
export function allAiFields(s: AnyExtractSchema): FieldSpec[] {
  return isMultiCallSchema(s) ? s.groups.flatMap((g) => g.aiFields) : s.aiFields;
}

/**
 * Verify a multi-call schema declares each top-level key in exactly ONE group.
 * The engine merges group outputs with Object.assign, so overlapping keys would
 * silently let one group overwrite another. We surface that at schema-load time
 * instead of at extract-time.
 *
 * Throws with a clear "MULTI_CALL_SCHEMA_INVALID" message that names both
 * offending groups + the duplicate key.
 */
export function validateGroupKeyUniqueness(
  schema: MultiCallExtractSchema,
): void {
  const seen = new Map<string, string>(); // key -> group name that first declared it
  for (const g of schema.groups) {
    for (const f of g.aiFields) {
      const prior = seen.get(f.key);
      if (prior !== undefined) {
        throw new Error(
          `MULTI_CALL_SCHEMA_INVALID: field key "${f.key}" is declared in both ` +
            `group "${prior}" and group "${g.name}". Every field key must appear ` +
            `in exactly one group.`,
        );
      }
      seen.set(f.key, g.name);
    }
  }
}
