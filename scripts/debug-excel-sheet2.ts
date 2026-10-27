#!/usr/bin/env npx tsx
import * as xlsx from 'xlsx';
import fs from 'fs';

const filePath = 'handover-report/Payroll/input/6039022_1-DE-NGHI-THANH-TOAN-KIEM-UNC-14--05-2025_20250514152053824 1.xlsx';
const buffer = fs.readFileSync(filePath);
const workbook = xlsx.read(buffer, { type: 'buffer' });

console.log(`Sheet names: ${workbook.SheetNames.join(', ')}\n`);

// Read "Lệnh TT" sheet
const sheetName = 'Lệnh TT';
const sheet = workbook.Sheets[sheetName];
if (!sheet) { console.log(`Sheet "${sheetName}" not found`); process.exit(1); }

const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null }) as unknown[][];
console.log(`Sheet "${sheetName}" — ${rows.length} rows\n`);

console.log('=== ALL ROWS ===');
for (let i = 0; i < rows.length; i++) {
  const row = rows[i] || [];
  const cells = row.map((c, j) => `[${j}]=${c === null ? 'NULL' : String(c).substring(0, 50)}`);
  console.log(`Row ${i}: ${cells.join(' | ')}`);
}
