/**
 * Unit tests for margin-deposit-profile-compare.ts
 * TDD: tests written FIRST, implementation follows.
 */
import {
  normalizeName,
  normalizeId,
  normalizeMoney,
  normalizeDate,
  normalizeString,
  compareCopies,
  type ComparableCopy,
} from '@/lib/pipelines/workflows/margin-deposit-profile-compare';

// ─── Normalize Functions ──────────────────────────────────────────────────────

describe('normalizeName', () => {
  it('should uppercase, trim and collapse whitespace', () => {
    expect(normalizeName('  nguYỄN   văN a  ')).toBe('NGUYỄN VĂN A');
  });

  it('should return empty string for null', () => {
    expect(normalizeName(null)).toBe('');
  });

  it('should return empty string for empty input', () => {
    expect(normalizeName('')).toBe('');
  });

  it('should handle single word', () => {
    expect(normalizeName('nguyễn')).toBe('NGUYỄN');
  });
});

describe('normalizeId', () => {
  it('should strip spaces', () => {
    expect(normalizeId('079 203 012345')).toBe('079203012345');
  });

  it('should strip dashes and dots', () => {
    expect(normalizeId('079-203-012.345')).toBe('079203012345');
  });

  it('should return empty string for null', () => {
    expect(normalizeId(null)).toBe('');
  });

  it('should handle clean input', () => {
    expect(normalizeId('079203012345')).toBe('079203012345');
  });

  it('should strip alphabetic characters', () => {
    expect(normalizeId('HC: B1234567')).toBe('1234567');
  });
});

describe('normalizeMoney', () => {
  it('should parse Vietnamese dot-thousands format', () => {
    expect(normalizeMoney('1.500.000.000')).toBe(1500000000);
  });

  it('should parse comma-thousands format', () => {
    expect(normalizeMoney('500,000,000')).toBe(500000000);
  });

  it('should parse plain number without separators', () => {
    expect(normalizeMoney('500000000')).toBe(500000000);
  });

  it('should strip VND suffix', () => {
    expect(normalizeMoney('500.000.000 VND')).toBe(500000000);
  });

  it('should strip đ suffix', () => {
    expect(normalizeMoney('500.000.000đ')).toBe(500000000);
  });

  it('should return null for null input', () => {
    expect(normalizeMoney(null)).toBeNull();
  });

  it('should return null for N/A', () => {
    expect(normalizeMoney('N/A')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(normalizeMoney('')).toBeNull();
  });

  it('should handle number with spaces', () => {
    expect(normalizeMoney('1 500 000 000')).toBe(1500000000);
  });
});

describe('normalizeDate', () => {
  it('should keep DD/MM/YYYY as-is', () => {
    expect(normalizeDate('15/05/2026')).toBe('15/05/2026');
  });

  it('should pad single-digit day and month', () => {
    expect(normalizeDate('1/1/2022')).toBe('01/01/2022');
  });

  it('should expand 2-digit year to 4-digit (20xx)', () => {
    expect(normalizeDate('1/1/22')).toBe('01/01/2022');
  });

  it('should return empty string for null', () => {
    expect(normalizeDate(null)).toBe('');
  });

  it('should return empty string for empty input', () => {
    expect(normalizeDate('')).toBe('');
  });

  it('should handle already-padded input', () => {
    expect(normalizeDate('01/01/2022')).toBe('01/01/2022');
  });
});

describe('normalizeString', () => {
  it('should trim, collapse whitespace and uppercase', () => {
    expect(normalizeString('  a-12-08  ')).toBe('A-12-08');
  });

  it('should return empty string for null', () => {
    expect(normalizeString(null)).toBe('');
  });
});

// ─── compareCopies ────────────────────────────────────────────────────────────

let extractOrdinal = 0;
function makeExtractResult(fields: Record<string, unknown>): ComparableCopy {
  extractOrdinal += 1;
  return {
    fields: fields as ComparableCopy['fields'],
    page_range: String(extractOrdinal),
  };
}

describe('compareCopies', () => {
  // TTKQ schema: escrow_parties[] + installments[] + scalar fields.
  const makeTTKQ = (over: {
    escrow_full_name?: { value: string | null; confidence: number };
    total_escrow_amount?: { value: string | null; confidence: number };
    dropPartyId?: boolean;
    empty?: boolean;
  } = {}) => {
    if (over.empty) {
      return { escrow_parties: [], unit_code: { value: null, confidence: 0 } } as Record<string, unknown>;
    }
    const party: Record<string, { value: string | null; confidence: number }> = {
      code: { value: '1', confidence: 0.99 },
      escrow_full_name: over.escrow_full_name ?? { value: 'NGUYỄN VĂN A', confidence: 0.95 },
      escrow_national_id: { value: '079203012345', confidence: 0.98 },
      escrow_id_issue_date: { value: '01/01/2020', confidence: 0.96 },
    };
    if (over.dropPartyId) delete party.escrow_national_id;
    return {
      escrow_parties: [party],
      unit_code: { value: 'A-12-08', confidence: 0.99 },
      total_escrow_amount: over.total_escrow_amount ?? { value: '1500000000', confidence: 0.97 },
      number_of_installments: { value: '1', confidence: 0.95 },
      installments: [
        { installment_index: { value: '1', confidence: 0.95 }, amount: { value: '1500000000', confidence: 0.97 } },
      ],
    } as Record<string, unknown>;
  };
  const baseTTKQ = makeTTKQ();

  it('should return MATCH for 4 identical copies', () => {
    const copies = [
      makeExtractResult(baseTTKQ),
      makeExtractResult(baseTTKQ),
      makeExtractResult(baseTTKQ),
      makeExtractResult(baseTTKQ),
    ];
    const result = compareCopies(copies, 'thoa_thuan_ky_quy');
    expect(result.verdict).toBe('MATCH');
    expect(result.mismatches).toHaveLength(0);
    expect(result.copies_found).toBe(4);
    expect(result.copies_expected).toBe(4);
  });

  it('should return MISMATCH when 1 field differs in copy 3', () => {
    const copy3 = makeExtractResult(makeTTKQ({
      escrow_full_name: { value: 'NGUYỄN VĂN B', confidence: 0.94 },
    }));
    const copies = [
      makeExtractResult(baseTTKQ),
      makeExtractResult(baseTTKQ),
      copy3,
      makeExtractResult(baseTTKQ),
    ];
    const result = compareCopies(copies, 'thoa_thuan_ky_quy');
    expect(result.verdict).toBe('MISMATCH');
    expect(result.mismatches.length).toBeGreaterThan(0);
    expect(result.mismatches[0].field).toBe('escrow_parties[0].escrow_full_name');
  });

  it('should MATCH when money format differs but value is same', () => {
    const copy2 = makeExtractResult(makeTTKQ({
      total_escrow_amount: { value: '1.500.000.000', confidence: 0.96 },
    }));
    const copies = [
      makeExtractResult(baseTTKQ),
      copy2,
      makeExtractResult(baseTTKQ),
      makeExtractResult(baseTTKQ),
    ];
    const result = compareCopies(copies, 'thoa_thuan_ky_quy');
    expect(result.verdict).toBe('MATCH');
    expect(result.mismatches).toHaveLength(0);
  });

  it('should MATCH when name casing differs (normalize)', () => {
    const copy2 = makeExtractResult(makeTTKQ({
      escrow_full_name: { value: 'Nguyễn Văn A', confidence: 0.93 },
    }));
    const copies = [
      makeExtractResult(baseTTKQ),
      copy2,
      makeExtractResult(baseTTKQ),
      makeExtractResult(baseTTKQ),
    ];
    const result = compareCopies(copies, 'thoa_thuan_ky_quy');
    expect(result.verdict).toBe('MATCH');
  });

  it('should return COMPARISON_SKIPPED with INSUFFICIENT_COPIES for 3 copies', () => {
    const copies = [
      makeExtractResult(baseTTKQ),
      makeExtractResult(baseTTKQ),
      makeExtractResult(baseTTKQ),
    ];
    const result = compareCopies(copies, 'thoa_thuan_ky_quy');
    expect(result.verdict).toBe('COMPARISON_SKIPPED');
    expect(result.error_code).toBe('INSUFFICIENT_COPIES');
    expect(result.copies_found).toBe(3);
  });

  it('should return COMPARISON_SKIPPED with PARTIAL_TEXT_COMPARISON when 1 field is null', () => {
    const copyWithNull = makeExtractResult(makeTTKQ({
      escrow_full_name: { value: null, confidence: 0 },
    }));
    const copies = [
      makeExtractResult(baseTTKQ),
      makeExtractResult(baseTTKQ),
      copyWithNull,
      makeExtractResult(baseTTKQ),
    ];
    const result = compareCopies(copies, 'thoa_thuan_ky_quy');
    expect(result.verdict).toBe('COMPARISON_SKIPPED');
    expect(result.error_code).toBe('PARTIAL_TEXT_COMPARISON');
  });

  it('should return COMPARISON_SKIPPED for 0 copies', () => {
    const result = compareCopies([], 'thoa_thuan_ky_quy');
    expect(result.verdict).toBe('COMPARISON_SKIPPED');
    expect(result.error_code).toBe('INSUFFICIENT_COPIES');
    expect(result.copies_found).toBe(0);
  });

  it('should return COMPARISON_SKIPPED for 1 copy', () => {
    const result = compareCopies([makeExtractResult(baseTTKQ)], 'thoa_thuan_ky_quy');
    expect(result.verdict).toBe('COMPARISON_SKIPPED');
    expect(result.error_code).toBe('INSUFFICIENT_COPIES');
    expect(result.copies_found).toBe(1);
  });

  it('should never return MATCH when more than exactly 4 copies are grouped', () => {
    const copies = Array.from({ length: 5 }, () => makeExtractResult(baseTTKQ));
    const result = compareCopies(copies, 'thoa_thuan_ky_quy');
    expect(result.verdict).toBe('COMPARISON_SKIPPED');
    expect(result.copies_found).toBe(5);
  });

  it('should skip comparison when an expected sub-field is missing from one copy', () => {
    const incomplete = makeExtractResult(makeTTKQ({ dropPartyId: true }));
    const result = compareCopies([
      makeExtractResult(baseTTKQ), makeExtractResult(baseTTKQ), incomplete, makeExtractResult(baseTTKQ),
    ], 'thoa_thuan_ky_quy');
    expect(result.verdict).toBe('COMPARISON_SKIPPED');
    expect(result.error_code).toBe('PARTIAL_TEXT_COMPARISON');
  });

  it('should skip comparison for four empty extraction outputs', () => {
    const result = compareCopies(Array.from({ length: 4 }, () => makeExtractResult(makeTTKQ({ empty: true }))), 'thoa_thuan_ky_quy');
    expect(result.verdict).toBe('COMPARISON_SKIPPED');
    expect(result.error_code).toBe('PARTIAL_TEXT_COMPARISON');
  });
});
