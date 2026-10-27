/**
 * Property-based tests for file classification (Property 1).
 *
 * Feature: payroll-verify-workflow, Property 1: File classification correctness
 *
 * **Validates: Requirements 2.1**
 */
import * as fc from 'fast-check';
import { classifyFiles } from '@/lib/pipelines/workflows/payroll-verify';

// ─── Constants matching the production code ───────────────────────────────────

const PDF_EXTENSIONS = ['.pdf'];
const EXCEL_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

const PDF_MIMES = ['application/pdf'];
const EXCEL_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
];

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789_';

/** Generate a random base filename (no extension). */
const arbBaseName = fc
  .array(fc.constantFrom(...NAME_CHARS.split('')), { minLength: 1, maxLength: 12 })
  .map((chars) => chars.join(''));

/** Generate a random file path. */
const arbPath = arbBaseName.map((id) => `/uploads/${id}`);

/** Generate a random positive file size. */
const arbSize = fc.integer({ min: 1, max: 10_000_000 });

/** Generate a valid PDF file metadata object. */
const arbPdfFile = fc.tuple(arbBaseName, arbPath, arbSize).map(([base, path, size]) => ({
  name: `${base}.pdf`,
  path,
  mime: 'application/pdf',
  size,
}));

/** Generate a valid Excel file metadata object with matching extension and MIME. */
const arbExcelFile = fc
  .tuple(
    arbBaseName,
    arbPath,
    arbSize,
    fc.constantFrom(
      { ext: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { ext: '.xls', mime: 'application/vnd.ms-excel' },
      { ext: '.csv', mime: 'text/csv' },
      { ext: '.csv', mime: 'application/csv' },
    ),
  )
  .map(([base, path, size, { ext, mime }]) => ({
    name: `${base}${ext}`,
    path,
    mime,
    size,
  }));

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Feature: payroll-verify-workflow, Property 1: File classification correctness', () => {
  it('should classify a valid PDF + Excel pair correctly', () => {
    fc.assert(
      fc.property(arbPdfFile, arbExcelFile, (pdf, excel) => {
        // Order should not matter — try both orderings
        const result1 = classifyFiles([pdf, excel]);
        expect(result1.pdfFiles).toContainEqual(pdf);
        expect(result1.excelFile).toEqual(excel);

        const result2 = classifyFiles([excel, pdf]);
        expect(result2.pdfFiles).toContainEqual(pdf);
        expect(result2.excelFile).toEqual(excel);
      }),
      { numRuns: 100 },
    );
  });

  it('.pdf files are always classified as PDF, never as Excel', () => {
    fc.assert(
      fc.property(arbPdfFile, arbExcelFile, (pdf, excel) => {
        const result = classifyFiles([pdf, excel]);
        // The PDF file is returned in pdfFiles
        expect(result.pdfFiles[0].name).toMatch(/\.pdf$/i);
        // The PDF file is NOT the excelFile
        expect(result.excelFile.name).not.toEqual(pdf.name);
      }),
      { numRuns: 100 },
    );
  });

  it('.xlsx/.xls/.csv files are always classified as Excel, never as PDF', () => {
    fc.assert(
      fc.property(arbPdfFile, arbExcelFile, (pdf, excel) => {
        const result = classifyFiles([pdf, excel]);
        // The Excel file is returned as excelFile
        expect(result.excelFile.name).toMatch(/\.(xlsx|xls|csv)$/i);
        // The Excel file is NOT in pdfFiles
        expect(result.pdfFiles.map(f => f.name)).not.toContain(excel.name);
      }),
      { numRuns: 100 },
    );
  });

  it('classifications are mutually exclusive — a file cannot be both PDF and Excel', () => {
    fc.assert(
      fc.property(arbPdfFile, arbExcelFile, (pdf, excel) => {
        const result = classifyFiles([pdf, excel]);
        // pdfFiles and excelFile must be different objects
        expect(result.pdfFiles).not.toContainEqual(result.excelFile);
        // pdfFiles have PDF extension, excelFile has Excel extension
        const pdfExt = result.pdfFiles[0].name.slice(result.pdfFiles[0].name.lastIndexOf('.')).toLowerCase();
        const excelExt = result.excelFile.name.slice(result.excelFile.name.lastIndexOf('.')).toLowerCase();
        expect(PDF_EXTENSIONS).toContain(pdfExt);
        expect(EXCEL_EXTENSIONS).toContain(excelExt);
        // No overlap
        expect(EXCEL_EXTENSIONS).not.toContain(pdfExt);
        expect(PDF_EXTENSIONS).not.toContain(excelExt);
      }),
      { numRuns: 100 },
    );
  });

  it('throws INVALID_INPUT for two PDF files', () => {
    fc.assert(
      fc.property(arbPdfFile, arbPdfFile, (pdf1, pdf2) => {
        expect(() => classifyFiles([pdf1, pdf2])).toThrow('INVALID_INPUT');
      }),
      { numRuns: 50 },
    );
  });

  it('throws INVALID_INPUT for two Excel files', () => {
    fc.assert(
      fc.property(arbExcelFile, arbExcelFile, (excel1, excel2) => {
        expect(() => classifyFiles([excel1, excel2])).toThrow('INVALID_INPUT');
      }),
      { numRuns: 50 },
    );
  });

  it('throws INVALID_INPUT for fewer than 2 files', () => {
    fc.assert(
      fc.property(arbPdfFile, (pdf) => {
        expect(() => classifyFiles([pdf])).toThrow('INVALID_INPUT');
        expect(() => classifyFiles([])).toThrow('INVALID_INPUT');
      }),
      { numRuns: 50 },
    );
  });
});
