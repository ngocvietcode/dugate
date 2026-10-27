// Số định danh hiện tại / lịch sử / kiểm tra và role_conflict (T-S3-06; S3-R11, R12, R13).
import { idKind } from '../common/id-number';
import { normIdNumber } from '../common/normalize';
import { ID_DOC_TYPES, type PartyRef, type Person, type Role } from './types';

export type IdStatus = 'CURRENT' | 'HISTORICAL' | 'OBSERVED';

export interface IdNumberSource {
  evidence_id: string;
  doc_type_key: string;
  party_index: number;
  id_number: string;
  id_status: IdStatus;
}

export interface IdNumberCheck {
  status: 'CONSISTENT' | 'HISTORICAL_ID_NUMBER' | 'CURRENT_ID_NUMBER_CONFLICT' | 'NOT_VERIFIABLE';
  severity: 'INFO' | 'REVIEW' | 'HIGH';
  requires_review: boolean;
  reason_code: string | null;
}

export interface IdentityCandidate {
  id_numbers: string[];
  date_of_birth: string | null;
  gender: string | null;
  evidence_ids: string[];
}

export interface RoleConflictDetail {
  role: Role;
  candidates: IdentityCandidate[];
}

export interface IdState {
  current_id_number: string | null;
  historical_id_numbers: string[];
  observed_id_numbers: string[];
  id_number_sources: IdNumberSource[];
  id_number_check: IdNumberCheck;
  role_conflict: boolean;
  role_conflict_details: RoleConflictDetail[];
}

const HISTORICAL_REVIEW_CONFIDENCE = 0.8;

const ids = (r: PartyRef) => [r.party.id_number, ...r.party.previous_id_numbers].map(normIdNumber).filter((n): n is string => n !== null);

/** Cụm danh tính: party HOLDER của giấy tờ định danh, gom theo số chung (kể cả số cũ trong previous_id_numbers). */
function identityClusters(holders: PartyRef[]): PartyRef[][] {
  const clusters: Array<{ ids: Set<string>; refs: PartyRef[] }> = [];
  for (const r of holders) {
    const own = new Set(ids(r));
    const hit = clusters.filter((c) => [...own].some((n) => c.ids.has(n)));
    if (hit.length === 0) { clusters.push({ ids: own, refs: [r] }); continue; }
    const [first, ...rest] = hit;
    for (const n of own) first.ids.add(n);
    first.refs.push(r);
    for (const c of rest) {
      c.ids.forEach((n) => first.ids.add(n));
      first.refs.push(...c.refs);
      clusters.splice(clusters.indexOf(c), 1);
    }
  }
  return clusters.map((c) => c.refs);
}

const distinctValue = (refs: PartyRef[], pick: (r: PartyRef) => string | null) => {
  const vals = [...new Set(refs.map(pick).filter((v): v is string => v !== null))];
  return vals.length === 1 ? vals[0] : null;
};

/** Hai cụm khác nhau rõ (ngày sinh hoặc giới tính cùng khác null và khác nhau). */
function clearlyDifferent(a: PartyRef[], b: PartyRef[]): boolean {
  const differ = (pick: (r: PartyRef) => string | null) => {
    const va = new Set(a.map(pick).filter((v): v is string => v !== null));
    const vb = new Set(b.map(pick).filter((v): v is string => v !== null));
    return va.size > 0 && vb.size > 0 && ![...va].some((v) => vb.has(v));
  };
  return differ((r) => r.party.date_of_birth) || differ((r) => r.party.gender);
}

export function computeIdState(person: Person): IdState {
  const holders = person.parties.filter((r) => ID_DOC_TYPES.has(r.doc_type_key) && r.party.party_role === 'HOLDER');

  // S3-R11 role_conflict
  const clusters = identityClusters(holders.filter((r) => ids(r).length > 0));
  let role_conflict = false;
  for (let i = 0; i < clusters.length && !role_conflict; i++) {
    for (let j = i + 1; j < clusters.length; j++) if (clearlyDifferent(clusters[i], clusters[j])) { role_conflict = true; break; }
  }

  // S3-R12 (1) số hiện tại
  const withId = holders.filter((r) => normIdNumber(r.party.id_number) !== null);
  const has12 = withId.some((r) => idKind(r.party.id_number) === 'ID12');
  const candidates = withId
    .filter((r) => !has12 || idKind(r.party.id_number) === 'ID12')
    .sort((a, b) => {
      const da = a.party.id_issue_date; const db = b.party.id_issue_date;
      if (da !== db) { if (da === null) return 1; if (db === null) return -1; return da < db ? 1 : -1; }
      return a.evidence_order - b.evidence_order;
    });
  const candidateIds = [...new Set(candidates.map((r) => normIdNumber(r.party.id_number)!))];
  const previousOfCandidates = new Set(candidates.flatMap((r) => r.party.previous_id_numbers.map(normIdNumber)).filter(Boolean) as string[]);
  let current: string | null = candidateIds[0] ?? null;
  const currentConflict = current !== null && candidateIds.some((n) => n !== current && n.length === current!.length && !previousOfCandidates.has(n));
  if (currentConflict || role_conflict) current = null;

  // (2) lịch sử + quan sát
  const declared = person.declared_id_number;
  const reference = current ?? declared;
  const observedAll = new Set<string>();
  for (const r of person.parties) ids(r).forEach((n) => observedAll.add(n));
  if (declared) observedAll.add(declared);
  const historical = new Set<string>();
  for (const r of person.parties) r.party.previous_id_numbers.map(normIdNumber).forEach((n) => { if (n) historical.add(n); });
  if (idKind(reference) === 'ID12') for (const n of observedAll) if (idKind(n) === 'ID9') historical.add(n);
  if (current) historical.delete(current);

  // (3) trạng thái từng quan sát
  const currentSet = new Set(currentConflict ? candidateIds : current ? [current] : []);
  const statusOf = (n: string): IdStatus => (currentSet.has(n) ? 'CURRENT' : historical.has(n) ? 'HISTORICAL' : 'OBSERVED');
  const sources: IdNumberSource[] = [];
  for (const r of person.parties) {
    for (const n of ids(r)) {
      if (sources.some((s) => s.evidence_id === r.evidence_id && s.party_index === r.party_index && s.id_number === n)) continue;
      sources.push({ evidence_id: r.evidence_id, doc_type_key: r.doc_type_key, party_index: r.party_index, id_number: n, id_status: statusOf(n) });
    }
  }
  const unexplained = [...observedAll].filter((n) => statusOf(n) === 'OBSERVED' && n !== reference);

  // S3-R13
  let check: IdNumberCheck;
  if (currentConflict || role_conflict) {
    check = { status: 'CURRENT_ID_NUMBER_CONFLICT', severity: 'HIGH', requires_review: true, reason_code: role_conflict ? 'MULTIPLE_IDENTITIES_FOR_ROLE' : 'CURRENT_ID_NUMBER_CONFLICT' };
  } else if (declared && current && declared !== current && !historical.has(declared)) {
    check = { status: 'NOT_VERIFIABLE', severity: 'REVIEW', requires_review: true, reason_code: 'DECLARED_ID_DIFFERS' };
  } else if (unexplained.length > 0) {
    check = { status: 'NOT_VERIFIABLE', severity: 'REVIEW', requires_review: true, reason_code: 'OBSERVED_ID_DIFFERS' };
  } else if (historical.size > 0) {
    const conf = Math.min(...person.parties.filter((r) => ids(r).some((n) => historical.has(n))).map((r) => r.confidence), 1);
    const severity = conf < HISTORICAL_REVIEW_CONFIDENCE ? 'REVIEW' : 'INFO';
    check = { status: 'HISTORICAL_ID_NUMBER', severity, requires_review: severity === 'REVIEW', reason_code: 'HISTORICAL_ID_NUMBER' };
  } else {
    check = { status: 'CONSISTENT', severity: 'INFO', requires_review: false, reason_code: null };
  }

  const role_conflict_details: RoleConflictDetail[] = role_conflict
    ? person.roles.map((role) => ({
      role,
      candidates: clusters.map((c) => ({
        id_numbers: [...new Set(c.flatMap(ids))],
        date_of_birth: distinctValue(c, (r) => r.party.date_of_birth),
        gender: distinctValue(c, (r) => r.party.gender),
        evidence_ids: [...new Set(c.map((r) => r.evidence_id))],
      })),
    }))
    : [];
  if (role_conflict) {
    for (const m of person.mapped) {
      if (ID_DOC_TYPES.has(m.doc_type_key) && !m.warnings.includes('MULTIPLE_IDENTITIES_FOR_ROLE')) m.warnings.push('MULTIPLE_IDENTITIES_FOR_ROLE');
    }
  }

  const observed = [...observedAll];
  for (const n of [...historical, ...(current ? [current] : [])]) if (!observed.includes(n)) observed.push(n);
  return {
    current_id_number: current,
    historical_id_numbers: [...historical].sort(),
    observed_id_numbers: observed.sort(),
    id_number_sources: sources,
    id_number_check: check,
    role_conflict,
    role_conflict_details,
  };
}
