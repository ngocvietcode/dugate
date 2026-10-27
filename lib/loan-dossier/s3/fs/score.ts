// Bộ chấm Fellegi-Sunter ghép party cá nhân → người (T-FS-03; spec s3_fellegi_sunter.md §3.1, §3.3, FS-R02, FS-R05).
// Hàm thuần, tất định: không đổi `persons` đầu vào. Pháp nhân không chấm ở đây (vẫn theo mã số thuế của matchParties).
import { normIdNumber } from '../../common/normalize';
import { otherParties } from '../match-parties';
import { partyKey, type Evidence, type PartyRef, type Person } from '../types';
import { comparePair, type FsLevels } from './compare';
import type { FsField, FsParams } from './params';

export type FsDecision = 'MATCH' | 'AMBIGUOUS_IDENTITY_MATCH' | 'POSSIBLE_MATCH' | 'NO_IDENTITY_MATCH';

export interface FsVerdict {
  decision: FsDecision;
  /** Điểm cao nhất `W1` (null khi không có người nào để so). */
  weight: number | null;
  /** Người có điểm cao nhất (kể cả khi không ghép). */
  person_id: string | null;
  /** Chỉ mức, không giá trị (FS-R13). */
  breakdown: FsLevels | null;
}

const MAX_ROUNDS = 5;

export function pairWeight(levels: FsLevels, params: FsParams): number {
  let w = 0;
  for (const field of Object.keys(levels) as FsField[]) {
    const p = (params.comparisons[field] as Record<string, { m: number; u: number }>)[levels[field]];
    if (p) w += Math.log2(p.m / p.u);
  }
  return w;
}

function score(ref: PartyRef, person: Person, params: FsParams): { weight: number; breakdown: FsLevels } | null {
  // FS-R05: hai party của cùng một evidence không vào cùng một người.
  if (person.parties.some((r) => r.evidence_id === ref.evidence_id)) return null;
  let best: { weight: number; breakdown: FsLevels } | null = null;
  for (const r of person.parties) {
    const breakdown = comparePair(ref.party, ref.confidence, r.party, person);
    const weight = pairWeight(breakdown, params);
    if (!best || weight > best.weight) best = { weight, breakdown };
  }
  return best;
}

function verdict(ref: PartyRef, persons: readonly Person[], params: FsParams): FsVerdict {
  const ranked = persons
    .filter((p) => p.party_type === 'INDIVIDUAL')
    .map((p) => ({ p, s: score(ref, p, params) }))
    .filter((x): x is { p: Person; s: { weight: number; breakdown: FsLevels } } => x.s !== null)
    .sort((a, b) => b.s.weight - a.s.weight);
  if (ranked.length === 0) return { decision: 'NO_IDENTITY_MATCH', weight: null, person_id: null, breakdown: null };
  const [top, second] = ranked;
  const { upper, lower, ambiguity_margin } = params.thresholds;
  const w1 = top.s.weight;
  const decision: FsDecision = w1 >= upper
    ? (second && w1 - second.s.weight < ambiguity_margin ? 'AMBIGUOUS_IDENTITY_MATCH' : 'MATCH')
    : w1 > lower ? 'POSSIBLE_MATCH' : 'NO_IDENTITY_MATCH';
  return { decision, weight: w1, person_id: top.p.person_id, breakdown: top.s.breakdown };
}

/**
 * Cùng khung với `matchParties` (S3-R06, R07): lặp tới điểm bất động (≤ 5 vòng); mỗi vòng ghép các party `MATCH` theo điểm giảm dần,
 * mở rộng `K(p)`, rồi chấm lại phần còn lại. Trả quyết định cuối của mọi party cá nhân chưa ghép.
 */
export function matchPartiesFs(persons: readonly Person[], evidences: ReadonlyArray<Evidence>, anchorId: string | null, params: FsParams) {
  const work: Person[] = structuredClone(persons as Person[]);
  const personOf = new Map<string, string>();
  for (const p of work) for (const r of p.parties) personOf.set(partyKey(r), p.person_id);
  const pending = otherParties(evidences, anchorId)
    .filter((r) => r.party.party_type !== 'ORGANIZATION' && (r.party.full_name?.trim() || r.party.id_number));
  const decisions = new Map<string, FsVerdict>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const open = pending.filter((r) => !personOf.has(partyKey(r)));
    const scored = open.map((r, i) => ({ r, i, v: verdict(r, work, params) }));
    for (const { r, v } of scored) decisions.set(partyKey(r), v);
    const matches = scored.filter((x) => x.v.decision === 'MATCH').sort((a, b) => b.v.weight! - a.v.weight! || a.i - b.i);
    let changed = false;
    for (const { r, v } of matches) {
      const person = work.find((p) => p.person_id === v.person_id)!;
      // Ghép trước trong vòng có thể làm người này nhận party cùng evidence: chấm lại trước khi ghép.
      if (person.parties.some((x) => x.evidence_id === r.evidence_id)) continue;
      person.parties.push(r);
      for (const n of [r.party.id_number, ...r.party.previous_id_numbers].map(normIdNumber)) if (n) person.known_ids.add(n);
      personOf.set(partyKey(r), person.person_id);
      changed = true;
    }
    if (!changed) break;
  }
  return { personOf, decisions };
}
