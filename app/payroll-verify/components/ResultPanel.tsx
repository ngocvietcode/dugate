'use client';

// app/payroll-verify/components/ResultPanel.tsx
// Two tabs: 📊 So sánh (default) and 📗 Excel Extract.
// Compare tab shows full Excel-driven view with pass/fail markers on compared fields.
// Markers ⚡ are DYNAMIC — derived from the actual compare response (not hardcoded).

import React, { useState, useMemo } from 'react';

interface ResultPanelProps {
  data: any;
}

// All ThongTinChung field keys (display all from Excel extraction)
const THONG_TIN_CHUNG_FIELDS: string[] = [
  'so_chung_tu', 'ngay_lap', 'chi_nhanh_vpbank', 'ma_bieu_mau', 'dia_diem_lap',
  'ten_don_vi_chuyen_tien', 'ma_kh_cif', 'dia_chi', 'dien_thoai', 'fax', 'cmnd_cccd', 'ten_chu_tai_khoan',
  'so_tai_khoan_trich_no', 'loai_tien', 'mo_tai',
  'tong_so_tien_bang_so', 'tong_so_tien_bang_chu', 'ngay_lenh_chi', 'noi_dung_thanh_toan', 'muc_dich', 'danh_sach_chi_luong_so',
  'tong_so_mon_bang_so', 'tong_so_mon_bang_chu', 'tong_so_nhan_vien', 'so_nhan_vien_vpbank', 'so_nhan_vien_ngan_hang_khac',
  'noi_dung_chuyen_tien', 'tai_khoan_trung_gian', 'ngay_nhan_tien_tk_trung_gian', 'ngay_chuyen_tien',
  'don_vi_chuyen_tien_tai_khoan_treo', 'ten_cong_ty_giay_nop_tien', 'xac_nhan_hop_le',
  'tong_so_tien_file_cung', 'so_mon_file_cung', 'ngay_thuc_hien',
  'so_tien_do_luong_lan_1', 'so_mon_do_luong_lan_1', 'ngay_do_luong_lan_1',
  'so_tien_ton_dong', 'so_mon_ton_dong', 'ngay_ton_dong', 'nguyen_nhan_ton_dong',
  'thoi_gian', 'tong_cong_don_vi', 'don_vi_tinh',
  'chu_tai_khoan_ky', 'thoi_diem_nhan_yeu_cau', 'thoi_diem_xu_ly_yeu_cau', 'ghi_chu_xu_ly', 'giao_dich_vien', 'cap_tham_quyen',
  'co_thu_phi', 'don_vi_thu_phi', 'phi_phai_thu_1_mon', 'phi_dich_vu_thanh_toan', 'phi_thanh_toan_noi_bo', 'phi_thanh_toan_lien_ngan_hang',
  'gio_nhan', 'ngay_nhan',
];

// All PayrollRecord field keys (display all columns)
const RECORD_FIELDS: string[] = [
  'stt', 'ho_ten', 'so_tai_khoan', 'so_tien', 'loai_tai_khoan',
  'so_tien_bang_chu', 'dia_chi', 'ngan_hang', 'ten_chi_nhanh', 'tinh_tp', 'ghi_chu',
  'noi_dung_thanh_toan_chi_tiet', 'loai_tien',
];

type TabKey = 'compare' | 'excel';

export function ResultPanel({ data }: ResultPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('compare');
  const result = data?.result;

  if (!result) {
    return (
      <div className="modern-card p-6">
        <pre className="text-xs font-mono whitespace-pre-wrap break-all max-h-[600px] overflow-y-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    );
  }

  const summary = result.comparison_result?.summary;
  const headerCompare = result.comparison_result?.header_compare || [];
  const detailResults = result.comparison_result?.detail_results || [];
  const excelExtraction = result.excel_extraction;

  return (
    <div className="modern-card overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📋</span>
          <div>
            <h3 className="font-heading font-bold text-lg">Kết quả Đối chiếu</h3>
            <p className="text-xs text-muted-foreground">
              {result.document_processed} tài liệu · {result.excel_rows} dòng Excel
            </p>
          </div>
        </div>
        <span className={`px-3 py-1.5 rounded-full text-xs font-bold ${
          result.final_decision === 'APPROVED'
            ? 'bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/30'
            : 'bg-red-500/15 text-red-600 ring-1 ring-red-500/30'
        }`}>
          {result.final_decision}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/50 bg-muted/30">
        {[
          { key: 'compare' as TabKey, label: '📊 So sánh' },
          { key: 'excel' as TabKey, label: '📗 Excel Extract' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-xs font-semibold transition-all border-b-2 ${
              activeTab === tab.key
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-5 max-h-[800px] overflow-y-auto">
        {activeTab === 'compare' && (
          <CompareTab
            summary={summary}
            headerCompare={headerCompare}
            detailResults={detailResults}
            excelExtraction={excelExtraction}
            result={result}
          />
        )}
        {activeTab === 'excel' && (
          <ExcelExtractTab data={excelExtraction} />
        )}
      </div>
    </div>
  );
}

// ─── Compare Tab ──────────────────────────────────────────────────────────────

function CompareTab({
  summary,
  headerCompare,
  detailResults,
  excelExtraction,
  result,
}: {
  summary: any;
  headerCompare: any[];
  detailResults: any[];
  excelExtraction: any;
  result: any;
}) {
  // Determine which record columns the Excel file has (detected by backend).
  // Priority: use backend-provided detected_record_fields (from Excel column headers).
  // Fallback: any field that has data in any record.
  const detectedFields: string[] = result?.detected_record_fields || [];

  const allExcelRecords = useMemo(() => [
    ...(excelExtraction?.danh_sach_trong_vpbank || []),
    ...(excelExtraction?.danh_sach_ngoai_vpbank || []),
  ], [excelExtraction]);

  // Derive compared fields from actual response
  const comparedDetailFields = useMemo(() => {
    for (const section of detailResults) {
      const row = (section.detail_compare || []).find((r: any) => r.field_results?.length > 0);
      if (row) return row.field_results.map((fr: any) => fr.field_code as string);
    }
    return ['ho_ten', 'so_tai_khoan', 'so_tien', 'ngan_hang'];
  }, [detailResults]);

  // Visible fields: core + compared + detected from Excel headers + any field with data
  const visibleRecordFields = useMemo(() => {
    return RECORD_FIELDS.filter(f => {
      // Core fields always visible
      if (['stt', 'ho_ten', 'so_tai_khoan', 'so_tien'].includes(f)) return true;
      // Compared fields always visible
      if (comparedDetailFields.includes(f)) return true;
      // Field detected in Excel column headers (even if all values are null)
      if (detectedFields.includes(f)) return true;
      // Fallback: show if ANY record has data
      return allExcelRecords.some((r: any) => hasData(r[f]));
    });
  }, [allExcelRecords, comparedDetailFields, detectedFields]);

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Tổng điểm so sánh" value={summary.total_compare_points ?? (summary.matched_rows + summary.mismatched_rows)} />
          <StatCard label="Khớp (tổng)" value={summary.total_matched ?? summary.matched_rows} variant="pass" />
          <StatCard label="Sai lệch (tổng)" value={summary.total_mismatched ?? summary.mismatched_rows} variant={(summary.total_mismatched ?? summary.mismatched_rows) > 0 ? 'fail' : undefined} />
          <StatCard label="Thiếu trong PDF" value={summary.missing_in_pdf} variant={summary.missing_in_pdf > 0 ? 'warn' : undefined} />
          <StatCard label="Tổng dòng Excel" value={summary.total_excel_rows} />
        </div>
      )}

      {/* Breakdown */}
      {summary && (summary.header_total > 0 || summary.header_matched !== undefined) && (
        <div className="flex gap-4 text-[10px] text-muted-foreground px-1">
          <span>Header: {summary.header_matched ?? 0}/{summary.header_total ?? 0} khớp</span>
          <span>Detail: {summary.matched_rows}/{summary.total_excel_rows} khớp</span>
        </div>
      )}

      {/* Header — full TTC fields with compare markers on the 13 active rules */}
      <HeaderCompareSection
        excelTtc={excelExtraction?.thong_tin_chung}
        headerCompare={headerCompare}
      />

      {/* Detail sections — full record columns with compare markers on the active fields */}
      {detailResults.map((section: any, si: number) => (
        <DetailSectionFull
          key={si}
          section={section}
          excelRecords={
            section.section_code === 'trong_vpbank'
              ? excelExtraction?.danh_sach_trong_vpbank
              : excelExtraction?.danh_sach_ngoai_vpbank
          }
          visibleFields={visibleRecordFields}
          comparedDetailFields={comparedDetailFields}
        />
      ))}
    </div>
  );
}

function HeaderCompareSection({ excelTtc, headerCompare }: { excelTtc: any; headerCompare: any[] }) {
  const excel = excelTtc || {};
  const compareMap = new Map(headerCompare.map((h: any) => [h.field_code, h]));

  // Dynamic: derive compared header fields from actual response
  const comparedHeaderFields = useMemo(() => {
    return headerCompare.map((h: any) => h.field_code as string);
  }, [headerCompare]);

  return (
    <div>
      <h4 className="text-sm font-bold mb-2">Thông tin chung (Header)</h4>
      <div className="overflow-x-auto rounded-lg border border-border/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50">
              <th className="px-3 py-2 text-left font-semibold w-[180px]">Trường</th>
              <th className="px-3 py-2 text-left font-semibold">Excel (Nguồn)</th>
              <th className="px-3 py-2 text-left font-semibold">PDF (OCR)</th>
              <th className="px-3 py-2 text-center font-semibold w-14">KQ</th>
            </tr>
          </thead>
          <tbody>
            {THONG_TIN_CHUNG_FIELDS.map((field) => {
              const excelVal = excel[field];
              const cmp = compareMap.get(field) as any;
              const isCompared = !!cmp;
              const isFail = cmp?.result === 'fail';
              const pdfVal = isCompared ? cmp.pdf_value : null;

              // Skip rows where neither side has data and not compared
              if (!isCompared && !hasData(excelVal)) {
                return null;
              }

              return (
                <tr key={field} className={isFail ? 'bg-red-500/5' : ''}>
                  <td className="px-3 py-1.5 font-medium text-muted-foreground">
                    {field}
                    {isCompared && <span className="ml-1 text-[8px] text-primary font-bold">⚡</span>}
                  </td>
                  <td className="px-3 py-1.5 max-w-[220px] truncate">{formatVal(excelVal)}</td>
                  <td className="px-3 py-1.5 max-w-[220px] truncate">
                    {isCompared ? formatVal(pdfVal) : <span className="text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {isCompared ? <Badge status={cmp.result} /> : <span className="text-[9px] text-muted-foreground">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1 px-1">
        <span className="text-primary font-bold">⚡</span> = trường được đối chiếu ({comparedHeaderFields.length} trường). Các trường khác chỉ hiển thị dữ liệu Excel.
      </p>
    </div>
  );
}

function DetailSectionFull({ section, excelRecords, visibleFields, comparedDetailFields }: { section: any; excelRecords: any[] | undefined; visibleFields: string[]; comparedDetailFields: string[] }) {
  const detailCompare = section.detail_compare || [];
  const missingRows = section.missing_rows || [];
  const extraRows = section.extra_rows || [];
  const sectionTitle = section.section_code === 'trong_vpbank' ? '🏦 Trong VPBank' : '🏢 Ngoài VPBank';

  const records = excelRecords || [];

  // Build compare result map: stt → { field_code → result }
  const compareByKey = new Map<string, Map<string, any>>();
  const foundMap = new Map<string, boolean>();
  const rowResultMap = new Map<string, string>();
  const rowReasonMap = new Map<string, string[]>();
  for (const row of detailCompare) {
    const key = String(row.match_key);
    const fieldMap = new Map<string, any>();
    for (const fr of (row.field_results || [])) {
      fieldMap.set(fr.field_code, fr);
    }
    compareByKey.set(key, fieldMap);
    foundMap.set(key, row.found_in_pdf);
    rowResultMap.set(key, row.row_result);
    rowReasonMap.set(key, parseRowReason(row.row_reason));
  }

  // Detect STT numbering mismatch warning
  const highMissing = missingRows.length > 0 && extraRows.length > 0 && missingRows.length >= records.length * 0.5;

  return (
    <div className="border border-border/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold flex items-center gap-2">
          {sectionTitle}
          <Badge status={section.detail_status} />
        </h4>
        <span className="text-xs text-muted-foreground">
          {records.length} dòng
        </span>
      </div>

      {/* STT mismatch warning */}
      {highMissing && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700">
          ⚠️ <strong>STT không khớp:</strong> Excel có {missingRows.length} dòng "Thiếu trong PDF" và PDF có {extraRows.length} dòng "Thừa". Có thể do PDF đánh STT liên tục (không reset) trong khi Excel reset STT từ 1 ở mỗi section.
        </div>
      )}

      {/* Main table */}
      <div className="overflow-x-auto rounded-lg border border-border/50">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-muted/50">
              {visibleFields.map(f => (
                <th key={f} className="px-2 py-2 text-left font-semibold whitespace-nowrap">
                  {f}
                  {comparedDetailFields.includes(f) && <span className="ml-0.5 text-[8px] text-primary">⚡</span>}
                </th>
              ))}
              <th className="px-2 py-2 text-center font-semibold w-14">KQ</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record: any, i: number) => {
              const key = String(record.stt);
              const fieldMap = compareByKey.get(key);
              const found = foundMap.get(key);
              const rowResult = rowResultMap.get(key);
              const isMissing = found === false;
              const isFail = rowResult === 'fail';

              const reasons = rowReasonMap.get(key) ?? [];
              return (
                <React.Fragment key={i}>
                  <tr className={`border-t border-border/30 ${isFail ? 'bg-red-500/5' : ''} ${isMissing ? 'bg-amber-500/5' : ''}`}>
                    {visibleFields.map(f => {
                      const excelVal = record[f];
                      const isComparedField = comparedDetailFields.includes(f);
                      const fr = fieldMap?.get(f);
                      const fieldFail = fr?.result === 'fail';

                      return (
                        <td key={f} className="px-2 py-1.5">
                          {isComparedField && fieldFail ? (
                            <CompareCell excel={excelVal} pdf={fr?.pdf_value} result="fail" found={found !== false} />
                          ) : (
                            <span className={fieldFail ? 'text-red-600' : ''}>{formatVal(excelVal)}</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-center">
                      {isMissing
                        ? <span className="text-[9px] font-bold text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded">THIẾU</span>
                        : <Badge status={rowResult || 'pass'} />
                      }
                    </td>
                  </tr>
                  {reasons.length > 0 && (
                    <tr className={isMissing ? 'bg-amber-500/5' : 'bg-red-500/5'}>
                      <td
                        colSpan={visibleFields.length + 1}
                        className={`px-3 pb-1.5 pt-0 text-[10px] italic ${isMissing ? 'text-amber-700/80' : 'text-red-600/80'}`}
                      >
                        {reasons.length === 1
                          ? reasons[0]
                          : reasons.map((r, ri) => <span key={ri} className="mr-3">• {r}</span>)
                        }
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Extra rows in PDF (not matched to any Excel row) */}
      {extraRows.length > 0 && (
        <div className="mt-3 border border-amber-500/30 rounded-lg p-3 bg-amber-500/5">
          <h5 className="text-xs font-bold text-amber-700 mb-2">⚠️ Thừa trong PDF ({extraRows.length} dòng) — có trên PDF nhưng không match STT nào trong Excel</h5>
          <div className="overflow-x-auto rounded border border-border/50">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-muted/50">
                  {visibleFields.map(f => (
                    <th key={f} className="px-2 py-1 text-left whitespace-nowrap">{f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {extraRows.map((row: any, i: number) => {
                  const r = row.pdf_row || row;
                  return (
                    <tr key={i} className="border-t border-border/30">
                      {visibleFields.map(f => (
                        <td key={f} className="px-2 py-0.5">{formatVal(r[f])}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mt-1 px-1">
        <span className="text-primary font-bold">⚡</span> = cột được đối chiếu ({comparedDetailFields.length} trường). Các cột khác chỉ hiển thị dữ liệu Excel.
      </p>
    </div>
  );
}

// ─── Excel Extract Tab ────────────────────────────────────────────────────────

function ExcelExtractTab({ data }: { data: any }) {
  if (!data) return <p className="text-muted-foreground text-sm">Không có dữ liệu Excel extract</p>;

  const ttc = data.thong_tin_chung || {};
  const vpbank = data.danh_sach_trong_vpbank || [];
  const nonVpbank = data.danh_sach_ngoai_vpbank || [];

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-bold mb-2">Thông tin chung ({THONG_TIN_CHUNG_FIELDS.length} trường)</h4>
        <div className="overflow-x-auto rounded-lg border border-border/50">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50">
                <th className="px-3 py-2 text-left font-semibold w-[220px]">Trường</th>
                <th className="px-3 py-2 text-left font-semibold">Giá trị</th>
              </tr>
            </thead>
            <tbody>
              {THONG_TIN_CHUNG_FIELDS.map(field => (
                <tr key={field} className={!hasData(ttc[field]) ? 'opacity-40' : ''}>
                  <td className="px-3 py-1.5 font-medium text-muted-foreground">{field}</td>
                  <td className="px-3 py-1.5">{hasData(ttc[field]) ? formatVal(ttc[field]) : <span className="italic text-muted-foreground/60">null</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {vpbank.length > 0 && (
        <div>
          <h4 className="text-sm font-bold mb-2">Danh sách Trong VPBank ({vpbank.length} dòng × {RECORD_FIELDS.length} cột)</h4>
          <ExcelRecordTable records={vpbank} />
        </div>
      )}

      {nonVpbank.length > 0 && (
        <div>
          <h4 className="text-sm font-bold mb-2">Danh sách Ngoài VPBank ({nonVpbank.length} dòng × {RECORD_FIELDS.length} cột)</h4>
          <ExcelRecordTable records={nonVpbank} />
        </div>
      )}
    </div>
  );
}

function ExcelRecordTable({ records }: { records: any[] }) {
  // Show ALL 13 record fields — not filtered
  return (
    <div className="overflow-x-auto rounded-lg border border-border/50">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-muted/50">
            {RECORD_FIELDS.map(f => (
              <th key={f} className="px-2 py-2 text-left font-semibold whitespace-nowrap">{f}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((r: any, i: number) => (
            <tr key={i} className="border-t border-border/30">
              {RECORD_FIELDS.map(f => (
                <td key={f} className={`px-2 py-1.5 ${!hasData(r[f]) ? 'opacity-40' : ''}`}>
                  {hasData(r[f]) ? formatVal(r[f]) : <span className="italic text-muted-foreground/60">null</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function CompareCell({ excel, pdf, result, found }: { excel: unknown; pdf: unknown; result: string; found: boolean }) {
  if (!found) {
    return (
      <div className="text-[10px]">
        <div className="font-medium">{formatVal(excel)}</div>
        <div className="text-muted-foreground italic">— không có PDF</div>
      </div>
    );
  }

  const isFail = result === 'fail';
  return (
    <div className={`text-[10px] ${isFail ? 'text-red-600' : ''}`}>
      <div className="font-medium">{formatVal(excel)}</div>
      {isFail && <div className="text-red-500 line-through">{formatVal(pdf)}</div>}
    </div>
  );
}

function hasData(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '' && v !== 0;
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  return String(v);
}

function StatCard({ label, value, variant }: { label: string; value: number; variant?: 'pass' | 'fail' | 'warn' }) {
  const cls = variant === 'pass' ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20'
    : variant === 'fail' ? 'bg-red-500/10 text-red-600 ring-red-500/20'
    : variant === 'warn' ? 'bg-amber-500/10 text-amber-600 ring-amber-500/20'
    : 'bg-muted text-foreground ring-border/50';

  return (
    <div className={`rounded-lg p-3 text-center ring-1 ${cls}`}>
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

function parseRowReason(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return raw.map(item => (item == null ? '' : String(item).trim())).filter(Boolean);
  }
  if (typeof raw !== 'string') return [String(raw)];
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const reasonLine = lines[lines.length - 1] ?? '';
  const inner = reasonLine.replace(/^\(\s*/, '').replace(/\s*\)$/, '');
  return inner.split(/\s*\/\s*/).map(r => r.trim()).filter(Boolean);
}

function Badge({ status }: { status: string }) {
  if (status === 'pass') return <span className="inline-block px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/15 text-emerald-600">pass</span>;
  if (status === 'fail') return <span className="inline-block px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-500/15 text-red-600">fail</span>;
  return <span className="inline-block px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-muted text-muted-foreground">{status}</span>;
}
