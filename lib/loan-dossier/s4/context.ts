// Ngữ cảnh chung của S4 `check_checklist` (dữ liệu vào đã chuẩn bị, tra cứu nhanh).
import type { ClassifyData } from '../contracts/stage-result';
import type { MapDossierData } from '../contracts/check-stages';
import type { EvidenceEnvelope } from '../s2/common-schema';

/** Khóa luồng của chương trình checklist (S4-R24), VD FULL/FAST/SIMPLE (HKD) hoặc A/B. */
export type Flow = string;
export type ConditionResult = 'MET' | 'NOT_MET' | 'INPUT_NOT_PROVIDED';
export type ConditionSource = 'OCR' | 'EXTERNAL_INPUT';

export interface ExternalInput {
  deviation_code?: string | null;
  loan_amount?: number | null;
  collateral_mortgaged_elsewhere?: boolean | null;
}

export type Person = MapDossierData['role_registry'][number];
export type Asset = MapDossierData['asset_registry'][number];

export interface ChecklistContext {
  flow: Flow;
  d0: string;
  external: ExternalInput | null;
  classify: ClassifyData;
  /** Mọi evidence của S2 (kể cả ERROR). */
  evidences: ReadonlyArray<EvidenceEnvelope>;
  s3: MapDossierData | null;
  subjectMapping: boolean;
  assetMapping: boolean;
  /** evidence_id bị thay thế (S3-R27) — không làm input điều kiện OCR (S4-R10). */
  superseded: ReadonlySet<string>;
}

/** Người được gán cho evidence: evidence_id → [{person_id, party_index}] theo `mapped_evidences` của S3. */
export function evidencePersons(s3: MapDossierData | null): Map<string, Array<{ person_id: string; party_index: number }>> {
  const out = new Map<string, Array<{ person_id: string; party_index: number }>>();
  for (const p of s3?.role_registry ?? []) {
    for (const m of p.mapped_evidences as Array<{ evidence_id: string; party_index: number }>) {
      const list = out.get(m.evidence_id) ?? [];
      if (!list.some((x) => x.person_id === p.person_id)) list.push({ person_id: p.person_id, party_index: m.party_index });
      out.set(m.evidence_id, list);
    }
  }
  return out;
}

/** Tài sản của evidence: evidence_id → [{asset_id, asset_index}] theo `sources` của S3. */
export function evidenceAssets(s3: MapDossierData | null): Map<string, Array<{ asset_id: string; asset_index: number }>> {
  const out = new Map<string, Array<{ asset_id: string; asset_index: number }>>();
  for (const a of s3?.asset_registry ?? []) {
    for (const s of a.sources as Array<{ evidence_id: string; asset_index: number }>) {
      out.set(s.evidence_id, [...(out.get(s.evidence_id) ?? []), { asset_id: a.asset_id, asset_index: s.asset_index }]);
    }
  }
  return out;
}

/** Loại chứng từ có mặt trong hồ sơ (S1 matches hoặc evidence S2), trừ bản S2 không thấy mẫu biểu (S4-R26). */
export function docTypesPresent(ctx: ChecklistContext): Set<string> {
  const wrong = new Set(ctx.evidences.filter((e) => e.reason_code === 'FORM_NOT_FOUND').map((e) => `${e.file_id}|${e.doc_type_key}|${e.instance_index}`));
  const out = new Set<string>();
  for (const f of ctx.classify.files) {
    for (const m of f.matches) {
      if (m.instances.some((i) => !wrong.has(`${f.file_id}|${m.doc_type_key}|${i.instance_index}`))) out.add(m.doc_type_key);
    }
  }
  for (const e of ctx.evidences) if (e.reason_code !== 'FORM_NOT_FOUND') out.add(e.doc_type_key);
  return out;
}
