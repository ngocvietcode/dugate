#!/usr/bin/env npx tsx
/**
 * Debug script: read an Excel file and print its structure
 * to understand why the parser fails.
 */
import * as xlsx from 'xlsx';
import fs from 'fs';
import { parsePayrollExcel, findHeaderAndOutsideText } from '../lib/pipelines/workflows/payroll-verify-excel';

const filePath = process.argv[2] || 'handover-report/Payroll/input/6039022_1-DE-NGHI-THANH-TOAN-KIEM-UNC-14--05-2025_20250514152053824 1.xlsx';

console.log(`Reading: ${filePath}\n`);

const buffer = fs.readFileSync(filePath);

// Raw xlsx analysis
const workbook = xlsx.read(buffer, { type: 'buffer' });
console.log(`Sheet names: ${workbook.SheetNames.join(', ')}`);

const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null }) as unknown[][];

console.log(`Total rows: ${rows.length}\n`);

// Print first 30 rows to see structure
console.log('=== FIRST 30 ROWS ===');
for (let i = 0; i < Math.min(30, rows.length); i++) {
  const row = rows[i];
  const cells = (row || []).map((c, j) => `[${j}]=${c === null ? 'NULL' : String(c).substring(0, 40)}`);
  console.log(`Row ${i}: ${cells.join(' | ')}`);
}

// Check for "stt" header
console.log('\n=== SEARCHING FOR "stt" HEADER ===');
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  if (!row || row.length === 0) continue;
  const firstCell = String(row[0] ?? '').trim().toLowerCase();
  if (firstCell === 'stt' || firstCell.includes('stt')) {
    console.log(`Found "stt" at row ${i}: ${(row || []).map(c => String(c ?? '').substring(0, 30)).join(' | ')}`);
  }
}

// Check for VPBank markers
console.log('\n=== SEARCHING FOR VPBANK MARKERS ===');
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  if (!row) continue;
  const rowText = row.map(c => String(c ?? '').toLowerCase()).join(' ');
  if (rowText.includes('vpbank') || rowText.includes('tài khoản thanh toán') || rowText.includes('tổng cộng') || rowText.includes('tổng số món')) {
    console.log(`Row ${i}: ${row.map(c => String(c ?? '').substring(0, 40)).join(' | ')}`);
  }
}

// Run parser
console.log('\n=== PARSER RESULT ===');
try {
  const result = parsePayrollExcel(buffer);
  console.log(`generalInfo length: ${result.generalInfo.length}`);
  console.log(`vpbankList: ${result.vpbankList.length} records`);
  console.log(`nonVpbankList: ${result.nonVpbankList.length} records`);
  console.log(`meta:`, JSON.stringify(result.meta, null, 2));
  if (result.vpbankList.length > 0) {
    console.log(`First VPBank record:`, JSON.stringify(result.vpbankList[0], null, 2));
  }
  if (result.generalInfo) {
    console.log(`\ngeneralInfo:\n${result.generalInfo.substring(0, 500)}`);
  }
} catch (err) {
  console.error('Parser error:', err);
}

// Run findHeaderAndOutsideText
console.log('\n=== HEADER DETECTION ===');
const headerResult = findHeaderAndOutsideText(rows);
console.log(JSON.stringify(headerResult, null, 2));
