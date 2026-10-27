// Chọn anchor (T-S3-01; S3-R01).
import { confidenceOf, type Evidence } from './types';

const hasIdentity = (p: { full_name: string | null; id_number: string | null }) => Boolean(p.full_name?.trim() || p.id_number?.trim());

/**
 * Ứng viên = `loan_application` SUCCESS có ≥ 1 party BORROWER có tên hoặc số. Chọn
 * `field_confidences.parties` cao nhất; hòa → đứng trước.
 */
export function pickAnchor(evidences: ReadonlyArray<Evidence>): Evidence | null {
  let best: Evidence | null = null;
  for (const e of evidences) {
    if (e.status !== 'SUCCESS' || e.doc_type_key !== 'loan_application' || !e.data) continue;
    const parties = (e.data.parties as Array<{ party_role: string; full_name: string | null; id_number: string | null }> | undefined) ?? [];
    if (!parties.some((p) => p.party_role === 'BORROWER' && hasIdentity(p))) continue;
    if (!best || confidenceOf(e, 'parties') > confidenceOf(best, 'parties')) best = e;
  }
  return best;
}
