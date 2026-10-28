'use client';

import { useMemo } from 'react';
import { AlertTriangle, Banknote, Building2, CheckCircle2, FileText, Home, Link2, Users } from 'lucide-react';
import type { AppraisalResult, DossierEvidence } from '@/app/loan-appraisal/types';
import { docTypeLabelOf } from '@/app/loan-appraisal-v2/lib/classification-view';
import { buildClaimsSummary, type SubjectNotes } from '@/app/loan-appraisal-v2/lib/claims-view';
import type { DetailRow } from '@/app/loan-appraisal-v2/lib/customer360-detail';
import { buildCustomer360, shouldOpenDetail, type AssetCard, type PersonCard } from '@/app/loan-appraisal-v2/lib/customer360-view';
import { buildDecision360 } from '@/app/loan-appraisal-v2/lib/decision-360';
import { assetContextView } from '@/app/loan-appraisal-v2/lib/dossier-view';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Disclosure } from '../ui/Disclosure';
import { ClaimsPanel } from './ClaimsPanel';
import { Decision360Card } from './Decision360Card';

/** Kết quả đối chiếu giữa các chứng từ cho đúng người / tài sản này: cảnh báo hiện ngay trên thẻ, không phải tìm ở khối riêng. */
function ClaimNotes({ notes }: { notes?: SubjectNotes }) {
  if (!notes || (notes.warnings.length === 0 && notes.variants.length === 0 && notes.confirmed.length === 0)) return null;
  return (
    <div className="mt-2 space-y-1 border-t border-border pt-2">
      {notes.warnings.length > 0 && <ul className="flex flex-wrap gap-1.5">{notes.warnings.map((w) => <li key={w}><Badge tone="danger" icon={AlertTriangle}>{w}</Badge></li>)}</ul>}
      {notes.variants.length > 0 && <p className="text-[11px] text-muted-foreground">{notes.variants.join('; ')}.</p>}
      {notes.confirmed.length > 0 && (
        <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" style={{ color: 'rgb(var(--la2-success))' }} aria-hidden />
          Đã khớp giữa các chứng từ: {notes.confirmed.join(', ')}
        </p>
      )}
    </div>
  );
}

/** Danh sách "nhãn : giá trị" hai cột; nguồn chứng từ nhỏ ở cuối giá trị. */
function Rows({ rows }: { rows: DetailRow[] }) {
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className="contents">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="min-w-0 break-words text-foreground">
            {r.value}
            {r.source && <span className="ml-1.5 text-[10px] text-muted-foreground">· {r.source}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, rows }: { title: string; rows: DetailRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <Rows rows={rows} />
    </div>
  );
}

/** Nguồn chứng từ dạng chip (thay cho một dòng dài khó đọc). */
function SourceChips({ sources, titles = {} }: { sources: string[]; titles?: Record<string, string> }) {
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Nguồn chứng từ" />
      {sources.map((s) => <span key={s} title={titles[s]} className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{s}</span>)}
    </div>
  );
}

function PersonItem({ p, notes }: { p: PersonCard; notes?: SubjectNotes }) {
  const d = p.detail;
  const extra = d.personal.length + d.business.length + d.income.length + d.credit.length;
  return (
    <li className="rounded-lg border border-border bg-card px-3 py-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {p.isOrg && <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Doanh nghiệp" />}
          {p.name}<span className="ml-1 font-mono text-[11px] font-normal text-muted-foreground">{p.personId}</span>
        </p>
        <div className="flex flex-wrap gap-1">
          {p.isOrg && <Badge tone="neutral">Doanh nghiệp</Badge>}
          {p.roleLabels.map((r) => <Badge key={r} tone="info">{r}</Badge>)}
        </div>
      </div>

      <div className="mt-2">
        <Rows rows={[...p.facts.map((f) => ({ label: f.label, value: f.value })), ...(p.marital ? [{ label: 'Hôn nhân', value: p.marital }] : [])]} />
      </div>

      {p.relations.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-border pt-2">
          {p.relations.map((r) => (
            <li key={`${r.kind}-${r.otherId}`} className="flex items-start gap-1.5">
              <Link2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
              <span><span className="text-muted-foreground">{r.text}: </span><span className="font-medium text-foreground">{r.otherName}</span> <span className="font-mono text-[10px] text-muted-foreground">{r.otherId}</span></span>
            </li>
          ))}
        </ul>
      )}

      {p.assets.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-border pt-2">
          {p.assets.map((a) => (
            <li key={a.assetId} className="flex items-start gap-1.5">
              <Home className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
              <span><span className="text-muted-foreground">{a.current ? 'Đứng tên' : 'Từng đứng tên'}: </span><span className="font-medium text-foreground">{a.typeLabel}</span> · {a.key} <span className="font-mono text-[10px] text-muted-foreground">{a.assetId}</span>{a.warn && <span className="ml-1 text-[rgb(var(--la2-warning))]">· cần xác nhận</span>}</span>
            </li>
          ))}
        </ul>
      )}

      {p.alerts.length > 0 && <ul className="mt-2 flex flex-wrap gap-1.5">{p.alerts.map((a) => <li key={a}><Badge tone="warning" icon={AlertTriangle}>{a}</Badge></li>)}</ul>}
      <ClaimNotes notes={notes} />

      {extra > 0 && (
        <div className="mt-2">
          <Disclosure defaultOpen={shouldOpenDetail(p, notes)} summary={<span>Chi tiết từ chứng từ <span className="font-normal text-muted-foreground">({extra} mục)</span></span>}>
            <div className="space-y-3">
              <Section title={p.isOrg ? 'Thông tin' : 'Thông tin cá nhân'} rows={d.personal} />
              <Section title="Hộ kinh doanh / doanh nghiệp" rows={d.business} />
              <Section title="Thu nhập" rows={d.income} />
              <Section title="Tín dụng (CIC)" rows={d.credit} />
            </div>
          </Disclosure>
        </div>
      )}

      {p.sources.length > 0 && <div className="mt-2 border-t border-border pt-2"><SourceChips sources={p.sources} /></div>}
    </li>
  );
}

/** Nguồn của tài sản: gộp theo loại chứng từ (kèm số lượng); tên file nằm ở tooltip thay vì chen vào dòng. */
function sourceChips(entry: { sources: unknown[] } | undefined, evidences: DossierEvidence[]): Array<{ text: string; files: string }> {
  const byId = new Map(evidences.map((e) => [e.evidence_id, e]));
  const groups = new Map<string, { n: number; files: Set<string> }>();
  for (const s of (entry?.sources ?? []) as Array<{ evidence_id: string; doc_type_key: string }>) {
    const e = byId.get(s.evidence_id);
    const label = e?.doc_type_label ?? s.doc_type_key;
    const g = groups.get(label) ?? { n: 0, files: new Set<string>() };
    g.n += 1;
    g.files.add(e?.file_name ?? s.evidence_id);
    groups.set(label, g);
  }
  return [...groups].map(([label, g]) => ({ text: g.n > 1 ? `${label} ×${g.n}` : label, files: [...g.files].join(', ') }));
}

function AssetItem({ a, result, evidences, notes }: { a: AssetCard; result: AppraisalResult; evidences: DossierEvidence[]; notes?: SubjectNotes }) {
  const entry = result.customer_360?.asset_registry?.find((x) => x.asset_id === a.assetId);
  const view = entry ? assetContextView(entry, evidences) : null;
  const d = a.detail;
  const chips = sourceChips(entry, evidences);
  return (
    <li className="rounded-lg border border-border bg-card px-3 py-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Home className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />{a.typeLabel} · {a.key}
          <span className="ml-1 font-mono text-[11px] font-normal text-muted-foreground">{a.assetId}</span>
        </p>
        {view && <Badge tone={view.tone}>{view.label}</Badge>}
      </div>
      <p className="mt-1.5 text-muted-foreground">
        Chủ sở hữu: <span className="font-medium text-foreground">{a.owners.length === 0 ? 'chưa xác định' : a.owners.map((o) => `${o.name}${o.current ? '' : ' (trước đây)'}`).join(', ')}</span>
      </p>
      {d.valuation.length > 0 && <div className="mt-2 border-t border-border pt-2"><Section title="Giá trị" rows={d.valuation} /></div>}
      {d.physical.length > 0 && <div className="mt-2 border-t border-border pt-2"><Section title="Đặc điểm" rows={d.physical} /></div>}
      {view?.reason && <p className="mt-2 text-muted-foreground">{view.reason}</p>}
      {view && view.conflicts.length > 0 && <ul className="mt-1 list-disc pl-4 text-muted-foreground">{view.conflicts.map((c) => <li key={c}>{c}</li>)}</ul>}
      <ClaimNotes notes={notes} />
      {d.changes.length > 0 && (
        <div className="mt-2">
          <Disclosure summary={<span>Biến động đăng ký <span className="font-normal text-muted-foreground">({d.changes.length})</span></span>}>
            <Rows rows={d.changes} />
          </Disclosure>
        </div>
      )}
      {chips.length > 0 && <div className="mt-2 border-t border-border pt-2"><SourceChips sources={chips.map((x) => x.text)} titles={Object.fromEntries(chips.map((x) => [x.text, x.files]))} /></div>}
    </li>
  );
}

/**
 * Customer 360 cho quyết định (D-113): Tóm tắt → Cần chú ý → Chi tiết. Dựng từ `customer_360` + `dossier_graph` cho định danh và quan hệ,
 * và từ `documents.evidences[].data` cho chi tiết (khoản vay, thu nhập, CIC, định giá, diện tích…): `customer_360` của S3 chỉ giữ phần định danh.
 * Chỉ cần S3 (không cần checklist / đối chiếu chéo).
 */
export function Customer360Panel({ result, evidences = [] }: { result: AppraisalResult; evidences?: DossierEvidence[] }) {
  const map = result.customer_360;
  const summary = useMemo(
    () => (map ? buildCustomer360(map, result.dossier_graph ?? null, docTypeLabelOf, evidences) : null),
    [map, result.dossier_graph, evidences],
  );
  // Claim đáng chú ý (kết quả cũ không có ⇒ null ⇒ không hiện khối đối chiếu).
  const claims = useMemo(() => buildClaimsSummary(result.claims ?? null, map ?? null, docTypeLabelOf), [result.claims, map]);
  const decision = useMemo(() => buildDecision360(result, summary, claims, docTypeLabelOf), [result, summary, claims]);
  if (!map || !summary || summary.people.length === 0) {
    return (
      <Card labelledBy="la2-people-title">
        <CardHeader id="la2-people-title" icon={Users} title="Người & tài sản trong hồ sơ" subtitle="Chưa xác định được người vay (thiếu giấy đề nghị vay vốn đọc được)." />
      </Card>
    );
  }
  const { counts, loan } = summary;
  const attentionCount = decision.attention.filter((item) => item.severity !== 'info').length;
  return (
    <Card labelledBy="la2-people-title">
      <CardHeader
        id="la2-people-title"
        icon={Users}
        title="Người & tài sản trong hồ sơ"
        subtitle={[counts.orgs > 0 ? `${counts.orgs} doanh nghiệp` : null, `${counts.people} người`, `${counts.assets} tài sản`, `${counts.relations} quan hệ`].filter(Boolean).join(' · ')}
        actions={attentionCount > 0 ? <Badge tone="warning" icon={AlertTriangle}>{attentionCount} điểm cần chú ý</Badge> : undefined}
      />
      <CardBody className="space-y-5">
        <Decision360Card decision={decision} />
        {loan && !decision.loan && (
          <section aria-label="Khoản vay">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Banknote className="h-3.5 w-3.5" aria-hidden />Khoản vay (theo giấy đề nghị vay)</h4>
            <div className="rounded-lg border border-border bg-card px-3 py-3 text-xs">
              <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
                <Rows rows={loan.rows} />
                <div className="space-y-3">
                  {loan.purposes.length > 0 && (
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mục đích vay</p>
                      <ul className="list-disc space-y-0.5 pl-4 text-foreground">{loan.purposes.map((x) => <li key={x}>{x}</li>)}</ul>
                    </div>
                  )}
                  <Section title="Thu nhập khai" rows={loan.incomeDetails} />
                </div>
              </div>
            </div>
          </section>
        )}

        {decision.loan && loan && (loan.rows.length > 0 || loan.purposes.length > 0 || loan.incomeDetails.length > 0) && (
          <Disclosure summary="Chi tiết đơn vay">
            <div className="space-y-3 text-xs">
              <Rows rows={loan.rows} />
              {loan.purposes.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mục đích vay</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-foreground">{loan.purposes.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              )}
              <Section title="Thu nhập khai" rows={loan.incomeDetails} />
            </div>
          </Disclosure>
        )}

        {claims && <ClaimsPanel summary={claims} />}

        {summary.assets.length > 0 && (
          <section aria-label="Tài sản bảo đảm">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Home className="h-3.5 w-3.5" aria-hidden />Tài sản ({summary.assets.length})</h4>
            <ul className="grid gap-2 lg:grid-cols-2">{summary.assets.map((a) => <AssetItem key={a.assetId} a={a} result={result} evidences={evidences} notes={claims?.bySubject.get(a.assetId)} />)}</ul>
          </section>
        )}

        <section aria-label="Người trong hồ sơ">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Users className="h-3.5 w-3.5" aria-hidden />Người ({summary.people.length})</h4>
          <ul className="grid gap-2 lg:grid-cols-2">{summary.people.map((p) => <PersonItem key={p.personId} p={p} notes={claims?.bySubject.get(p.personId)} />)}</ul>
        </section>

        {(summary.unmapped > 0 || summary.superseded > 0) && (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            {summary.unmapped > 0 && <>Có {summary.unmapped} người trên chứng từ chưa gắn được vào hồ sơ. </>}
            {summary.superseded > 0 && <>Có {summary.superseded} chứng từ đã bị bản mới hơn thay thế.</>}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
