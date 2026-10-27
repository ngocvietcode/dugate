// lib/reference-extract.ts
// Extract a client-meaningful reference value from request form-data,
// based on admin-configured `referenceExtract` field in ProfileEndpoint.
//
// This allows Ops team to search operations by business identifiers
// (e.g. deal_id, case_id) without requiring integration systems to change.
//
// Supported config formats:
//   "deal_id"              → simple form field value
//   "_filename"            → name of the first uploaded file
//   "data.case_id"         → nested JSON path (parse "data" field, then extract "case_id")
//   "process/deal_id"      → combine multiple fields joined by "/"

const MAX_REFERENCE_LENGTH = 500;

/**
 * Extract client reference from form-data based on profile config.
 * Returns null if no config, field not found, or any parse error.
 * NEVER throws — safe to call in any request path.
 */
export function extractClientReference(
  form: FormData,
  files: File[],
  config: string | null | undefined,
): string | null {
  if (!config || !config.trim()) return null;

  try {
    const trimmed = config.trim();
    let result: string | null = null;

    // Case 3: Special keyword "_filename" → first uploaded file name
    if (trimmed === '_filename') {
      result = files.length > 0 ? files[0].name : null;
    }
    // Case 4: Multi-field template "field1/field2" (contains "/" but not in a JSON path like "a.b/c")
    else if (trimmed.includes('/') && !trimmed.includes('.')) {
      result = extractMultiField(form, files, trimmed);
    }
    // Case 4b: Multi-field with nested paths "process/data.case_id"
    else if (trimmed.includes('/')) {
      result = extractMultiField(form, files, trimmed);
    }
    // Case 2: Nested JSON path "reference_data.kondor_id"
    else if (trimmed.includes('.')) {
      result = extractNestedJson(form, trimmed);
    }
    // Case 1: Simple field name "deal_id"
    else {
      const val = form.get(trimmed);
      result = val && typeof val === 'string' ? val.trim() : null;
    }

    // Truncate to prevent storing excessively large values
    if (result && result.length > MAX_REFERENCE_LENGTH) {
      result = result.substring(0, MAX_REFERENCE_LENGTH);
    }

    return result || null;
  } catch {
    // NEVER throw — return null on any unexpected error
    return null;
  }
}

/**
 * Extract a value from a nested JSON field.
 * e.g. path = "reference_data.kondor_id"
 *   → form.get("reference_data") = '{"kondor_id": 12345}'
 *   → return "12345"
 */
function extractNestedJson(form: FormData, path: string): string | null {
  const [field, ...keys] = path.split('.');
  const raw = form.get(field);
  if (!raw || typeof raw !== 'string') return null;

  try {
    let obj: unknown = JSON.parse(raw);
    for (const key of keys) {
      if (obj == null || typeof obj !== 'object') return null;
      obj = (obj as Record<string, unknown>)[key];
    }
    return obj != null ? String(obj).trim() : null;
  } catch {
    // JSON parse failed — field value is not JSON, treat as plain text
    return null;
  }
}

/**
 * Extract and combine multiple fields separated by "/".
 * e.g. config = "process/deal_id"
 *   → form.get("process") = "disbursement", form.get("deal_id") = "FX-001"
 *   → return "disbursement/FX-001"
 *
 * Each segment can be:
 *   - A simple field name
 *   - "_filename" keyword
 *   - A nested JSON path (contains ".")
 */
function extractMultiField(form: FormData, files: File[], config: string): string | null {
  const segments = config.split('/');
  const values: string[] = [];

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    let val: string | null = null;

    if (trimmed === '_filename') {
      val = files.length > 0 ? files[0].name : null;
    } else if (trimmed.includes('.')) {
      val = extractNestedJson(form, trimmed);
    } else {
      const formVal = form.get(trimmed);
      val = formVal && typeof formVal === 'string' ? formVal.trim() : null;
    }

    if (val) {
      values.push(val);
    }
  }

  return values.length > 0 ? values.join('/') : null;
}
