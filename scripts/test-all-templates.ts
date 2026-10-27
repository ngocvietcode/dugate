// Test script: run parsePayrollExcel against all single-sheet Excel files
// Usage: node node_modules/tsx/dist/cli.mjs scripts/test-all-templates.ts

import { parsePayrollExcel } from '../lib/pipelines/workflows/payroll-verify-excel';
import * as fs from 'fs';
import * as path from 'path';
import * as xlsx from 'xlsx';

const BASE = 'handover-report/Payroll/input/chuẩn hóa mẫu biểu OCR';

function findExcel(dir: string): string[] {
  const results: string[] = [];
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory()) results.push(...findExcel(full));
    else if (/\.(xlsx|xls)$/i.test(item)) results.push(full);
  }
  return results;
}

const files = findExcel(BASE);
let passed = 0;
let skipped = 0;
let failed = 0;
const failures: string[] = [];

console.log(`Scanning ${files.length} Excel files...\n`);

for (const file of files) {
  const name = path.basename(file);
  const relPath = file.replace(BASE + '/', '').replace(BASE + path.sep, '');

  // Skip multi-sheet files
  try {
    const buf = fs.readFileSync(file);
    const wb = xlsx.read(buf, { type: 'buffer' });
    if (wb.SheetNames.length > 1) {
      console.log(`⏭️  SKIP (${wb.SheetNames.length} sheets): ${name}`);
      skipped++;
      continue;
    }
  } catch (e: any) {
    console.log(`⏭️  SKIP (read error): ${name} - ${e.message.substring(0, 50)}`);
    skipped++;
    continue;
  }

  // Run parser
  try {
    const buf = fs.readFileSync(file);
    const result = parsePayrollExcel(buf);
    const total = result.vpbankList.length + result.nonVpbankList.length;
    const mode = result.meta.parseMode;
    const hasInfo = result.generalInfo.length > 0 ? 'INFO' : 'NO-INFO';
    console.log(`✅ ${mode.padEnd(10)} | ${hasInfo.padEnd(7)} | VPB:${String(result.vpbankList.length).padEnd(4)} Other:${String(result.nonVpbankList.length).padEnd(4)} Total:${String(total).padEnd(4)} | ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`❌ FAIL: ${name} — ${e.message.substring(0, 100)}`);
    failures.push(`${relPath}: ${e.message.substring(0, 120)}`);
    failed++;
  }
}

console.log(`\n${'='.repeat(80)}`);
console.log(`RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped (multi-sheet)`);
console.log(`${'='.repeat(80)}`);

if (failures.length > 0) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  ❌ ${f}`);
}
