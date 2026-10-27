// Hiển thị master_dossier theo checklist (T-MD-05; MD-R14). Hàm thuần — component chỉ render.
import type { MasterDocument, MasterDossier, MasterEntity, MasterField } from '@/lib/loan-dossier/contracts/master-dossier';

import { CHECKLIST_GROUP_LABELS, CHECKLIST_STATUS_LABELS, checklistStatusTone, formatVnd, labelOf, type ToneName } from './dossier-view';

export const MASTER_STATUS_LABELS: Record<string, string> = {
  AGREED: 'Thống nhất', OCR_NORMALIZED: 'Đã chuẩn hóa (nghi lỗi đọc)', SINGLE_SOURCE: 'Một nguồn', CONFLICT: 'Chưa thống nhất', MISSING: 'Thiếu',
  CORRECTED: 'Đã hiệu chỉnh (cần xác nhận)',
};

export function masterStatusTone(status: string, review: string): ToneName {
  if (status === 'CONFLICT') return 'warning';
  if (status === 'MISSING') return 'neutral';
  if (status === 'OCR_NORMALIZED') return 'info';
  if (status === 'CORRECTED') return 'warning';
  return review === 'ACCEPTED' ? 'success' : 'warning';
}

/** Lá nguồn → "Mẫu biểu (file · tr.a-b)". */
export interface EvidenceRef { evidence_id: string; file_name: string; doc_type_label: string; page_range?: [number, number] }
export function evidenceWhere(evidences: ReadonlyArray<EvidenceRef>): (rid: string) => string {
  const byId = new Map(evidences.map((e) => [e.evidence_id, e]));
  return (rid) => {
    const e = byId.get(rid.split('#')[0]);
    if (!e) return rid.split('#')[0];
    const pr = e.page_range;
    return `${e.doc_type_label} (${e.file_name}${pr ? ` · tr.${pr[0]}${pr[1] !== pr[0] ? `-${pr[1]}` : ''}` : ''})`;
  };
}

function valueText(v: unknown, kind: string): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.map((x) => valueText(x, kind)).join(', ');
  if (typeof v === 'object') return String((v as { full_text?: unknown }).full_text ?? JSON.stringify(v));
  if (typeof v === 'number' && kind === 'money') return formatVnd(v);
  if (typeof v === 'boolean') return v ? 'Có' : 'Không';
  return String(v);
}

export interface MasterFieldRow {
  key: string;
  label: string;
  value: string;
  status: string;
  status_label: string;
  tone: ToneName;
  note: string | null;
  /** Ứng viên (CONFLICT / chỉ một phía tin cậy) hoặc bản lệch (OCR_NORMALIZED), mỗi dòng có nơi ghi. */
  details: string[];
}

export function masterFieldRows(fields: ReadonlyArray<MasterField>, where: (rid: string) => string): MasterFieldRow[] {
  return fields.map((f) => ({
    key: f.path,
    label: labelOf(f.path),
    value: f.status === 'CONFLICT' ? 'Chưa thống nhất' : valueText(f.value, f.kind),
    status: f.status,
    status_label: MASTER_STATUS_LABELS[f.status] ?? f.status,
    tone: masterStatusTone(f.status, f.review_status),
    note: f.note,
    details: [
      ...f.outliers.map((o) => `Bản lệch: ${valueText(o.raw_value, f.kind)} — ${where(o.evidence_id)}`),
      // D-69: trường đã hiệu chỉnh hiện giá trị bị loại kèm nơi ghi để CO đối chiếu (MD-R19 e).
      ...(f.correction?.minority ?? []).map((m) => `Bản lệch: ${valueText(m.raw_value, f.kind)} — ${where(m.evidence_id)}`),
      ...f.candidates.map((c) => `${valueText(c.value, f.kind)} — ${[...new Set(c.evidence_ids.map(where))].join('; ')}`),
    ],
  }));
}

export interface MasterDocumentView {
  id: string;
  title: string;
  scope: string | null;
  status_label: string;
  tone: ToneName;
  copies: string;
  rows: MasterFieldRow[];
  conflicts: number;
  corrected: number;
}

export function masterDocumentView(d: MasterDocument, where: (rid: string) => string, scopeName: (d: MasterDocument) => string | null): MasterDocumentView {
  const used = d.copies.filter((c) => c.role === 'PRIMARY' || c.role === 'DUPLICATE');
  const rows = masterFieldRows(d.fields.filter((f) => f.status !== 'MISSING'), where);
  return {
    id: d.document_id,
    title: d.item_label ?? d.doc_type_label ?? 'Chứng từ khác',
    scope: scopeName(d),
    status_label: used.length === 0 ? (d.checklist_status === 'NOT_APPLICABLE' ? 'Không áp dụng' : 'Chưa có chứng từ') : (d.checklist_status ? CHECKLIST_STATUS_LABELS[d.checklist_status] ?? d.checklist_status : 'Đã có'),
    tone: used.length === 0 ? (d.required ? 'warning' : 'neutral') : d.checklist_status ? checklistStatusTone(d.checklist_status) : 'success',
    copies: used.length === 0 ? '' : `${used.length} bản: ${[...new Set(used.map((c) => c.file_name))].join(', ')}`,
    rows,
    conflicts: rows.filter((r) => r.status === 'CONFLICT').length,
    corrected: rows.filter((r) => r.status === 'CORRECTED').length,
  };
}

/** Nhóm checklist (I…V) → mục; chứng từ ngoài checklist ở nhóm cuối. */
export function masterGroups(master: MasterDossier, where: (rid: string) => string): Array<{ key: string; label: string; documents: MasterDocumentView[] }> {
  const names = new Map<string, string>([...master.persons, ...master.assets].map((e) => [e.entity_id, e.label]));
  const scopeName = (d: MasterDocument) => (d.person_id ? names.get(d.person_id) ?? d.person_id : d.asset_id ? names.get(d.asset_id) ?? d.asset_id : null);
  const out = new Map<string, { key: string; label: string; documents: MasterDocumentView[] }>();
  for (const d of master.documents) {
    // D-65: mục "Không áp dụng" mà không có chứng từ nào thì không hiển thị.
    if (d.checklist_status === 'NOT_APPLICABLE' && !d.copies.some((c) => c.role === 'PRIMARY' || c.role === 'DUPLICATE')) continue;
    const key = d.checklist_group ?? 'other';
    const g = out.get(key) ?? { key, label: CHECKLIST_GROUP_LABELS[key] ?? key, documents: [] };
    g.documents.push(masterDocumentView(d, where, scopeName));
    out.set(key, g);
  }
  if (master.other_documents.length) {
    out.set('__other', { key: '__other', label: 'Chứng từ ngoài checklist', documents: master.other_documents.map((d) => masterDocumentView(d, where, scopeName)) });
  }
  return [...out.values()];
}

export function masterEntityRows(e: MasterEntity, where: (rid: string) => string): MasterFieldRow[] {
  return masterFieldRows(e.fields, where).map((r, i) => ({ ...r, label: e.fields[i].label === e.fields[i].path ? labelOf(e.fields[i].path) : e.fields[i].label }));
}
