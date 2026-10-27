// tests/payment-account-management/field-renderer-utils.test.ts
// Unit tests for the pure helpers inside FieldRenderer.tsx:
//   - isScalarWrapper  (shape predicate)
//   - classifyShape    (shape classifier)
//   - aggregateConfidence (recursive mean over confidence leaves)
//
// The React components in the same file aren't exercised here; we import only
// the exported utilities so the tests stay pure and don't need JSDOM.

import {
  isScalarWrapper,
  classifyShape,
  aggregateConfidence,
} from '../../app/payment-account-management/components/FieldRenderer.helpers';

describe('isScalarWrapper', () => {
  it('returns true for a full { value, confidence } wrapper', () => {
    expect(isScalarWrapper({ value: 'x', confidence: 0.9 })).toBe(true);
  });

  it('returns true even when confidence is null (the wrapper is still valid)', () => {
    expect(isScalarWrapper({ value: 'x', confidence: null })).toBe(true);
  });

  it('returns false when either key is missing', () => {
    // Only `value` — matches unwrap()'s heuristic in utils.ts NOT applying;
    // FieldRenderer intentionally requires BOTH keys so plain objects that
    // happen to have a `value` field don't get misread as wrappers.
    expect(isScalarWrapper({ value: 'x' })).toBe(false);
    expect(isScalarWrapper({ confidence: 0.9 })).toBe(false);
  });

  it('returns false for null, undefined, arrays, and primitives', () => {
    expect(isScalarWrapper(null)).toBe(false);
    expect(isScalarWrapper(undefined)).toBe(false);
    expect(isScalarWrapper([])).toBe(false);
    expect(isScalarWrapper([{ value: 'x', confidence: 0.5 }])).toBe(false);
    expect(isScalarWrapper('x')).toBe(false);
    expect(isScalarWrapper(42)).toBe(false);
    expect(isScalarWrapper(true)).toBe(false);
  });
});

describe('classifyShape', () => {
  it('classifies null and undefined as null', () => {
    expect(classifyShape(null)).toEqual({ kind: 'null' });
    expect(classifyShape(undefined)).toEqual({ kind: 'null' });
  });

  it('classifies a wrapper as scalar and preserves the leaf', () => {
    const leaf = { value: 'x', confidence: 0.5 };
    expect(classifyShape(leaf)).toEqual({ kind: 'scalar', leaf });
  });

  it('classifies an empty array', () => {
    expect(classifyShape([])).toEqual({ kind: 'array-empty' });
  });

  it('classifies an array of wrappers as array-of-scalars', () => {
    const items = [
      { value: 'a', confidence: 0.9 },
      { value: 'b', confidence: null },
    ];
    expect(classifyShape(items)).toEqual({ kind: 'array-of-scalars', items });
  });

  it('classifies an array of raw primitives as array-of-scalars', () => {
    // Post-parseFieldConfidence, raw primitives shouldn't appear inside arrays,
    // but the classifier is defensive — treat them as scalar items.
    const items = ['a', 42, true];
    expect(classifyShape(items)).toEqual({ kind: 'array-of-scalars', items });
  });

  it('classifies an array of plain records as array-of-objects', () => {
    const items = [
      { name: { value: 'A', confidence: 0.9 } },
      { name: { value: 'B', confidence: 0.7 } },
    ];
    const result = classifyShape(items);
    expect(result.kind).toBe('array-of-objects');
    if (result.kind === 'array-of-objects') {
      // Records are passed through, not wrapped.
      expect(result.items).toEqual(items);
    }
  });

  it('coerces non-record elements inside a mixed array into stub records', () => {
    // If a legal-representatives array had one plain string mixed in with real
    // records, treat it as a record `{ value: <primitive> }` so the renderer's
    // record-of-fields branch works uniformly.
    const items = [{ name: { value: 'A', confidence: 0.9 } }, 'stray', null];
    const result = classifyShape(items);
    expect(result.kind).toBe('array-of-objects');
    if (result.kind === 'array-of-objects') {
      expect(result.items).toHaveLength(3);
      expect(result.items[0]).toEqual({ name: { value: 'A', confidence: 0.9 } });
      expect(result.items[1]).toEqual({ value: 'stray' });
      expect(result.items[2]).toEqual({ value: null });
    }
  });

  it('classifies a plain object as object with its entries', () => {
    const obj = { a: 1, b: { value: 'x', confidence: 0.5 } };
    const result = classifyShape(obj);
    expect(result.kind).toBe('object');
    if (result.kind === 'object') {
      expect(result.entries).toEqual([
        ['a', 1],
        ['b', { value: 'x', confidence: 0.5 }],
      ]);
    }
  });

  it('does NOT treat an object with only `value` as a scalar wrapper', () => {
    // Both keys required — this defends against schemas that happen to have a
    // field literally named `value`.
    const result = classifyShape({ value: 'x' });
    expect(result.kind).toBe('object');
  });

  it('classifies a top-level primitive as a defensive scalar', () => {
    // Not expected post-parseFieldConfidence (it wraps primitives), but the
    // classifier must not throw or drop data.
    const result = classifyShape('hello');
    expect(result.kind).toBe('scalar');
    if (result.kind === 'scalar') {
      expect(result.leaf).toEqual({ value: 'hello', confidence: null });
    }
  });

  it('never throws on odd inputs', () => {
    expect(() => classifyShape(Symbol('x') as unknown)).not.toThrow();
    expect(() => classifyShape(() => 1)).not.toThrow();
  });
});

describe('aggregateConfidence', () => {
  it('returns null/0 when there are no confidence leaves', () => {
    expect(aggregateConfidence(null)).toEqual({ avg: null, count: 0 });
    expect(aggregateConfidence({})).toEqual({ avg: null, count: 0 });
    expect(aggregateConfidence([])).toEqual({ avg: null, count: 0 });
    expect(aggregateConfidence('bare-string')).toEqual({ avg: null, count: 0 });
  });

  it('picks up a single scalar wrapper', () => {
    expect(aggregateConfidence({ value: 'x', confidence: 0.9 })).toEqual({
      avg: 0.9,
      count: 1,
    });
  });

  it('ignores wrappers whose confidence is null', () => {
    // Null confidence means "AI didn't self-rate" — we don't fold that into the
    // mean because there's no signal to average.
    expect(aggregateConfidence({ value: 'x', confidence: null })).toEqual({
      avg: null,
      count: 0,
    });
  });

  it('averages confidences across a plain object', () => {
    const obj = {
      id_no: { value: '123', confidence: 1.0 },
      full_name: { value: 'A', confidence: 0.5 },
      birth: { value: null, confidence: null }, // ignored
    };
    expect(aggregateConfidence(obj)).toEqual({ avg: 0.75, count: 2 });
  });

  it('walks arrays of wrappers', () => {
    const arr = [
      { value: 'a', confidence: 0.4 },
      { value: 'b', confidence: 0.6 },
    ];
    expect(aggregateConfidence(arr)).toEqual({ avg: 0.5, count: 2 });
  });

  it('walks nested records inside an array-of-objects', () => {
    const reps = [
      {
        full_name: { value: 'Alice', confidence: 0.9 },
        position: { value: 'CEO', confidence: 0.7 },
      },
      {
        full_name: { value: 'Bob', confidence: 0.5 },
        position: { value: 'CFO', confidence: 0.3 },
      },
    ];
    // Mean of 0.9, 0.7, 0.5, 0.3 = 2.4 / 4 = 0.6
    const { avg, count } = aggregateConfidence(reps);
    expect(count).toBe(4);
    expect(avg).toBeCloseTo(0.6, 10);
  });

  it('ignores null elements inside arrays', () => {
    const arr = [{ value: 'x', confidence: 0.8 }, null, undefined];
    expect(aggregateConfidence(arr)).toEqual({ avg: 0.8, count: 1 });
  });

  it('handles the top-level MB01-like shape (mix of scalars + array-of-records)', () => {
    const extracted = {
      org_name_vi: { value: 'Công ty X', confidence: 1.0 },
      tax_code: { value: '01234', confidence: 0.8 },
      legal_representatives: [
        { full_name: { value: 'A', confidence: 0.6 } },
        { full_name: { value: 'B', confidence: 0.4 } },
      ],
      chief_accountants: [],
      other_address: null,
    };
    // 1.0 + 0.8 + 0.6 + 0.4 = 2.8 / 4 = 0.7
    const { avg, count } = aggregateConfidence(extracted);
    expect(count).toBe(4);
    expect(avg).toBeCloseTo(0.7, 10);
  });

  it('never throws on unexpected inputs', () => {
    expect(() => aggregateConfidence(Symbol('x') as unknown)).not.toThrow();
    expect(() => aggregateConfidence(() => 1)).not.toThrow();
  });
});
