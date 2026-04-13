import * as xlsx from 'xlsx';
import { DocumentParser, ParseResult } from './interface';

export class ExcelParser implements DocumentParser {
  canHandle(mimeType: string, extension: string): boolean {
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];
    return validTypes.includes(mimeType) || ['.xlsx', '.xls', '.csv'].includes(extension.toLowerCase());
  }

  async parse(fileBuffer: Buffer, fileName: string): Promise<ParseResult> {
    // xlsx.read works completely synchronously but we keep async interface
    const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
    // Use arrays + join to avoid O(n²) string concatenation in loops
    const markdownParts: string[] = [];
    const textParts: string[] = [];
    let totalCells = 0;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as any[][];

      if (rows.length === 0) continue;

      markdownParts.push(`### Sheet: ${sheetName}\n\n`);
      textParts.push(`--- Sheet: ${sheetName} ---\n`);

      // Determine max columns
      let numCols = 0;
      for (const row of rows) {
        if (row.length > numCols) numCols = row.length;
      }

      if (numCols > 0) {
        // Build Headers
        const headerRow = rows[0] || [];
        const headerStrings = Array.from({length: numCols}, (_, i) => {
           const val = headerRow[i] !== undefined && headerRow[i] !== null ? String(headerRow[i]) : `Col ${i+1}`;
           return val.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        });

        markdownParts.push(`| ${headerStrings.join(' | ')} |\n`);
        markdownParts.push(`| ${headerStrings.map(() => '---').join(' | ')} |\n`);
        textParts.push(headerStrings.join('\t') + '\n');
        totalCells += numCols;

        // Build Rows
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i] || [];
          const rowStrings = Array.from({length: numCols}, (_, j) => {
            const val = row[j] !== undefined && row[j] !== null ? String(row[j]) : '';
            return val.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
          });

          markdownParts.push(`| ${rowStrings.join(' | ')} |\n`);
          textParts.push(rowStrings.join('\t') + '\n');
          totalCells += numCols;
        }
      }

      markdownParts.push('\n');
      textParts.push('\n');
    }

    return {
      text: textParts.join('').trim(),
      markdown: markdownParts.join('').trim(),
      metadata: {
        sheetNames: workbook.SheetNames,
        totalCells
      }
    };
  }
}
