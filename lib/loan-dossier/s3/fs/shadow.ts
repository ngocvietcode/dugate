// Chế độ shadow của bộ chấm Fellegi-Sunter (T-FS-03; FS-R08, FS-R13): chạy cạnh luật S3, chỉ đếm khác biệt, không đổi output S3.
import type { MapDossierData } from '../../contracts/check-stages';
import { pickAnchor } from '../anchor';
import { otherParties } from '../match-parties';
import { buildRegistry } from '../registry';
import { partyKey, type Evidence } from '../types';
import type { FsParams } from './params';
import { matchPartiesFs } from './score';

export type S3Matcher = 'rules' | 'shadow';

/** Tham số chạy `s3_matcher`; giá trị lạ → `rules`. Chế độ `fs` chưa mở (để sau T-FS-06). */
export function resolveS3Matcher(raw: unknown): S3Matcher {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'shadow' ? 'shadow' : 'rules';
}

/** Chỉ số đếm theo party cá nhân chưa thuộc anchor; không có tên, số, ngày sinh. */
export interface FsShadowSummary {
  params_version: string;
  parties: number;
  /** Cả hai cùng ghép vào một người. */
  same: number;
  /** Luật ghép, FS không ghép. */
  rules_only: number;
  /** FS ghép, luật không ghép. */
  fs_only: number;
  /** Cả hai ghép nhưng vào hai người khác nhau. */
  different_person: number;
  fs_possible: number;
  fs_ambiguous: number;
}

export function fsShadow(input: ReadonlyArray<Evidence>, rules: MapDossierData, params: FsParams): FsShadowSummary {
  const evidences = input.filter((e) => e.status === 'SUCCESS' && e.data);
  const anchor = pickAnchor(evidences);
  const summary: FsShadowSummary = { params_version: params.params_version, parties: 0, same: 0, rules_only: 0, fs_only: 0, different_person: 0, fs_possible: 0, fs_ambiguous: 0 };
  if (!anchor) return summary;

  // Registry dựng lại từ anchor, độc lập với kết quả luật; buildRegistry tất định nên person_id trùng với output S3.
  const fs = matchPartiesFs(buildRegistry(anchor, evidences.indexOf(anchor)), evidences, anchor.evidence_id, params);
  const byRules = new Map<string, string>();
  for (const p of rules.role_registry) {
    for (const m of p.mapped_evidences as Array<{ evidence_id: string; party_index: number; sub_index: number | null }>) byRules.set(partyKey(m), p.person_id);
  }
  for (const ref of otherParties(evidences, anchor.evidence_id)) {
    if (ref.party.party_type === 'ORGANIZATION' || !(ref.party.full_name?.trim() || ref.party.id_number)) continue;
    const key = partyKey(ref);
    const r = byRules.get(key);
    const f = fs.personOf.get(key);
    const decision = fs.decisions.get(key)?.decision;
    summary.parties += 1;
    if (r && f) summary[r === f ? 'same' : 'different_person'] += 1;
    else if (r) summary.rules_only += 1;
    else if (f) summary.fs_only += 1;
    if (decision === 'POSSIBLE_MATCH') summary.fs_possible += 1;
    if (decision === 'AMBIGUOUS_IDENTITY_MATCH') summary.fs_ambiguous += 1;
  }
  return summary;
}
