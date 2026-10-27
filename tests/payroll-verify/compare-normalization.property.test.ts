/**
 * Property-based tests for Vietnamese name normalization (Property 6).
 *
 * Feature: payroll-verify-workflow, Property 6: Vietnamese name normalization idempotence
 *
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5**
 */
import * as fc from 'fast-check';
import { normalizeString, normalizeNumber } from '@/lib/pipelines/workflows/payroll-verify-compare';
import type { CompareOptions } from '@/lib/pipelines/workflows/prompts/payroll-verify-prompts';

// Default options matching the production DEFAULT_COMPARE_CONFIG
const DEFAULT_OPTIONS: CompareOptions = {
  trim_string: true,
  case_insensitive: true,
  remove_vietnamese_accents: true,
  collapse_whitespace: true,
  number_remove_commas: true,
  treat_null_as_empty: true,
};

// All lowercase Vietnamese diacritical characters from the accent map
const VIETNAMESE_DIACRITICAL_CHARS = [
  'à', 'á', 'ạ', 'ả', 'ã',
  'â', 'ầ', 'ấ', 'ậ', 'ẩ', 'ẫ',
  'ă', 'ằ', 'ắ', 'ặ', 'ẳ', 'ẵ',
  'è', 'é', 'ẹ', 'ẻ', 'ẽ',
  'ê', 'ề', 'ế', 'ệ', 'ể', 'ễ',
  'ì', 'í', 'ị', 'ỉ', 'ĩ',
  'ò', 'ó', 'ọ', 'ỏ', 'õ',
  'ô', 'ồ', 'ố', 'ộ', 'ổ', 'ỗ',
  'ơ', 'ờ', 'ớ', 'ợ', 'ở', 'ỡ',
  'ù', 'ú', 'ụ', 'ủ', 'ũ',
  'ư', 'ừ', 'ứ', 'ự', 'ử', 'ữ',
  'ỳ', 'ý', 'ỵ', 'ỷ', 'ỹ',
  'đ',
];

// Build a regex that matches any Vietnamese diacritical character (lower or upper)
const VIETNAMESE_DIACRITICAL_REGEX = new RegExp(
  `[${VIETNAMESE_DIACRITICAL_CHARS.join('')}]`,
  'i',
);

describe('Feature: payroll-verify-workflow, Property 6: Vietnamese name normalization idempotence', () => {
  const mode = 'vietnamese_name_normalized' as const;

  it('applying normalizeString twice produces the same result as once (idempotence)', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const once = normalizeString(input, DEFAULT_OPTIONS, mode);
        const twice = normalizeString(once, DEFAULT_OPTIONS, mode);
        expect(twice).toBe(once);
      }),
      { numRuns: 100 },
    );
  });

  it('output contains no Vietnamese diacritical characters', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = normalizeString(input, DEFAULT_OPTIONS, mode);
        expect(result).not.toMatch(VIETNAMESE_DIACRITICAL_REGEX);
      }),
      { numRuns: 100 },
    );
  });

  it('output has no leading or trailing whitespace', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = normalizeString(input, DEFAULT_OPTIONS, mode);
        expect(result).toBe(result.trim());
      }),
      { numRuns: 100 },
    );
  });

  it('output contains no consecutive whitespace characters', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = normalizeString(input, DEFAULT_OPTIONS, mode);
        expect(result).not.toMatch(/\s{2,}/);
      }),
      { numRuns: 100 },
    );
  });

  it('output is entirely uppercase', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = normalizeString(input, DEFAULT_OPTIONS, mode);
        expect(result).toBe(result.toUpperCase());
      }),
      { numRuns: 100 },
    );
  });

  it('idempotence holds for strings containing Vietnamese characters', () => {
    // Generator that mixes Vietnamese diacritical characters with random strings
    const vietnameseCharArb = fc.constantFrom(...VIETNAMESE_DIACRITICAL_CHARS);
    const mixedStringArb = fc.array(
      fc.oneof(fc.constant(' '), vietnameseCharArb, fc.string({ maxLength: 3 })),
      { minLength: 0, maxLength: 10 },
    ).map((parts) => parts.join(''));

    fc.assert(
      fc.property(mixedStringArb, (input) => {
        const once = normalizeString(input, DEFAULT_OPTIONS, mode);
        const twice = normalizeString(once, DEFAULT_OPTIONS, mode);
        expect(twice).toBe(once);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property-based tests for number normalization (Property 7).
 *
 * Feature: payroll-verify-workflow, Property 7: Number normalization removes all separators
 *
 * **Validates: Requirements 11.1, 11.2, 11.3**
 */
describe('Feature: payroll-verify-workflow, Property 7: Number normalization removes all separators', () => {
  // Generator for digit strings with random separator placement (dots, commas, spaces)
  const SEPARATORS = ['.', ',', ' '];

  // Generator for a group of 1-4 digit characters
  const digitGroupArb = fc
    .array(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 1, maxLength: 4 })
    .map((chars) => chars.join(''));

  const numberWithSeparatorsArb = fc
    .tuple(
      fc.array(digitGroupArb, { minLength: 1, maxLength: 5 }),
      fc.array(fc.constantFrom(...SEPARATORS), { minLength: 0, maxLength: 4 }),
    )
    .map(([digitGroups, seps]) => {
      // Interleave digit groups with separators
      let result = digitGroups[0];
      for (let i = 1; i < digitGroups.length; i++) {
        const sep = seps[(i - 1) % seps.length] ?? '.';
        result += sep + digitGroups[i];
      }
      return result;
    });

  it('output contains no dot, comma, or whitespace characters', () => {
    fc.assert(
      fc.property(numberWithSeparatorsArb, (input) => {
        const result = normalizeNumber(input, DEFAULT_OPTIONS);
        const strResult = String(result);
        expect(strResult).not.toMatch(/[.,\s]/);
      }),
      { numRuns: 100 },
    );
  });

  it('output contains no separators for arbitrary string inputs', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = normalizeNumber(input, DEFAULT_OPTIONS);
        const strResult = String(result);
        expect(strResult).not.toMatch(/[.,\s]/);
      }),
      { numRuns: 100 },
    );
  });

  it('two strings differing only in separator placement produce identical outputs', () => {
    // Generate a base digit string, then create two variants with different separators
    const digitGroupsArb = fc.array(
      fc.array(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 1, maxLength: 3 }).map((c) => c.join('')),
      { minLength: 1, maxLength: 5 },
    );

    const separatorArb = fc.constantFrom('.', ',', ' ');

    fc.assert(
      fc.property(digitGroupsArb, separatorArb, separatorArb, (digitGroups, sep1, sep2) => {
        const variant1 = digitGroups.join(sep1);
        const variant2 = digitGroups.join(sep2);

        const result1 = String(normalizeNumber(variant1, DEFAULT_OPTIONS));
        const result2 = String(normalizeNumber(variant2, DEFAULT_OPTIONS));

        expect(result1).toBe(result2);
      }),
      { numRuns: 100 },
    );
  });

  it('normalizeNumber is idempotent for numeric strings', () => {
    fc.assert(
      fc.property(numberWithSeparatorsArb, (input) => {
        const once = String(normalizeNumber(input, DEFAULT_OPTIONS));
        const twice = String(normalizeNumber(once, DEFAULT_OPTIONS));
        expect(twice).toBe(once);
      }),
      { numRuns: 100 },
    );
  });

  it('null input with treat_null_as_empty produces empty string', () => {
    const result = normalizeNumber(null, DEFAULT_OPTIONS);
    expect(String(result)).toBe('');
  });
});
