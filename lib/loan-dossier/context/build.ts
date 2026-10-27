// Dựng Loan Application Context từ S2 + S3 + sổ Claim (LAC-R01…R10, R12; D-103). Hàm thuần, tất định, không gọi model,
// không log. LAC mang giá trị thật (PII): chỉ đi vào prompt (khối untrusted) và bộ nhớ worker.
import { createHash } from 'crypto';

import { docTypeByKey } from '../catalog';
import { fieldLabel } from '../catalog/field-labels';
import type { MapDossierData } from '../contracts/check-stages';
import { buildClaimLedger, type Claim } from '../graph/claims';
import type { EvidenceEnvelope } from '../s2/common-schema';
import {
  LAC_VERSION,
  type LacConflict,
  type LacFact,
  type LacGap,
  type LacRelation,
  type LacSubject,
  type LacSubjectFlag,
  type LacTrust,
  type LoanApplicationContext,
} from './schema';

export interface BuildLacInput {
  product_code: string;
  flow: string | null;
  /** Output S2 nguyên trạng (kể cả evidence ERROR — chỉ để đếm gap). */
  evidences: ReadonlyArray<EvidenceEnvelope>;
  /** Output S3; null khi S3 lỗi (LAC vẫn dựng, LAC-R10). */
  s3: MapDossierData | null;
  s3_status?: string | null;
}

/** Ngưỡng ACCEPTED của độ tin cậy đọc (cùng V2-R04 / ACCEPT_CONFIDENCE). */
export const LAC_ACCEPT_CONFIDENCE = 0.8;
const LOW_MATCH_CONFIDENCE = 0.8;
const LOAN_SUBJECT = 'loan';
const BUSINESS_SUBJECT = 'business-1';
/** Trường định danh khoản vay: hai đơn vay ghi khác nhau là mâu thuẫn thật (LAC-R03). */
const LOAN_IDENTITY_FIELDS = new Set(['loan_info.requested_amount', 'loan_info.bank_proposed_amount', 'loan_info.loan_term_months', 'loan_info.interest_rate']);
/** Lá liên kết nội bộ của chứng từ (cùng tập NEVER_CONTRADICT của sổ Claim): giữ cho lossless, không render. */
const INTERNAL_FIELD = /(^|\.)(party_index|party_indexes\[\]|owner_party_indexes\[\]|asset_index)$|_index$|_indexes\[\]$/;
const MAX_SUPPORT = 3;

type Draft = Omit<LacFact, 'fact_id' | 'contradicts' | 'trust' | 'review'> & {
  status: Claim['status'];
  claimIds: string[];
  contradictsClaims: string[];
  norm: string | number | boolean | null;
};

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const docLabel = (key: string) => docTypeByKey(key)?.doc_type_label ?? key;
const evidenceIdOf = (recordId: string) => recordId.split('#')[0];

export function buildLoanApplicationContext(input: BuildLacInput): LoanApplicationContext {
  const { evidences, s3 } = input;
  const ledger = buildClaimLedger(evidences, s3);
  const superseded = new Set((s3?.superseded_evidences ?? []).map((s) => s.evidence_id));

  // ── Chủ thể của từng Claim: loan:* → loan, business:* → business-1, document:<ev> → doc-<n> theo thứ tự S2 ──
  const docOrder = new Map(evidences.map((e, i) => [e.evidence_id, i]));
  const docSubject = new Map<string, string>();
  [...new Set(ledger.claims.filter((c) => c.subject.kind === 'document').map((c) => c.subject.id))]
    .sort((a, b) => (docOrder.get(a) ?? 0) - (docOrder.get(b) ?? 0))
    .forEach((ev, i) => docSubject.set(ev, `doc-${i + 1}`));
  const subjectOf = (c: Claim): string => {
    if (c.subject.kind === 'loan') return LOAN_SUBJECT;
    if (c.subject.kind === 'business') return BUSINESS_SUBJECT;
    if (c.subject.kind === 'document') return docSubject.get(c.subject.id)!;
    return c.subject.id;
  };

  // ── Claim → bản nháp; gộp chủ thể khoản vay / kinh doanh theo (field, value_norm) (LAC-R03) ──
  const drafts: Draft[] = [];
  const mergeIndex = new Map<string, Draft>();
  for (const c of ledger.claims) {
    const subject_id = subjectOf(c);
    const internal = INTERNAL_FIELD.test(c.field);
    const mergeable = (subject_id === LOAN_SUBJECT || subject_id === BUSINESS_SUBJECT) && !internal && c.value_norm !== null;
    const key = mergeable ? `${subject_id}\u0000${c.field}\u0000${String(c.value_norm)}` : null;
    const sources = c.sources.map((s) => ({ record_id: s.record_id, doc_type_key: s.doc_type_key, page: s.page, read_confidence: s.read_confidence }));
    const existing = key ? mergeIndex.get(key) : undefined;
    if (existing) {
      existing.sources.push(...sources);
      existing.claimIds.push(c.claim_id);
      existing.contradictsClaims.push(...c.contradicts);
      continue;
    }
    const d: Draft = {
      subject_id, field: c.field, label: fieldLabel(c.field), value: c.value, value_kind: c.value_kind, sources, internal,
      status: c.status, claimIds: [c.claim_id], contradictsClaims: [...c.contradicts], norm: c.value_norm,
    };
    drafts.push(d);
    if (key) mergeIndex.set(key, d);
  }

  // ── Thứ tự & mã: chủ thể theo LAC-R12, fact theo lá đầu tiên (thứ tự sổ Claim) ──
  const subjectRank = new Map<string, number>();
  const rank = (id: string, r: number) => { if (!subjectRank.has(id)) subjectRank.set(id, r); };
  rank(LOAN_SUBJECT, 0);
  rank(BUSINESS_SUBJECT, 1);
  (s3?.role_registry ?? []).forEach((p, i) => rank(p.person_id, 100 + i));
  (s3?.asset_registry ?? []).forEach((a, i) => rank(a.asset_id, 10_000 + i));
  [...docSubject.values()].forEach((id, i) => rank(id, 1_000_000 + i));
  const ordered = drafts.map((d, i) => ({ d, i })).sort((x, y) => (subjectRank.get(x.d.subject_id) ?? 0) - (subjectRank.get(y.d.subject_id) ?? 0) || x.i - y.i).map((x) => x.d);
  const factIdOfClaim = new Map<string, string>();
  ordered.forEach((d, i) => d.claimIds.forEach((cid) => factIdOfClaim.set(cid, `fact-${i + 1}`)));

  // ── Trust + review (LAC-R05, R06) ──
  const facts: LacFact[] = ordered.map((d, i) => {
    const live = d.sources.filter((s) => !superseded.has(evidenceIdOf(s.record_id)));
    const docs = new Set(live.map((s) => evidenceIdOf(s.record_id)));
    let trust: LacTrust;
    if (live.length === 0) trust = 'SUPERSEDED';
    else if (d.status === 'DISPUTED' || d.status === 'PROBABLE_OCR_ERROR' || d.status === 'SPELLING_VARIANT') trust = d.status;
    else if (docs.size >= 2) trust = 'CORROBORATED';
    else trust = live.every((s) => s.doc_type_key === 'loan_application') ? 'DECLARED' : 'SINGLE_SOURCE';
    const judged = live.length > 0 ? live : d.sources;
    const review = judged.every((s) => typeof s.read_confidence === 'number' && s.read_confidence >= LAC_ACCEPT_CONFIDENCE) ? 'ACCEPTED' : 'REVIEW';
    const contradicts = [...new Set(d.contradictsClaims.map((cid) => factIdOfClaim.get(cid)).filter((x): x is string => !!x && x !== `fact-${i + 1}`))];
    return {
      fact_id: `fact-${i + 1}`, subject_id: d.subject_id, field: d.field, label: d.label, value: d.value, value_kind: d.value_kind,
      trust, review, sources: d.sources, contradicts, internal: d.internal,
    };
  });

  // ── Hai đơn vay ghi khác nhau định danh khoản vay → DISPUTED (LAC-R03) ──
  const loanGroups = new Map<string, LacFact[]>();
  for (const f of facts) {
    if (f.subject_id !== LOAN_SUBJECT || !LOAN_IDENTITY_FIELDS.has(f.field) || f.trust === 'SUPERSEDED') continue;
    loanGroups.set(f.field, [...(loanGroups.get(f.field) ?? []), f]);
  }
  let loanDisputes = 0;
  for (const group of loanGroups.values()) {
    if (group.length < 2) continue;
    loanDisputes += 1;
    for (const f of group) {
      f.trust = 'DISPUTED';
      f.contradicts = [...new Set([...f.contradicts, ...group.filter((o) => o !== f).map((o) => o.fact_id)])];
    }
  }

  const factsBySubject = new Map<string, LacFact[]>();
  for (const f of facts) factsBySubject.set(f.subject_id, [...(factsBySubject.get(f.subject_id) ?? []), f]);

  const subjects = buildSubjects(input, factsBySubject, superseded, subjectRank);
  const relations = buildRelations(s3, factsBySubject);
  const conflicts = buildConflicts(facts);
  const gaps = buildGaps(input, ledger.claims, superseded, loanDisputes);

  const sourceLines = facts.flatMap((f) => f.sources.map((s) => `${s.record_id}\t${JSON.stringify(f.value)}`)).sort();
  return {
    lac_version: LAC_VERSION,
    product_code: input.product_code,
    flow: input.flow,
    subjects,
    facts,
    relations,
    conflicts,
    gaps,
    meta: {
      leaf_count: ledger.leaf_count,
      fact_count: facts.length,
      unresolved_count: ledger.unresolved_count,
      s3_status: input.s3_status ?? null,
      source_hash: sha256(sourceLines.join('\n')),
    },
  };
}

function mentionedIn(facts: ReadonlyArray<LacFact>, superseded: ReadonlySet<string>): LacSubject['mentioned_in'] {
  const byType = new Map<string, Set<string>>();
  for (const f of facts) {
    for (const s of f.sources) {
      const ev = evidenceIdOf(s.record_id);
      if (superseded.has(ev)) continue;
      byType.set(s.doc_type_key, (byType.get(s.doc_type_key) ?? new Set()).add(ev));
    }
  }
  return [...byType].map(([doc_type_key, evs]) => ({ doc_type_key, count: evs.size }));
}

function buildSubjects(
  input: BuildLacInput,
  factsBySubject: ReadonlyMap<string, LacFact[]>,
  superseded: ReadonlySet<string>,
  subjectRank: ReadonlyMap<string, number>,
): LacSubject[] {
  const out: LacSubject[] = [];
  const of = (id: string) => factsBySubject.get(id) ?? [];
  if (of(LOAN_SUBJECT).length) out.push({ subject_id: LOAN_SUBJECT, kind: 'loan', label: 'Khoản vay', roles: [], mentioned_in: mentionedIn(of(LOAN_SUBJECT), superseded), flags: [] });
  if (of(BUSINESS_SUBJECT).length) out.push({ subject_id: BUSINESS_SUBJECT, kind: 'business', label: 'Hoạt động kinh doanh', roles: [], mentioned_in: mentionedIn(of(BUSINESS_SUBJECT), superseded), flags: [] });

  const c360 = new Map((input.s3?.customer_360 ?? []).map((c) => [c.person_id, c]));
  for (const p of input.s3?.role_registry ?? []) {
    const flags: LacSubjectFlag[] = [];
    if (p.role_conflict) flags.push('ROLE_CONFLICT');
    if (p.id_number_check.requires_review) flags.push('ID_NUMBER_REVIEW');
    const mapped = p.mapped_evidences as Array<{ match_confidence?: unknown; warnings?: unknown }>;
    if (mapped.some((m) => typeof m.match_confidence === 'number' && m.match_confidence < LOW_MATCH_CONFIDENCE)) flags.push('LOW_MATCH_CONFIDENCE');
    if (mapped.some((m) => Array.isArray(m.warnings) && m.warnings.includes('NAME_SPELLING_DIFFERENCE'))) flags.push('NAME_SPELLING_DIFFERENCE');
    const name = c360.get(p.person_id)?.identity.full_name ?? p.full_name;
    out.push({
      subject_id: p.person_id, kind: 'person', label: name ?? '(không rõ tên)',
      roles: p.roles.map((r) => (r === 'other' && p.other_role_detail ? `other:${p.other_role_detail}` : r)),
      mentioned_in: mentionedIn(of(p.person_id), superseded), flags,
    });
  }
  for (const a of input.s3?.asset_registry ?? []) {
    const ids = a.identifiers as Record<string, unknown>;
    const ident = ['certificate_number', 'license_plate', 'chassis_number', 'apartment_number'].map((k) => ids[k]).find((v) => typeof v === 'string' && v);
    out.push({
      subject_id: a.asset_id, kind: 'asset', label: ident ? `${a.asset_type} ${String(ident)}` : a.asset_type,
      roles: [...(a.usage_contexts as string[])], mentioned_in: mentionedIn(of(a.asset_id), superseded), flags: [],
    });
  }
  const docs = [...factsBySubject.keys()].filter((id) => id.startsWith('doc-')).sort((x, y) => (subjectRank.get(x) ?? 0) - (subjectRank.get(y) ?? 0));
  for (const id of docs) {
    const first = of(id)[0]?.sources[0];
    out.push({ subject_id: id, kind: 'document', label: first ? docLabel(first.doc_type_key) : id, roles: [], mentioned_in: mentionedIn(of(id), superseded), flags: [] });
  }
  return out;
}

/** Fact của `subjectId` có nguồn thuộc một trong các evidence `evidenceIds`, ưu tiên trường định danh (LAC-R08). */
function supportFacts(factsBySubject: ReadonlyMap<string, LacFact[]>, subjectId: string, evidenceIds: ReadonlySet<string>): string[] {
  const candidates = (factsBySubject.get(subjectId) ?? []).filter((f) => !f.internal && f.sources.some((s) => evidenceIds.has(evidenceIdOf(s.record_id))));
  const score = (f: LacFact) => (/(full_name|id_number|tax_id|certificate_number|license_plate)$/.test(f.field) ? 0 : 1);
  return candidates.sort((a, b) => score(a) - score(b)).slice(0, MAX_SUPPORT).map((f) => f.fact_id);
}

function buildRelations(s3: MapDossierData | null, factsBySubject: ReadonlyMap<string, LacFact[]>): LacRelation[] {
  if (!s3) return [];
  const out: Array<Omit<LacRelation, 'relation_id'>> = [];
  const evidencesOf = (entries: ReadonlyArray<Record<string, unknown>>) => new Set(entries.map((e) => e.evidence_id).filter((x): x is string => typeof x === 'string'));
  const notRequired = { status: 'NOT_REQUIRED' as const, detail: null };

  for (const a of s3.asset_registry) {
    const assetEvs = evidencesOf(a.sources);
    for (const pid of a.owner_person_ids.filter((x, i, xs) => xs.indexOf(x) === i)) {
      const current = a.current_owner_person_ids.includes(pid);
      out.push({ type: current ? 'OWNS' : 'OWNED_FORMERLY', from: pid, to: a.asset_id, verification: notRequired, support_fact_ids: supportFacts(factsBySubject, pid, assetEvs) });
    }
    for (const pid of a.current_owner_person_ids.filter((x) => !a.owner_person_ids.includes(x))) {
      out.push({ type: 'OWNS', from: pid, to: a.asset_id, verification: notRequired, support_fact_ids: supportFacts(factsBySubject, pid, assetEvs) });
    }
  }
  const seenSpouse = new Set<string>();
  const registry = new Map(s3.role_registry.map((p) => [p.person_id, p]));
  for (const c of s3.customer_360) {
    if (c.spouse_person_id) {
      const pair = [c.person_id, c.spouse_person_id].sort().join('|');
      if (!seenSpouse.has(pair)) {
        seenSpouse.add(pair);
        const shared = new Set([...evidencesOf(registry.get(c.person_id)?.mapped_evidences ?? [])].filter((ev) => evidencesOf(registry.get(c.spouse_person_id!)?.mapped_evidences ?? []).has(ev)));
        out.push({ type: 'SPOUSE_OF', from: c.person_id, to: c.spouse_person_id, verification: notRequired, support_fact_ids: supportFacts(factsBySubject, c.person_id, shared) });
      }
    }
    const rep = c.organization?.representative_person_id ?? null;
    if (rep) {
      const orgEvs = evidencesOf(registry.get(c.person_id)?.mapped_evidences ?? []);
      out.push({ type: 'LEGAL_REP_OF', from: rep, to: c.person_id, verification: notRequired, support_fact_ids: supportFacts(factsBySubject, rep, orgEvs) });
    }
  }
  for (const r of s3.relationship_verifications) {
    const status = r.required_count === null ? 'NOT_REQUIRED' : r.verified_count >= r.required_count ? 'VERIFIED' : r.verified_count > 0 ? 'PARTIAL' : 'UNVERIFIED';
    const detail = [r.relationship_type ?? 'chưa phân loại', r.required_count !== null ? `giấy khai sinh ${r.verified_count}/${r.required_count}` : null].filter(Boolean).join(' · ');
    const docs = evidencesOf(r.verified_documents);
    out.push({
      type: 'RELATIVE_OF', from: r.subject_person_id, to: r.collateral_owner_person_id, verification: { status, detail },
      support_fact_ids: [...new Set([...supportFacts(factsBySubject, r.subject_person_id, docs), ...supportFacts(factsBySubject, r.collateral_owner_person_id, docs)])].slice(0, MAX_SUPPORT),
    });
  }
  return out.map((r, i) => ({ relation_id: `rel-${i + 1}`, ...r }));
}

function buildConflicts(facts: ReadonlyArray<LacFact>): LacConflict[] {
  const groups = new Map<string, LacFact[]>();
  for (const f of facts) {
    if (f.internal || (f.trust !== 'DISPUTED' && f.trust !== 'PROBABLE_OCR_ERROR')) continue;
    const key = `${f.subject_id}\u0000${f.field}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const support = (f: LacFact) => new Set(f.sources.map((s) => evidenceIdOf(s.record_id))).size;
  return [...groups.values()].filter((g) => g.length >= 2).map((g, i) => ({
    conflict_id: `conf-${i + 1}`,
    subject_id: g[0].subject_id,
    field: g[0].field,
    kind: g.some((f) => f.trust === 'PROBABLE_OCR_ERROR') ? 'PROBABLE_OCR_ERROR' as const : 'DISPUTED' as const,
    fact_ids: [...g].sort((a, b) => support(b) - support(a)).map((f) => f.fact_id),
  }));
}

function buildGaps(input: BuildLacInput, claims: ReadonlyArray<Claim>, superseded: ReadonlySet<string>, loanDisputes: number): LacGap[] {
  const gaps: LacGap[] = [];
  const add = (code: LacGap['code'], count: number, subject_id: string | null = null) => { if (count > 0) gaps.push({ code, subject_id, count }); };
  const readable = input.evidences.filter((e) => e.status === 'SUCCESS' && e.data);
  if (input.s3 === null) add('S3_UNAVAILABLE', 1);
  add('NO_LOAN_APPLICATION', readable.some((e) => e.doc_type_key === 'loan_application') ? 0 : 1);
  add('PARTY_NOT_MAPPED', input.s3?.unmapped_evidences.length ?? 0);
  add('ASSET_NOT_MAPPED', new Set(claims.filter((c) => c.unresolved === 'ASSET_NOT_MAPPED').map((c) => c.sources[0]?.evidence_id)).size);
  add('EVIDENCE_READ_ERROR', input.evidences.length - readable.length);
  add('SUPERSEDED_EVIDENCE', superseded.size);
  add('LOAN_APPLICATION_DUPLICATE', loanDisputes, LOAN_SUBJECT);
  return gaps;
}
