// tests/pipelines/parse-field-confidence.test.ts
// Unit tests for parseFieldConfidence in
// lib/pipelines/workflows/payment-account-management/shared/utils.ts
//
// The function is a hard boundary between LLM-generated output and our
// downstream pipeline: it must never throw, must strip valid ⟨conf:x⟩ markers
// from string leaves, and must preserve container shape (arrays/objects) while
// wrapping only the scalar leaves.

// Mock the storage backend import — utils.ts eagerly imports @/lib/storage,
// which transitively pulls in DB/settings modules we don't want to boot for a
// pure-function test.
jest.mock('@/lib/storage', () => ({
  getStorageBackend: jest.fn(),
}));

import {
  parseFieldConfidence,
  clamp01,
  unwrap,
} from '../../lib/pipelines/workflows/payment-account-management/shared/utils';

describe('parseFieldConfidence', () => {
  // ─── null / primitives without a marker ─────────────────────────────────────
  describe('null and primitive leaves without a marker', () => {
    it('returns literal null for null (does not wrap)', () => {
      expect(parseFieldConfidence(null)).toBeNull();
    });

    it('wraps a plain string with confidence: null when no marker is present', () => {
      expect(parseFieldConfidence('Nguyễn Văn A')).toEqual({
        value: 'Nguyễn Văn A',
        confidence: null,
      });
    });

    it('wraps a number with confidence: null (numbers never carry a marker)', () => {
      expect(parseFieldConfidence(42)).toEqual({ value: 42, confidence: null });
    });

    it('wraps a boolean with confidence: null', () => {
      expect(parseFieldConfidence(true)).toEqual({ value: true, confidence: null });
      expect(parseFieldConfidence(false)).toEqual({ value: false, confidence: null });
    });

    it('wraps an empty string with confidence: null', () => {
      expect(parseFieldConfidence('')).toEqual({ value: '', confidence: null });
    });

    it('wraps undefined at a leaf position with confidence: null', () => {
      // Not typically expected from AI output, but we defend against it.
      expect(parseFieldConfidence(undefined)).toEqual({
        value: undefined,
        confidence: null,
      });
    });
  });

  // ─── String leaves WITH a valid marker ──────────────────────────────────────
  describe('string leaves with a valid ⟨conf:x⟩ marker', () => {
    it('strips a trailing marker and returns the numeric confidence', () => {
      expect(parseFieldConfidence('Nguyễn Văn A ⟨conf:0.95⟩')).toEqual({
        value: 'Nguyễn Văn A',
        confidence: 0.95,
      });
    });

    it('handles an integer confidence of 1', () => {
      expect(parseFieldConfidence('Certain value ⟨conf:1⟩')).toEqual({
        value: 'Certain value',
        confidence: 1,
      });
    });

    it('handles a confidence of 0', () => {
      expect(parseFieldConfidence('Total guess ⟨conf:0⟩')).toEqual({
        value: 'Total guess',
        confidence: 0,
      });
    });

    it('clamps a confidence > 1 down to 1', () => {
      expect(parseFieldConfidence('Overconfident ⟨conf:1.5⟩')).toEqual({
        value: 'Overconfident',
        confidence: 1,
      });
    });

    // The marker regex is /\s*⟨conf:([0-9.]+)⟩\s*$/. A leading "-" is not in
    // [0-9.], so `⟨conf:-0.5⟩` fails to match the marker as a whole → the input
    // is treated as having NO marker, and the raw string is preserved verbatim
    // with confidence: null. This is safer than fabricating a confidence from
    // whatever partial number we could scrape out.
    it('does not fabricate a confidence when the marker contains a sign character', () => {
      expect(parseFieldConfidence('X ⟨conf:-0.5⟩')).toEqual({
        value: 'X ⟨conf:-0.5⟩',
        confidence: null,
      });
    });

    it('trims surrounding whitespace around the marker when stripping', () => {
      expect(parseFieldConfidence('Value   ⟨conf:0.8⟩   ')).toEqual({
        value: 'Value',
        confidence: 0.8,
      });
    });

    it('strips only the FINAL marker (regex is end-anchored)', () => {
      // A stray ⟨ mid-value must not cause a false match: only the final marker
      // is removed, mid-value markers stay embedded verbatim.
      const out = parseFieldConfidence('A ⟨conf:0.1⟩ B ⟨conf:0.9⟩') as {
        value: string;
        confidence: number;
      };
      expect(out.confidence).toBe(0.9);
      expect(out.value).toBe('A ⟨conf:0.1⟩ B');
    });
  });

  // ─── String leaves with a MALFORMED marker ──────────────────────────────────
  describe('string leaves with a malformed marker', () => {
    it('keeps the value intact and reports confidence: null for an unparseable number', () => {
      // "0.9.9" is captured by [0-9.]+ but Number("0.9.9") is NaN → we must not
      // strip the marker (that would invent a bogus value) and must not fabricate
      // a 0 confidence. The whole raw string is preserved.
      expect(parseFieldConfidence('Value ⟨conf:0.9.9⟩')).toEqual({
        value: 'Value ⟨conf:0.9.9⟩',
        confidence: null,
      });
    });

    it('treats a marker whose contents are non-digits as no marker at all', () => {
      // "..." is not captured by [0-9.]+ ... wait, "." IS in [0-9.]+. So this
      // case actually gets a numeric match. Instead assert the truly-not-matching
      // "abc" case.
      expect(parseFieldConfidence('Value ⟨conf:abc⟩')).toEqual({
        value: 'Value ⟨conf:abc⟩',
        confidence: null,
      });
    });

    it('leaves a value alone when the marker is not at the end', () => {
      // Marker is not trailing — end-anchoring means we treat it as no marker.
      expect(parseFieldConfidence('⟨conf:0.9⟩ prefix')).toEqual({
        value: '⟨conf:0.9⟩ prefix',
        confidence: null,
      });
    });
  });

  // ─── Arrays: container is NOT wrapped, leaves are ──────────────────────────
  describe('arrays', () => {
    it('returns an empty array unchanged (no wrapper)', () => {
      expect(parseFieldConfidence([])).toEqual([]);
    });

    it('parses each scalar element, keeping the outer array as a plain array', () => {
      expect(
        parseFieldConfidence(['A ⟨conf:0.9⟩', 'B', 7])
      ).toEqual([
        { value: 'A', confidence: 0.9 },
        { value: 'B', confidence: null },
        { value: 7, confidence: null },
      ]);
    });

    it('preserves null elements literally inside an array', () => {
      expect(parseFieldConfidence(['A ⟨conf:0.5⟩', null])).toEqual([
        { value: 'A', confidence: 0.5 },
        null,
      ]);
    });

    it('recurses into nested arrays without wrapping the containers', () => {
      expect(
        parseFieldConfidence([['x ⟨conf:0.5⟩'], ['y']])
      ).toEqual([
        [{ value: 'x', confidence: 0.5 }],
        [{ value: 'y', confidence: null }],
      ]);
    });
  });

  // ─── Objects: container is NOT wrapped, leaves are ─────────────────────────
  describe('objects', () => {
    it('returns an empty object unchanged (no wrapper)', () => {
      expect(parseFieldConfidence({})).toEqual({});
    });

    it('parses each scalar field, keeping the outer object as a plain object', () => {
      expect(
        parseFieldConfidence({
          id_no: '123456789 ⟨conf:0.99⟩',
          name: 'Nguyễn Văn A',
          age: 30,
          active: true,
          spouse: null,
        })
      ).toEqual({
        id_no: { value: '123456789', confidence: 0.99 },
        name: { value: 'Nguyễn Văn A', confidence: null },
        age: { value: 30, confidence: null },
        active: { value: true, confidence: null },
        spouse: null,
      });
    });

    it('recurses through nested objects', () => {
      expect(
        parseFieldConfidence({
          address: {
            street: '123 Main ⟨conf:0.8⟩',
            city: 'Hà Nội',
          },
        })
      ).toEqual({
        address: {
          street: { value: '123 Main', confidence: 0.8 },
          city: { value: 'Hà Nội', confidence: null },
        },
      });
    });

    it('handles array-of-object fields like legal_representatives', () => {
      // This is the shape mentioned in the JSDoc: each leaf gets wrapped, the
      // outer array + inner objects stay plain containers.
      expect(
        parseFieldConfidence([
          { name: 'Alice ⟨conf:0.9⟩', role: 'CEO ⟨conf:0.7⟩' },
          { name: 'Bob', role: 'CFO ⟨conf:0.6⟩' },
        ])
      ).toEqual([
        {
          name: { value: 'Alice', confidence: 0.9 },
          role: { value: 'CEO', confidence: 0.7 },
        },
        {
          name: { value: 'Bob', confidence: null },
          role: { value: 'CFO', confidence: 0.6 },
        },
      ]);
    });
  });

  // ─── Guarantees ────────────────────────────────────────────────────────────
  describe('robustness guarantees', () => {
    it('never throws on unexpected input types', () => {
      expect(() => parseFieldConfidence(Symbol('x') as unknown)).not.toThrow();
      expect(() => parseFieldConfidence(() => 1)).not.toThrow();
      expect(() => parseFieldConfidence(BigInt(1) as unknown)).not.toThrow();
    });

    it('returns a deep-cloned structure — mutating the output does not touch the input', () => {
      const input = { a: ['x ⟨conf:0.5⟩'] };
      // Nested string arrays are inferred checkbox fields with one field-level wrapper.
      const out = parseFieldConfidence(input) as { a: { value: string[]; confidence: number } };
      expect(out).toEqual({ a: { value: ['x'], confidence: 0.5 } });
      out.a.value.push('mutated');
      expect(input.a).toEqual(['x ⟨conf:0.5⟩']);
      expect(input.a.length).toBe(1);
    });
  });
});

// ─── Sanity checks for the helpers parseFieldConfidence relies on ────────────
describe('clamp01', () => {
  it('returns 0 for non-finite numbers', () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clamp01(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('clamps negatives to 0 and > 1 down to 1', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
  });

  it('passes valid values in range through', () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
  });
});

describe('unwrap', () => {
  it('returns the .value from a FieldValue wrapper', () => {
    expect(unwrap({ value: 'hi', confidence: 0.9 })).toBe('hi');
    expect(unwrap({ value: 42, confidence: null })).toBe(42);
  });

  it('passes primitives through unchanged', () => {
    expect(unwrap('plain')).toBe('plain');
    expect(unwrap(7)).toBe(7);
    expect(unwrap(null)).toBeNull();
  });

  it('passes objects without a "value" key through unchanged', () => {
    const obj = { foo: 'bar' };
    expect(unwrap(obj)).toBe(obj);
  });
});
