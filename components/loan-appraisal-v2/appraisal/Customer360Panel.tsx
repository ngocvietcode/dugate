'use client';

import { useMemo, type ReactNode } from 'react';
import { AlertTriangle, Banknote, Building2, CheckCircle2, FileText, Home, Landmark, Link2, Users, Wallet, type LucideIcon } from 'lucide-react';
import type { AppraisalResult } from '@/app/loan-appraisal/types';
import { docTypeLabelOf } from '@/app/loan-appraisal-v2/lib/classification-view';
import { buildCustomer360View, type CollateralCard, type CustomerCard, type Row } from '@/app/loan-appraisal-v2/lib/customer360';
import type { Issue } from '@/lib/loan-dossier/profile360/schema';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { DataTable } from '../ui/DataTable';
import { Disclosure } from '../ui/Disclosure';
import { TONE_BOX } from '../ui/toneClasses';

const ISSUE_LABEL: Record<Issue['severity'], string> = { danger: 'Phải xử lý', warning: 'Cần soát', info: 'Lưu ý' };
const SHOWN_ISSUES = 6;

function Section({ n, title, icon: Icon, aside, children }: { n: number; title: string; icon: LucideIcon; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h4 className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" aria-hidden />{n}. {title}</span>
        {aside}
      </h4>
      {children}
    </section>
  );
}

/** "nhãn : giá trị · ghi chú trust" hai cột. */
function Rows({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1 text-xs">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className="contents">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="min-w-0 break-words text-foreground">
            {r.value}
            {r.note && <span className={`ml-1.5 text-[10px] ${r.tone === 'danger' ? 'text-[rgb(var(--la2-danger))]' : r.tone === 'warning' ? 'text-[rgb(var(--la2-warning))]' : 'text-muted-foreground'}`}>· {r.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Chứng từ" />
      {items.map((s) => <span key={s} className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{s}</span>)}
    </div>
  );
}

function IssueList({ items }: { items: Issue[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((i, n) => (
        <li key={`${i.code}-${i.subject_id}-${n}`} className="rounded-lg border border-border px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={i.severity}>{ISSUE_LABEL[i.severity]}</Badge>
            <strong className="text-foreground">{i.subject_label}</strong>
            <span className="text-foreground">{i.title}</span>
          </div>
          {i.detail && <p className="mt-1 break-words text-muted-foreground">{i.detail}</p>}
        </li>
      ))}
    </ul>
  );
}

function CustomerItem({ c }: { c: CustomerCard }) {
  return (
    <li className="rounded-lg border border-border bg-card px-3 py-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {c.isOrg && <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Doanh nghiệp" />}
          {c.name}<span className="ml-1 font-mono text-[11px] font-normal text-muted-foreground">{c.personId}</span>
        </p>
        <div className="flex flex-wrap gap-1">
          {c.roleLabels.map((r) => <Badge key={r} tone="info">{r}</Badge>)}
          {c.issueCount > 0 && <Badge tone="warning" icon={AlertTriangle}>{c.issueCount}</Badge>}
        </div>
      </div>
      <div className="mt-2"><Rows rows={c.identity} /></div>
      {c.relations.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-border pt-2">
          {c.relations.map((r) => (
            <li key={`${r.text}-${r.name}`} className="flex items-start gap-1.5">
              <Link2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
              <span><span className={r.tone === 'warning' ? 'text-[rgb(var(--la2-warning))]' : 'text-muted-foreground'}>{r.text}: </span><span className="font-medium text-foreground">{r.name}</span></span>
            </li>
          ))}
        </ul>
      )}
      {c.details.length > 0 && (
        <div className="mt-2">
          <Disclosure defaultOpen={c.issueCount > 0} summary={<span>Chi tiết từ chứng từ <span className="font-normal text-muted-foreground">({c.details.length} mục)</span></span>}>
            <Rows rows={c.details} />
          </Disclosure>
        </div>
      )}
      {c.documents.length > 0 && <div className="mt-2 border-t border-border pt-2"><Chips items={c.documents} /></div>}
    </li>
  );
}

function CollateralItem({ a }: { a: CollateralCard }) {
  return (
    <li className="rounded-lg border border-border bg-card px-3 py-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Home className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />{a.title}
          <span className="ml-1 font-mono text-[11px] font-normal text-muted-foreground">{a.assetId}</span>
        </p>
        <div className="flex flex-wrap gap-1">
          <Badge tone={a.confirmed ? 'success' : 'warning'}>{a.usage}{a.confirmed ? '' : ' · cần xác nhận'}</Badge>
          {a.issueCount > 0 && <Badge tone="warning" icon={AlertTriangle}>{a.issueCount}</Badge>}
        </div>
      </div>
      <p className="mt-1.5 text-muted-foreground">Chủ sở hữu: <span className="font-medium text-foreground">{a.owners}</span></p>
      {a.valuations.length > 0 ? (
        <div className="mt-2 border-t border-border pt-2">
          <ul className="space-y-0.5">
            {a.valuations.map((v, i) => (
              <li key={`${v.source}-${i}`} className="flex flex-wrap justify-between gap-2">
                <span className="text-muted-foreground">{v.source} · {v.date}</span>
                <span className="tabular-nums text-foreground">{v.value}{v.review && <span className="ml-1 text-[10px] text-[rgb(var(--la2-warning))]">· cần soát</span>}</span>
              </li>
            ))}
          </ul>
          {a.chosenValue && <p className="mt-1 font-semibold text-foreground">Giá trị dùng tính LTV: <span className="tabular-nums">{a.chosenValue}</span> <span className="font-normal text-muted-foreground">(thấp nhất các chứng thư)</span></p>}
        </div>
      ) : <p className="mt-2 border-t border-border pt-2 text-muted-foreground">Chưa có chứng thư định giá.</p>}
      {a.details.length > 0 && (
        <div className="mt-2">
          <Disclosure summary={<span>Đặc điểm từ chứng từ <span className="font-normal text-muted-foreground">({a.details.length} mục)</span></span>}><Rows rows={a.details} /></Disclosure>
        </div>
      )}
    </li>
  );
}

/**
 * Customer 360 (D-114): một nguồn sự thật (`result.profile_360`), đọc theo hồ sơ vay — vấn đề cần xử lý → đề nghị vay vốn → khách hàng → nguồn
 * trả nợ → nghĩa vụ nợ → tài sản bảo đảm. Mọi số trùng với số stage 2 dùng tính DSCR / LTV.
 */
export function Customer360Panel({ result }: { result: AppraisalResult }) {
  const profile = result.profile_360 ?? null;
  const view = useMemo(() => (profile ? buildCustomer360View(profile, docTypeLabelOf) : null), [profile]);
  if (!view) {
    return (
      <Card labelledBy="la2-c360-title">
        <CardHeader id="la2-c360-title" icon={Users} title="Customer 360" subtitle="Chưa có hồ sơ 360: chưa gom được người & tài sản (thiếu giấy đề nghị vay đọc được) hoặc kết quả được tạo trước D-114 — chạy lại để xem." />
      </Card>
    );
  }
  const { issues, loan, customers, repayment, obligations, collateral, counts } = view;
  const urgent = issues.danger + issues.warning;
  return (
    <Card labelledBy="la2-c360-title">
      <CardHeader
        id="la2-c360-title"
        icon={Users}
        title="Customer 360"
        subtitle={`${counts.customers} khách hàng & người liên quan · ${counts.collateral} tài sản bảo đảm`}
        actions={urgent > 0 ? <Badge tone={issues.danger > 0 ? 'danger' : 'warning'} icon={AlertTriangle}>{urgent} điểm cần xử lý</Badge> : <Badge tone="success" icon={CheckCircle2}>Không có điểm cần xử lý</Badge>}
      />
      <CardBody className="space-y-6">
        {issues.items.length > 0 && (
          <section aria-label="Vấn đề cần xử lý">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Vấn đề cần xử lý trước khi quyết định</h4>
            <IssueList items={issues.items.slice(0, SHOWN_ISSUES)} />
            {issues.items.length > SHOWN_ISSUES && (
              <div className="mt-1.5"><Disclosure summary={`Xem thêm ${issues.items.length - SHOWN_ISSUES} điểm`}><IssueList items={issues.items.slice(SHOWN_ISSUES)} /></Disclosure></div>
            )}
          </section>
        )}

        <Section n={1} title="Đề nghị vay vốn" icon={Banknote} aside={loan.disputed ? <Badge tone="danger">Các đơn vay ghi khác nhau</Badge> : undefined}>
          <div className="grid gap-x-8 gap-y-3 rounded-lg border border-border bg-card px-3 py-3 md:grid-cols-2">
            <Rows rows={loan.rows} />
            {loan.purposes.length > 0 && (
              <div className="text-xs">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mục đích vay</p>
                <ul className="list-disc space-y-0.5 pl-4 text-foreground">{loan.purposes.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            )}
          </div>
        </Section>

        <Section n={2} title={`Khách hàng (${customers.length})`} icon={Users}>
          <ul className="grid gap-2 lg:grid-cols-2">{customers.map((c) => <CustomerItem key={c.personId} c={c} />)}</ul>
        </Section>

        <Section n={3} title="Nguồn trả nợ" icon={Wallet} aside={repayment.monthlyTotal ? <span className="normal-case tracking-normal">Tổng thu nhập: <strong className="tabular-nums text-foreground">{repayment.monthlyTotal}/tháng</strong></span> : undefined}>
          <div className="space-y-3">
            {(repayment.dscrProfit || repayment.dscrRevenue) && (
              <p className={`rounded-lg border px-3 py-2 text-xs ${TONE_BOX.info}`}>
                Dùng tính DSCR: lợi nhuận hộ kinh doanh <strong className="tabular-nums">{repayment.dscrProfit ?? '—'}</strong>/năm · doanh thu <strong className="tabular-nums">{repayment.dscrRevenue ?? '—'}</strong>/năm
              </p>
            )}
            <DataTable
              caption="Nguồn thu"
              rows={repayment.income}
              rowKey={(r) => `${r.kind}-${r.owner}-${r.business}-${r.monthly}`}
              empty="Chưa có nguồn thu trên chứng từ"
              columns={[
                { key: 'kind', header: 'Loại', cell: (r) => r.kind },
                { key: 'owner', header: 'Của ai', cell: (r) => r.owner },
                { key: 'business', header: 'Hộ kinh doanh', cell: (r) => r.business ?? '—' },
                { key: 'monthly', header: 'Số tiền/tháng', cell: (r) => <span className="tabular-nums">{r.monthly}</span> },
                { key: 'evidenced', header: 'Chứng từ', cell: (r) => (r.evidenced ? <Badge tone="success">Có chứng từ</Badge> : <span className="text-muted-foreground">chỉ lời khai</span>) },
              ]}
            />
            {repayment.businesses.length > 0 && (
              <DataTable
                caption="Hộ kinh doanh"
                rows={repayment.businesses}
                rowKey={(r) => `${r.name}-${r.registration}`}
                empty="Chưa có hộ kinh doanh"
                columns={[
                  { key: 'name', header: 'Hộ kinh doanh', cell: (r) => r.name },
                  { key: 'registration', header: 'Số GCN', cell: (r) => r.registration },
                  { key: 'line', header: 'Ngành', cell: (r) => r.line },
                  { key: 'owners', header: 'Chủ hộ', cell: (r) => r.owners },
                  { key: 'verified', header: 'Xác minh', cell: (r) => <Badge tone={r.verified ? 'success' : 'warning'}>{r.verified ? 'Chủ hộ đã xác minh' : 'Chưa xác minh chủ hộ'}</Badge> },
                  { key: 'documents', header: 'Chứng từ', cell: (r) => <Chips items={r.documents} /> },
                ]}
              />
            )}
          </div>
        </Section>

        <Section n={4} title="Nghĩa vụ nợ" icon={Landmark}>
          <DataTable
            caption="Nghĩa vụ nợ"
            rows={obligations}
            rowKey={(r) => `${r.kind}-${r.owner}-${r.lender}-${r.amount}`}
            empty="Không khai nợ hiện hữu và không có HĐ tín dụng / CIC trong hồ sơ"
            columns={[
              { key: 'kind', header: 'Nguồn', cell: (r) => r.kind },
              { key: 'owner', header: 'Của ai', cell: (r) => r.owner },
              { key: 'lender', header: 'Tổ chức', cell: (r) => r.lender },
              { key: 'amount', header: 'Số tiền', cell: (r) => <span className="tabular-nums">{r.amount}</span> },
              { key: 'note', header: 'Ghi chú', cell: (r) => r.note || '—' },
            ]}
          />
        </Section>

        <Section n={5} title={`Tài sản (${collateral.length})`} icon={Home}>
          {collateral.length > 0
            ? <ul className="grid gap-2 lg:grid-cols-2">{collateral.map((a) => <CollateralItem key={a.assetId} a={a} />)}</ul>
            : <p className="text-xs text-muted-foreground">Chưa có tài sản trong hồ sơ.</p>}
        </Section>
      </CardBody>
    </Card>
  );
}
