// Cầu nối `master_dossier` → stage 3–7 (T-MD-06…08; MD-R10, MD-R11, MD-R13).
//   - Rule LLM: EvidenceRegistry dựng từ master (mỗi trường hợp nhất 1 bản ghi, evidence_id = lá nguồn thật).
//   - Tài chính: đầu vào v3 (V2-R06) được thay bằng giá trị hợp nhất; trường CONFLICT → bỏ trống + cờ xung đột.
import type { MasterDocument, MasterDossier, MasterEntity, MasterField } from '@/lib/loan-dossier/contracts/master-dossier';

import type { Customer360 } from '../prompts/loan-appraisal-prompts';
import type { FinancialInputs, SourcedNumber } from './financial-inputs';
import type { EvidenceRecord, EvidenceRegistry } from './types';

const MAX_CANDIDATE_TEXT = 80;

function display(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map((x) => String(display(x))).join(', ');
  if (typeof v === 'object') return (v as { full_text?: unknown }).full_text == null ? JSON.stringify(v) : String((v as { full_text: unknown }).full_text);
  return v as string | number | boolean;
}

/** MD-R11: trường CONFLICT hiện mọi ứng viên kèm nơi ghi để model không tự chọn một giá trị. */
function conflictText(f: MasterField, whereOf: (rid: string) => string): string {
  const parts = f.candidates.map((c) => `${String(display(c.value)).slice(0, MAX_CANDIDATE_TEXT)} (${[...new Set(c.evidence_ids.map(whereOf))].join('; ')})`);
  return `CHƯA THỐNG NHẤT giữa các bản: ${parts.join(' | ')}`;
}

/**
 * Registry cho Rule LLM từ master (MD-R11). Mỗi khối = 1 chứng từ hợp nhất (`file_name` = nhãn mục + document_id để
 * hai chứng từ cùng loại không trộn vào một khối). Trường không trỏ được lá nguồn bị bỏ (không có gì để dẫn chứng).
 * Một lá dùng ở nhiều trường (chứng từ + người/tài sản) giữ trạng thái thận trọng nhất (REVIEW thắng).
 */
export function masterEvidenceRegistry(master: MasterDossier, raw: EvidenceRegistry): EvidenceRegistry {
  const rawById = new Map(raw.records.map((r) => [r.evidence_id, r]));
  const whereOf = (rid: string) => {
    const r = rawById.get(rid);
    return r ? `${r.doc_type_label} · ${r.file_name}` : rid.split('#')[0];
  };
  const records: EvidenceRecord[] = [];
  const push = (f: MasterField, file_name: string, doc_type_key: string, doc_type_label: string, scope: string) => {
    const evidence_id = f.sources[0] ?? f.candidates[0]?.evidence_ids[0];
    if (!evidence_id) return;
    const value = f.status === 'CONFLICT' ? conflictText(f, whereOf) : display(f.value);
    if (value === null) return;
    records.push({
      evidence_id, field_path: f.path, value, normalized_value: value, file_name, doc_type_key, doc_type_label,
      classification_confidence: null, extraction_confidence: f.confidence, extraction_method: 'AI_EXTRACT',
      evidence_kind: 'EXTRACTED_FIELD', source_evidence_ids: f.sources, master_scope: scope, review_status: f.review_status,
    });
  };
  const docLabel = (d: MasterDocument) => `${d.item_label ?? d.doc_type_label ?? 'Chứng từ khác'} [${d.document_id}]`;
  for (const d of [...master.documents, ...master.other_documents]) {
    for (const f of d.fields) push(f, docLabel(d), d.doc_type_key ?? 'other', d.doc_type_label ?? '', d.item_key ? `item:${d.item_key}` : 'item:other');
  }
  const entity = (e: MasterEntity, kind: 'person' | 'asset') => {
    for (const f of e.fields) push(f, `${e.label} [${e.entity_id}]`, `master_${kind}`, e.label, `master:${kind}`);
  };
  master.persons.forEach((e) => entity(e, 'person'));
  master.assets.forEach((e) => entity(e, 'asset'));

  const review = new Set(records.filter((r) => r.review_status === 'REVIEW').map((r) => r.evidence_id));
  for (const r of records) if (review.has(r.evidence_id)) r.review_status = 'REVIEW';
  const checklistRecords = raw.records.filter((r) => r.evidence_kind === 'CHECKLIST_STATUS');
  const all = [...records, ...checklistRecords];

  const byFile = new Map<string, { doc_types: Set<string>; ids: string[] }>();
  const byType = new Map<string, { files: Set<string>; ids: string[] }>();
  for (const r of all) {
    const f = byFile.get(r.file_name) ?? { doc_types: new Set(), ids: [] };
    f.doc_types.add(r.doc_type_key); f.ids.push(r.evidence_id); byFile.set(r.file_name, f);
    const t = byType.get(r.doc_type_key) ?? { files: new Set(), ids: [] };
    t.files.add(r.file_name); t.ids.push(r.evidence_id); byType.set(r.doc_type_key, t);
  }
  return {
    records: all,
    by_file: [...byFile].map(([file_name, v]) => ({ file_name, doc_types: [...v.doc_types], evidence_ids: v.ids })),
    by_document_type: [...byType].map(([doc_type_key, v]) => ({ doc_type_key, file_names: [...v.files], evidence_ids: v.ids })),
  };
}

/**
 * MD-R19 (c): Customer 360 kiểu cũ đưa cho Rule LLM lấy `identity.*` và `identifiers.*` từ trường đã hiệu chỉnh (`CORRECTED`)
 * của `persons` / `assets`. Chỉ ghi đè đúng các trường đó; `customer_360` của S3 trong kết quả không đổi (OQ-33).
 */
export function applyMasterToCustomer360(c360: Customer360, master: MasterDossier | null): Customer360 {
  if (!master) return c360;
  const corrected = (e: MasterEntity) => e.fields.filter((f) => f.status === 'CORRECTED' && f.value !== null && f.value !== undefined);
  const out: Customer360 = { ...c360 };
  const persons = ((c360.relationship?.persons as Array<{ person_id: string; roles: string[]; full_name: string | null }> | undefined) ?? []);
  const borrowerId = persons.find((p) => p.roles?.includes('borrower'))?.person_id;
  const byPerson = new Map(master.persons.map((e) => [e.entity_id, corrected(e)]));

  const fixes = borrowerId ? byPerson.get(borrowerId) ?? [] : [];
  if (fixes.length > 0 && c360.identity) {
    const identity = { ...c360.identity };
    for (const f of fixes) if (f.path in identity) identity[f.path] = f.value;
    out.identity = identity;
  }
  if (persons.length > 0 && persons.some((p) => byPerson.get(p.person_id)?.some((f) => f.path === 'full_name'))) {
    out.relationship = {
      ...c360.relationship,
      persons: persons.map((p) => {
        const name = byPerson.get(p.person_id)?.find((f) => f.path === 'full_name');
        return name ? { ...p, full_name: name.value } : p;
      }),
    };
  }
  const assets = (c360.collateral?.assets as Array<{ asset_id: string; identifiers: Record<string, unknown> }> | undefined) ?? [];
  const byAsset = new Map(master.assets.map((e) => [e.entity_id, corrected(e)]));
  if (assets.some((a) => (byAsset.get(a.asset_id)?.length ?? 0) > 0)) {
    out.collateral = {
      ...c360.collateral,
      assets: assets.map((a) => {
        const fs = byAsset.get(a.asset_id) ?? [];
        if (fs.length === 0) return a;
        const identifiers = { ...a.identifiers };
        for (const f of fs) {
          const key = f.path.replace(/^identifiers\./, '');
          if (key in identifiers) identifiers[key] = f.value;
        }
        return { ...a, identifiers };
      }),
    };
  }
  return out;
}

/** Trường master chứa lá nguồn `rid` (là nguồn, ứng viên hoặc bản lệch). */
export function masterFieldOf(master: MasterDossier, rid: string): MasterField | null {
  for (const d of [...master.documents, ...master.other_documents]) {
    for (const f of d.fields) {
      if (f.sources.includes(rid) || f.candidates.some((c) => c.evidence_ids.includes(rid)) || f.outliers.some((o) => o.evidence_id === rid)) return f;
    }
  }
  return null;
}

const FIELD_NAMES: Record<string, string> = {
  requested: 'số tiền cho vay', revenue: 'doanh thu năm', profit: 'lợi nhuận năm', collateral: 'giá trị TSBĐ',
  tenor: 'thời hạn vay', rate: 'lãi suất', existingMonthly: 'nghĩa vụ nợ hiện hữu',
};
type InputKey = keyof typeof FIELD_NAMES;

/**
 * MD-R13: thay từng đầu vào tài chính bằng giá trị hợp nhất của trường master chứa lá nguồn. CONFLICT → null +
 * `conflicts[key]`. Đầu vào không trỏ được trường master giữ nguyên. Giá trị TSBĐ (tổng nhiều tài sản) cộng lại theo master.
 */
export function applyMasterToFinancialInputs(inputs: FinancialInputs, master: MasterDossier | null): FinancialInputs {
  if (!master) return inputs;
  const out: FinancialInputs = { ...inputs, conflicts: { ...(inputs.conflicts ?? {}) } };
  const resolve = (key: InputKey, cur: SourcedNumber | null) => {
    if (!cur) return;
    const parts = cur.evidenceIds.map((rid) => ({ rid, field: masterFieldOf(master, rid) }));
    if (parts.some((p) => p.field?.status === 'CONFLICT')) {
      (out as unknown as Record<string, SourcedNumber | null>)[key] = null;
      out.conflicts![key as keyof NonNullable<FinancialInputs['conflicts']>] = FIELD_NAMES[key];
      return;
    }
    if (parts.length === 1 && parts[0].field) {
      const f = parts[0].field;
      // has_existing_debt = false → 0 (giữ nguyên ngữ nghĩa của V2-R06).
      const value = typeof f.value === 'number' ? f.value : f.value === false && key === 'existingMonthly' ? 0 : null;
      if (value !== null) (out as unknown as Record<string, SourcedNumber>)[key] = { value, evidenceIds: f.sources.length ? f.sources : cur.evidenceIds };
      return;
    }
    if (key === 'collateral' && parts.every((p) => p.field && typeof p.field.value === 'number')) {
      out.collateral = { value: parts.reduce((s, p) => s + (p.field!.value as number), 0), evidenceIds: parts.flatMap((p) => p.field!.sources) };
    }
  };
  (Object.keys(FIELD_NAMES) as InputKey[]).forEach((k) => resolve(k, (inputs as unknown as Record<string, SourcedNumber | null>)[k]));

  // Đầu vào v3 lấy từ bản đầu tiên; bản đó trống mà bản trùng khác có giá trị → lấy từ chứng từ hợp nhất.
  const loanDoc = master.documents.find((d) => d.doc_type_key === 'loan_application' && d.fields.length > 0);
  const fromLoan = (key: 'requested' | 'tenor' | 'rate' | 'existingMonthly', path: string) => {
    if (out[key] || out.conflicts![key] || !loanDoc) return;
    const f = loanDoc.fields.find((x) => x.path === path);
    if (!f) return;
    if (f.status === 'CONFLICT') { out.conflicts![key] = FIELD_NAMES[key]; return; }
    if (typeof f.value === 'number') out[key] = { value: f.value, evidenceIds: f.sources };
  };
  fromLoan('requested', 'loan_info.bank_proposed_amount');
  fromLoan('tenor', 'loan_info.loan_term_months');
  fromLoan('rate', 'loan_info.interest_rate');
  fromLoan('existingMonthly', 'financial_info.existing_monthly_debt_payment');
  if (Object.keys(out.conflicts!).length === 0) delete out.conflicts;
  return out;
}
