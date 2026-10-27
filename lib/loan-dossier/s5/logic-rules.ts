// Logic rule liên chứng từ (T-S5-09; S5-R13). Cả 3 rule chờ BA xác nhận (OQ-05) nhưng vẫn chạy.
import type { MapDossierData } from '../contracts/check-stages';
import { normIdNumber } from '../common/normalize';
import type { DocumentParty, EvidenceEnvelope } from '../s2/common-schema';
import type { Matrix, MatrixLogicRule } from './matrix';

export interface LogicFinding {
  finding_id: string;
  rule_key: string;
  person_id: string | null;
  asset_id: string | null;
  evidence_ids: string[];
  violated: boolean;
  severity: 'INFO' | 'REVIEW' | 'HIGH';
  requires_review: boolean;
  needs_ba_confirmation: boolean;
  message: string;
}

type Draft = Omit<LogicFinding, 'finding_id' | 'severity' | 'requires_review' | 'needs_ba_confirmation' | 'message'>;

const parties = (e: EvidenceEnvelope) => (e.data?.parties as DocumentParty[] | undefined) ?? [];
const get = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o);

function mappedParties(s3: MapDossierData, personId: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  const p = s3.role_registry.find((x) => x.person_id === personId);
  for (const m of (p?.mapped_evidences ?? []) as Array<{ evidence_id: string; party_index: number }>) {
    if (!out.has(m.evidence_id)) out.set(m.evidence_id, new Set());
    out.get(m.evidence_id)!.add(m.party_index);
  }
  return out;
}

function idIssueBeforeLabor(s3: MapDossierData, usable: readonly EvidenceEnvelope[]): Draft[] {
  const out: Draft[] = [];
  for (const p of s3.role_registry) {
    const mine = mappedParties(s3, p.person_id);
    const cards = usable.filter((e) => e.doc_type_key === 'id_card' && mine.has(e.evidence_id))
      .flatMap((e) => parties(e).filter((x) => x.party_role === 'HOLDER' && mine.get(e.evidence_id)!.has(x.party_index)).map((x) => ({ e, x })));
    const contracts = usable.filter((e) => e.doc_type_key === 'labor_contract' && mine.has(e.evidence_id))
      .flatMap((e) => parties(e).filter((x) => x.party_role === 'EMPLOYEE' && mine.get(e.evidence_id)!.has(x.party_index)).map((x) => ({ e, x })));
    for (const c of cards) {
      for (const l of contracts) {
        const sign = get(l.e.data, 'contract_info.sign_date') as string | null | undefined;
        const issue = c.x.id_issue_date;
        const sameId = normIdNumber(c.x.id_number) !== null && normIdNumber(c.x.id_number) === normIdNumber(l.x.id_number);
        if (!sign || !issue || !sameId) continue;
        out.push({ rule_key: 'id_issue_date_before_labor_contract', person_id: p.person_id, asset_id: null, evidence_ids: [c.e.evidence_id, l.e.evidence_id], violated: issue > sign });
      }
    }
  }
  return out;
}

function purchaseBelowLoan(usable: readonly EvidenceEnvelope[]): Draft[] {
  const app = usable.find((e) => e.doc_type_key === 'loan_application' && typeof get(e.data, 'loan_info.bank_proposed_amount') === 'number');
  if (!app) return [];
  const bank = get(app.data, 'loan_info.bank_proposed_amount') as number;
  const seenGroups = new Set<string>();
  let total = 0;
  const ids: string[] = [];
  for (const e of usable) {
    const path = e.doc_type_key === 'purchase_list' ? 'funding_plan.total_amount' : e.doc_type_key === 'goods_purchase_contract' ? 'contract_info.total_amount' : null;
    if (!path) continue;
    const v = get(e.data, path);
    if (typeof v !== 'number') continue;
    if (e.duplicate_group_id) {
      if (seenGroups.has(e.duplicate_group_id)) continue;
      seenGroups.add(e.duplicate_group_id);
    }
    total += v;
    ids.push(e.evidence_id);
  }
  if (ids.length === 0) return [];
  return [{ rule_key: 'purchase_total_below_loan_amount', person_id: null, asset_id: null, evidence_ids: [app.evidence_id, ...ids], violated: total < bank }];
}

function declaredOwnerNotCurrent(s3: MapDossierData, usable: readonly EvidenceEnvelope[]): Draft[] {
  const out: Draft[] = [];
  const apps = new Set(usable.filter((e) => e.doc_type_key === 'loan_application').map((e) => e.evidence_id));
  for (const a of s3.asset_registry) {
    if (a.current_owner_person_ids.length === 0) continue;
    const sources = a.sources as Array<{ evidence_id: string; doc_type_key: string }>;
    const appIds = sources.filter((s) => apps.has(s.evidence_id)).map((s) => s.evidence_id);
    if (appIds.length === 0) continue;
    const declared = s3.role_registry.filter((p) => p.roles.includes('collateral_owner')
      && (p.mapped_evidences as Array<{ evidence_id: string; party_role: string }>).some((m) => appIds.includes(m.evidence_id) && m.party_role === 'COLLATERAL_OWNER'));
    if (declared.length === 0) continue;
    out.push({
      rule_key: 'declared_collateral_owner_not_current_owner', person_id: null, asset_id: a.asset_id,
      evidence_ids: [...new Set(sources.map((s) => s.evidence_id))],
      violated: declared.some((p) => !a.current_owner_person_ids.includes(p.person_id)),
    });
  }
  return out;
}

const RULES: Record<string, (s3: MapDossierData, usable: readonly EvidenceEnvelope[]) => Draft[]> = {
  id_issue_date_before_labor_contract: idIssueBeforeLabor,
  purchase_total_below_loan_amount: (_s3, usable) => purchaseBelowLoan(usable),
  declared_collateral_owner_not_current_owner: declaredOwnerNotCurrent,
};

/** Đánh giá mọi rule của ma trận; thiếu input → không sinh finding; ghi cả finding `violated = false`. */
export function evaluateLogicRules(matrix: Matrix, s3: MapDossierData, usable: readonly EvidenceEnvelope[]): LogicFinding[] {
  const out: LogicFinding[] = [];
  for (const rule of matrix.logic_rules) {
    const fn = RULES[rule.rule_key];
    if (!fn) throw new Error(`Logic rule chưa hỗ trợ: ${rule.rule_key}`);
    for (const d of fn(s3, usable)) out.push(finish(rule, d, out.length + 1));
  }
  return out;
}

function finish(rule: MatrixLogicRule, d: Draft, n: number): LogicFinding {
  return {
    ...d,
    finding_id: `lgc-${n}`,
    severity: d.violated ? rule.severity_when_violated : 'INFO',
    requires_review: d.violated,
    needs_ba_confirmation: rule.needs_ba_confirmation,
    message: d.violated ? rule.message : `Không vi phạm: ${rule.rule_label}`,
  };
}
