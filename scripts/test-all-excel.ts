#!/usr/bin/env npx tsx
/**
 * Test Excel parser against all .xlsx files in the sample folder.
 * Reports which files match and which don't.
 */
import * as xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';
import { parsePayrollExcel } from '../lib/pipelines/workflows/payroll-verify-excel';

const BASE_DIR = 'handover-report/Payroll/input/chuẩn hóa mẫu biểu OCR';

function findXlsxFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findXlsxFiles(fullPath));
      } else if (entry.name.endsWith('.xlsx') || entry.name.endsWith('.xls')) {
        results.push(fullPath);
      }
    }
  } catch { /* skip unreadable dirs */ }
  return results;
}

const files = findXlsxFiles(BASE_DIR);
console.log(`Found ${files.length} Excel files\n`);

const matched: string[] = [];
const notMatched: string[] = [];
const errors: string[] = [];
const zeroRecords: string[] = [];

for (const file of files) {
  const shortName = file.replace(BASE_DIR + path.sep, '');
  try {
    const buffer = fs.readFileSync(file);
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetCount = workbook.SheetNames.length;
    
    const result = parsePayrollExcel(buffer);
    const total = result.vpbankList.length + result.nonVpbankList.length;
    
    if (total > 0) {
      matched.push(`${shortName} | VPB:${result.vpbankList.length} Other:${result.nonVpbankList.length} Total:${total} | sheet:"${result.meta.sheetName}" (${sheetCount} sheets)`);
    } else {
      zeroRecords.push(`${shortName} | sheet:"${result.meta.sheetName}" (${sheetCount} sheets)`);
    }
  } catch (err: any) {
    const msg = err.message?.substring(0, 120) || String(err);
    if (msg.includes('EXCEL_PARSE_FAILED')) {
      notMatched.push(`${shortName}`);
    } else {
      errors.push(`${shortName} — ${msg.substring(0, 80)}`);
    }
  }
}

// Write results to file
let output = '';
output += `MATCHED — ${matched.length} files (parser extracted records successfully)\n`;
output += `${'='.repeat(80)}\n`;
matched.forEach((m, i) => output += `${i+1}. ${m}\n`);

output += `\nZERO RECORDS — ${zeroRecords.length} files (markers found but no valid data rows)\n`;
output += `${'='.repeat(80)}\n`;
zeroRecords.forEach((m, i) => output += `${i+1}. ${m}\n`);

output += `\nNOT MATCHED — ${notMatched.length} files (no VPBank markers found)\n`;
output += `${'='.repeat(80)}\n`;
notMatched.forEach((m, i) => output += `${i+1}. ${m}\n`);

output += `\nERRORS — ${errors.length} files\n`;
output += `${'='.repeat(80)}\n`;
errors.forEach((m, i) => output += `${i+1}. ${m}\n`);

output += `\nSUMMARY: ${matched.length} matched, ${zeroRecords.length} zero-records, ${notMatched.length} not-matched, ${errors.length} errors / ${files.length} total\n`;

fs.writeFileSync('handover-report/Payroll/output/excel-parser-test-results.txt', output);
console.log(output);
console.log('\nResults saved to: handover-report/Payroll/output/excel-parser-test-results.txt');
