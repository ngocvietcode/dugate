'use client';

import { Fingerprint, Landmark, UserRound } from 'lucide-react';
import type { AppraisalResult } from '@/app/loan-appraisal/types';
import { evidenceWhere, masterEntityRows, masterGroups, type EvidenceRef, type MasterFieldRow } from '@/app/loan-appraisal-v2/lib/master-view';
import type { MasterDossier } from '@/lib/loan-dossier/contracts/master-dossier';
import { safeArray } from '@/app/loan-appraisal-v2/lib/selectors';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Disclosure } from '../ui/Disclosure';

/** Master data theo checklist (MD-R14). Không có `master_dossier` (không dựng được, MD-AC12) thì không hiện gì; lý do nằm ở `config_snapshot.warnings`. */
export function MasterDataPanel({ result }: { result: AppraisalResult | null }) {
  if (!result?.master_dossier) return null;
  return <MasterDossierPanel master={result.master_dossier} evidences={safeArray(result.documents?.evidences)} />;
}

function MasterRows({ rows }: { rows: MasterFieldRow[] }) {
  if (rows.length === 0) return <p className="text-xs italic text-muted-foreground">Không có trường nào.</p>;
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.key} className="rounded-md border border-border px-2 py-1 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{r.label}</span>
            <Badge tone={r.tone}>{r.status_label}</Badge>
          </div>
          <p className="break-words">{r.value}</p>
          {r.note && <p className="text-[11px] text-muted-foreground">{r.note}</p>}
          {r.details.length > 0 && (
            <ul className="mt-0.5 list-disc pl-4 text-[11px] text-muted-foreground">
              {r.details.map((d) => <li key={d}>{d}</li>)}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function MasterDossierPanel({ master, evidences }: { master: MasterDossier; evidences: EvidenceRef[] }) {
  const where = evidenceWhere(evidences);
  const groups = masterGroups(master, where);
  const s = master.summary;
  return (
    <Card labelledBy="la2-master-title">
      <CardHeader
        id="la2-master-title"
        icon={Fingerprint}
        title="Master data theo checklist"
        subtitle={`${s.documents_present}/${s.documents_total} mục có chứng từ · ${s.fields_total} trường`}
        actions={(
          <>
            <Badge tone="success">{s.agreed} thống nhất</Badge>
            {s.ocr_normalized > 0 && <Badge tone="info">{s.ocr_normalized} đã chuẩn hóa</Badge>}
            {s.corrected > 0 && <Badge tone="warning">{s.corrected} đã hiệu chỉnh</Badge>}
            {s.conflict > 0 && <Badge tone="warning">{s.conflict} chưa thống nhất</Badge>}
          </>
        )}
      />
      <CardBody className="space-y-4">
        {[...master.persons, ...master.assets].length > 0 && (
          <section aria-label="Người và tài sản">
            <h4 className="mb-2 text-xs font-semibold text-muted-foreground">Người và tài sản (hợp nhất giữa các chứng từ)</h4>
            <div className="space-y-2">
              {[...master.persons, ...master.assets].map((e) => (
                <Disclosure key={e.entity_id} defaultOpen lazy={false} summary={(
                  <span className="flex items-start gap-2">
                    {e.entity_id.startsWith('person') ? <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /> : <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />}
                    <span>{e.label} · {e.fields.length} trường</span>
                  </span>
                )}>
                  <MasterRows rows={masterEntityRows(e, where)} />
                </Disclosure>
              ))}
            </div>
          </section>
        )}
        {groups.map((g) => (
          <section key={g.key} aria-label={g.label}>
            <h4 className="mb-2 text-xs font-semibold text-muted-foreground">{g.label}</h4>
            <div className="space-y-2">
              {g.documents.map((d) => (
                <Disclosure key={d.id} defaultOpen lazy={false} summary={(
                  <span className="flex flex-wrap items-center gap-2">
                    <span>{d.title}{d.scope ? ` · ${d.scope}` : ''}</span>
                    <Badge tone={d.tone}>{d.status_label}</Badge>
                    {d.corrected > 0 && <Badge tone="warning">{d.corrected} đã hiệu chỉnh</Badge>}
                    {d.conflicts > 0 && <Badge tone="warning">{d.conflicts} chưa thống nhất</Badge>}
                  </span>
                )}>
                  {d.copies && <p className="mb-1 text-[11px] text-muted-foreground">{d.copies}</p>}
                  {d.rows.length > 0 ? <MasterRows rows={d.rows} /> : <p className="text-xs italic text-muted-foreground">{d.status_label}.</p>}
                </Disclosure>
              ))}
            </div>
          </section>
        ))}
        <p className="text-xs text-muted-foreground">Giá trị đã gom các bản của cùng chứng từ. &ldquo;Chưa thống nhất&rdquo; là các bản ghi khác nhau thật chưa đủ căn cứ để chọn; rule liên quan ra cần rà soát. &ldquo;Đã hiệu chỉnh&rdquo; là giá trị được chọn trong các giá trị đã đọc theo đa số nguồn, luôn cần xác nhận; giá trị bị loại hiện ở dòng &ldquo;Bản lệch&rdquo;.</p>
      </CardBody>
    </Card>
  );
}
