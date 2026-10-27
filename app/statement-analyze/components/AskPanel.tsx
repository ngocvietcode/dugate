'use client';

// app/statement-analyze/components/AskPanel.tsx
// Panel Hỏi–Đáp trên dữ liệu sao kê. Gửi câu hỏi + CSV giao dịch (rút gọn, bỏ null) +
// tóm tắt tới /api/statement-analyze/ask; hiển thị câu trả lời. Kèm nút "Đánh giá rủi ro".

import React, { useMemo, useRef, useState } from 'react';
import { transactionsToCsv } from '../lib/transactions-csv';
import { formatVnd } from '../lib/money';

interface Msg { role: 'user' | 'assistant'; text: string; }

const SUGGESTIONS = [
  '3 giao dịch lớn nhất của tháng 01',
  'Có dấu hiệu chia nhỏ / cấu trúc hoá giao dịch không?',
  'Dòng tiền có bất thường vào cuối kỳ không?',
  'Liệt kê các đối tác nhận tiền nhiều nhất',
];

function buildSummary(a: any): string {
  const w = a?.selected_window || {};
  const lines = [
    `Khách hàng: ${a?.customer_name ?? '—'} | Số TK: ${a?.account_no ?? '—'} | Ngân hàng: ${a?.bank_name ?? '—'}`,
    `Kỳ sao kê: ${a?.statement_start_date ?? '—'} → ${a?.statement_end_date ?? '—'}`,
    `Số dư đầu kỳ: ${formatVnd(a?.account_start_balance)} | Số dư cuối kỳ: ${formatVnd(a?.account_end_balance)}`,
    `Tổng giao dịch: ${a?.total_transactions ?? '—'} | Nguồn số dư: ${a?.balance_source ?? 'statement'}`,
    `Chu kỳ SDBQ cao nhất: ${w.start_month ?? '—'}–${w.end_month ?? '—'} | SDBQ TB: ${formatVnd(w.avg_sdbq)}`,
    `Số dư cao nhất kỳ: ${formatVnd(a?.max_balance_value)} (${a?.time_of_max_balance ?? '—'}) | thấp nhất: ${formatVnd(a?.min_balance_value)} (${a?.time_of_min_balance ?? '—'})`,
  ];
  if (Array.isArray(a?.warnings) && a.warnings.length > 0) {
    lines.push(`Cảnh báo hệ thống: ${a.warnings.join(' | ')}`);
  }
  return lines.join('\n');
}

export function AskPanel({ analysis, apiKey }: { analysis: any; apiKey?: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const csv = useMemo(() => transactionsToCsv(analysis?.data_raw || []), [analysis]);
  const summary = useMemo(() => buildSummary(analysis), [analysis]);

  const ask = async (question: string, mode: 'qa' | 'risk' = 'qa') => {
    if (loading) return;
    const shown = mode === 'risk' && !question ? '📋 Đánh giá rủi ro tổng thể' : question;
    if (!shown.trim()) return;

    setError(null);
    setMessages((m) => [...m, { role: 'user', text: shown }]);
    setInput('');
    setLoading(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['X-API-Key'] = apiKey;
      const res = await fetch('/api/statement-analyze/ask', {
        method: 'POST',
        headers,
        body: JSON.stringify({ question, csv, summary, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.title || `Lỗi ${res.status}`);
      const note = data.truncated ? '\n\n_(Lưu ý: dữ liệu giao dịch quá lớn, đã cắt bớt khi phân tích.)_' : '';
      setMessages((m) => [...m, { role: 'assistant', text: (data.answer || '(không có nội dung)') + note }]);
    } catch (e: any) {
      setError(e?.message || 'Không xử lý được câu hỏi.');
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    }
  };

  const hasData = !!csv;

  return (
    <div className="flex flex-col h-[560px]">
      {!hasData && (
        <p className="text-xs text-muted-foreground mb-2">Không có dữ liệu giao dịch để hỏi.</p>
      )}

      {/* Hành động nhanh */}
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          disabled={!hasData || loading}
          onClick={() => ask('', 'risk')}
          className="modern-button btn-outline text-xs gap-1.5 disabled:opacity-50"
        >
          📋 Đánh giá rủi ro tổng thể
        </button>
        {SUGGESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={!hasData || loading}
            onClick={() => ask(q)}
            className="px-2.5 py-1 rounded-full text-[11px] ring-1 ring-border/60 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Hội thoại */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Đặt câu hỏi về sao kê (vd &quot;3 giao dịch lớn nhất tháng 01&quot;). Hệ thống trả lời dựa trên dữ liệu đã trích xuất.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[12px] whitespace-pre-wrap leading-relaxed ${
              m.role === 'user' ? 'bg-primary/10 ring-1 ring-primary/20' : 'bg-background ring-1 ring-border/50'
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-lg px-3 py-2 text-[12px] bg-background ring-1 ring-border/50 text-muted-foreground">
              Đang phân tích…
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-[11px] text-red-600 mt-2">{error}</p>}

      {/* Ô nhập */}
      <form
        className="flex gap-2 mt-3"
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!hasData || loading}
          placeholder="Nhập câu hỏi về sao kê…"
          className="flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!hasData || loading || !input.trim()}
          className="modern-button btn-primary text-xs disabled:opacity-50"
        >
          Gửi
        </button>
      </form>
      <p className="text-[10px] text-muted-foreground mt-1.5">
        Câu trả lời do AI tạo dựa trên dữ liệu sao kê — hãy đối chiếu trước khi ra quyết định.
      </p>
    </div>
  );
}
