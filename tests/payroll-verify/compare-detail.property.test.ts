/**
 * Property-based tests for row matching partitions (Property 9).
 *
 * Feature: payroll-verify-workflow, Property 9: Row matching partitions into matched, missing, and extra
 *
 * **Validates: Requirements 13.1, 13.2, 13.3**
 */
import * as fc from 'fast-check';
import { comparePayrollData } from '@/lib/pipelines/workflows/payroll-verify-compare';
import type {
  CompareConfig,
  CompareOptions,
  PayrollJSON,
  PayrollRecord,
} from '@/lib/pipelines/workflows/prompts/payroll-verify-prompts';
import { createEmptyThongTinChung } from '@/lib/pipelines/workflows/prompts/payroll-verify-prompts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: CompareOptions = {
  trim_string: true,
  case_insensitive: true,
  remove_vietnamese_accents: true,
  collapse_whitespace: true,
  number_remove_commas: true,
  treat_null_as_empty: true,
};

/**
 * Build a minimal CompareConfig with a single detail_rule using so_tai_khoan as match_key.
 */
function buildMinimalConfig(includeUnmatchedFromB: boolean): CompareConfig {
  return {
    header_rules: [],
    detail_rules: [
      {
        section_code: 'test_section',
        source_a_list_path: 'danh_sach_trong_vpbank',
        source_b_list_path: 'danh_sach_trong_vpbank',
        match_key: 'so_tai_khoan',
        include_unmatched_from_b: includeUnmatchedFromB,
        compare_fields: [
          {
            field_code: 'ho_ten',
            source_a_field: 'ho_ten',
            source_b_field: 'ho_ten',
            compare_mode: 'vietnamese_name_normalized',
          },
        ],
      },
    ],
    options: DEFAULT_OPTIONS,
  };
}

/**
 * Build a PayrollRecord with the given account number.
 */
function makeRecord(soTaiKhoan: string, index: number): PayrollRecord {
  return {
    stt: index + 1,
    ho_ten: `EMPLOYEE ${index + 1}`,
    so_tai_khoan: soTaiKhoan,
    so_tien: 1000000,
    loai_tai_khoan: 'vpbank',
    so_tien_bang_chu: null,
    dia_chi: null,
    ngan_hang: null,
    ten_chi_nhanh: null,
    tinh_tp: null,
    ghi_chu: null,
    noi_dung_thanh_toan_chi_tiet: null,
    loai_tien: null,
  };
}

/**
 * Build a minimal PayrollJSON wrapping a list of records.
 */
function buildPayrollJSON(records: PayrollRecord[]): PayrollJSON {
  return {
    thong_tin_chung: {
      ...createEmptyThongTinChung(),
      tong_so_nhan_vien: records.length,
      so_nhan_vien_vpbank: records.length,
      so_nhan_vien_ngan_hang_khac: 0,
    },
    danh_sach_trong_vpbank: records,
    danh_sach_ngoai_vpbank: [],
  };
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/**
 * Generate a unique array of account number strings (alphanumeric, 5-15 chars).
 */
const uniqueAccountsArb = (minLength: number, maxLength: number) =>
  fc.uniqueArray(
    fc.stringMatching(/^[0-9a-zA-Z]{5,15}$/),
    { minLength, maxLength, comparator: (a, b) => a === b },
  );

/**
 * Generate two PayrollRecord arrays with controlled key overlap:
 * - `shared`: keys present in both A and B
 * - `onlyA`: keys present only in A
 * - `onlyB`: keys present only in B
 */
const overlappingRecordPairsArb = fc
  .tuple(
    uniqueAccountsArb(0, 8),  // shared keys
    uniqueAccountsArb(0, 5),  // onlyA keys
    uniqueAccountsArb(0, 5),  // onlyB keys
  )
  .filter(([shared, onlyA, onlyB]) => {
    // Ensure no overlap between the three sets
    const all = new Set([...shared, ...onlyA, ...onlyB]);
    return all.size === shared.length + onlyA.length + onlyB.length;
  })
  .filter(([shared, onlyA]) => {
    // Ensure source A has at least 1 record so the test is meaningful
    return shared.length + onlyA.length > 0;
  })
  .map(([shared, onlyA, onlyB]) => {
    const recordsA = [...shared, ...onlyA].map((key, i) => makeRecord(key, i));
    const recordsB = [...shared, ...onlyB].map((key, i) => makeRecord(key, i));
    return {
      recordsA,
      recordsB,
      sharedKeys: new Set(shared),
      onlyAKeys: new Set(onlyA),
      onlyBKeys: new Set(onlyB),
    };
  });

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Feature: payroll-verify-workflow, Property 9: Row matching partitions into matched, missing, and extra', () => {
  it('every source A key appears exactly once in either detail_compare or missing_rows', () => {
    fc.assert(
      fc.property(overlappingRecordPairsArb, ({ recordsA, recordsB }) => {
        const sourceA = buildPayrollJSON(recordsA);
        const sourceB = buildPayrollJSON(recordsB);
        const config = buildMinimalConfig(true);

        const result = comparePayrollData(sourceA, sourceB, config);
        expect(result.ok).toBe(true);

        const section = result.detail_results[0];
        const detailKeys = section.detail_compare.map((r) => r.match_key);
        const missingKeys = section.missing_rows.map((r) => r.match_key);

        // Every source A key must appear in detail_compare (which includes both matched and missing-as-fail rows)
        const allSourceAKeys = recordsA.map((r) => r.so_tai_khoan);
        for (const key of allSourceAKeys) {
          const inDetail = detailKeys.filter((k) => k === key).length;
          expect(inDetail).toBe(1);
        }

        // Missing rows are a subset of detail_compare rows with found_in_pdf === false
        const missingInDetail = section.detail_compare.filter((r) => !r.found_in_pdf);
        expect(missingInDetail.length).toBe(missingKeys.length);
        for (const mr of missingKeys) {
          expect(missingInDetail.some((r) => r.match_key === mr)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('if include_unmatched_from_b is true, every source B key not in source A appears in extra_rows', () => {
    fc.assert(
      fc.property(overlappingRecordPairsArb, ({ recordsA, recordsB, onlyBKeys }) => {
        const sourceA = buildPayrollJSON(recordsA);
        const sourceB = buildPayrollJSON(recordsB);
        const config = buildMinimalConfig(true);

        const result = comparePayrollData(sourceA, sourceB, config);
        expect(result.ok).toBe(true);

        const section = result.detail_results[0];
        const extraKeys = new Set(section.extra_rows.map((r) => r.match_key));

        // Every B-only key should be in extra_rows
        for (const key of Array.from(onlyBKeys)) {
          expect(extraKeys.has(key)).toBe(true);
        }

        // extra_rows should only contain B-only keys
        expect(extraKeys.size).toBe(onlyBKeys.size);
      }),
      { numRuns: 100 },
    );
  });

  it('matched + missing = |source A|, no key in more than one partition', () => {
    fc.assert(
      fc.property(overlappingRecordPairsArb, ({ recordsA, recordsB }) => {
        const sourceA = buildPayrollJSON(recordsA);
        const sourceB = buildPayrollJSON(recordsB);
        const config = buildMinimalConfig(true);

        const result = comparePayrollData(sourceA, sourceB, config);
        expect(result.ok).toBe(true);

        const section = result.detail_results[0];

        // detail_compare contains ALL source A rows (matched + missing)
        expect(section.detail_compare.length).toBe(recordsA.length);

        const matchedKeys = section.detail_compare
          .filter((r) => r.found_in_pdf)
          .map((r) => r.match_key);
        const missingKeys = section.missing_rows.map((r) => r.match_key);
        const extraKeys = section.extra_rows.map((r) => r.match_key);

        // matched + missing = |source A|
        expect(matchedKeys.length + missingKeys.length).toBe(recordsA.length);

        // No key appears in more than one partition
        const allKeys = [...matchedKeys, ...missingKeys, ...extraKeys];
        const uniqueKeys = new Set(allKeys);
        expect(uniqueKeys.size).toBe(allKeys.length);
      }),
      { numRuns: 100 },
    );
  });

  it('when include_unmatched_from_b is false, extra_rows is empty', () => {
    fc.assert(
      fc.property(overlappingRecordPairsArb, ({ recordsA, recordsB }) => {
        const sourceA = buildPayrollJSON(recordsA);
        const sourceB = buildPayrollJSON(recordsB);
        const config = buildMinimalConfig(false);

        const result = comparePayrollData(sourceA, sourceB, config);
        expect(result.ok).toBe(true);

        const section = result.detail_results[0];
        expect(section.extra_rows.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});


// ─── Property 10 Tests ───────────────────────────────────────────────────────

/**
 * Property-based tests for verdict logic (Property 10).
 *
 * Feature: payroll-verify-workflow, Property 10: Verdict is logical AND of all sub-statuses
 *
 * **Validates: Requirements 14.1, 14.2**
 */

describe('Feature: payroll-verify-workflow, Property 10: Verdict is logical AND of all sub-statuses', () => {
  /**
   * Build a CompareConfig that has one header rule and one detail rule.
   * The header rule compares a simple string_exact field.
   * The detail rule compares employee records by so_tai_khoan.
   */
  function buildVerdictConfig(): CompareConfig {
    return {
      header_rules: [
        {
          field_code: 'test_header',
          source_a_path: 'thong_tin_chung.ten_don_vi_chuyen_tien',
          source_b_path: 'thong_tin_chung.ten_don_vi_chuyen_tien',
          compare_mode: 'string_exact',
        },
      ],
      detail_rules: [
        {
          section_code: 'test_section',
          source_a_list_path: 'danh_sach_trong_vpbank',
          source_b_list_path: 'danh_sach_trong_vpbank',
          match_key: 'so_tai_khoan',
          include_unmatched_from_b: true,
          compare_fields: [
            {
              field_code: 'ho_ten',
              source_a_field: 'ho_ten',
              source_b_field: 'ho_ten',
              compare_mode: 'string_exact',
            },
          ],
        },
      ],
      options: DEFAULT_OPTIONS,
    };
  }

  /**
   * Build a PayrollJSON with a specific header value and employee records.
   */
  function buildPayrollWithHeader(
    headerValue: string,
    records: PayrollRecord[],
  ): PayrollJSON {
    return {
      thong_tin_chung: {
        ...createEmptyThongTinChung(),
        ten_don_vi_chuyen_tien: headerValue,
        tong_so_nhan_vien: records.length,
        so_nhan_vien_vpbank: records.length,
        so_nhan_vien_ngan_hang_khac: 0,
      },
      danh_sach_trong_vpbank: records,
      danh_sach_ngoai_vpbank: [],
    };
  }

  /**
   * Arbitrary for header pass/fail and detail pass/fail combinations.
   * Generates { headerPass: boolean, detailPass: boolean } along with
   * two PayrollJSON objects that produce the desired header/detail outcomes.
   */
  const verdictArb = fc
    .record({
      headerPass: fc.boolean(),
      detailPass: fc.boolean(),
      headerValueA: fc.stringMatching(/^[A-Z]{3,10}$/),
      accountKey: fc.stringMatching(/^[0-9]{5,10}$/),
      employeeName: fc.stringMatching(/^[A-Z]{3,10}$/),
    })
    .map(({ headerPass, detailPass, headerValueA, accountKey, employeeName }) => {
      const headerValueB = headerPass ? headerValueA : headerValueA + '_DIFF';

      // For detail: both sources have one record with the same account key.
      // If detailPass, the employee name matches; if not, it differs.
      const recordA: PayrollRecord = {
        stt: 1,
        ho_ten: employeeName,
        so_tai_khoan: accountKey,
        so_tien: 1000000,
        loai_tai_khoan: 'vpbank',
        so_tien_bang_chu: null,
        dia_chi: null,
        ngan_hang: null,
        ten_chi_nhanh: null,
        tinh_tp: null,
        ghi_chu: null,
        noi_dung_thanh_toan_chi_tiet: null,
        loai_tien: null,
      };
      const recordB: PayrollRecord = {
        stt: 1,
        ho_ten: detailPass ? employeeName : employeeName + '_DIFF',
        so_tai_khoan: accountKey,
        so_tien: 1000000,
        loai_tai_khoan: 'vpbank',
        so_tien_bang_chu: null,
        dia_chi: null,
        ngan_hang: null,
        ten_chi_nhanh: null,
        tinh_tp: null,
        ghi_chu: null,
        noi_dung_thanh_toan_chi_tiet: null,
        loai_tien: null,
      };

      const sourceA = buildPayrollWithHeader(headerValueA, [recordA]);
      const sourceB = buildPayrollWithHeader(headerValueB, [recordB]);

      return { headerPass, detailPass, sourceA, sourceB };
    });

  it('overall_status is pass iff both header_status and detail_status are pass', () => {
    fc.assert(
      fc.property(verdictArb, ({ headerPass, detailPass, sourceA, sourceB }) => {
        const config = buildVerdictConfig();
        const result = comparePayrollData(sourceA, sourceB, config);

        expect(result.ok).toBe(true);

        const expectedOverall = headerPass && detailPass ? 'pass' : 'fail';
        expect(result.summary.header_status).toBe(headerPass ? 'pass' : 'fail');
        expect(result.summary.detail_status).toBe(detailPass ? 'pass' : 'fail');
        expect(result.summary.overall_status).toBe(expectedOverall);
      }),
      { numRuns: 100 },
    );
  });

  it('final_decision is APPROVED when overall pass, REVIEW_REQUIRED when overall fail', () => {
    fc.assert(
      fc.property(verdictArb, ({ headerPass, detailPass, sourceA, sourceB }) => {
        const config = buildVerdictConfig();
        const result = comparePayrollData(sourceA, sourceB, config);

        expect(result.ok).toBe(true);

        const bothPass = headerPass && detailPass;
        expect(result.final_decision).toBe(bothPass ? 'APPROVED' : 'REVIEW_REQUIRED');
        expect(result.compare_status).toBe(bothPass ? 'pass' : 'fail');
      }),
      { numRuns: 100 },
    );
  });
});


// ─── Property 11 Tests ───────────────────────────────────────────────────────

/**
 * Property-based tests for summary aggregation (Property 11).
 *
 * Feature: payroll-verify-workflow, Property 11: Summary aggregation across detail sections
 *
 * **Validates: Requirements 14.3**
 */

describe('Feature: payroll-verify-workflow, Property 11: Summary aggregation across detail sections', () => {
  /**
   * Build a CompareConfig with TWO detail_rules (trong_vpbank + ngoai_vpbank),
   * matching the DEFAULT_COMPARE_CONFIG structure.
   */
  function buildTwoSectionConfig(): CompareConfig {
    return {
      header_rules: [],
      detail_rules: [
        {
          section_code: 'trong_vpbank',
          source_a_list_path: 'danh_sach_trong_vpbank',
          source_b_list_path: 'danh_sach_trong_vpbank',
          match_key: 'so_tai_khoan',
          include_unmatched_from_b: true,
          compare_fields: [
            {
              field_code: 'ho_ten',
              source_a_field: 'ho_ten',
              source_b_field: 'ho_ten',
              compare_mode: 'string_exact',
            },
          ],
        },
        {
          section_code: 'ngoai_vpbank',
          source_a_list_path: 'danh_sach_ngoai_vpbank',
          source_b_list_path: 'danh_sach_ngoai_vpbank',
          match_key: 'so_tai_khoan',
          include_unmatched_from_b: true,
          compare_fields: [
            {
              field_code: 'ho_ten',
              source_a_field: 'ho_ten',
              source_b_field: 'ho_ten',
              compare_mode: 'string_exact',
            },
          ],
        },
      ],
      options: DEFAULT_OPTIONS,
    };
  }

  /**
   * Build a PayrollJSON with separate trong_vpbank and ngoai_vpbank record lists.
   */
  function buildTwoSectionPayrollJSON(
    vpbankRecords: PayrollRecord[],
    nonVpbankRecords: PayrollRecord[],
  ): PayrollJSON {
    return {
      thong_tin_chung: {
        ...createEmptyThongTinChung(),
        tong_so_nhan_vien: vpbankRecords.length + nonVpbankRecords.length,
        so_nhan_vien_vpbank: vpbankRecords.length,
        so_nhan_vien_ngan_hang_khac: nonVpbankRecords.length,
      },
      danh_sach_trong_vpbank: vpbankRecords,
      danh_sach_ngoai_vpbank: nonVpbankRecords,
    };
  }

  /**
   * Generate unique account keys for a given section prefix to avoid cross-section collisions.
   */
  const sectionAccountsArb = (prefix: string, minLen: number, maxLen: number) =>
    fc.uniqueArray(
      fc.stringMatching(/^[0-9]{5,10}$/).map((s) => `${prefix}_${s}`),
      { minLength: minLen, maxLength: maxLen, comparator: (a, b) => a === b },
    );

  /**
   * Generate two PayrollRecord arrays (source A and source B) for a section
   * with controlled overlap: shared keys, A-only keys, B-only keys.
   * Also allows name mismatches on shared keys to produce mismatched rows.
   */
  const sectionPairArb = (prefix: string) =>
    fc.tuple(
      sectionAccountsArb(`${prefix}_shared`, 0, 5),
      sectionAccountsArb(`${prefix}_onlyA`, 0, 3),
      sectionAccountsArb(`${prefix}_onlyB`, 0, 3),
      fc.boolean(), // whether shared rows have matching names
    )
      .filter(([shared, onlyA, onlyB]) => {
        const all = new Set([...shared, ...onlyA, ...onlyB]);
        return all.size === shared.length + onlyA.length + onlyB.length;
      })
      .map(([shared, onlyA, onlyB, namesMatch]) => {
        const recordsA = [...shared, ...onlyA].map((key, i) => makeRecord(key, i));
        const recordsB = [
          ...shared.map((key, i) => ({
            ...makeRecord(key, i),
            ho_ten: namesMatch ? makeRecord(key, i).ho_ten : `DIFFERENT_${i}`,
          })),
          ...onlyB.map((key, i) => makeRecord(key, shared.length + i)),
        ];
        return { recordsA, recordsB };
      });

  /**
   * Arbitrary that generates source A and source B PayrollJSON objects
   * with both vpbank and non-vpbank sections populated with random overlaps.
   */
  const twoSectionArb = fc
    .tuple(sectionPairArb('vp'), sectionPairArb('nv'))
    .map(([vpbank, nonVpbank]) => {
      const sourceA = buildTwoSectionPayrollJSON(vpbank.recordsA, nonVpbank.recordsA);
      const sourceB = buildTwoSectionPayrollJSON(vpbank.recordsB, nonVpbank.recordsB);
      return { sourceA, sourceB };
    });

  it('summary total_excel_rows equals sum of each section total_excel_rows', () => {
    fc.assert(
      fc.property(twoSectionArb, ({ sourceA, sourceB }) => {
        const config = buildTwoSectionConfig();
        const result = comparePayrollData(sourceA, sourceB, config);
        expect(result.ok).toBe(true);

        const sectionSum = result.detail_results.reduce(
          (sum, s) => sum + s.summary.total_excel_rows,
          0,
        );
        expect(result.summary.total_excel_rows).toBe(sectionSum);
      }),
      { numRuns: 100 },
    );
  });

  it('summary matched_rows equals sum of each section matched_rows', () => {
    fc.assert(
      fc.property(twoSectionArb, ({ sourceA, sourceB }) => {
        const config = buildTwoSectionConfig();
        const result = comparePayrollData(sourceA, sourceB, config);
        expect(result.ok).toBe(true);

        const sectionSum = result.detail_results.reduce(
          (sum, s) => sum + s.summary.matched_rows,
          0,
        );
        expect(result.summary.matched_rows).toBe(sectionSum);
      }),
      { numRuns: 100 },
    );
  });

  it('summary mismatched_rows equals sum of each section mismatched_rows', () => {
    fc.assert(
      fc.property(twoSectionArb, ({ sourceA, sourceB }) => {
        const config = buildTwoSectionConfig();
        const result = comparePayrollData(sourceA, sourceB, config);
        expect(result.ok).toBe(true);

        const sectionSum = result.detail_results.reduce(
          (sum, s) => sum + s.summary.mismatched_rows,
          0,
        );
        expect(result.summary.mismatched_rows).toBe(sectionSum);
      }),
      { numRuns: 100 },
    );
  });

  it('summary missing_in_pdf equals sum of each section missing_in_pdf', () => {
    fc.assert(
      fc.property(twoSectionArb, ({ sourceA, sourceB }) => {
        const config = buildTwoSectionConfig();
        const result = comparePayrollData(sourceA, sourceB, config);
        expect(result.ok).toBe(true);

        const sectionSum = result.detail_results.reduce(
          (sum, s) => sum + s.summary.missing_in_pdf,
          0,
        );
        expect(result.summary.missing_in_pdf).toBe(sectionSum);
      }),
      { numRuns: 100 },
    );
  });

  it('summary extra_in_pdf equals sum of each section extra_in_pdf', () => {
    fc.assert(
      fc.property(twoSectionArb, ({ sourceA, sourceB }) => {
        const config = buildTwoSectionConfig();
        const result = comparePayrollData(sourceA, sourceB, config);
        expect(result.ok).toBe(true);

        const sectionSum = result.detail_results.reduce(
          (sum, s) => sum + s.summary.extra_in_pdf,
          0,
        );
        expect(result.summary.extra_in_pdf).toBe(sectionSum);
      }),
      { numRuns: 100 },
    );
  });
});


// ─── Property 12 Tests ───────────────────────────────────────────────────────

/**
 * Property-based tests for comparison output completeness (Property 12).
 *
 * Feature: payroll-verify-workflow, Property 12: Comparison output completeness
 *
 * **Validates: Requirements 12.5, 13.4**
 */

describe('Feature: payroll-verify-workflow, Property 12: Comparison output completeness', () => {
  /** Required fields on every HeaderFieldResult */
  const REQUIRED_HEADER_FIELD_KEYS: readonly string[] = [
    'field_code',
    'compare_mode',
    'excel_value',
    'pdf_value',
    'normalized_excel_value',
    'normalized_pdf_value',
    'result',
    'reason',
  ] as const;

  /**
   * Arbitrary for a random compare mode.
   */
  const compareModeArb = fc.constantFrom(
    'vietnamese_name_normalized' as const,
    'string_exact' as const,
    'string_normalized' as const,
    'number_normalized' as const,
  );

  /**
   * Arbitrary for a random header rule with random field_code and paths
   * that point to real locations in the PayrollJSON thong_tin_chung.
   */
  const headerRuleArb = fc
    .record({
      field_code: fc.stringMatching(/^[a-z_]{3,12}$/),
      mode: compareModeArb,
    })
    .map(({ field_code, mode }) => ({
      field_code,
      source_a_path: 'thong_tin_chung.ten_don_vi_chuyen_tien',
      source_b_path: 'thong_tin_chung.ten_don_vi_chuyen_tien',
      compare_mode: mode,
    }));

  /**
   * Arbitrary for a random detail field rule.
   */
  const detailFieldRuleArb = fc
    .record({
      field_code: fc.stringMatching(/^[a-z_]{3,12}$/),
      mode: compareModeArb,
    })
    .map(({ field_code, mode }) => ({
      field_code,
      source_a_field: 'ho_ten',
      source_b_field: 'ho_ten',
      compare_mode: mode,
    }));

  /**
   * Generate a CompareConfig with random header rules and detail rules
   * that have at least 1 compare_field each.
   */
  const completenessConfigArb = fc
    .tuple(
      fc.array(headerRuleArb, { minLength: 1, maxLength: 5 }),
      fc.array(detailFieldRuleArb, { minLength: 1, maxLength: 4 }),
    )
    .map(([headerRules, compareFields]) => ({
      header_rules: headerRules,
      detail_rules: [
        {
          section_code: 'test_section',
          source_a_list_path: 'danh_sach_trong_vpbank',
          source_b_list_path: 'danh_sach_trong_vpbank',
          match_key: 'so_tai_khoan',
          include_unmatched_from_b: true,
          compare_fields: compareFields,
        },
      ],
      options: DEFAULT_OPTIONS,
    } as CompareConfig));

  /**
   * Generate two PayrollJSON objects with shared employee records
   * so that detail rows are matched and field_results are populated.
   */
  const matchedPayrollPairArb = fc
    .tuple(
      fc.uniqueArray(fc.stringMatching(/^[0-9]{5,10}$/), {
        minLength: 1,
        maxLength: 6,
        comparator: (a, b) => a === b,
      }),
      fc.stringMatching(/^[A-Z]{3,10}$/),
    )
    .map(([accounts, nameBase]) => {
      const recordsA = accounts.map((acc, i) => makeRecord(acc, i));
      const recordsB = accounts.map((acc, i) => ({
        ...makeRecord(acc, i),
        ho_ten: `${nameBase}_${i}`,
      }));
      return {
        sourceA: buildPayrollJSON(recordsA),
        sourceB: buildPayrollJSON(recordsB),
      };
    });

  it('every header field result includes all required fields (not undefined)', () => {
    fc.assert(
      fc.property(
        completenessConfigArb,
        matchedPayrollPairArb,
        (config, { sourceA, sourceB }) => {
          const result = comparePayrollData(sourceA, sourceB, config);
          expect(result.ok).toBe(true);

          for (const hf of result.header_compare) {
            for (const key of REQUIRED_HEADER_FIELD_KEYS) {
              expect((hf as unknown as Record<string, unknown>)[key]).not.toBeUndefined();
            }
          }

          // Number of header results matches number of header rules
          expect(result.header_compare.length).toBe(config.header_rules.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('every matched detail row field result includes all required fields (not undefined)', () => {
    fc.assert(
      fc.property(
        completenessConfigArb,
        matchedPayrollPairArb,
        (config, { sourceA, sourceB }) => {
          const result = comparePayrollData(sourceA, sourceB, config);
          expect(result.ok).toBe(true);

          for (const section of result.detail_results) {
            for (const row of section.detail_compare) {
              if (!row.found_in_pdf) continue; // skip missing rows — they have no field_results

              // Each matched row should have field_results matching compare_fields count
              const expectedFieldCount = config.detail_rules[0].compare_fields.length;
              expect(row.field_results.length).toBe(expectedFieldCount);

              for (const fr of row.field_results) {
                for (const key of REQUIRED_HEADER_FIELD_KEYS) {
                  expect((fr as unknown as Record<string, unknown>)[key]).not.toBeUndefined();
                }
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
