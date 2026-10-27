// Bộ dựng hồ sơ giả cho test S3–S5: evidence SUCCESS với parties/assets tùy ý. Dữ liệu giả, không có PII thật.
import { createHash } from 'node:crypto';

import { docTypeByKey } from '@/lib/loan-dossier/catalog';
import type { ClassifyData } from '@/lib/loan-dossier/contracts/stage-result';

import type { AssetDescriptor, AssetIdentifiers, DocumentParty, EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { makeAsset, makeEvidence, makeIdentifiers, makeLegalInfo, makeParty } from './build';

let counter = 0;
/** evidence_id giả tất định theo nhãn. */
export const evId = (label: string) => `ev-${createHash('sha256').update(label).digest('hex').slice(0, 12)}`;

export interface EvOptions {
  id?: string;
  /** Kiểu lỏng cho test: field thiếu lấy mặc định của makeParty / makeAsset. */
  parties?: Array<Record<string, unknown>>;
  assets?: Array<Record<string, unknown> & { identifiers?: Partial<AssetIdentifiers> }>;
  issue_date?: string | null;
  valid_until?: string | null;
  confidence?: number;
  data?: Record<string, unknown>;
}

export function ev(docTypeKey: string, o: EvOptions = {}): EvidenceEnvelope {
  counter += 1;
  const id = o.id ?? evId(`${docTypeKey}-${counter}`);
  // Mỗi evidence 1 file riêng (file_id suy từ evidence_id) để dựng output S1 khớp.
  const base = makeEvidence(docTypeKey, { evidence_id: id, file_id: `file-${id.slice(3)}`, file_name: `${docTypeKey}-${counter}.pdf` });
  const data = { ...base.data! };
  // Mặc định không số, không ngày sinh: test tự khai báo danh tính để không vô tình trùng số giả.
  if (o.parties) data.parties = o.parties.map((p, i) => makeParty({ party_index: i, id_number: null, date_of_birth: null, ...(p as Partial<DocumentParty>) }));
  if (o.assets) data.assets = o.assets.map((a, i) => makeAsset({ asset_index: i, ...(a as Partial<AssetDescriptor>), identifiers: makeIdentifiers(a.identifiers ?? {}) }));
  if ('legal_info' in data || o.issue_date !== undefined) {
    data.legal_info = makeLegalInfo({ issue_date: o.issue_date === undefined ? '2026-09-01' : o.issue_date, valid_until: o.valid_until ?? null });
  }
  Object.assign(data, o.data ?? {});
  const c = o.confidence ?? 0.95;
  return { ...base, data, field_confidences: { parties: c, assets: c, legal_info: c } };
}

/** Giấy đề nghị vay: party_details tự sinh theo parties (quan hệ có thể truyền qua `relations`). */
export function loanApp(parties: Array<Record<string, unknown>>, o: EvOptions & { relations?: Record<number, { raw?: string | null; type?: string | null; marital?: string | null }> } = {}): EvidenceEnvelope {
  const e = ev('loan_application', { ...o, parties });
  const details = parties.map((_, i) => ({
    party_index: i, form_section: null, source_page: null, is_section_page_verified: null,
    marital_status: o.relations?.[i]?.marital ?? null, marital_status_raw: null,
    relationship_to_borrower: o.relations?.[i]?.type ?? null, relationship_to_borrower_raw: o.relations?.[i]?.raw ?? null,
  }));
  return { ...e, data: { ...e.data!, party_details: details } };
}

export const ID_A12 = '001090000001';
export const ID_A9 = '012345671';
export const ID_B12 = '001090000002';
export const ID_C12 = '001090000003';

/** Output S1 tương ứng các evidence (1 file / evidence, 1 match, 1 instance). */
export function classifyOf(evidences: ReadonlyArray<EvidenceEnvelope>, extra: Array<{ doc_type_key: string; needs_manual_review?: boolean }> = []): ClassifyData {
  const files: ClassifyData['files'] = evidences.map((e) => ({
    file_id: e.file_id, file_name: e.file_name, status: 'CLASSIFIED', reason_code: null, next_action: null, message: null, page_count: 1,
    matches: [{
      doc_type_key: e.doc_type_key, confidence: 0.9, needs_manual_review: false, needs_extraction: docTypeByKey(e.doc_type_key)!.needs_extraction,
      instances_count: 1, hint_mismatch: false, instances: [{ instance_index: e.instance_index, page_range: e.page_range, confidence: 0.9, summary: '', key_facts: [] }],
    }],
  }));
  extra.forEach((x, i) => files.push({
    file_id: `file-ffffffff${String(i).padStart(4, '0')}`, file_name: `${x.doc_type_key}.pdf`, status: 'CLASSIFIED', reason_code: null, next_action: null, message: null, page_count: 1,
    matches: [{
      doc_type_key: x.doc_type_key, confidence: x.needs_manual_review ? 0.6 : 0.9, needs_manual_review: x.needs_manual_review ?? false,
      needs_extraction: docTypeByKey(x.doc_type_key)!.needs_extraction, instances_count: 1, hint_mismatch: false,
      instances: [{ instance_index: 1, page_range: [1, 1], confidence: x.needs_manual_review ? 0.6 : 0.9, summary: '', key_facts: [] }],
    }],
  }));
  return { files, repeated_doc_types: [] };
}
