/**
 * Property-based tests for Excel header row detection (Property 5).
 *
 * Feature: payroll-verify-workflow, Property 5: Excel header row detection
 *
 * **Validates: Requirements 6.2, 6.3**
 */
import * as fc from 'fast-check';
import { findHeaderAndOutsideText } from '@/lib/pipelines/workflows/payroll-verify-excel';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Join non-empty cell values in a row into a single text line (mirrors rowToText in source). */
function rowToText(row: unknown[]): string {
  return row
    .map((cell) => (cell == null ? '' : String(cell).trim()))
    .filter((s) => s.length > 0)
    .join(' ');
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Generate a non-empty text cell that is NOT a pure integer and NOT "stt" variants. */
const lowerAlphaArb = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split(''));
const textCellArb = fc
  .array(lowerAlphaArb, { minLength: 2, maxLength: 12 })
  .map((chars) => chars.join(''))
  .filter((s) => {
    const trimmed = s.trim().toLowerCase();
    return trimmed.length > 0 && trimmed !== 'stt' && !/^\d+$/.test(trimmed.replace(/\./g, ''));
  });

/** Generate a row of random text cells (for above-header or below-table rows). */
const textRowArb = fc.array(textCellArb, { minLength: 1, maxLength: 5 });

/** Generate a header row with "stt" (case variants) as the first cell. */
const sttVariantArb = fc.constantFrom('stt', 'STT', 'Stt', 'sTT', 'stT');
const headerRowArb = fc.tuple(sttVariantArb, fc.array(textCellArb, { minLength: 0, maxLength: 4 })).map(
  ([stt, rest]) => [stt, ...rest] as unknown[],
);

/** Generate a data row with an integer first cell (table data). */
const dataRowArb = fc.tuple(
  fc.integer({ min: 1, max: 9999 }),
  fc.array(textCellArb, { minLength: 1, maxLength: 5 }),
).map(([stt, rest]) => [stt, ...rest] as unknown[]);


// ─── Property 5 Tests ─────────────────────────────────────────────────────────

describe('Feature: payroll-verify-workflow, Property 5: Excel header row detection', () => {
  /**
   * Generate a complete row array structure:
   * - N rows of text above the header (aboveRows)
   * - 1 header row with "stt" first cell
   * - M data rows with integer first cells (table data)
   * - 2 non-integer rows to trigger table end detection
   * - K rows of text below the table (belowRows)
   */
  const rowsWithHeaderArb = fc
    .tuple(
      fc.array(textRowArb, { minLength: 0, maxLength: 4 }),   // aboveRows
      headerRowArb,                                             // header
      fc.array(dataRowArb, { minLength: 1, maxLength: 6 }),    // dataRows
      fc.array(textRowArb, { minLength: 0, maxLength: 3 }),    // belowRows
    )
    .map(([aboveRows, headerRow, dataRows, belowRows]) => {
      // 2 non-integer rows to trigger table end
      const endMarkerRows: unknown[][] = [
        ['total', 'summary'],
        ['footer', 'note'],
      ];
      return {
        rows: [...aboveRows, headerRow, ...dataRows, ...endMarkerRows, ...belowRows] as unknown[][],
        aboveRows,
        headerRow,
        dataRows,
        endMarkerRows,
        belowRows,
        expectedHeaderIndex: aboveRows.length,
      };
    });

  it('returns found: true with correct headerRowIndex when "stt" row exists', () => {
    fc.assert(
      fc.property(rowsWithHeaderArb, ({ rows, expectedHeaderIndex }) => {
        const result = findHeaderAndOutsideText(rows);
        expect(result.found).toBe(true);
        expect(result.headerRowIndex).toBe(expectedHeaderIndex);
      }),
      { numRuns: 100 },
    );
  });

  it('headerRowIndex points to a row whose first cell is "stt" (case-insensitive)', () => {
    fc.assert(
      fc.property(rowsWithHeaderArb, ({ rows }) => {
        const result = findHeaderAndOutsideText(rows);
        expect(result.found).toBe(true);
        const headerRow = rows[result.headerRowIndex!];
        expect(String(headerRow[0]).trim().toLowerCase()).toBe('stt');
      }),
      { numRuns: 100 },
    );
  });

  it('generalInfo contains text from rows above the header', () => {
    fc.assert(
      fc.property(rowsWithHeaderArb, ({ rows, aboveRows }) => {
        const result = findHeaderAndOutsideText(rows);
        for (const row of aboveRows) {
          const txt = rowToText(row);
          if (txt) {
            expect(result.generalInfo).toContain(txt);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('generalInfo contains text from rows below the table end', () => {
    fc.assert(
      fc.property(rowsWithHeaderArb, ({ rows, belowRows }) => {
        const result = findHeaderAndOutsideText(rows);
        for (const row of belowRows) {
          const txt = rowToText(row);
          if (txt) {
            expect(result.generalInfo).toContain(txt);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('generalInfo does NOT contain text from table data rows (rows with integer first cell between header and table end)', () => {
    fc.assert(
      fc.property(rowsWithHeaderArb, ({ rows, dataRows, expectedHeaderIndex }) => {
        const result = findHeaderAndOutsideText(rows);
        // Data rows are between header+1 and tableEnd
        // Each data row has a unique integer first cell followed by text
        for (const dataRow of dataRows) {
          const fullRowText = rowToText(dataRow);
          // The full row text (including the integer stt) should not appear in generalInfo
          // We check the non-stt portion to be more precise
          const nonSttText = dataRow
            .slice(1)
            .map((cell) => (cell == null ? '' : String(cell).trim()))
            .filter((s) => s.length > 0)
            .join(' ');
          if (nonSttText && nonSttText.length > 3) {
            // Only check if there's meaningful text content
            expect(result.generalInfo).not.toContain(fullRowText);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('returns found: false when no row has "stt" as first cell', () => {
    fc.assert(
      fc.property(
        fc.array(textRowArb, { minLength: 1, maxLength: 8 }),
        (rows) => {
          const result = findHeaderAndOutsideText(rows);
          expect(result.found).toBe(false);
          expect(result.headerRowIndex).toBeNull();
          expect(result.tableEndIndex).toBeNull();
          expect(result.generalInfo).toBe('');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('tableEndIndex is set correctly when 2+ consecutive non-integer first cells appear after data rows', () => {
    fc.assert(
      fc.property(rowsWithHeaderArb, ({ rows, expectedHeaderIndex, dataRows }) => {
        const result = findHeaderAndOutsideText(rows);
        expect(result.tableEndIndex).not.toBeNull();
        // tableEndIndex should be after the last data row
        // The first non-integer row after data rows triggers the streak;
        // at the second consecutive non-integer row, tableEnd = (that index - 1)
        const firstEndMarkerIndex = expectedHeaderIndex + 1 + dataRows.length;
        // With 2 consecutive non-integer rows, tableEnd = secondNonIntRow - 1 = firstEndMarkerIndex
        expect(result.tableEndIndex).toBe(firstEndMarkerIndex);
      }),
      { numRuns: 100 },
    );
  });

  it('detects "stt" regardless of case (case-insensitive matching)', () => {
    const caseVariants = ['stt', 'STT', 'Stt', 'sTT', 'stT', 'StT', 'stt'];
    for (const variant of caseVariants) {
      const rows: unknown[][] = [
        ['Company Name', 'Address'],
        [variant, 'Name', 'Account', 'Amount'],
        [1, 'Nguyen Van A', '123456', 5000000],
        [2, 'Tran Thi B', '789012', 3000000],
        ['total', 'summary'],
        ['end', 'note'],
      ];
      const result = findHeaderAndOutsideText(rows);
      expect(result.found).toBe(true);
      expect(result.headerRowIndex).toBe(1);
    }
  });
});


// ─── Property 4 Tests ─────────────────────────────────────────────────────────

/**
 * Property-based tests for Excel section extraction by markers (Property 4).
 *
 * Feature: payroll-verify-workflow, Property 4: Excel section extraction by markers
 *
 * **Validates: Requirements 6.4, 6.5, 6.7**
 */
import * as xlsx from 'xlsx';
import { parsePayrollExcel } from '@/lib/pipelines/workflows/payroll-verify-excel';

// ─── Property 4 Arbitraries ──────────────────────────────────────────────────

/** Generate a valid employee name (length > 1). */
const employeeNameArb = fc
  .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), { minLength: 2, maxLength: 10 })
  .map((chars) => chars.join(''));

/** Generate a valid account number (length > 1, digits only). */
const accountNumberArb = fc
  .array(fc.constantFrom(...'0123456789'.split('')), { minLength: 2, maxLength: 12 })
  .map((digits) => digits.join(''));

/** Generate a positive integer amount. */
const amountArb = fc.integer({ min: 100000, max: 999999999 });

/** Generate a list of VPBank employee data rows (each is [stt, ho_ten, so_tai_khoan, so_tien, '', '', '']). */
const vpbankEmployeeListArb = fc
  .array(
    fc.tuple(employeeNameArb, accountNumberArb, amountArb),
    { minLength: 1, maxLength: 6 },
  )
  .map((employees) =>
    employees.map(([name, account, amount], idx) => [
      idx + 1,       // stt
      name,          // ho_ten
      account,       // so_tai_khoan
      amount,        // so_tien
      '',            // so_tien_bang_chu
      'VPBANK',      // ngan_hang_thu_huong
      '',            // noi_dung
    ]),
  );

/** Generate a list of non-VPBank employee data rows. */
const nonVpbankEmployeeListArb = fc
  .array(
    fc.tuple(employeeNameArb, accountNumberArb, amountArb, fc.constantFrom('VIETCOMBANK', 'TECHCOMBANK', 'BIDV', 'AGRIBANK')),
    { minLength: 1, maxLength: 6 },
  )
  .map((employees) =>
    employees.map(([name, account, amount, bank], idx) => [
      idx + 1,       // stt
      name,          // ho_ten
      account,       // so_tai_khoan
      amount,        // so_tien
      '',            // so_tien_bang_chu
      bank,          // ngan_hang_thu_huong
      '',            // noi_dung
    ]),
  );

/**
 * Build an xlsx Buffer from rows that include proper section markers.
 *
 * Structure:
 * - Row 0: Header info text
 * - Row 1: "stt" header row
 * - Row 2: Sub-header row (column names)
 * - Row 3: VPBank start marker
 * - Row 4: VPBank sub-header (skipped by processTableSection)
 * - Rows 5..N: VPBank employee data
 * - Row N+1: Non-VPBank start marker (also VPBank end marker)
 * - Row N+2: Non-VPBank sub-header (skipped by processTableSection)
 * - Rows N+3..M: Non-VPBank employee data
 * - Row M+1: Non-VPBank end marker ("tổng số món chuyển")
 * - Row M+2: Footer text
 */
function buildExcelBuffer(vpbankRows: unknown[][], nonVpbankRows: unknown[][]): Buffer {
  const rows: unknown[][] = [
    ['Company Info', 'Some Address', '', '', '', '', ''],
    ['stt', 'Họ tên', 'Số tài khoản', 'Số tiền', 'Số tiền bằng chữ', 'Ngân hàng', 'Nội dung'],
    ['', 'Có tài khoản thanh toán tại VPBank', '', '', '', '', ''],
    ['STT', 'Họ tên', 'Số TK', 'Số tiền', '', 'NH', ''],
    ...vpbankRows,
    ['', 'Có tài khoản thanh toán tại ngân hàng khác', '', '', '', '', ''],
    ['STT', 'Họ tên', 'Số TK', 'Số tiền', '', 'NH', ''],
    ...nonVpbankRows,
    ['', 'Tổng số món chuyển', '', '', '', '', ''],
    ['Footer', 'End of document', '', '', '', '', ''],
  ];

  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.from(buf);
}

// ─── Property 4 Test Suite ────────────────────────────────────────────────────

describe('Feature: payroll-verify-workflow, Property 4: Excel section extraction by markers', () => {
  it('extracts only VPBank rows between VPBank start and end markers', () => {
    fc.assert(
      fc.property(vpbankEmployeeListArb, nonVpbankEmployeeListArb, (vpbankRows, nonVpbankRows) => {
        const buffer = buildExcelBuffer(vpbankRows, nonVpbankRows);
        const result = parsePayrollExcel(buffer);

        // VPBank list should have exactly the number of generated VPBank employees
        expect(result.vpbankList.length).toBe(vpbankRows.length);

        // Verify each extracted VPBank record matches the input data
        for (let i = 0; i < result.vpbankList.length; i++) {
          const record = result.vpbankList[i];
          const inputRow = vpbankRows[i];
          expect(record.ho_ten).toBe(String(inputRow[1]).trim());
          expect(record.so_tai_khoan).toBe(String(inputRow[2]).trim());
          expect(record.loai_tai_khoan).toBe('vpbank');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('extracts only non-VPBank rows between non-VPBank start and end markers', () => {
    fc.assert(
      fc.property(vpbankEmployeeListArb, nonVpbankEmployeeListArb, (vpbankRows, nonVpbankRows) => {
        const buffer = buildExcelBuffer(vpbankRows, nonVpbankRows);
        const result = parsePayrollExcel(buffer);

        // Non-VPBank list should have exactly the number of generated non-VPBank employees
        expect(result.nonVpbankList.length).toBe(nonVpbankRows.length);

        // Verify each extracted non-VPBank record matches the input data
        for (let i = 0; i < result.nonVpbankList.length; i++) {
          const record = result.nonVpbankList[i];
          const inputRow = nonVpbankRows[i];
          expect(record.ho_ten).toBe(String(inputRow[1]).trim());
          expect(record.so_tai_khoan).toBe(String(inputRow[2]).trim());
          expect(record.loai_tai_khoan).toBe('ngan_hang_khac');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('every extracted record has ho_ten length > 1 and so_tai_khoan length > 1', () => {
    fc.assert(
      fc.property(vpbankEmployeeListArb, nonVpbankEmployeeListArb, (vpbankRows, nonVpbankRows) => {
        const buffer = buildExcelBuffer(vpbankRows, nonVpbankRows);
        const result = parsePayrollExcel(buffer);

        for (const record of result.vpbankList) {
          expect(record.ho_ten.length).toBeGreaterThan(1);
          expect(record.so_tai_khoan.length).toBeGreaterThan(1);
        }

        for (const record of result.nonVpbankList) {
          expect(record.ho_ten.length).toBeGreaterThan(1);
          expect(record.so_tai_khoan.length).toBeGreaterThan(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('rows with ho_ten or so_tai_khoan length <= 1 are filtered out', () => {
    fc.assert(
      fc.property(vpbankEmployeeListArb, nonVpbankEmployeeListArb, (vpbankRows, nonVpbankRows) => {
        // Add invalid rows (short name or short account) to VPBank section
        const invalidRows: unknown[][] = [
          [99, 'A', '123456', 1000000, '', 'VPBANK', ''],   // ho_ten length = 1
          [98, 'Valid Name', 'X', 2000000, '', 'VPBANK', ''], // so_tai_khoan length = 1
        ];
        const vpbankWithInvalid = [...vpbankRows, ...invalidRows];

        const buffer = buildExcelBuffer(vpbankWithInvalid, nonVpbankRows);
        const result = parsePayrollExcel(buffer);

        // Invalid rows should be filtered out — only valid vpbankRows should remain
        expect(result.vpbankList.length).toBe(vpbankRows.length);

        // None of the extracted records should have short ho_ten or so_tai_khoan
        for (const record of result.vpbankList) {
          expect(record.ho_ten.length).toBeGreaterThan(1);
          expect(record.so_tai_khoan.length).toBeGreaterThan(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('does not extract rows outside the section markers', () => {
    fc.assert(
      fc.property(vpbankEmployeeListArb, nonVpbankEmployeeListArb, (vpbankRows, nonVpbankRows) => {
        const buffer = buildExcelBuffer(vpbankRows, nonVpbankRows);
        const result = parsePayrollExcel(buffer);

        // VPBank records should not contain any non-VPBank employee names
        const nonVpbankNames = new Set(nonVpbankRows.map((r) => String(r[1]).trim()));
        for (const record of result.vpbankList) {
          // Only check if the name is unique to non-VPBank section
          if (!vpbankRows.some((r) => String(r[1]).trim() === record.ho_ten)) {
            expect(nonVpbankNames.has(record.ho_ten)).toBe(false);
          }
        }

        // Non-VPBank records should not contain any VPBank employee names
        const vpbankNames = new Set(vpbankRows.map((r) => String(r[1]).trim()));
        for (const record of result.nonVpbankList) {
          if (!nonVpbankRows.some((r) => String(r[1]).trim() === record.ho_ten)) {
            expect(vpbankNames.has(record.ho_ten)).toBe(false);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('meta counts match extracted list lengths', () => {
    fc.assert(
      fc.property(vpbankEmployeeListArb, nonVpbankEmployeeListArb, (vpbankRows, nonVpbankRows) => {
        const buffer = buildExcelBuffer(vpbankRows, nonVpbankRows);
        const result = parsePayrollExcel(buffer);

        expect(result.meta.vpbankRecordCount).toBe(result.vpbankList.length);
        expect(result.meta.nonVpbankRecordCount).toBe(result.nonVpbankList.length);
      }),
      { numRuns: 100 },
    );
  });
});
