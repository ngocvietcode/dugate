// EvidenceRegistry và Customer 360 kiểu v2 dựng từ output spec-v3 (T-V2-04; V2-R04). Provenance cũ đã gỡ (D-66).
import type { CheckChecklistData, MapDossierData } from '@/lib/loan-dossier/contracts/check-stages';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import type { Customer360 } from '../prompts/loan-appraisal-prompts';
import type { EvidenceRecord, EvidenceRegistry, StoredEvidenceRegistry } from './types';

export const ACCEPT_CONFIDENCE = 0.8;

function leaves(value: unknown, path: string, out: Array<{ path: string; value: unknown }>): void {
  if (Array.isArray(value)) value.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) leaves(v, path ? `${path}.${k}` : k, out);
  else if (value !== null && value !== undefined && path) out.push({ path, value });
}

const topField = (path: string) => path.split(/[.[]/)[0];
const scalar = (v: unknown): string | number | boolean | null => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null);

/**
 * V2-R04: mỗi lá của `data` là 1 EvidenceRecord, `evidence_id = "{envelope}#{field_path}"`. ACCEPTED khi confidence
 * field cấp 1 ≥ 0.80. Evidence ERROR và bản bị thay thế (S3-R27) không vào registry. Bản ghi trạng thái checklist từ S4.
 */
export function buildEvidenceRegistryV3(
  envelopes: ReadonlyArray<EvidenceEnvelope>,
  superseded: ReadonlySet<string>,
  checklist: CheckChecklistData | null,
): EvidenceRegistry {
  const records: EvidenceRecord[] = [];
  for (const e of envelopes) {
    if (e.status !== 'SUCCESS' || !e.data || superseded.has(e.evidence_id)) continue;
    const ls: Array<{ path: string; value: unknown }> = [];
    leaves(e.data, '', ls);
    for (const l of ls) {
      const conf = e.field_confidences[topField(l.path)] ?? null;
      records.push({
        evidence_id: `${e.evidence_id}#${l.path}`,
        field_path: l.path,
        value: l.value,
        normalized_value: scalar(l.value),
        file_name: e.file_name,
        doc_type_key: e.doc_type_key,
        doc_type_label: e.doc_type_label,
        extraction_confidence: conf,
        extraction_method: 'AI_EXTRACT',
        evidence_kind: 'EXTRACTED_FIELD',
        review_status: conf !== null && conf >= ACCEPT_CONFIDENCE ? 'ACCEPTED' : 'REVIEW',
      });
    }
  }
  for (const it of checklist?.items ?? []) {
    const scope = it.person_id ?? it.asset_id ?? 'dossier';
    records.push({
      evidence_id: `chk:${it.item_key}:${scope}`,
      field_path: 'status',
      value: it.status,
      normalized_value: it.status,
      file_name: it.found_in[0]?.file_name ?? '',
      doc_type_key: it.doc_type_key ?? it.item_key,
      doc_type_label: it.item_label,
      extraction_method: 'AI_EXTRACT',
      evidence_kind: 'CHECKLIST_STATUS',
      source_evidence_ids: it.found_in.map((f) => f.evidence_id),
      review_status: it.status === 'PRESENT' || it.status === 'SUBSTITUTED' || it.status === 'NOT_APPLICABLE' ? 'ACCEPTED' : 'REVIEW',
    });
  }
  const byFile = new Map<string, { doc_types: Set<string>; ids: string[] }>();
  const byType = new Map<string, { files: Set<string>; ids: string[] }>();
  for (const r of records) {
    if (r.evidence_kind === 'CHECKLIST_STATUS') continue;
    const f = byFile.get(r.file_name) ?? { doc_types: new Set(), ids: [] };
    f.doc_types.add(r.doc_type_key); f.ids.push(r.evidence_id); byFile.set(r.file_name, f);
    const t = byType.get(r.doc_type_key) ?? { files: new Set(), ids: [] };
    t.files.add(r.file_name); t.ids.push(r.evidence_id); byType.set(r.doc_type_key, t);
  }
  return {
    records,
    by_file: [...byFile].map(([file_name, v]) => ({ file_name, doc_types: [...v.doc_types], evidence_ids: v.ids })),
    by_document_type: [...byType].map(([doc_type_key, v]) => ({ doc_type_key, file_names: [...v.files], evidence_ids: v.ids })),
  };
}

/**
 * Evidence để LƯU vào kết quả: bỏ bản ghi trạng thái checklist (sao của `checklist.items`, không rule hay giao diện nào tham chiếu) và
 * các chỉ mục ngược. Registry đầy đủ vẫn dùng trong bộ nhớ cho strategy và rule LLM.
 */
export function toStoredEvidence(evidence: EvidenceRegistry): StoredEvidenceRegistry {
  return { records: evidence.records.filter((r) => r.evidence_kind !== 'CHECKLIST_STATUS') };
}

/** Customer 360 kiểu v2 (nhóm identity/legal/collateral) dựng từ S3 — cho stage 3–7 cũ đọc (cầu nối tạm tới T-V2-08). */
export function toLegacyCustomer360(s3: MapDossierData | null): Customer360 {
  if (!s3) return {};
  const borrower = s3.customer_360.find((c) => c.roles.includes('borrower'));
  return {
    identity: borrower ? { ...borrower.identity, permanent_address: borrower.identity.permanent_address?.full_text ?? null, current_address: borrower.identity.current_address?.full_text ?? null } : {},
    legal: borrower ? { marital_status: borrower.marital_status } : {},
    income: borrower?.business ? { business: borrower.business } : {},
    collateral: { assets: s3.asset_registry.map((a) => ({ asset_id: a.asset_id, asset_type: a.asset_type, identifiers: a.identifiers, usage_contexts: a.usage_contexts })) },
    relationship: { persons: s3.customer_360.map((c) => ({ person_id: c.person_id, roles: c.roles, full_name: c.identity.full_name })) },
  };
}
