// Bản bị thay thế khi bản cũ hết hiệu lực (T-S3-16; S3-R27).
import { evaluateValidity } from '../common/validity';
import type { DocValidityRule } from '../s4/catalog';
import type { AssetRegistryEntry } from './asset-attrs';
import type { Evidence } from './types';

export interface SupersededEvidence {
  evidence_id: string;
  doc_type_key: string;
  person_id: string | null;
  asset_id: string | null;
  issue_date: string | null;
  superseded_by_evidence_ids: string[];
  reason_code: 'DOCUMENT_EXPIRED';
}

const legal = (e: Evidence) => (e.data?.legal_info as { issue_date?: string | null; valid_until?: string | null } | null | undefined) ?? null;

/**
 * Nhóm evidence SUCCESS theo (`doc_type_key`, phạm vi): PERSON → người của party chủ thể; ASSET → asset_id;
 * DOSSIER → cả hồ sơ. Bản hết hạn có ≥ 1 bản cùng nhóm còn hạn (`dateOK` và không hết hạn) → bị thay thế,
 * `superseded_by_evidence_ids` sắp theo `issue_date` giảm dần. Không có bản còn hạn → không thay.
 *
 * `personOfEvidence`: evidence_id → person_id của party chủ thể (HOLDER hoặc party đầu tiên đã ghép).
 */
export function findSuperseded(
  evidences: ReadonlyArray<Evidence>,
  personOfEvidence: ReadonlyMap<string, string>,
  assets: ReadonlyArray<AssetRegistryEntry>,
  validityByDocType: ReadonlyMap<string, DocValidityRule>,
  d0: string,
): SupersededEvidence[] {
  const assetOf = new Map<string, string>();
  for (const a of assets) for (const s of a.sources) if (!assetOf.has(s.evidence_id)) assetOf.set(s.evidence_id, a.asset_id);

  const groups = new Map<string, Array<{ e: Evidence; order: number; person: string | null; asset: string | null }>>();
  evidences.forEach((e, order) => {
    if (e.status !== 'SUCCESS' || !e.data) return;
    const rule = validityByDocType.get(e.doc_type_key);
    const scope = rule?.scope ?? 'DOSSIER';
    const person = personOfEvidence.get(e.evidence_id) ?? null;
    const asset = assetOf.get(e.evidence_id) ?? null;
    // Phạm vi không xác định được (không ghép người / tài sản) → không nhóm với ai.
    const scopeKey = scope === 'PERSON' ? person : scope === 'ASSET' ? asset : 'dossier';
    if (scopeKey === null) return;
    const k = `${e.doc_type_key}|${scopeKey}`;
    groups.set(k, [...(groups.get(k) ?? []), { e, order, person: scope === 'PERSON' ? person : null, asset: scope === 'ASSET' ? asset : null }]);
  });

  const out: Array<SupersededEvidence & { order: number }> = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const rule = validityByDocType.get(members[0].e.doc_type_key) ?? { validityDays: null, ignorePrintedExpiry: false, scope: 'DOSSIER' as const };
    const status = members.map((m) => {
      const li = legal(m.e);
      return evaluateValidity(
        { issue_date: li?.issue_date ?? null, valid_until: li?.valid_until ?? null, recognition_only: m.e.extraction_level === 'LIGHT' },
        rule, d0,
      );
    });
    const valid = members.filter((_, i) => status[i].dateOK && !status[i].expired);
    if (valid.length === 0) continue;
    const by = [...valid]
      .sort((a, b) => {
        const da = legal(a.e)?.issue_date ?? null; const db = legal(b.e)?.issue_date ?? null;
        if (da !== db) { if (da === null) return 1; if (db === null) return -1; return da < db ? 1 : -1; }
        return a.order - b.order;
      })
      .map((m) => m.e.evidence_id);
    members.forEach((m, i) => {
      if (!status[i].expired) return;
      out.push({
        evidence_id: m.e.evidence_id, doc_type_key: m.e.doc_type_key, person_id: m.person, asset_id: m.asset,
        issue_date: legal(m.e)?.issue_date ?? null, superseded_by_evidence_ids: by, reason_code: 'DOCUMENT_EXPIRED', order: m.order,
      });
    });
  }
  return out.sort((a, b) => a.order - b.order).map(({ order: _o, ...s }) => s);
}
