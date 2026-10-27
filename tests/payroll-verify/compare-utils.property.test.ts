/**
 * Property-based tests for dot-notation path resolution (Property 8).
 *
 * Feature: payroll-verify-workflow, Property 8: Dot-notation path resolution
 *
 * **Validates: Requirements 12.3**
 */
import * as fc from 'fast-check';
import { getByPath } from '@/lib/pipelines/workflows/payroll-verify-compare';

/**
 * Arbitrary that generates a valid key segment (non-empty alphanumeric + underscore).
 * Avoids dots and empty strings to ensure valid dot-notation paths.
 */
const KEY_CHARS = 'abcdefghijklmnopqrstuvwxyz_0123456789';
const keySegmentArb = fc
  .array(fc.constantFrom(...KEY_CHARS.split('')), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(''));

/**
 * Arbitrary that generates a dot-notation path with 1-4 segments.
 */
const dotPathArb = fc
  .array(keySegmentArb, { minLength: 1, maxLength: 4 })
  .map((segments) => segments.join('.'));

/**
 * Arbitrary that generates a leaf value (string, number, boolean, null).
 */
const leafValueArb = fc.oneof(
  fc.string({ maxLength: 20 }),
  fc.integer(),
  fc.double({ noNaN: true }),
  fc.boolean(),
  fc.constant(null),
);

/**
 * Build a nested object from a dot-notation path and a leaf value.
 * e.g., buildNested("a.b.c", 42) => { a: { b: { c: 42 } } }
 */
function buildNested(path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.');
  const root: Record<string, unknown> = {};
  let current: Record<string, unknown> = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const child: Record<string, unknown> = {};
    current[keys[i]] = child;
    current = child;
  }
  current[keys[keys.length - 1]] = value;
  return root;
}

describe('Feature: payroll-verify-workflow, Property 8: Dot-notation path resolution', () => {
  it('getByPath returns the value at a valid dot-notation path', () => {
    fc.assert(
      fc.property(dotPathArb, leafValueArb, (path, value) => {
        const obj = buildNested(path, value);
        const result = getByPath(obj, path);
        expect(result).toBe(value);
      }),
      { numRuns: 100 },
    );
  });

  it('getByPath returns undefined for paths where an intermediate key does not exist', () => {
    fc.assert(
      fc.property(dotPathArb, keySegmentArb, (existingPath, extraKey) => {
        // Build an object with a non-indexable leaf (number), then query a path that extends beyond it
        const obj = buildNested(existingPath, 42);
        const invalidPath = existingPath + '.' + extraKey;
        const result = getByPath(obj, invalidPath);
        // The leaf is a number, not an object, so going deeper should yield undefined
        expect(result).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('getByPath returns undefined when a middle segment does not exist', () => {
    fc.assert(
      fc.property(
        fc.array(keySegmentArb, { minLength: 2, maxLength: 4 }),
        keySegmentArb,
        leafValueArb,
        (segments, missingKey, value) => {
          // Build object with the full path
          const path = segments.join('.');
          const obj = buildNested(path, value);

          // Replace one intermediate segment with a key that doesn't exist
          const insertIdx = fc.sample(fc.integer({ min: 0, max: segments.length - 1 }), 1)[0];
          const brokenSegments = [...segments];
          // Ensure the missing key is different from the actual key at that position
          const actualKey = brokenSegments[insertIdx];
          if (missingKey !== actualKey) {
            brokenSegments[insertIdx] = missingKey;
            const brokenPath = brokenSegments.join('.');
            const result = getByPath(obj, brokenPath);
            expect(result).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('getByPath returns undefined for an empty path', () => {
    const obj = { a: 1 };
    expect(getByPath(obj, '')).toBeUndefined();
  });

  it('getByPath handles single-segment paths correctly', () => {
    fc.assert(
      fc.property(keySegmentArb, leafValueArb, (key, value) => {
        const obj: Record<string, unknown> = { [key]: value };
        expect(getByPath(obj, key)).toBe(value);
      }),
      { numRuns: 100 },
    );
  });
});
