import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const BASE_DIR = 'handover-report/Payroll/input/chuẩn hóa mẫu biểu OCR';

interface FileAnalysis {
  filePath: string;
  sheetsCount: number;
  sheetNames: string[];
  hasVPBankMarkers: boolean;
  vpbankMarkerDetails: string;
  hasSTTHeader: boolean;
  sttHeaderDetails: string;
  firstRows: string[];
  templateGuess: string;
}

function findExcelFiles(dir: string): string[] {
  const results: string[] = [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findExcelFiles(fullPath));
    } else if (/\.(xlsx|xls)$/i.test(item)) {
      results.push(fullPath);
    }
  }
  return results;
}

function cellToString(cell: any): string {
  if (!cell) return '';
  if (cell.v !== undefined) return String(cell.v);
  if (cell.w !== undefined) return String(cell.w);
  return '';
}

function getSheetRows(sheet: XLSX.WorkSheet, maxRows: number = 20): string[][] {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const rows: string[][] = [];
  const endRow = Math.min(range.e.r, maxRows - 1);
  for (let r = range.s.r; r <= endRow; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= Math.min(range.e.c, 15); c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      row.push(cellToString(sheet[addr]));
    }
    rows.push(row);
  }
  return rows;
}

function checkVPBankMarkers(rows: string[][]): { found: boolean; details: string } {
  const markers = [
    'có tài khoản thanh toán tại vpbank',
    'có tài khoản thanh toán tại ngân hàng khác',
    'co tai khoan thanh toan tai vpbank',
    'co tai khoan thanh toan tai ngan hang khac'
  ];
  
  for (let i = 0; i < rows.length; i++) {
    const rowText = rows[i].join(' ').toLowerCase();
    for (const marker of markers) {
      if (rowText.includes(marker)) {
        return { found: true, details: `Row ${i}: "${rows[i].filter(c => c).join(' | ').substring(0, 80)}"` };
      }
    }
  }
  return { found: false, details: '' };
}

function checkSTTHeader(rows: string[][]): { found: boolean; details: string } {
  const sttPatterns = ['stt', 'tt', 'số tt', 'no.', 'no', 's tt'];
  
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const firstCell = rows[i][0]?.toLowerCase().trim();
    if (sttPatterns.includes(firstCell)) {
      return { found: true, details: `Row ${i}: [${rows[i].filter(c => c).slice(0, 6).join(' | ')}]` };
    }
    // Also check second cell (sometimes first col is merged)
    const secondCell = rows[i][1]?.toLowerCase().trim();
    if (sttPatterns.includes(secondCell)) {
      return { found: true, details: `Row ${i} col B: [${rows[i].filter(c => c).slice(0, 6).join(' | ')}]` };
    }
  }
  return { found: false, details: '' };
}

function guessTemplate(analysis: { hasVPBankMarkers: boolean; hasSTTHeader: boolean; sheetNames: string[]; rows: string[][] }): string {
  const { hasVPBankMarkers, hasSTTHeader, sheetNames, rows } = analysis;
  
  // Check for MB01 pattern: has VPBank markers + STT header
  if (hasVPBankMarkers && hasSTTHeader) return 'MB01';
  
  // Check for CAHN pattern: typically police/military payroll, no VPBank markers
  const allText = rows.map(r => r.join(' ')).join(' ').toLowerCase();
  if (allText.includes('công an') || allText.includes('cong an')) return 'CAHN';
  
  // Check for MB08 pattern: batch transfer
  if (allText.includes('chuyển tiền theo lô') || allText.includes('chuyen tien theo lo')) return 'MB08-Batch';
  if (allText.includes('chuyển tiền theo danh sách') || allText.includes('chuyen tien theo danh sach')) return 'MB08-List';
  
  // Check for MB06 pattern
  if (allText.includes('mb06') || allText.includes('bảng kê')) return 'MB06';
  
  // If has STT but no VPBank markers
  if (hasSTTHeader && !hasVPBankMarkers) return 'Custom-List';
  
  // If has VPBank markers but no STT
  if (hasVPBankMarkers && !hasSTTHeader) return 'MB01-variant';
  
  return 'Unknown';
}

function analyzeFile(filePath: string): FileAnalysis | null {
  try {
    const workbook = XLSX.readFile(filePath, { type: 'file' });
    const sheetNames = workbook.SheetNames;
    const sheetsCount = sheetNames.length;
    
    let hasVPBankMarkers = false;
    let vpbankMarkerDetails = '';
    let hasSTTHeader = false;
    let sttHeaderDetails = '';
    let firstRows: string[] = [];
    let allRows: string[][] = [];
    
    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = getSheetRows(sheet, 20);
      
      if (sheetName === sheetNames[0]) {
        allRows = rows;
        firstRows = rows.slice(0, 5).map((r, i) => 
          `  R${i}: ${r.filter(c => c).join(' | ').substring(0, 100)}`
        );
      }
      
      const vpbCheck = checkVPBankMarkers(rows);
      if (vpbCheck.found) {
        hasVPBankMarkers = true;
        vpbankMarkerDetails = vpbCheck.details;
      }
      
      const sttCheck = checkSTTHeader(rows);
      if (sttCheck.found) {
        hasSTTHeader = true;
        sttHeaderDetails = sttCheck.details;
      }
    }
    
    const templateGuess = guessTemplate({ hasVPBankMarkers, hasSTTHeader, sheetNames, rows: allRows });
    
    return {
      filePath,
      sheetsCount,
      sheetNames,
      hasVPBankMarkers,
      vpbankMarkerDetails,
      hasSTTHeader,
      sttHeaderDetails,
      firstRows,
      templateGuess
    };
  } catch (err: any) {
    console.error(`ERROR reading ${filePath}: ${err.message}`);
    return null;
  }
}

// Main execution
console.log('='.repeat(120));
console.log('EXCEL TEMPLATE SCANNER - chuẩn hóa mẫu biểu OCR');
console.log('='.repeat(120));

const excelFiles = findExcelFiles(BASE_DIR);
console.log(`\nFound ${excelFiles.length} Excel files\n`);

// Group by parent folder
const grouped: Record<string, FileAnalysis[]> = {};

for (const file of excelFiles) {
  const analysis = analyzeFile(file);
  if (analysis) {
    const parentDir = path.dirname(file).replace(BASE_DIR + '/', '');
    if (!grouped[parentDir]) grouped[parentDir] = [];
    grouped[parentDir].push(analysis);
  }
}

// Print results
for (const [folder, files] of Object.entries(grouped)) {
  console.log('\n' + '─'.repeat(120));
  console.log(`📁 ${folder}`);
  console.log('─'.repeat(120));
  
  for (const f of files) {
    const shortPath = path.basename(f.filePath);
    console.log(`\n  📄 ${shortPath}`);
    console.log(`     Sheets: ${f.sheetsCount} [${f.sheetNames.join(', ')}]`);
    console.log(`     VPBank markers: ${f.hasVPBankMarkers ? '✅ YES' : '❌ NO'} ${f.vpbankMarkerDetails}`);
    console.log(`     STT header: ${f.hasSTTHeader ? '✅ YES' : '❌ NO'} ${f.sttHeaderDetails}`);
    console.log(`     Template guess: 🏷️  ${f.templateGuess}`);
    console.log(`     First rows:`);
    for (const row of f.firstRows) {
      console.log(`       ${row}`);
    }
  }
}

// Summary table
console.log('\n\n' + '='.repeat(120));
console.log('SUMMARY TABLE');
console.log('='.repeat(120));
console.log(`${'File'.padEnd(50)} | ${'Sheets'.padEnd(6)} | ${'VPBank'.padEnd(6)} | ${'STT'.padEnd(4)} | ${'Template'.padEnd(12)}`);
console.log('-'.repeat(120));

const templateCounts: Record<string, number> = {};

for (const [folder, files] of Object.entries(grouped)) {
  console.log(`\n📁 ${folder}`);
  for (const f of files) {
    const shortName = path.basename(f.filePath).substring(0, 48);
    const vpb = f.hasVPBankMarkers ? 'YES' : 'NO';
    const stt = f.hasSTTHeader ? 'YES' : 'NO';
    console.log(`  ${shortName.padEnd(50)} | ${String(f.sheetsCount).padEnd(6)} | ${vpb.padEnd(6)} | ${stt.padEnd(4)} | ${f.templateGuess}`);
    templateCounts[f.templateGuess] = (templateCounts[f.templateGuess] || 0) + 1;
  }
}

console.log('\n\n' + '='.repeat(60));
console.log('TEMPLATE DISTRIBUTION');
console.log('='.repeat(60));
for (const [template, count] of Object.entries(templateCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${template.padEnd(20)} : ${count} files`);
}
console.log(`  ${'TOTAL'.padEnd(20)} : ${excelFiles.length} files`);
