// app/statement-analyze/lib/export-html.ts
// Build a self-contained, printable HTML report from a StatementAnalysisResult
// and trigger a client-side download. No server round-trip: the report is
// generated from the same `data` object the ResultPanel renders, so it always
// matches what the user sees on screen.

import { parseVndAmount, parseDMY } from './money';

// ─── Formatting (kept in sync with ResultPanel) ───────────────────────────────

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
 * Hiển thị tỉ lệ 0..1 dạng %, trung thực: chỉ "100%" khi thực sự đạt 1.0; ngược lại
 * 1 chữ số thập phân, chặn ở 99.9% để không làm tròn lên che mất dòng lệch.
 */
function pctText(r: unknown): string {
  const v = Math.max(0, Math.min(1, Number(r) || 0));
  if (v >= 1) return '100%';
  const p = Math.min(99.9, Math.round(v * 1000) / 10);
  return Number.isInteger(p) ? `${p}%` : `${p.toFixed(1)}%`;
}

/** Escape a value for safe insertion into HTML text/attribute content. */
function esc(v: unknown): string {
  const s = fmtVal(v);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Section builders ──────────────────────────────────────────────────────────

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

function kvTable(rows: Array<[string, unknown]>): string {
  const body = rows
    .map(
      ([label, val]) =>
        `<tr><th>${esc(label)}</th><td>${esc(val)}</td></tr>`,
    )
    .join('');
  return `<table class="kv">${body}</table>`;
}

function statCards(cards: Array<[string, string]>): string {
  return `<div class="stats">${cards
    .map(
      ([label, value]) =>
        `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(
          value,
        )}</div></div>`,
    )
    .join('')}</div>`;
}

function monthlyTable(rows: any[]): string {
  if (!rows || rows.length === 0) return '<p class="muted">Không có dữ liệu tháng.</p>';
  const dateNote = (d: unknown) =>
    d ? `<div class="date-note">(${esc(d)})</div>` : '';
  const body = rows
    .map(
      (m: any) =>
        `<tr><td>${esc(m.month)}</td><td class="r">${esc(fmtMoney(m.min_balance))}${dateNote(
          m.min_balance_date,
        )}</td><td class="r">${esc(fmtMoney(m.max_balance))}${dateNote(
          m.max_balance_date,
        )}</td><td class="r b">${esc(fmtMoney(m.sdbq))}</td><td class="r muted">${esc(m.data_points)}</td></tr>`,
    )
    .join('');
  return `<table class="grid"><thead><tr><th>Tháng</th><th class="r">Số dư thấp nhất</th><th class="r">Số dư cao nhất</th><th class="r">SDBQ</th><th class="r">Số GD</th></tr></thead><tbody>${body}</tbody></table>`;
}

function rawTable(transactions: any[], breaks: any[] = []): string {
  if (!transactions || transactions.length === 0) return '<p class="muted">Không có giao dịch.</p>';
  const breakByIndex = new Map<number, any>();
  for (const b of breaks) breakByIndex.set(b.index, b);

  const head = `<th class="r">STT</th><th>Check</th>` + RAW_COLS.map(([, label]) => `<th>${esc(label)}</th>`).join('');
  const body = transactions
    .map((t: any, i: number) => {
      const b = breakByIndex.get(i + 1);
      const stt = `<td class="r muted">${i + 1}</td>`;
      const check = b
        ? `<td style="color:#dc2626;font-weight:700;text-align:center" title="Lệch ${esc(
            fmtSigned(b.delta),
          )} (kỳ vọng ${esc(fmtMoney(b.expected_balance))}, thực đọc ${esc(
            fmtMoney(b.actual_balance),
          )})">⚠</td>`
        : `<td style="color:#059669;text-align:center">✓</td>`;
      const cls = b ? ' class="status-error"' : '';
      return `<tr${cls}>${stt}${check}${RAW_COLS.map(([key]) => `<td>${esc(t[key])}</td>`).join('')}</tr>`;
    })
    .join('');
  return `<table class="grid tx"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function breaksTable(breaks: any[]): string {
  if (!breaks || breaks.length === 0) return '';
  const body = breaks
    .map(
      (b: any) =>
        `<tr class="status-error"><td>${esc(b.index)}</td><td>${esc(b.date || '—')}</td><td class="r">${esc(
          fmtMoney(b.prev_balance),
        )}</td><td class="r">${esc(fmtSigned(b.movement))}</td><td class="r">${esc(
          fmtMoney(b.expected_balance),
        )}</td><td class="r b">${esc(fmtMoney(b.actual_balance))}</td><td class="r b">${esc(
          fmtSigned(b.delta),
        )}</td><td>${esc(b.details || '—')}</td></tr>`,
    )
    .join('');
  return `<table class="grid"><thead><tr><th>STT</th><th>Ngày</th><th class="r">Số dư trước</th><th class="r">Biến động</th><th class="r">Kỳ vọng</th><th class="r">Thực đọc</th><th class="r">Lệch</th><th>Diễn giải</th></tr></thead><tbody>${body}</tbody></table>`;
}

// ─── Charts (Chart.js CDN, khớp phong cách báo cáo mẫu) ────────────────────────

const toMillion = (n: number) => Math.round((n / 1_000_000) * 100) / 100;

interface ChartPayload {
  flowMonths: string[];
  inflow: number[];
  outflow: number[];
  net: number[];
  balMonths: string[];
  balMax: Array<number | null>;
  balMin: Array<number | null>;
  balSdbq: Array<number | null>;
  compLabels: string[];
  compValues: number[];
}

function buildChartPayload(analysis: any): ChartPayload {
  const flowMap = new Map<string, { inflow: number; outflow: number; key: number }>();
  for (const tx of analysis?.data_raw || []) {
    const d = parseDMY(tx?.transaction_date ?? null);
    if (!d) continue;
    const monthKey = `${String(d.month).padStart(2, '0')}/${d.year}`;
    const agg = flowMap.get(monthKey) ?? { inflow: 0, outflow: 0, key: d.year * 12 + d.month };
    agg.inflow += parseVndAmount(tx?.credit ?? null) ?? 0;
    agg.outflow += parseVndAmount(tx?.debit ?? null) ?? 0;
    flowMap.set(monthKey, agg);
  }
  const flow = [...flowMap.entries()].sort((a, b) => a[1].key - b[1].key);

  const bal = Array.isArray(analysis?.monthly_balances) ? analysis.monthly_balances : [];
  const summary = analysis?.revenue_normalization?.summary;
  const comp: Array<[string, number]> = summary
    ? ([
        ['Doanh thu KD thực', toMillion(summary.normalized_business_revenue_after_fraud ?? 0)],
        ['Thu nhập cá nhân', toMillion(summary.personal_income ?? 0)],
        ['Phi kinh doanh', toMillion(summary.non_business_inflow ?? 0)],
        ['Khác', toMillion(summary.other_inflow ?? 0)],
        ['Chờ rà soát', toMillion(summary.pending_review_inflow ?? 0)],
      ] as Array<[string, number]>).filter(([, v]) => v > 0)
    : [];

  return {
    flowMonths: flow.map(([m]) => m),
    inflow: flow.map(([, v]) => toMillion(v.inflow)),
    outflow: flow.map(([, v]) => toMillion(v.outflow)),
    net: flow.map(([, v]) => toMillion(v.inflow - v.outflow)),
    balMonths: bal.map((m: any) => m.month),
    balMax: bal.map((m: any) => (m.max_balance != null ? toMillion(m.max_balance) : null)),
    balMin: bal.map((m: any) => (m.min_balance != null ? toMillion(m.min_balance) : null)),
    balSdbq: bal.map((m: any) => (m.sdbq != null ? toMillion(m.sdbq) : null)),
    compLabels: comp.map(([label]) => label),
    compValues: comp.map(([, v]) => v),
  };
}

/** Section HTML (canvas) + script khởi tạo Chart.js. Rỗng nếu không có dữ liệu. */
function chartsSection(analysis: any): { html: string; script: string } {
  const p = buildChartPayload(analysis);
  const hasFlow = p.flowMonths.length > 0;
  const hasBal = p.balMonths.length > 0;
  const hasComp = p.compValues.length > 0;
  if (!hasFlow && !hasBal && !hasComp) return { html: '', script: '' };

  const html = `
    <section class="card">
      <h2>📈 Biểu đồ dòng tiền &amp; số dư</h2>
      ${hasFlow ? '<h3>Dòng tiền vào · ra · ròng theo tháng (triệu VND)</h3><div class="chart-wrap"><canvas id="expCf"></canvas></div>' : ''}
      ${hasBal ? '<h3>Số dư Max / Min / SDBQ theo tháng (triệu VND)</h3><div class="chart-wrap"><canvas id="expBal"></canvas></div>' : ''}
      ${hasComp ? '<h3>Cơ cấu tiền vào theo phân loại (triệu VND)</h3><div class="chart-wrap"><canvas id="expComp"></canvas></div>' : ''}
    </section>`;

  const data = JSON.stringify(p);
  const script = `
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script>
(function(){
  if (typeof Chart === 'undefined') return;
  var D = ${data};
  var fmt = function(v){ return (v==null?'—':v.toLocaleString('vi-VN')) + ' tr'; };
  var tip = { callbacks: { label: function(c){ return ' ' + c.dataset.label + ': ' + fmt(c.parsed.y != null ? c.parsed.y : c.parsed); } } };
  if (document.getElementById('expCf')) new Chart(document.getElementById('expCf'), {
    data: { labels: D.flowMonths, datasets: [
      { type:'bar', label:'Tiền vào', data:D.inflow, backgroundColor:'#16b37e', borderRadius:3 },
      { type:'bar', label:'Tiền ra', data:D.outflow, backgroundColor:'#cbd8d1', borderRadius:3 },
      { type:'line', label:'Ròng', data:D.net, borderColor:'#12241c', borderWidth:2 }
    ]},
    options: { maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' }, tooltip:tip } }
  });
  if (document.getElementById('expBal')) new Chart(document.getElementById('expBal'), {
    data: { labels: D.balMonths, datasets: [
      { type:'line', label:'Số dư Max', data:D.balMax, borderColor:'#0b7a4b', borderWidth:2.5, tension:0.3, spanGaps:true },
      { type:'line', label:'Số dư Min', data:D.balMin, borderColor:'#b91c1c', borderDash:[4,4], borderWidth:2, tension:0.3, spanGaps:true },
      { type:'line', label:'SDBQ', data:D.balSdbq, borderColor:'#b45309', borderWidth:2, tension:0.3, spanGaps:true }
    ]},
    options: { maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' }, tooltip:tip } }
  });
  if (document.getElementById('expComp')) new Chart(document.getElementById('expComp'), {
    type:'doughnut',
    data: { labels: D.compLabels, datasets: [{ data:D.compValues, backgroundColor:['#0b7a4b','#16b37e','#b45309','#94a3b8','#b91c1c'] }] },
    options: { maintainAspectRatio:false, cutout:'58%', plugins:{ legend:{ position:'right' } } }
  });
})();
</script>`;

  return { html, script };
}

function pagesTable(pages: any[]): string {
  if (!pages || pages.length === 0) return '';
  const body = pages
    .map(
      (p: any) =>
        `<tr class="status-${esc(p.status)}"><td>${esc(p.page)}</td><td>${esc(p.pdf_name)}</td><td>${esc(
          p.status,
        )}</td><td class="r">${esc(p.transactions_extracted)}</td><td class="muted">${esc(p.reason || '—')}</td></tr>`,
    )
    .join('');
  return `<table class="grid"><thead><tr><th>Trang / lô</th><th>File</th><th>Trạng thái</th><th class="r">Số GD</th><th>Ghi chú</th></tr></thead><tbody>${body}</tbody></table>`;
}

// ─── Main builder ──────────────────────────────────────────────────────────────

/**
 * Build a full standalone HTML document string for the statement analysis result.
 * Accepts the same `data` object passed to <ResultPanel/>.
 */
export function buildStatementReportHtml(data: any): string {
  const result = data?.result;
  const analysis = result?.analysis;
  const pdfInfo = result?.pdf_processing_info;
  const generatedAt = new Date().toLocaleString('vi-VN');

  // Fallback: no analysis → dump raw JSON so the export is never empty.
  if (!analysis) {
    return baseDocument(
      'Báo cáo Phân tích Sao kê',
      `<section class="card"><h2>Dữ liệu thô</h2><pre class="raw">${esc(
        JSON.stringify(data, null, 2),
      )}</pre></section>`,
      generatedAt,
    );
  }

  const ratioValue = analysis.ocr_success_ratio ?? 0;
  const ratioClass = ratioValue >= 0.9 ? 'pass' : ratioValue >= 0.7 ? 'warn' : 'fail';
  const w = analysis.selected_window || {};
  const q = analysis.ocr_quality_detail || {};

  const header = `
    <header class="report-header">
      <div class="title-row">
        <h1>🏦 Báo cáo Phân tích Sao kê Ngân hàng</h1>
        <span class="ocr-badge ${ratioClass}">OCR ${pctText(ratioValue)}</span>
      </div>
      <p class="subtitle">${esc(analysis.customer_name || '—')} · TK ${esc(
        analysis.account_no || '—',
      )} · ${esc(analysis.bank_name || '—')}</p>
      <p class="muted small">Xuất lúc ${esc(generatedAt)}</p>
    </header>`;

  const summary = `
    <section class="card">
      <h2>📌 Thông tin khách hàng &amp; kỳ sao kê</h2>
      ${kvTable([
        ['Họ tên khách hàng', analysis.customer_name],
        ['Số tài khoản', analysis.account_no],
        ['Tên ngân hàng', analysis.bank_name],
        ['Ngày bắt đầu sao kê', analysis.statement_start_date],
        ['Ngày kết thúc sao kê', analysis.statement_end_date],
      ])}
    </section>

    <section class="card">
      <h2>📊 Thống kê file</h2>
      ${statCards([
        ['Total Pages', fmtNum(analysis.total_pages)],
        ['Account Total Days', fmtNum(analysis.total_days)],
        ['Account Total Transactions', fmtNum(analysis.total_transactions)],
        ['Account Start Balance', fmtMoney(analysis.account_start_balance)],
        ['Account End Balance', fmtMoney(analysis.account_end_balance)],
        ['OCR Success Ratio', pctText(ratioValue)],
      ])}
    </section>

    <section class="card">
      <h2>📈 6 tháng có SDBQ cao nhất (không bắt buộc liên tiếp)</h2>
      ${kvTable([
        ['Tháng sớm nhất được chọn', w.start_month],
        ['Tháng muộn nhất được chọn', w.end_month],
        ['Số tháng được chọn', fmtNum(w.months_count)],
        ['SDBQ trung bình các tháng chọn', fmtMoney(w.avg_sdbq)],
      ])}
    </section>

    <section class="card">
      <h2>🎯 Cực trị số dư trong chu kỳ được chọn</h2>
      <div class="extrema">
        <div class="ex ex-max">
          <div class="ex-label">Số dư CAO nhất</div>
          <div class="ex-value">${esc(fmtMoney(analysis.max_balance_value))}</div>
          <div class="ex-meta">Tháng: <b>${esc(analysis.month_of_max_balance || '—')}</b> · Ngày: <b>${esc(
            analysis.time_of_max_balance || '—',
          )}</b></div>
        </div>
        <div class="ex ex-min">
          <div class="ex-label">Số dư THẤP nhất</div>
          <div class="ex-value">${esc(fmtMoney(analysis.min_balance_value))}</div>
          <div class="ex-meta">Tháng: <b>${esc(analysis.month_of_min_balance || '—')}</b> · Ngày: <b>${esc(
            analysis.time_of_min_balance || '—',
          )}</b></div>
        </div>
      </div>
      ${
        pdfInfo
          ? `<p class="muted small">OCR: ${esc(pdfInfo.success_pages)}/${esc(
              pdfInfo.total_pages,
            )} trang có dữ liệu · ${esc(pdfInfo.empty_pages)} trang trống · ${esc(
              pdfInfo.error_pages,
            )} trang lỗi${
              pdfInfo.total_batches != null
                ? ` · ${esc(pdfInfo.total_batches)} lô (≤ ${esc(pdfInfo.pages_per_batch)} trang/lô)`
                : ''
            }.</p>`
          : ''
      }
    </section>`;

  const intelligence = (() => {
    const revenue = analysis.revenue_normalization;
    const fraud = analysis.fraud_detection;
    if (!revenue && !fraud) return '';
    const revenueSection = revenue ? `
    <section class="card">
      <h2>💰 Doanh thu/thu nhập chuẩn hóa</h2>
      ${statCards([
        ['Tổng tiền vào', fmtMoney(revenue.summary?.gross_inflow)],
        ['Doanh thu theo rule/LLM', fmtMoney(revenue.summary?.business_revenue)],
        ['Loại do bất thường', fmtMoney(revenue.summary?.fraud_excluded_amount)],
        ['Doanh thu thực sau loại trừ', fmtMoney(revenue.summary?.normalized_business_revenue_after_fraud)],
      ])}
      <p class="muted small">LLM chọn lọc: ${esc(revenue.llm_adjudication?.resolved ?? 0)}/${esc(revenue.llm_adjudication?.requested ?? 0)} giao dịch xử lý · ${esc(revenue.pending_review_transaction_ids?.length ?? 0)} giao dịch còn chờ rà soát.</p>
    </section>` : '';
    const findings = Array.isArray(fraud?.findings) ? fraud.findings : [];
    const fraudSection = fraud ? `
    <section class="card">
      <h2>🛡️ Gian lận &amp; bất thường (${esc(findings.length)})</h2>
      ${kvTable([
        ['SDBQ gốc', fmtMoney(fraud.adjusted_balance?.original_selected_avg_sdbq)],
        ['SDBQ sau loại window dressing', fmtMoney(fraud.adjusted_balance?.adjusted_selected_avg_sdbq)],
        ['Cặp window dressing', fmtNum(fraud.metrics?.window_dressing_pairs)],
        ['Cặp quay vòng quan sát được', fmtNum(fraud.metrics?.observed_round_trip_pairs)],
      ])}
      ${findings.length > 0 ? `<ul class="warn-list">${findings.map((item: any) =>
        `<li><b>${esc(item.title)}</b>: ${esc(item.detail)}${item.txIndexes?.length ? ` (Dòng ${esc(item.txIndexes.join(', '))})` : ''}</li>`
      ).join('')}</ul>` : '<p class="muted small">Không phát hiện tín hiệu bất thường theo ruleset hiện tại.</p>'}
    </section>` : '';
    return revenueSection + fraudSection;
  })();

  const monthly = `
    <section class="card">
      <h2>📅 Số dư theo tháng (các tháng được chọn)</h2>
      <p class="muted small">≤ 6 tháng có SDBQ cao nhất (không bắt buộc liên tiếp) · số dư thấp/cao nhất theo số dư sau mỗi giao dịch · SDBQ = (min + max) / 2.</p>
      ${monthlyTable(analysis.monthly_balances)}
    </section>`;

  const raw = `
    <section class="card">
      <h2>📄 Data raw (${esc(analysis.total_transactions)} giao dịch)</h2>
      <p class="muted small">Cột Check: ✓ = số dư khớp chuỗi · ⚠ = lệch so với (số dư trước + Có − Nợ − Phí − Thuế).</p>
      ${rawTable(analysis.data_raw || [], analysis.ocr_quality_detail?.balance_breaks || [])}
    </section>`;

  const quality = `
    <section class="card">
      <h2>🔎 Chất lượng OCR</h2>
      <p class="muted small">Ratio = 0.6 × tính nhất quán chuỗi số dư + 0.2 × độ đầy đủ header + 0.2 × tỉ lệ trang OCR ra dữ liệu.</p>
      ${kvTable([
        ['OCR success ratio', pctText(ratioValue)],
        [
          'Balance chain consistency',
          `${pctText(q.balance_consistency_ratio)} (${fmtVal(q.balance_consistent)}/${fmtVal(
            q.balance_checked,
          )} dòng)`,
        ],
        ['Header completeness', pctText(q.header_completeness)],
        ['Page parse ratio', pctText(q.page_parse_ratio)],
      ])}
      ${
        Array.isArray(q.balance_breaks) && q.balance_breaks.length > 0
          ? `<h3>Các điểm số dư không khớp (${q.balance_breaks.length})</h3>
      <p class="muted small">Số dư dòng này lệch so với (số dư trước + Có − Nợ − Phí − Thuế). Nghi đọc sai chữ số, thiếu dòng, hoặc bút toán đảo — cần soi lại.</p>
      ${breaksTable(q.balance_breaks)}`
          : ''
      }
      ${pdfInfo?.pages ? `<h3>Chi tiết theo lô OCR</h3>${pagesTable(pdfInfo.pages)}` : ''}
    </section>`;

  const warningsList: string[] = Array.isArray(analysis.warnings)
    ? analysis.warnings.filter((x: unknown) => x != null && String(x).trim() !== '')
    : [];
  const warningsSection = warningsList.length > 0
    ? `
    <section class="card warn-card">
      <h2>⚠️ Lưu ý (${warningsList.length})${
        analysis.balance_source === 'computed'
          ? ' <span class="warn-badge">Số dư do hệ thống tính</span>'
          : ''
      }</h2>
      <ul class="warn-list">${warningsList.map((x: string) => `<li>${esc(x)}</li>`).join('')}</ul>
    </section>`
    : '';

  const charts = chartsSection(analysis);

  return baseDocument(
    `Báo cáo Sao kê ${analysis.account_no || ''}`.trim(),
    header + warningsSection + summary + charts.html + intelligence + monthly + raw + quality,
    generatedAt,
    charts.script,
  );
}

// ─── HTML shell + styles ─────────────────────────────────────────────────────

function baseDocument(title: string, body: string, generatedAt: string, extraScript = ''): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root { --border:#e2e8f0; --muted:#64748b; --bg:#f8fafc; --card:#ffffff; --fg:#0f172a; --primary:#4f46e5; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background:var(--bg); color:var(--fg); line-height:1.5; }
  .wrap { max-width: 980px; margin: 0 auto; }
  .report-header { margin-bottom: 20px; }
  .title-row { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  h1 { font-size: 22px; margin: 0; }
  h2 { font-size: 15px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
  h3 { font-size: 13px; margin: 16px 0 8px; }
  .subtitle { margin: 6px 0 0; color: var(--fg); font-size: 13px; }
  .muted { color: var(--muted); }
  .small { font-size: 11px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:18px; margin-bottom:16px; }
  .ocr-badge { padding:6px 12px; border-radius:999px; font-size:12px; font-weight:700; border:1px solid; }
  .ocr-badge.pass { background:#ecfdf5; color:#059669; border-color:#a7f3d0; }
  .ocr-badge.warn { background:#fffbeb; color:#d97706; border-color:#fde68a; }
  .ocr-badge.fail { background:#fef2f2; color:#dc2626; border-color:#fecaca; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  table.kv th { text-align:left; font-weight:600; color:var(--muted); width:240px; vertical-align:top; }
  table.kv th, table.kv td { padding:7px 10px; border-top:1px solid var(--border); }
  table.kv tr:first-child th, table.kv tr:first-child td { border-top:none; }
  table.grid { border:1px solid var(--border); border-radius:8px; overflow:hidden; }
  table.grid th { background:#f1f5f9; text-align:left; font-weight:600; padding:8px 10px; }
  table.grid td { padding:6px 10px; border-top:1px solid var(--border); }
  table.grid.tx { font-size:11px; }
  .r { text-align:right; vertical-align:top; }
  .b { font-weight:700; }
  .date-note { font-size:10px; color:var(--muted); font-weight:400; }
  .stats { display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; }
  .stat { background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:12px; text-align:center; }
  .stat-label { font-size:10px; color:var(--muted); margin-bottom:4px; }
  .stat-value { font-size:16px; font-weight:700; }
  .extrema { display:grid; grid-template-columns: repeat(2, 1fr); gap:12px; }
  .ex { border-radius:10px; padding:12px; border:1px solid; }
  .ex-max { background:#ecfdf5; border-color:#a7f3d0; }
  .ex-min { background:#fef2f2; border-color:#fecaca; }
  .ex-label { font-size:10px; color:var(--muted); }
  .ex-value { font-size:18px; font-weight:700; }
  .ex-max .ex-value { color:#059669; }
  .ex-min .ex-value { color:#dc2626; }
  .ex-meta { font-size:11px; color:var(--muted); margin-top:4px; }
  tr.status-error { background:#fef2f2; }
  tr.status-empty { background:#fffbeb; }
  .warn-card { background:#fffbeb; border-color:#fde68a; }
  .warn-card h2 { border-color:#fde68a; }
  .warn-badge { display:inline-block; margin-left:8px; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:600; background:#fde68a; color:#92400e; vertical-align:middle; }
  .warn-list { margin:4px 0 0; padding-left:22px; }
  .warn-list li { font-size:12px; color:#92400e; margin:3px 0; }
  pre.raw { font-size:11px; white-space:pre-wrap; word-break:break-all; background:var(--bg); padding:12px; border-radius:8px; }
  .chart-wrap { position:relative; height:300px; margin:6px 0 18px; }
  @media print { body { background:#fff; padding:0; } .card { break-inside: avoid; } .chart-wrap { height:260px; } }
</style>
</head>
<body>
<div class="wrap">
${body}
<footer class="muted small" style="margin-top:24px; text-align:center;">AI SkillHub · Statement Analyze · ${esc(
    generatedAt,
  )}</footer>
</div>
${extraScript}
</body>
</html>`;
}

// ─── Download trigger ──────────────────────────────────────────────────────────

/** Build the report and trigger a browser download as an .html file. */
export function downloadStatementReportHtml(data: any): void {
  const html = buildStatementReportHtml(data);
  const accountNo = data?.result?.analysis?.account_no;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const safeAccount = accountNo ? String(accountNo).replace(/[^\w-]/g, '') : 'sao-ke';
  const filename = `Bao-cao_${safeAccount}_${stamp}.html`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the object URL on the next tick (after the download has started).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
