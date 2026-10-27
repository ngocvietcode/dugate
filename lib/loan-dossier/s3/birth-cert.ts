// Xác minh quan hệ qua giấy khai sinh (T-S3-11; S3-R21). S3 chỉ đếm; so với required_count thuộc S4.
import { isNameMatch, nameLevel } from '../common/name';
import type { DocumentParty } from '../s2/common-schema';
import type { RelationshipType } from './relationship';
import type { Evidence } from './types';

export interface VerifiedDocument {
  evidence_id: string;
  matched_names: number;
  total_names: 3;
}

const matchesAny = (name: string | null, names: ReadonlyArray<string>) => Boolean(name) && names.some((n) => isNameMatch(nameLevel(name, n)));

/**
 * `subjectNames`/`ownerNames`: mọi tên đã biết của người vay và chủ TSBĐ. `PARENT_CHILD`: ≥ 2/3 tên khớp và gồm
 * cả hai người (một ở CHILD, một ở FATHER/MOTHER), cần 1 giấy. `SIBLING`: mỗi giấy có ≥ 1/3 tên khớp một trong
 * hai người là hợp lệ. Loại khác → không xét.
 */
export function verifyByBirthCerts(
  subjectNames: ReadonlyArray<string>,
  ownerNames: ReadonlyArray<string>,
  type: RelationshipType | null,
  evidences: ReadonlyArray<Evidence>,
): { verified_documents: VerifiedDocument[]; verified_count: number } {
  if (type !== 'PARENT_CHILD' && type !== 'SIBLING') return { verified_documents: [], verified_count: 0 };
  const docs: VerifiedDocument[] = [];
  for (const e of evidences) {
    if (e.status !== 'SUCCESS' || e.doc_type_key !== 'birth_certificate' || !e.data) continue;
    const parties = (e.data.parties as DocumentParty[] | undefined) ?? [];
    const nameOf = (role: string) => parties.find((p) => p.party_role === role)?.full_name ?? null;
    const child = nameOf('CHILD');
    if (!parties.some((p) => p.party_role === 'CHILD')) continue;
    const parents = [nameOf('FATHER'), nameOf('MOTHER')];
    const all = [child, ...parents];
    const matched = all.filter((n) => matchesAny(n, subjectNames) || matchesAny(n, ownerNames)).length;
    let valid = false;
    if (type === 'PARENT_CHILD') {
      const childIsSubject = matchesAny(child, subjectNames);
      const childIsOwner = matchesAny(child, ownerNames);
      const parentIsSubject = parents.some((n) => matchesAny(n, subjectNames));
      const parentIsOwner = parents.some((n) => matchesAny(n, ownerNames));
      valid = matched >= 2 && ((childIsSubject && parentIsOwner) || (childIsOwner && parentIsSubject));
    } else {
      valid = matched >= 1;
    }
    if (valid) docs.push({ evidence_id: e.evidence_id, matched_names: matched, total_names: 3 });
  }
  return { verified_documents: docs, verified_count: docs.length };
}
