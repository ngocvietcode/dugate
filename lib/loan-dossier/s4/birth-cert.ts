// Giấy khai sinh — dòng `legal_birth_certificate` khi điều kiện MET (T-S4-08; S4-R17). S4 không tự so tên.
import type { ChecklistContext, Person } from './context';
import type { Candidate } from './rows';

export interface RelationshipCheck {
  collateral_owner_person_id: string;
  relationship_type: string | null;
  required_count: number | null;
  verified_count: number;
  is_satisfied: boolean | null;
}

export interface BirthCertDecision {
  status: 'PRESENT' | 'MISSING' | 'NEEDS_REVIEW';
  reason_code: 'DOCUMENT_FOUND' | 'INSUFFICIENT_BIRTH_CERTIFICATES' | 'DOCUMENT_NOT_FOUND' | 'RELATIONSHIP_UNVERIFIED';
  relationship_checks: RelationshipCheck[];
  found_in: Candidate[];
}

export function evaluateBirthCertRow(p: Person | null, candidates: readonly Candidate[], ctx: ChecklistContext): BirthCertDecision {
  const s3 = ctx.s3;
  if (!p || !s3) return { status: 'NEEDS_REVIEW', reason_code: 'RELATIONSHIP_UNVERIFIED', relationship_checks: [], found_in: [] };
  const spouse = s3.customer_360.find((c) => c.person_id === p.person_id)?.spouse_person_id ?? null;
  const owners = s3.role_registry.filter((q) => q.person_id !== p.person_id && q.roles.includes('collateral_owner') && q.person_id !== spouse
    && !s3.relationship_verifications.some((r) => r.subject_person_id === p.person_id && r.collateral_owner_person_id === q.person_id && r.relationship_type === 'SPOUSE'));
  const checks: RelationshipCheck[] = owners.map((q) => {
    const rv = s3.relationship_verifications.find((r) => r.subject_person_id === p.person_id && r.collateral_owner_person_id === q.person_id);
    const required = rv?.required_count ?? null;
    return {
      collateral_owner_person_id: q.person_id,
      relationship_type: rv?.relationship_type ?? null,
      required_count: required,
      verified_count: rv?.verified_count ?? 0,
      is_satisfied: !rv || required === null ? null : rv.verified_count >= required,
    };
  });
  if (checks.length > 0 && checks.every((c) => c.is_satisfied === true)) {
    const verified = new Set(s3.relationship_verifications
      .filter((r) => r.subject_person_id === p.person_id && owners.some((q) => q.person_id === r.collateral_owner_person_id))
      .flatMap((r) => (r.verified_documents as Array<{ evidence_id: string }>).map((d) => d.evidence_id)));
    const byId = new Map(ctx.evidences.map((e) => [e.evidence_id, e]));
    const found = [...verified].map((id) => byId.get(id)).filter(Boolean).map((e) => ({
      evidence_id: e!.evidence_id, file_id: e!.file_id, file_name: e!.file_name, doc_type_key: e!.doc_type_key, page: e!.page_range[0],
      field_path: null, status: 'SUCCESS' as const, duplicate_group_id: e!.duplicate_group_id, duplicate_status: e!.duplicate_status,
      issue_date: null, valid_until: null, recognition_only: false, needs_manual_review: false,
    }));
    return { status: 'PRESENT', reason_code: 'DOCUMENT_FOUND', relationship_checks: checks, found_in: found };
  }
  if (checks.some((c) => c.is_satisfied === false)) {
    const hasCert = candidates.some((c) => c.status === 'SUCCESS');
    return { status: 'MISSING', reason_code: hasCert ? 'INSUFFICIENT_BIRTH_CERTIFICATES' : 'DOCUMENT_NOT_FOUND', relationship_checks: checks, found_in: [] };
  }
  return { status: 'NEEDS_REVIEW', reason_code: 'RELATIONSHIP_UNVERIFIED', relationship_checks: checks, found_in: candidates.filter((c) => c.evidence_id) };
}
