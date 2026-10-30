'use client';

// Hiệu chỉnh của người thẩm định và tính lại (case_corrections.md COR-R16; T-COR-06). Danh sách chỉ nằm trong state của trang
// (không localStorage — chứa PII); "Tính lại" gửi đúng một case_input.json qua cùng đường submit. Server kiểm lại mọi thứ (COR-R14).
import { useMemo, useReducer, useState } from 'react';
import { Download, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import type { AppraisalResult } from '@/app/loan-appraisal/types';
import {
  assetOccurrences, buildCaseInput, caseInputJson, correctionsReducer, DEFAULT_RETENTION_DAYS, evidenceLeaves, KIND_LABELS,
  newCorrectionId, personOccurrences, SKIP_LABELS, unmappedParties, type Correction,
} from '@/app/loan-appraisal-v2/lib/corrections';
import { docTypeLabelOf } from '@/app/loan-appraisal-v2/lib/classification-view';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { FOCUS_RING } from '../ui/toneClasses';

const INPUT = `w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground disabled:opacity-60 ${FOCUS_RING}`;
const H = 'mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

/** Omit phân phối trên union (Omit thường gộp union về phần chung). */
type Body<T> = T extends unknown ? Omit<T, 'correction_id' | 'reason' | 'corrected_by' | 'corrected_at'> : never;
type Draft = { label: string; correction: Body<Correction> };

function describe(c: Correction, labelOf: (id: string) => string): string {
  if (c.kind === 'OCR_FIX') return `${labelOf(c.record_id.split('#')[0])} · ${c.record_id.split('#')[1]}: ${String(c.original_value)} → ${String(c.value)}`;
  if (c.kind === 'FACT_RESOLUTION') return `Chọn giá trị tại ${labelOf(c.chosen_record_id.split('#')[0])}`;
  return `${c.subject_kind === 'person' ? 'Người' : 'Tài sản'}: ${labelOf(c.a.evidence_id)} #${c.a.index} ${c.kind === 'SAME_SUBJECT' ? '=' : '≠'} ${labelOf(c.b.evidence_id)} #${c.b.index}`;
}

export function CorrectionsPanel({ result, onRecompute, busy = false }: {
  result: AppraisalResult;
  /** Gửi case_input.json (một file) như một lần chạy mới. */
  onRecompute?: (file: File) => void;
  busy?: boolean;
}) {
  const [corrections, dispatch] = useReducer(correctionsReducer, []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reason, setReason] = useState('');
  const [author, setAuthor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [ocr, setOcr] = useState<{ evidence: string; record: string; value: string }>({ evidence: '', record: '', value: '' });

  const evidences = useMemo(() => (result.documents?.evidences ?? []).filter((e) => e.status === 'SUCCESS' && e.data), [result.documents]);
  const evLabel = useMemo(() => {
    const m = new Map(evidences.map((e) => [e.evidence_id, `${docTypeLabelOf(e.doc_type_key)} (${e.file_name})`]));
    return (id: string) => m.get(id) ?? id;
  }, [evidences]);
  const persons = useMemo(() => personOccurrences(result), [result]);
  const unmapped = useMemo(() => unmappedParties(result), [result]);
  const assets = useMemo(() => assetOccurrences(result), [result]);
  const conflicts = result.profile_360?.conflicts ?? [];
  const leaves = useMemo(() => {
    const e = evidences.find((x) => x.evidence_id === ocr.evidence);
    return e ? evidenceLeaves(e as { evidence_id: string; data: Record<string, unknown> | null }) : [];
  }, [evidences, ocr.evidence]);
  const sealed = Boolean(result.case_seal);
  const report = result.correction_report;

  const confirm = () => {
    if (!draft) return;
    if (!reason.trim() || !author.trim()) { setError('Nhập lý do và người sửa trước khi thêm'); return; }
    dispatch({ type: 'add', correction: { ...draft.correction, correction_id: newCorrectionId(), reason: reason.trim(), corrected_by: author.trim(), corrected_at: new Date().toISOString() } as Correction });
    setDraft(null); setReason(''); setError(null);
  };
  const caseFile = () => {
    const input = buildCaseInput(result, corrections);
    return input ? new File([caseInputJson(input)], 'case_input.json', { type: 'application/json' }) : null;
  };
  const download = () => {
    const f = caseFile();
    if (!f) return;
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url; a.download = f.name; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card labelledBy="la2-cor-title">
      <CardHeader id="la2-cor-title" icon={Pencil} title="Hiệu chỉnh và tính lại"
        subtitle="Sửa lỗi đọc, chọn giá trị đúng khi chứng từ ghi khác nhau, gộp hoặc tách người / tài sản; tính lại không cần OCR lại." />
      <CardBody className="space-y-6">
        {!sealed && <p className="text-xs text-[rgb(var(--la2-warning))]">Kết quả này không có niêm phong (kết quả cũ) nên chưa tính lại được. Chạy lại hồ sơ để dùng hiệu chỉnh.</p>}

        {report && (
          <section aria-label="Kết quả áp hiệu chỉnh">
            <h4 className={H}>Lần tính lại này</h4>
            <p className="text-xs">Đã áp {report.applied.length} hiệu chỉnh{report.skipped.length ? `, bỏ qua ${report.skipped.length}` : ''}.</p>
            {report.skipped.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-[rgb(var(--la2-warning))]">
                {report.skipped.map((s) => <li key={s.correction_id}>{KIND_LABELS[s.kind]} ({s.correction_id}): {SKIP_LABELS[s.code]}</li>)}
              </ul>
            )}
          </section>
        )}

        {conflicts.length > 0 && (
          <section aria-label="Mâu thuẫn giữa chứng từ">
            <h4 className={H}>Mâu thuẫn — chọn giá trị đúng</h4>
            <ul className="space-y-2">
              {conflicts.map((c) => {
                const picked = choice[c.conflict_id] ?? '';
                const all = c.options.flatMap((o) => o.record_ids);
                return (
                  <li key={c.conflict_id} className="rounded-lg border border-border px-3 py-2 text-xs">
                    <p className="font-medium">{c.subject_label} · {c.field_label}</p>
                    {c.options.map((o) => (
                      <label key={o.fact_id} className="mt-1 flex items-center gap-2">
                        <input type="radio" name={c.conflict_id} checked={picked === o.fact_id} onChange={() => setChoice({ ...choice, [c.conflict_id]: o.fact_id })} />
                        <code>{String(o.value)}</code><span className="text-muted-foreground">{o.doc_types.map(docTypeLabelOf).join(', ')}</span>
                      </label>
                    ))}
                    <Button size="sm" className="mt-2" disabled={!picked || !sealed} onClick={() => {
                      const o = c.options.find((x) => x.fact_id === picked)!;
                      setDraft({ label: `${c.field_label}: chọn ${String(o.value)}`, correction: { kind: 'FACT_RESOLUTION', record_ids: all, chosen_record_id: o.record_ids[0] } });
                    }}>Chọn giá trị đúng</Button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section aria-label="Người">
          <h4 className={H}>Người — gộp hoặc tách</h4>
          <ul className="space-y-1 text-xs">
            {persons.flatMap((p) => p.others.map((o) => (
              <li key={`${p.person_id}-${o.evidence_id}-${o.index}`} className="flex flex-wrap items-center gap-2">
                <span className="flex-1"><strong>{p.label}</strong> trên {evLabel(o.evidence_id)} <span className="text-muted-foreground">(ghép theo {o.matched_by === 'ID_NUMBER' ? 'số định danh' : o.matched_by === 'HUMAN_LINK' ? 'người thẩm định' : 'tên'})</span></span>
                <Button size="sm" variant="ghost" disabled={!p.anchor || !sealed} onClick={() => setDraft({ label: `Không phải ${p.label}: ${evLabel(o.evidence_id)}`, correction: { kind: 'DIFFERENT_SUBJECT', subject_kind: 'person', a: { evidence_id: p.anchor!.evidence_id, index: p.anchor!.index }, b: { evidence_id: o.evidence_id, index: o.index } } })}>Không phải người này</Button>
              </li>
            )))}
            {unmapped.map((u) => (
              <li key={`u-${u.evidence_id}-${u.index}`} className="flex flex-wrap items-center gap-2">
                <span className="flex-1">{u.name ?? '(không tên)'} trên {evLabel(u.evidence_id)} <Badge tone="warning">chưa gắn được</Badge></span>
                <select className={`${INPUT} w-auto`} value={choice[`u-${u.evidence_id}-${u.index}`] ?? ''} onChange={(e) => setChoice({ ...choice, [`u-${u.evidence_id}-${u.index}`]: e.target.value })}>
                  <option value="">Là người…</option>
                  {persons.filter((p) => p.anchor).map((p) => <option key={p.person_id} value={p.person_id}>{p.label}</option>)}
                </select>
                <Button size="sm" variant="ghost" disabled={!choice[`u-${u.evidence_id}-${u.index}`] || !sealed} onClick={() => {
                  const p = persons.find((x) => x.person_id === choice[`u-${u.evidence_id}-${u.index}`])!;
                  setDraft({ label: `${u.name ?? 'Người'} trên ${evLabel(u.evidence_id)} là ${p.label}`, correction: { kind: 'SAME_SUBJECT', subject_kind: 'person', a: { evidence_id: p.anchor!.evidence_id, index: p.anchor!.index }, b: { evidence_id: u.evidence_id, index: u.index } } });
                }}>Là một</Button>
              </li>
            ))}
            {persons.every((p) => p.others.length === 0) && unmapped.length === 0 && <li className="text-muted-foreground">Không có người nào được ghép từ chứng từ khác.</li>}
          </ul>
        </section>

        <section aria-label="Tài sản">
          <h4 className={H}>Tài sản — gộp hoặc tách</h4>
          <ul className="space-y-1 text-xs">
            {assets.flatMap((a) => a.sources.slice(1).map((s) => (
              <li key={`${a.asset_id}-${s.evidence_id}-${s.index}`} className="flex flex-wrap items-center gap-2">
                <span className="flex-1"><strong>{a.label}</strong> trên {evLabel(s.evidence_id)}</span>
                <Button size="sm" variant="ghost" disabled={!sealed} onClick={() => setDraft({ label: `${evLabel(s.evidence_id)} không phải ${a.label}`, correction: { kind: 'DIFFERENT_SUBJECT', subject_kind: 'asset', a: { evidence_id: a.sources[0].evidence_id, index: a.sources[0].index }, b: { evidence_id: s.evidence_id, index: s.index } } })}>Không phải cùng tài sản</Button>
              </li>
            )))}
            {assets.length > 1 && (
              <li className="flex flex-wrap items-center gap-2">
                <select className={`${INPUT} w-auto`} value={choice.assetA ?? ''} onChange={(e) => setChoice({ ...choice, assetA: e.target.value })}>
                  <option value="">Tài sản…</option>{assets.map((a) => <option key={a.asset_id} value={a.asset_id}>{a.label}</option>)}
                </select>
                <span>là cùng</span>
                <select className={`${INPUT} w-auto`} value={choice.assetB ?? ''} onChange={(e) => setChoice({ ...choice, assetB: e.target.value })}>
                  <option value="">Tài sản…</option>{assets.filter((a) => a.asset_id !== choice.assetA).map((a) => <option key={a.asset_id} value={a.asset_id}>{a.label}</option>)}
                </select>
                <Button size="sm" variant="ghost" disabled={!choice.assetA || !choice.assetB || !sealed} onClick={() => {
                  const a = assets.find((x) => x.asset_id === choice.assetA)!; const b = assets.find((x) => x.asset_id === choice.assetB)!;
                  setDraft({ label: `${a.label} là cùng ${b.label}`, correction: { kind: 'SAME_SUBJECT', subject_kind: 'asset', a: { evidence_id: a.sources[0].evidence_id, index: a.sources[0].index }, b: { evidence_id: b.sources[0].evidence_id, index: b.sources[0].index } } });
                }}>Là một</Button>
              </li>
            )}
            {assets.length === 0 && <li className="text-muted-foreground">Chưa có tài sản.</li>}
          </ul>
        </section>

        <section aria-label="Máy đọc sai">
          <h4 className={H}>Máy đọc sai — sửa theo bản scan</h4>
          <div className="grid gap-2 md:grid-cols-3">
            <select className={INPUT} value={ocr.evidence} onChange={(e) => setOcr({ evidence: e.target.value, record: '', value: '' })}>
              <option value="">Chứng từ…</option>{evidences.map((e) => <option key={e.evidence_id} value={e.evidence_id}>{evLabel(e.evidence_id)}</option>)}
            </select>
            <select className={INPUT} value={ocr.record} disabled={!ocr.evidence} onChange={(e) => setOcr({ ...ocr, record: e.target.value, value: String(leaves.find((l) => l.record_id === e.target.value)?.value ?? '') })}>
              <option value="">Trường…</option>{leaves.map((l) => <option key={l.record_id} value={l.record_id}>{l.path} = {String(l.value).slice(0, 40)}</option>)}
            </select>
            <input className={INPUT} value={ocr.value} disabled={!ocr.record} placeholder="Giá trị đúng trên chứng từ" onChange={(e) => setOcr({ ...ocr, value: e.target.value })} />
          </div>
          <Button size="sm" className="mt-2" disabled={!ocr.record || !sealed} onClick={() => {
            const leaf = leaves.find((l) => l.record_id === ocr.record)!;
            const value = typeof leaf.value === 'number' && ocr.value.trim() !== '' && Number.isFinite(Number(ocr.value)) ? Number(ocr.value) : typeof leaf.value === 'boolean' ? ocr.value === 'true' : ocr.value;
            setDraft({ label: `${leaf.path}: ${String(leaf.value)} → ${String(value)}`, correction: { kind: 'OCR_FIX', record_id: leaf.record_id, original_value: leaf.value, value } });
          }}>Máy đọc sai</Button>
        </section>

        <section aria-label="Hiệu chỉnh chưa tính" className="rounded-lg border border-border bg-muted/30 p-3">
          {draft && (
            <div className="mb-3 space-y-2 rounded-lg border border-border bg-card p-2 text-xs">
              <p><strong>{KIND_LABELS[draft.correction.kind]}:</strong> {draft.label}</p>
              <input className={INPUT} placeholder="Lý do (bắt buộc), VD: đã đối chiếu bản gốc GCN" value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }} maxLength={500} />
              <input className={INPUT} placeholder="Người sửa (bắt buộc)" value={author} onChange={(e) => { setAuthor(e.target.value); setError(null); }} maxLength={64} />
              {error && <p className="text-[rgb(var(--la2-danger))]">{error}</p>}
              <div className="flex gap-2"><Button size="sm" variant="primary" onClick={confirm}>Thêm hiệu chỉnh</Button><Button size="sm" variant="ghost" onClick={() => { setDraft(null); setError(null); }}>Bỏ</Button></div>
            </div>
          )}
          <p className="text-xs font-semibold">{corrections.length} hiệu chỉnh chưa tính <span className="font-normal text-muted-foreground">· giữ trong trang, mất khi tải lại; nội dung hồ sơ lưu {DEFAULT_RETENTION_DAYS} ngày, sau đó chỉ tính lại được từ file đã tải</span></p>
          {corrections.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {corrections.map((c) => (
                <li key={c.correction_id} className="flex items-center gap-2">
                  <Badge tone="info">{KIND_LABELS[c.kind]}</Badge><span className="flex-1">{describe(c, evLabel)} — <span className="text-muted-foreground">{c.reason}</span></span>
                  <Button size="sm" variant="ghost" aria-label="Xóa hiệu chỉnh" onClick={() => dispatch({ type: 'remove', correction_id: c.correction_id })}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={!sealed} onClick={download}><Download className="h-3.5 w-3.5" aria-hidden />Tải case_input.json</Button>
            <Button size="sm" variant="primary" disabled={!sealed || corrections.length === 0 || busy || !onRecompute} onClick={() => { const f = caseFile(); if (f && onRecompute) onRecompute(f); }}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Tính lại</Button>
          </div>
        </section>
      </CardBody>
    </Card>
  );
}
