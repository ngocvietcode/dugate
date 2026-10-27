// Ghép party của chứng từ khác theo số, rồi theo tên (T-S3-04; S3-R06, R07, R08, R09).
import { isNameMatch, nameLevel, type NameLevel } from '../common/name';
import { orgNameLevel } from '../common/org-name';
import { normIdNumber } from '../common/normalize';
import type { DocumentParty } from '../s2/common-schema';
import { splitJointOwner } from './split-names';
import { confidenceOf, partyKey, type Evidence, type PartyRef, type Person } from './types';

export const ID_CONFIDENCE_MIN = 0.5;
const MAX_ROUNDS = 5;

export type UnmatchedReason = 'NO_IDENTITY_MATCH' | 'NAME_SPELLING_DIFFERENCE' | 'NO_IDENTITY_FIELDS' | 'AMBIGUOUS_IDENTITY_MATCH';

export interface UnmatchedParty extends PartyRef {
  reason: UnmatchedReason;
}

export interface MatchResult {
  persons: Person[];
  unmatched: UnmatchedParty[];
  /** `partyKey` → person_id của mọi party đã ghép (kể cả anchor). */
  personOf: Map<string, string>;
}

/** Mọi party (đã tách tên ghép) của evidence SUCCESS ngoài anchor, theo thứ tự evidences rồi party_index. */
export function otherParties(evidences: ReadonlyArray<Evidence>, anchorId: string | null): PartyRef[] {
  const out: PartyRef[] = [];
  evidences.forEach((e, order) => {
    if (e.status !== 'SUCCESS' || !e.data || e.evidence_id === anchorId) return;
    const parties = [...((e.data.parties as DocumentParty[] | undefined) ?? [])].sort((a, b) => a.party_index - b.party_index);
    for (const p of parties) {
      const parts = splitJointOwner(p);
      parts.forEach((party, i) => out.push({
        evidence_id: e.evidence_id, evidence_order: order, doc_type_key: e.doc_type_key, party_index: p.party_index,
        sub_index: parts.length > 1 ? i : null, party, confidence: confidenceOf(e, 'parties'),
      }));
    }
  });
  return out;
}

const idsOf = (p: DocumentParty) => [p.id_number, ...p.previous_id_numbers].map(normIdNumber).filter((n): n is string => n !== null);
const taxOf = (p: DocumentParty) => normIdNumber(p.tax_id);
const isOrg = (p: DocumentParty) => p.party_type === 'ORGANIZATION';
const kindOf = (p: DocumentParty): Person['party_type'] => (isOrg(p) ? 'ORGANIZATION' : 'INDIVIDUAL');
const namesOf = (person: Person) => [...new Set([person.full_name, ...person.parties.map((r) => r.party.full_name)].filter((n): n is string => Boolean(n?.trim())))];
const dobsOf = (person: Person) => new Set(person.parties.map((r) => r.party.date_of_birth).filter((d): d is string => d !== null));

/** Mức tên tốt nhất của party so với mọi tên đã biết của người. Pháp nhân dùng luật tên pháp nhân (bỏ loại hình, không đảo từ). */
function bestLevel(name: string | null, person: Person): NameLevel {
  const rank: NameLevel[] = ['EXACT', 'REORDERED', 'SPELLING_DIFFERENCE', 'NO_MATCH'];
  const levelOf = person.party_type === 'ORGANIZATION' ? orgNameLevel : nameLevel;
  let best: NameLevel = 'NO_MATCH';
  for (const n of namesOf(person)) {
    const l = levelOf(name, n);
    if (rank.indexOf(l) < rank.indexOf(best)) best = l;
  }
  return best;
}

function attach(person: Person, ref: PartyRef, by: 'ID_NUMBER' | 'FULL_NAME', level: NameLevel, personOf: Map<string, string>): void {
  person.parties.push(ref);
  for (const n of idsOf(ref.party)) person.known_ids.add(n);
  const tax = taxOf(ref.party);
  if (tax && person.party_type === 'ORGANIZATION') person.known_tax_ids.add(tax);
  const warnings: string[] = [];
  if (by === 'ID_NUMBER' && ref.party.full_name && level === 'SPELLING_DIFFERENCE') warnings.push('NAME_SPELLING_DIFFERENCE');
  const cap = by === 'FULL_NAME' ? (level === 'EXACT' ? 0.9 : 0.85) : 1;
  person.mapped.push({
    evidence_id: ref.evidence_id, doc_type_key: ref.doc_type_key, party_index: ref.party_index, sub_index: ref.sub_index,
    party_role: ref.party.party_role, matched_by: by, match_confidence: Math.min(ref.confidence, cap),
    name_level: ref.party.full_name ? level : null, warnings,
  });
  personOf.set(partyKey(ref), person.person_id);
}

/**
 * Vòng số (khớp tuyệt đối với `K(p)`, chỉ khi confidence parties ≥ 0.50) rồi dự phòng tên (`EXACT`/`REORDERED`,
 * lọc DOB khi khớp nhiều người); lặp tới điểm bất động (≤ 5 vòng) vì mỗi lần ghép mở rộng `K(p)`.
 * Đầu vào `persons` bị sửa tại chỗ (thêm party/ids); trả thêm danh sách party chưa ghép kèm lý do.
 */
export function matchParties(persons: Person[], evidences: ReadonlyArray<Evidence>, anchorId: string | null): MatchResult {
  const personOf = new Map<string, string>();
  for (const p of persons) for (const r of p.parties) personOf.set(partyKey(r), p.person_id);
  const pending = otherParties(evidences, anchorId);
  const ambiguous = new Set<string>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let changed = false;
    // (1) theo số: cá nhân theo số định danh, pháp nhân theo mã số thuế. Hai loại không bao giờ khớp chéo.
    for (const ref of pending) {
      const k = partyKey(ref);
      if (personOf.has(k) || ambiguous.has(k) || ref.confidence < ID_CONFIDENCE_MIN) continue;
      const kind = kindOf(ref.party);
      const tax = taxOf(ref.party);
      const ids = kind === 'ORGANIZATION' ? (tax ? [tax] : []) : idsOf(ref.party);
      if (ids.length === 0) continue;
      const hits = persons.filter((p) => p.party_type === kind && ids.some((n) => (kind === 'ORGANIZATION' ? p.known_tax_ids : p.known_ids).has(n)));
      if (hits.length === 1) {
        attach(hits[0], ref, 'ID_NUMBER', bestLevel(ref.party.full_name, hits[0]), personOf);
        changed = true;
      } else if (hits.length > 1) {
        ambiguous.add(k);
      }
    }
    // (2) dự phòng theo tên: không có số / số confidence thấp / số không thuộc K() của ai.
    for (const ref of pending) {
      const k = partyKey(ref);
      if (personOf.has(k) || ambiguous.has(k) || !ref.party.full_name?.trim()) continue;
      const kind = kindOf(ref.party);
      const tax = taxOf(ref.party);
      const ids = kind === 'ORGANIZATION' ? (tax ? [tax] : []) : idsOf(ref.party);
      const idUsable = ids.length > 0 && ref.confidence >= ID_CONFIDENCE_MIN;
      const same = persons.filter((p) => p.party_type === kind);
      if (idUsable && same.some((p) => ids.some((n) => (kind === 'ORGANIZATION' ? p.known_tax_ids : p.known_ids).has(n)))) continue;
      let hits = same.filter((p) => isNameMatch(bestLevel(ref.party.full_name, p)));
      if (hits.length > 1) {
        const dob = ref.party.date_of_birth;
        hits = dob && kind === 'INDIVIDUAL' ? hits.filter((p) => dobsOf(p).has(dob)) : [];
        if (hits.length !== 1) { ambiguous.add(k); continue; }
      }
      if (hits.length === 1) {
        // Pháp nhân có MST khác MST đã biết của chủ thể thì là công ty khác dù trùng tên riêng.
        if (kind === 'ORGANIZATION' && tax && hits[0].known_tax_ids.size > 0 && !hits[0].known_tax_ids.has(tax)) continue;
        attach(hits[0], ref, 'FULL_NAME', bestLevel(ref.party.full_name, hits[0]), personOf);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const unmatched: UnmatchedParty[] = pending
    .filter((ref) => !personOf.has(partyKey(ref)))
    .map((ref) => {
      const hasName = Boolean(ref.party.full_name?.trim());
      let reason: UnmatchedReason = 'NO_IDENTITY_MATCH';
      if (!hasName && idsOf(ref.party).length === 0) reason = 'NO_IDENTITY_FIELDS';
      else if (ambiguous.has(partyKey(ref))) reason = 'AMBIGUOUS_IDENTITY_MATCH';
      else if (hasName && persons.some((p) => bestLevel(ref.party.full_name, p) === 'SPELLING_DIFFERENCE')) reason = 'NAME_SPELLING_DIFFERENCE';
      return { ...ref, reason };
    });
  return { persons, unmatched, personOf };
}
