// app/payment-account-management/components/FieldRenderer.helpers.ts
// Pure helpers backing the FieldRenderer components. Split out from the .tsx
// so unit tests can import them without pulling React/JSX into the test bundle
// (the project's tsconfig uses jsx: "preserve", which Jest can't parse).

/** One scalar leaf produced by `parseFieldConfidence`. */
export type ParsedLeaf = { value: unknown; confidence: number | null };

/**
 * Discriminated union covering every shape a field value can take after
 * `parseFieldConfidence` runs. Every renderer branch dispatches on this.
 */
export type FieldShape =
  | { kind: 'null' }
  | { kind: 'scalar'; leaf: ParsedLeaf }
  | { kind: 'object'; entries: [string, unknown][] }
  | { kind: 'array-of-scalars'; items: unknown[] }
  | { kind: 'array-of-objects'; items: Record<string, unknown>[] }
  | { kind: 'array-empty' }
  /**
   * A `string[]` schema field: ONE wrapper whose `value` is the list and whose
   * `confidence` covers the whole field (the extractor averages the per-element
   * markers). Distinct from `array-of-scalars`, where each item carries its own
   * confidence — here the items are bare strings and the single score is
   * rendered once, next to the field label.
   */
  | { kind: 'string-list'; items: unknown[]; confidence: number | null };

/**
 * True when the value looks like a `parseFieldConfidence` scalar wrapper. We
 * require BOTH `value` and `confidence` to be present — that keeps a plain
 * object that happens to have a `value` key (unlikely but possible in a
 * user-declared schema) from being mistaken for a wrapper.
 */
export function isScalarWrapper(v: unknown): v is ParsedLeaf {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const rec = v as Record<string, unknown>;
  return 'value' in rec && 'confidence' in rec;
}

/**
 * Classify a value into one of six render shapes. Never throws.
 *
 * Array rules:
 *   - empty                                 → array-empty
 *   - any element is a plain record         → array-of-objects
 *   - all elements are scalars/wrappers/null→ array-of-scalars
 * Non-record elements inside a mixed array are coerced to `{ value: x }` so the
 * downstream renderer never has to handle mixed cases.
 */
export function classifyShape(value: unknown): FieldShape {
  if (value === null || value === undefined) return { kind: 'null' };

  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'array-empty' };
    const hasRecord = value.some(
      (el) =>
        el !== null &&
        typeof el === 'object' &&
        !Array.isArray(el) &&
        !isScalarWrapper(el),
    );
    if (hasRecord) {
      const items: Record<string, unknown>[] = value.map((el) =>
        el !== null &&
        typeof el === 'object' &&
        !Array.isArray(el) &&
        !isScalarWrapper(el)
          ? (el as Record<string, unknown>)
          : { value: el },
      );
      return { kind: 'array-of-objects', items };
    }
    return { kind: 'array-of-scalars', items: value };
  }

  if (typeof value === 'object') {
    if (isScalarWrapper(value)) {
      // A wrapper whose value is itself a list — the `string[]` field shape.
      // Checked before the plain-scalar branch, which would otherwise stringify
      // the array into JSON.
      if (Array.isArray(value.value)) {
        return {
          kind: 'string-list',
          items: value.value,
          confidence: typeof value.confidence === 'number' ? value.confidence : null,
        };
      }
      return { kind: 'scalar', leaf: value };
    }
    return {
      kind: 'object',
      entries: Object.entries(value as Record<string, unknown>),
    };
  }

  // Primitive at the top of a subtree — shouldn't happen post-parseFieldConfidence
  // (it wraps primitives), but defensive: treat as an unlabelled scalar.
  return { kind: 'scalar', leaf: { value, confidence: null } };
}

/**
 * Walk a value tree and return the mean of every non-null confidence, plus the
 * count. Used to badge container sections with a rolled-up score. Never throws.
 */
export function aggregateConfidence(value: unknown): {
  avg: number | null;
  count: number;
} {
  let sum = 0;
  let count = 0;

  const walk = (v: unknown): void => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === 'object') {
      if (isScalarWrapper(v)) {
        if (typeof v.confidence === 'number') {
          sum += v.confidence;
          count += 1;
        }
        return;
      }
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  };

  walk(value);
  return count === 0 ? { avg: null, count: 0 } : { avg: sum / count, count };
}

/**
 * True iff `value` contains at least one wrapped scalar whose confidence is
 * strictly below `threshold`. Used to decide whether a container section is
 * worth showing in low-confidence-only review mode.
 */
export function hasLowConfidence(value: unknown, threshold: number): boolean {
  let found = false;
  const walk = (v: unknown): void => {
    if (found || v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === 'object') {
      if (isScalarWrapper(v)) {
        if (typeof v.confidence === 'number' && v.confidence < threshold) {
          found = true;
        }
        return;
      }
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  };
  walk(value);
  return found;
}
