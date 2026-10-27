'use client';

import { AlertTriangle, CheckCircle2, FileSearch, Languages, Link2Off } from 'lucide-react';
import { CLAIM_STATUS_LABELS, type ClaimsSummary, type ClaimView, type DiscrepancyGroup } from '@/app/loan-appraisal-v2/lib/claims-view';
import { Badge } from '../ui/Badge';

const TONE_ICON = { danger: AlertTriangle, warning: AlertTriangle, info: Languages, success: CheckCircle2, neutral: FileSearch } as const;

/** Một nguồn: loại chứng từ, nguyên văn nếu khác, độ tin cậy ĐỌC CHỮ (không phải "đúng người"), trang. */
function SourceLine({ s }: { s: ClaimView['sources'][number] }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-muted-foreground" title={s.recordId}>
      <span className="text-foreground">{s.doc}</span>
      {s.raw !== null && <span>ghi: <span className="font-mono text-foreground">{s.raw}</span></span>}
      {s.readPercent !== null && <span title="Độ tin cậy khi đọc chữ (cấp nhóm trường), không phải độ tin cậy đúng người">đọc {s.readPercent}%</span>}
      {s.page !== null && <span>tr.{s.page}</span>}
    </li>
  );
}

function ClaimBlock({ c, mark }: { c: ClaimView; mark: boolean }) {
  return (
    <div className="rounded-md border border-border bg-background px-2.5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="break-all font-mono text-[13px] font-semibold text-foreground">{c.value}</span>
        {mark && <Badge tone={c.tone === 'danger' ? 'danger' : c.tone === 'warning' ? 'warning' : c.tone === 'success' ? 'success' : c.tone === 'info' ? 'info' : 'neutral'}>{CLAIM_STATUS_LABELS[c.status] ?? c.status}</Badge>}
      </div>
      <ul className="mt-1 space-y-0.5">{c.sources.map((s) => <SourceLine key={s.recordId} s={s} />)}</ul>
    </div>
  );
}

function Group({ g }: { g: DiscrepancyGroup }) {
  const Icon = TONE_ICON[g.tone];
  const conflicting = g.tone === 'danger' || g.tone === 'warning';
  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2.5 text-xs">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden style={{ color: conflicting ? 'rgb(var(--la2-warning))' : undefined }} />
        <span className="font-semibold text-foreground">{g.fieldLabel}</span>
        <span className="text-muted-foreground">của</span>
        <span className="font-medium text-foreground">{g.subjectName}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{g.subjectId}</span>
      </p>
      <div className={`mt-2 grid gap-2 ${g.claims.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {g.claims.map((c) => <ClaimBlock key={c.id} c={c} mark />)}
      </div>
    </li>
  );
}

function Section({ title, tone, groups }: { title: string; tone: 'danger' | 'warning' | 'info' | 'success'; groups: DiscrepancyGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}<Badge tone={tone}>{groups.length}</Badge>
      </p>
      <ul className="space-y-2">{groups.map((g) => <Group key={g.key} g={g} />)}</ul>
    </div>
  );
}

/**
 * "Đối chiếu giữa các chứng từ": thông tin nào do chứng từ nào khẳng định, chỗ nào không khớp. Mâu thuẫn hiện trước, mặc định mở;
 * phần đồng thuận và cách viết khác gọn hơn. Mỗi giá trị đi kèm nguồn riêng nên không có "một giá trị chọn sẵn kèm ghi chú".
 */
export function ClaimsPanel({ summary }: { summary: ClaimsSummary }) {
  const disputed = summary.groups.filter((g) => g.tone === 'danger');
  const ocr = summary.groups.filter((g) => g.tone === 'warning');
  const variants = summary.groups.filter((g) => g.tone === 'info');
  const confirmed = summary.groups.filter((g) => g.tone === 'success');
  const hasAnything = summary.groups.length > 0 || summary.unresolved.length > 0;

  return (
    <section aria-label="Đối chiếu giữa các chứng từ" className="space-y-3">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <FileSearch className="h-3.5 w-3.5" aria-hidden />Đối chiếu giữa các chứng từ
      </h4>
      {!hasAnything ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Chưa thấy thông tin nào được nhiều chứng từ cùng khẳng định hoặc mâu thuẫn nhau.
        </p>
      ) : (
        <>
          <Section title="Không khớp, cần rà soát" tone="danger" groups={disputed} />
          <Section title="Nghi lỗi đọc chữ" tone="warning" groups={ocr} />
          <Section title="Khác cách viết" tone="info" groups={variants} />
          <Section title="Được nhiều chứng từ xác nhận" tone="success" groups={confirmed} />
          {summary.unresolved.length > 0 && (
            <div className="rounded-lg border border-border bg-card px-3 py-2.5 text-xs">
              <p className="mb-1 flex items-center gap-2 font-semibold text-foreground"><Link2Off className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />Thông tin chưa gắn được vào người hoặc tài sản</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {summary.unresolved.map((u) => <li key={u.reason}>{u.label}: <span className="font-medium text-foreground">{u.count}</span> mục</li>)}
              </ul>
            </div>
          )}
        </>
      )}
      <p className="text-[11px] text-muted-foreground">
        Danh sách chỉ gồm thông tin được đối chiếu hoặc cần chú ý ({summary.coverage.shownLeaves}/{summary.coverage.leafCount} mục đọc được từ chứng từ).
        {summary.coverage.omittedLeaves > 0 && ' Các mục còn lại chỉ có một nguồn, xem ở phần chi tiết từng chứng từ.'}
      </p>
    </section>
  );
}
