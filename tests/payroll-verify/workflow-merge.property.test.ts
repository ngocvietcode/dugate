/**
 * Property-based tests for OCR merge (Property 2) and merged counts invariant (Property 3).
 *
 * Feature: payroll-verify-workflow, Property 2: OCR merge preserves all records with original STT
 * Feature: payroll-verify-workflow, Property 3: Document counts and fallback
 *
 * **Validates: Requirements 5.3, 5.4, 5.5, 8.2**
 */
import * as fc from 'fast-check';
import { mergeOcrResults } from '@/lib/pipelines/workflows/payroll-verify';
import type { PayrollJSON, PayrollRecord } from '@/lib/pipelines/workflows/prompts/payroll-verify-prompts';
import { createEmptyThongTinChung } from '@/lib/pipelines/workflows/prompts/payroll-verify-prompts';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Generate a random PayrollRecord. */
const arbPayrollRecord = (stt: number): fc.Arbitrary<PayrollRecord> =>
  fc
    .tuple(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.string({ minLength: 1, maxLength: 15 }),
      fc.oneof(fc.integer({ min: 1000, max: 999_999_999 }), fc.constant('5.000.000')),
      fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
      fc.constantFrom('vpbank' as const, 'ngan_hang_khac' as const),
    )
    .map(([hoTen, soTaiKhoan, soTien, nganHang, loaiTk]) => ({
      stt,
      ho_ten: hoTen,
      so_tai_khoan: soTaiKhoan,
      so_tien: soTien,
      loai_tai_khoan: loaiTk,
      so_tien_bang_chu: null,
      dia_chi: null,
      ngan_hang: nganHang,
      ten_chi_nhanh: null,
      tinh_tp: null,
      ghi_chu: null,
      noi_dung_thanh_toan_chi_tiet: null,
      loai_tien: null,
    }));

/** Generate a random list of PayrollRecords with sequential stt. */
const arbPayrollRecordList = (minLen = 0, maxLen = 8): fc.Arbitrary<PayrollRecord[]> =>
  fc.integer({ min: minLen, max: maxLen }).chain((len) => {
    if (len === 0) return fc.constant([]);
    return fc.tuple(...Array.from({ length: len }, (_, i) => arbPayrollRecord(i + 1))).map((arr) => [...arr]);
  });

/** Generate a minimal thong_tin_chung for a page. */
const arbThongTinChung = fc.record({
  ten_don_vi_chuyen_tien: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
  ma_kh_cif: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: null }),
  dia_chi: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
  dien_thoai: fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: null }),
  so_tai_khoan_trich_no: fc.option(fc.string({ minLength: 1, maxLength: 15 }), { nil: null }),
  loai_tien: fc.constant('VND' as string | null),
  tong_so_tien_bang_so: fc.option(fc.string({ minLength: 1, maxLength: 15 }), { nil: null }),
  tong_so_tien_bang_chu: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
  ngay_lenh_chi: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: null }),
  noi_dung_thanh_toan: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
  tong_so_nhan_vien: fc.integer({ min: 0, max: 100 }),
  so_nhan_vien_vpbank: fc.integer({ min: 0, max: 50 }),
  so_nhan_vien_ngan_hang_khac: fc.integer({ min: 0, max: 50 }),
}).map((partial) => ({
  ...createEmptyThongTinChung(),
  ...partial,
}));

/** Generate a single page OCR result with random vpbank and non-vpbank lists. */
const arbPageResult = (pageIndex: number): fc.Arbitrary<{ pageIndex: number; data: PayrollJSON }> =>
  fc
    .tuple(arbThongTinChung, arbPayrollRecordList(0, 6), arbPayrollRecordList(0, 6))
    .map(([thongTinChung, vpbank, nonVpbank]) => ({
      pageIndex,
      data: {
        thong_tin_chung: thongTinChung,
        danh_sach_trong_vpbank: vpbank,
        danh_sach_ngoai_vpbank: nonVpbank,
      },
    }));

/**
 * Generate an array of page results with shuffled page indices.
 * This verifies that mergeOcrResults sorts by pageIndex correctly.
 */
const arbPageResults: fc.Arbitrary<Array<{ pageIndex: number; data: PayrollJSON }>> = fc
  .integer({ min: 1, max: 5 })
  .chain((numPages) => {
    // Generate page results for indices 0..numPages-1
    const pageArbs = Array.from({ length: numPages }, (_, i) => arbPageResult(i));
    return fc.tuple(...pageArbs).chain((pages) => {
      // Shuffle the array to test sorting
      return fc.shuffledSubarray([...pages], { minLength: pages.length, maxLength: pages.length });
    });
  });

// ─── Property 2: OCR merge preserves all records with original STT ──

describe('Feature: payroll-verify-workflow, Property 2: OCR merge preserves all records with original STT', () => {
  it('merged vpbank list length equals sum of input vpbank list lengths', () => {
    /**
     * **Validates: Requirements 5.3**
     */
    fc.assert(
      fc.property(arbPageResults, (pageResults) => {
        const merged = mergeOcrResults(pageResults);

        const expectedVpbankLen = pageResults.reduce(
          (sum, p) => sum + (p.data.danh_sach_trong_vpbank?.length ?? 0),
          0,
        );
        const expectedNonVpbankLen = pageResults.reduce(
          (sum, p) => sum + (p.data.danh_sach_ngoai_vpbank?.length ?? 0),
          0,
        );

        expect(merged.danh_sach_trong_vpbank.length).toBe(expectedVpbankLen);
        expect(merged.danh_sach_ngoai_vpbank.length).toBe(expectedNonVpbankLen);
      }),
      { numRuns: 100 },
    );
  });

  it('preserves original stt fields in vpbank page order', () => {
    /**
     * **Validates: Requirements 5.4**
     */
    fc.assert(
      fc.property(arbPageResults, (pageResults) => {
        const merged = mergeOcrResults(pageResults);

        const expected = [...pageResults].sort((a, b) => a.pageIndex - b.pageIndex)
          .flatMap((page) => page.data.danh_sach_trong_vpbank.map((record) => record.stt));
        expect(merged.danh_sach_trong_vpbank.map((record) => record.stt)).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('preserves original stt fields in non-vpbank page order', () => {
    /**
     * **Validates: Requirements 5.4**
     */
    fc.assert(
      fc.property(arbPageResults, (pageResults) => {
        const merged = mergeOcrResults(pageResults);

        const expected = [...pageResults].sort((a, b) => a.pageIndex - b.pageIndex)
          .flatMap((page) => page.data.danh_sach_ngoai_vpbank.map((record) => record.stt));
        expect(merged.danh_sach_ngoai_vpbank.map((record) => record.stt)).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('record order within each page is preserved after merge', () => {
    /**
     * **Validates: Requirements 5.3, 5.4**
     */
    fc.assert(
      fc.property(arbPageResults, (pageResults) => {
        const merged = mergeOcrResults(pageResults);

        // Sort pages by pageIndex (same as mergeOcrResults does internally)
        const sorted = [...pageResults].sort((a, b) => a.pageIndex - b.pageIndex);

        // Check vpbank list: records from each page appear in order
        let vpbankOffset = 0;
        for (const page of sorted) {
          const pageVpbank = page.data.danh_sach_trong_vpbank ?? [];
          for (let i = 0; i < pageVpbank.length; i++) {
            const mergedRecord = merged.danh_sach_trong_vpbank[vpbankOffset + i];
            // ho_ten and so_tai_khoan should match (stt is preserved)
            expect(mergedRecord.ho_ten).toBe(pageVpbank[i].ho_ten);
            expect(mergedRecord.so_tai_khoan).toBe(pageVpbank[i].so_tai_khoan);
            expect(mergedRecord.so_tien).toBe(pageVpbank[i].so_tien);
          }
          vpbankOffset += pageVpbank.length;
        }

        // Check non-vpbank list: records from each page appear in order
        let nonVpbankOffset = 0;
        for (const page of sorted) {
          const pageNonVpbank = page.data.danh_sach_ngoai_vpbank ?? [];
          for (let i = 0; i < pageNonVpbank.length; i++) {
            const mergedRecord = merged.danh_sach_ngoai_vpbank[nonVpbankOffset + i];
            expect(mergedRecord.ho_ten).toBe(pageNonVpbank[i].ho_ten);
            expect(mergedRecord.so_tai_khoan).toBe(pageNonVpbank[i].so_tai_khoan);
            expect(mergedRecord.so_tien).toBe(pageNonVpbank[i].so_tien);
          }
          nonVpbankOffset += pageNonVpbank.length;
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 3: Document counts and fallback ──────────────────────────────────────

describe('Feature: payroll-verify-workflow, Property 3: Document counts and fallback', () => {
  it('preserves the first non-zero document total even when it differs from list counts', () => {
    fc.assert(fc.property(arbPageResults, (pages) => {
      const sorted = [...pages].sort((a, b) => a.pageIndex - b.pageIndex);
      const declared = sorted.find((page) => page.data.thong_tin_chung.tong_so_nhan_vien !== 0);
      const merged = mergeOcrResults(pages);
      expect(merged.thong_tin_chung.tong_so_nhan_vien).toBe(declared
        ? declared.data.thong_tin_chung.tong_so_nhan_vien
        : merged.danh_sach_trong_vpbank.length + merged.danh_sach_ngoai_vpbank.length);
    }), { numRuns: 100 });
  });

  it('preserves the first non-zero per-bank counts when a document total is present', () => {
    fc.assert(fc.property(arbPageResults, (pages) => {
      const sorted = [...pages].sort((a, b) => a.pageIndex - b.pageIndex);
      // An explicit total selects the preserve-document branch for every generated case.
      const withTotal = sorted.map((page) => ({ ...page, data: { ...page.data,
        thong_tin_chung: { ...page.data.thong_tin_chung, tong_so_nhan_vien: 123 },
      } }));
      const merged = mergeOcrResults(withTotal);
      for (const key of ['so_nhan_vien_vpbank', 'so_nhan_vien_ngan_hang_khac'] as const) {
        const first = sorted.find((page) => page.data.thong_tin_chung[key] !== 0);
        expect(merged.thong_tin_chung[key]).toBe(first?.data.thong_tin_chung[key] ?? 0);
      }
    }), { numRuns: 100 });
  });

  it('falls back to actual list counts when every page lacks a document total', () => {
    fc.assert(fc.property(arbPageResults, (pages) => {
      const withoutTotals = pages.map((page) => ({ ...page, data: { ...page.data,
        thong_tin_chung: { ...page.data.thong_tin_chung, tong_so_nhan_vien: 0,
          so_nhan_vien_vpbank: 0, so_nhan_vien_ngan_hang_khac: 0 },
      } }));
      const merged = mergeOcrResults(withoutTotals);
      expect(merged.thong_tin_chung.so_nhan_vien_vpbank).toBe(merged.danh_sach_trong_vpbank.length);
      expect(merged.thong_tin_chung.so_nhan_vien_ngan_hang_khac).toBe(merged.danh_sach_ngoai_vpbank.length);
      expect(merged.thong_tin_chung.tong_so_nhan_vien).toBe(
        merged.danh_sach_trong_vpbank.length + merged.danh_sach_ngoai_vpbank.length);
    }), { numRuns: 100 });
  });
});
