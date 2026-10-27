'use client';

// app/statement-analyze/components/ResultPanel.tsx
// Hiển thị kết quả phân tích sao kê: Key Information + số dư theo tháng + data raw.

import React, { useState } from 'react';
import { downloadStatementReportHtml } from '../lib/export-html';
import { RiskTab } from './RiskTab';
import { AskPanel } from './AskPanel';
import { StatementCharts } from './StatementCharts';

interface ResultPanelProps {
  data: any;
  /** Raw API key (X-API-Key) để route Q&A resolve prompt/model override từ Profile. */
  apiKey?: string;
}

function ExportHtmlButton({ data }: { data: any }) {
  return (
    <button
      type="button"
      onClick={() => downloadStatementReportHtml(data)}
      className="modern-button btn-outline text-xs gap-1.5 whitespace-nowrap"
      title="Tải báo cáo dạng HTML"
    >
      ⬇ Export HTML
    </button>
  );
}

type TabKey = 'summary' | 'charts' | 'revenue' | 'risk' | 'monthly' | 'raw' | 'quality' | 'ask';

export function ResultPanel({ data, apiKey }: ResultPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('summary');
  const result = data?.result;
  const analysis = result?.analysis;

  if (!analysis) {
    return (
      <div className="modern-card p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-heading font-bold text-sm text-muted-foreground">Dữ liệu thô</h3>
          <ExportHtmlButton data={data} />
        </div>
        <pre className="text-xs font-mono whitespace-pre-wrap break-all max-h-[600px] overflow-y-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    );
  }

  const ratioValue = analysis.ocr_success_ratio ?? 0;
  const ratioVariant = ratioValue >= 0.9 ? 'pass' : ratioValue >= 0.7 ? 'warn' : 'fail';

  return (
    <div className="modern-card overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🏦</span>
          <div>
            <h3 className="font-heading font-bold text-lg">Kết quả Phân tích Sao kê</h3>
            <p className="text-xs text-muted-foreground">
              {analysis.customer_name || '—'} · TK {analysis.account_no || '—'} · {analysis.bank_name || '—'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1.5 rounded-full text-xs font-bold ${
            ratioVariant === 'pass' ? 'bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/30'
            : ratioVariant === 'warn' ? 'bg-amber-500/15 text-amber-600 ring-1 ring-amber-500/30'
            : 'bg-red-500/15 text-red-600 ring-1 ring-red-500/30'
          }`}>
            OCR {pctText(ratioValue)}
          </span>
          <ExportHtmlButton data={data} />
        </div>
      </div>

      {/* Cảnh báo cho người dùng (số dư tự tính, trang bị bỏ qua, dòng lệch...) */}
      <WarningsBanner warnings={analysis.warnings} balanceSource={analysis.balance_source} />

      {/* Tabs */}
      <div className="flex overflow-x-auto whitespace-nowrap border-b border-border/50 bg-muted/30">
        {[
          { key: 'summary' as TabKey, label: '📌 Key Information' },
          { key: 'charts' as TabKey, label: '📈 Biểu đồ' },
          { key: 'revenue' as TabKey, label: '💰 Doanh thu thực' },
          { key: 'risk' as TabKey, label: '🛡️ Rủi ro' },
          { key: 'monthly' as TabKey, label: '📅 Số dư theo tháng' },
          { key: 'raw' as TabKey, label: `📄 Data raw (${analysis.total_transactions})` },
          { key: 'quality' as TabKey, label: '🔎 Chất lượng OCR' },
          { key: 'ask' as TabKey, label: '💬 Hỏi AI' },
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

      <div className="p-5 max-h-[800px] overflow-y-auto">
        {activeTab === 'summary' && <SummaryTab analysis={analysis} pdfInfo={result?.pdf_processing_info} />}
        {activeTab === 'charts' && <StatementCharts analysis={analysis} />}
        {activeTab === 'revenue' && <RevenueTab analysis={analysis} />}
        {activeTab === 'risk' && <RiskTab analysis={analysis} />}
        {activeTab === 'monthly' && <MonthlyTab analysis={analysis} />}
        {activeTab === 'raw' && <RawTab transactions={analysis.data_raw || []} breaks={analysis.ocr_quality_detail?.balance_breaks || []} />}
        {activeTab === 'quality' && <QualityTab analysis={analysis} pdfInfo={result?.pdf_processing_info} />}
        {activeTab === 'ask' && <AskPanel analysis={analysis} apiKey={apiKey} />}
      </div>
    </div>
  );
}

// ─── Warnings banner ──────────────────────────────────────────────────────────────

function WarningsBanner({
  warnings,
  balanceSource,
}: {
  warnings?: string[] | null;
  balanceSource?: 'statement' | 'computed';
}) {
  const list = Array.isArray(warnings) ? warnings.filter((w) => w && String(w).trim() !== '') : [];
  if (list.length === 0) return null;

  return (
    <div className="mx-5 mt-4 rounded-lg ring-1 ring-amber-500/30 bg-amber-500/10 p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-base">⚠️</span>
        <span className="text-xs font-bold text-amber-700">
          Lưu ý ({list.length})
          {balanceSource === 'computed' && (
            <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-800 ring-1 ring-amber-500/30">
              Số dư do hệ thống tính
            </span>
          )}
        </span>
      </div>
      <ul className="list-disc pl-6 space-y-1">
        {list.map((w, i) => (
          <li key={i} className="text-[11px] leading-relaxed text-amber-800">{w}</li>
        ))}
      </ul>
    </div>
  );
}

// ─── Summary tab ────────────────────────────────────────────────────────────────

function SummaryTab({ analysis, pdfInfo }: { analysis: any; pdfInfo: any }) {
  const w = analysis.selected_window || {};
  return (
    <div className="space-y-6">
      {/* Thông tin khách hàng / tài khoản */}
      <Section title="Thông tin khách hàng & kỳ sao kê">
        <KvTable rows={[
          ['Họ tên khách hàng', analysis.customer_name],
          ['Số tài khoản', analysis.account_no],
          ['Tên ngân hàng', analysis.bank_name],
          ['Ngày bắt đầu sao kê', analysis.statement_start_date],
          ['Ngày kết thúc sao kê', analysis.statement_end_date],
        ]} />
      </Section>

      {/* Thống kê file */}
      <Section title="Thống kê file">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard label="Total Pages" value={fmtNum(analysis.total_pages)} />
          <StatCard label="Account Total Days" value={fmtNum(analysis.total_days)} />
          <StatCard label="Account Total Transactions" value={fmtNum(analysis.total_transactions)} />
          <StatCard label="Account Start Balance" value={fmtMoney(analysis.account_start_balance)} />
          <StatCard label="Account End Balance" value={fmtMoney(analysis.account_end_balance)} />
          <StatCard label="OCR Success Ratio" value={pctText(analysis.ocr_success_ratio)} />
        </div>
      </Section>

      {/* 6 tháng có SDBQ cao nhất (không cần liên tiếp) */}
      <Section title="6 tháng có SDBQ cao nhất (không bắt buộc liên tiếp)">
        <KvTable rows={[
          ['Tháng sớm nhất được chọn', w.start_month],
          ['Tháng muộn nhất được chọn', w.end_month],
          ['Số tháng được chọn', fmtNum(w.months_count)],
          ['SDBQ trung bình các tháng chọn', fmtMoney(w.avg_sdbq)],
        ]} />
      </Section>

      {/* Cực trị trong chu kỳ */}
      <Section title="Cực trị số dư trong chu kỳ được chọn">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg p-3 ring-1 bg-emerald-500/10 ring-emerald-500/20">
            <div className="text-[10px] text-muted-foreground mb-0.5">Số dư CAO nhất</div>
            <div className="text-lg font-bold text-emerald-600">{fmtMoney(analysis.max_balance_value)}</div>
            <div className="text-[11px] text-muted-foreground mt-1">
              Tháng: <b>{analysis.month_of_max_balance || '—'}</b> · Ngày: <b>{analysis.time_of_max_balance || '—'}</b>
            </div>
          </div>
          <div className="rounded-lg p-3 ring-1 bg-red-500/10 ring-red-500/20">
            <div className="text-[10px] text-muted-foreground mb-0.5">Số dư THẤP nhất</div>
            <div className="text-lg font-bold text-red-600">{fmtMoney(analysis.min_balance_value)}</div>
            <div className="text-[11px] text-muted-foreground mt-1">
              Tháng: <b>{analysis.month_of_min_balance || '—'}</b> · Ngày: <b>{analysis.time_of_min_balance || '—'}</b>
            </div>
          </div>
        </div>
      </Section>

      {pdfInfo && (
        <p className="text-[10px] text-muted-foreground px-1">
          OCR: {pdfInfo.success_pages}/{pdfInfo.total_pages} trang có dữ liệu · {pdfInfo.empty_pages} trang trống · {pdfInfo.error_pages} trang lỗi
          {pdfInfo.total_batches != null && ` · ${pdfInfo.total_batches} lô (≤ ${pdfInfo.pages_per_batch} trang/lô)`}.
        </p>
      )}
    </div>
  );
}

// ─── Revenue normalization tab ─────────────────────────────────────────────────

function RevenueTab({ analysis }: { analysis: any }) {
  const revenue = analysis.revenue_normalization;
  const enrichment = analysis.enrichment;
  if (!revenue) {
    return <p className="text-sm text-muted-foreground">Kết quả cũ chưa có bước chuẩn hóa doanh thu.</p>;
  }
  const summary = revenue.summary || {};
  const labels: Record<string, string> = {
    business_revenue: 'Doanh thu',
    personal_income: 'Thu nhập cá nhân',
    non_business: 'Phi kinh doanh',
    other: 'Khác',
    review: 'Cần rà soát',
  };
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Tổng tiền vào" value={fmtMoney(summary.gross_inflow)} />
        <StatCard label="Doanh thu theo rule/LLM" value={fmtMoney(summary.business_revenue)} />
        <StatCard label="Loại do gian lận/bất thường" value={fmtMoney(summary.fraud_excluded_amount)} />
        <StatCard label="Doanh thu thực sau loại trừ" value={fmtMoney(summary.normalized_business_revenue_after_fraud)} />
      </div>
      <div className="text-[11px] text-muted-foreground rounded-lg bg-muted/50 p-3">
        Rule engine đã xét {revenue.rules_evaluated ?? 0} khoản tiền vào; gửi {revenue.llm_adjudication?.requested ?? 0} dòng confidence &lt; {revenue.review_threshold ?? 85} sang LLM,
        xử lý được {revenue.llm_adjudication?.resolved ?? 0}; còn {revenue.pending_review_transaction_ids?.length ?? 0} dòng cần rà soát.
        Đã chuẩn hóa {enrichment?.metrics?.sanitized_transactions ?? 0} diễn giải và gom {enrichment?.metrics?.entities_grouped ?? 0} chủ thể.
      </div>
      <div className="overflow-x-auto rounded-lg border border-border/50">
        <table className="w-full text-[11px]">
          <thead><tr className="bg-muted/50">
            <th className="px-2 py-2 text-left">Dòng</th><th className="px-2 py-2 text-right">Số tiền</th>
            <th className="px-2 py-2 text-left">Phân loại</th><th className="px-2 py-2 text-right">Tin cậy</th>
            <th className="px-2 py-2 text-left">Nguồn</th><th className="px-2 py-2 text-left">Giải thích</th>
          </tr></thead>
          <tbody>
            {(revenue.classifications || []).map((item: any) => (
              <tr key={item.transaction_id} className="border-t border-border/30">
                <td className="px-2 py-1.5">{item.source_index}</td>
                <td className="px-2 py-1.5 text-right font-semibold">{fmtMoney(item.amount)}</td>
                <td className="px-2 py-1.5">{labels[item.label] || item.label}</td>
                <td className="px-2 py-1.5 text-right">{fmtNum(item.confidence)}%</td>
                <td className="px-2 py-1.5">{item.source === 'llm_adjudication' ? 'LLM' : 'Rule'}</td>
                <td className="px-2 py-1.5 max-w-[360px]">{item.explanation_vi}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground">Phân loại là tín hiệu hỗ trợ thẩm định. Dòng “Cần rà soát” không được tự động cộng vào doanh thu thực.</p>
    </div>
  );
}

// ─── Monthly tab ────────────────────────────────────────────────────────────────

function MonthlyTab({ analysis }: { analysis: any }) {
  const rows = analysis.monthly_balances || [];
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">Không có dữ liệu tháng.</p>;
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">
        Các tháng được chọn (≤ 6 tháng có SDBQ cao nhất, không bắt buộc liên tiếp) · số dư thấp/cao nhất theo số dư sau mỗi giao dịch · SDBQ = (min + max) / 2.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50">
              <th className="px-3 py-2 text-left font-semibold">Tháng</th>
              <th className="px-3 py-2 text-right font-semibold">Số dư thấp nhất</th>
              <th className="px-3 py-2 text-right font-semibold">Số dư cao nhất</th>
              <th className="px-3 py-2 text-right font-semibold">SDBQ</th>
              <th className="px-3 py-2 text-right font-semibold">Số GD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m: any, i: number) => (
              <tr key={i} className={`border-t border-border/30 ${m.sdbq == null ? 'opacity-50' : ''}`}>
                <td className="px-3 py-1.5 font-medium">{m.month}</td>
                <td className="px-3 py-1.5 text-right">
                  {fmtMoney(m.min_balance)}
                  {m.min_balance_date && (
                    <div className="text-[10px] text-muted-foreground font-normal">({m.min_balance_date})</div>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {fmtMoney(m.max_balance)}
                  {m.max_balance_date && (
                    <div className="text-[10px] text-muted-foreground font-normal">({m.max_balance_date})</div>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right font-semibold align-top">{fmtMoney(m.sdbq)}</td>
                <td className="px-3 py-1.5 text-right text-muted-foreground align-top">{m.data_points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Raw tab ────────────────────────────────────────────────────────────────────

const RAW_COLS: Array<[string, string]> = [
  ['transaction_date', 'Ngày GD'],
  ['remitter', 'Đối tác'],
  ['remitter_bank', 'NH đối tác'],
  ['details', 'Diễn giải'],
  ['transaction_no', 'Số bút toán'],
  ['debit', 'Nợ'],
  ['credit', 'Có'],
  ['fee_interest', 'Phí/Lãi'],
  ['tax', 'Thuế'],
  ['balance', 'Số dư'],
];

function RawTab({ transactions, breaks }: { transactions: any[]; breaks: any[] }) {
  if (transactions.length === 0) return <p className="text-muted-foreground text-sm">Không có giao dịch.</p>;

  // index của BalanceBreak là vị trí 1-based trong data_raw → map về dòng.
  const breakByIndex = new Map<number, any>();
  for (const b of breaks || []) breakByIndex.set(b.index, b);
  const flaggedCount = breakByIndex.size;

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">
        Cột <b>Check</b>: ✓ = số dư khớp chuỗi · <span className="text-red-600 font-semibold">⚠</span> = lệch so với (số dư trước + Có − Nợ − Phí − Thuế).
        {flaggedCount > 0 ? ` Có ${flaggedCount} dòng bị đánh dấu.` : ' Không có dòng nào lệch.'}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border/50">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-muted/50">
              <th className="px-2 py-2 text-center font-semibold whitespace-nowrap">STT</th>
              <th className="px-2 py-2 text-center font-semibold whitespace-nowrap">Check</th>
              {RAW_COLS.map(([key, label]) => (
                <th key={key} className="px-2 py-2 text-left font-semibold whitespace-nowrap">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.map((t: any, i: number) => {
              const b = breakByIndex.get(i + 1);
              const tip = b
                ? `Lệch ${fmtSigned(b.delta)} — kỳ vọng ${fmtMoney(b.expected_balance)}, thực đọc ${fmtMoney(b.actual_balance)}`
                : 'Số dư khớp chuỗi';
              return (
                <tr key={i} className={`border-t border-border/30 ${b ? 'bg-red-500/5' : ''}`}>
                  <td className="px-2 py-1.5 text-center font-mono text-muted-foreground">{i + 1}</td>
                  <td className={`px-2 py-1.5 text-center font-bold ${b ? 'text-red-600' : 'text-emerald-600'}`} title={tip}>
                    {b ? '⚠' : '✓'}
                  </td>
                  {RAW_COLS.map(([key]) => (
                    <td key={key} className="px-2 py-1.5 whitespace-nowrap max-w-[220px] truncate" title={fmtVal(t[key])}>
                      {fmtVal(t[key])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Quality tab ────────────────────────────────────────────────────────────────

function QualityTab({ analysis, pdfInfo }: { analysis: any; pdfInfo: any }) {
  const q = analysis.ocr_quality_detail || {};
  return (
    <div className="space-y-6">
      <Section title="OCR Success Ratio — cấu phần">
        <p className="text-xs text-muted-foreground mb-2">
          Ratio = 0.6 × tính nhất quán chuỗi số dư + 0.2 × độ đầy đủ header + 0.2 × tỉ lệ trang OCR ra dữ liệu.
        </p>
        <KvTable rows={[
          ['OCR success ratio', pctText(analysis.ocr_success_ratio)],
          ['Balance chain consistency', `${pctText(q.balance_consistency_ratio)} (${q.balance_consistent}/${q.balance_checked} dòng)`],
          ['Header completeness', pctText(q.header_completeness)],
          ['Page parse ratio', pctText(q.page_parse_ratio)],
        ]} />
      </Section>

      {Array.isArray(q.balance_breaks) && q.balance_breaks.length > 0 && (
        <Section title={`Các điểm số dư không khớp (${q.balance_breaks.length})`}>
          <p className="text-xs text-muted-foreground mb-2">
            Số dư dòng này lệch so với (số dư dòng trước + Có − Nợ − Phí − Thuế). Nghi đọc sai chữ số, thiếu dòng (trang gập), hoặc bút toán đảo/khác thứ tự — cần soi lại.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border/50">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-3 py-2 text-left font-semibold">STT</th>
                  <th className="px-3 py-2 text-left font-semibold">Ngày</th>
                  <th className="px-3 py-2 text-right font-semibold">Số dư trước</th>
                  <th className="px-3 py-2 text-right font-semibold">Biến động</th>
                  <th className="px-3 py-2 text-right font-semibold">Kỳ vọng</th>
                  <th className="px-3 py-2 text-right font-semibold">Thực đọc</th>
                  <th className="px-3 py-2 text-right font-semibold">Lệch</th>
                  <th className="px-3 py-2 text-left font-semibold">Diễn giải</th>
                </tr>
              </thead>
              <tbody>
                {q.balance_breaks.map((b: any, i: number) => (
                  <tr key={i} className="border-t border-border/30 bg-red-500/5">
                    <td className="px-3 py-1.5">{b.index}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{b.date || '—'}</td>
                    <td className="px-3 py-1.5 text-right">{fmtMoney(b.prev_balance)}</td>
                    <td className="px-3 py-1.5 text-right">{fmtSigned(b.movement)}</td>
                    <td className="px-3 py-1.5 text-right">{fmtMoney(b.expected_balance)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{fmtMoney(b.actual_balance)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-red-600">{fmtSigned(b.delta)}</td>
                    <td className="px-3 py-1.5 max-w-[220px] truncate" title={b.details || ''}>{b.details || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {pdfInfo?.pages && (
        <Section title="Chi tiết theo lô OCR">
          <div className="overflow-x-auto rounded-lg border border-border/50">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-3 py-2 text-left font-semibold">Trang / lô</th>
                  <th className="px-3 py-2 text-left font-semibold">File</th>
                  <th className="px-3 py-2 text-left font-semibold">Trạng thái</th>
                  <th className="px-3 py-2 text-right font-semibold">Số GD</th>
                  <th className="px-3 py-2 text-left font-semibold">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {pdfInfo.pages.map((p: any, i: number) => (
                  <tr key={i} className={`border-t border-border/30 ${p.status === 'error' ? 'bg-red-500/5' : p.status === 'empty' ? 'bg-amber-500/5' : ''}`}>
                    <td className="px-3 py-1.5">{p.page}</td>
                    <td className="px-3 py-1.5 max-w-[180px] truncate" title={p.pdf_name}>{p.pdf_name}</td>
                    <td className="px-3 py-1.5">{p.status}</td>
                    <td className="px-3 py-1.5 text-right">{p.transactions_extracted}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{p.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── Small UI helpers ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-bold mb-2">{title}</h4>
      {children}
    </div>
  );
}

function KvTable({ rows }: { rows: Array<[string, unknown]> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/50">
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([label, val], i) => (
            <tr key={i} className="border-t border-border/30 first:border-t-0">
              <td className="px-3 py-1.5 font-medium text-muted-foreground w-[220px]">{label}</td>
              <td className="px-3 py-1.5">{fmtVal(val)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-3 text-center ring-1 bg-muted text-foreground ring-border/50">
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className="text-base font-bold">{value}</div>
    </div>
  );
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function fmtNum(v: unknown): string {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('vi-VN') : String(v);
}

function fmtMoney(v: unknown): string {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

/** Số tiền có dấu (+/−) — dùng cho biến động & chênh lệch số dư. */
function fmtSigned(v: unknown): string {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const s = Math.abs(n).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  return n > 0 ? `+${s}` : n < 0 ? `-${s}` : s;
}

/**
 * Hiển thị tỉ lệ 0..1 dạng %, TRUNG THỰC cho quyết định tài chính:
 * chỉ trả "100%" khi thực sự đạt 1.0; ngược lại 1 chữ số thập phân, chặn ở 99.9%
 * để không làm tròn 99.69% → 100% và che mất dòng lệch.
 */
function pctText(r: unknown): string {
  const v = Math.max(0, Math.min(1, Number(r) || 0));
  if (v >= 1) return '100%';
  const p = Math.min(99.9, Math.round(v * 1000) / 10);
  return Number.isInteger(p) ? `${p}%` : `${p.toFixed(1)}%`;
}
