// Nghĩa vụ nợ (D-114; L360-G02 v1): lời khai trên đơn vay gốc, HĐ tín dụng tại TCTD khác, nhóm nợ trên CIC. Chưa gộp khoản CIC với
// HĐ tín dụng vì CIC chưa bóc theo khoản (OQ-360-14, T-360-11). Hàm thuần, tất định.
import type { DocumentParty } from '../s2/common-schema';
import type { Obligation } from './schema';
import { text, valueAt, type Lookup } from './sources';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function buildObligations(lookup: Lookup, borrowerId: string | null): Obligation[] {
  const out: Array<Omit<Obligation, 'obligation_id'>> = [];
  const fact = (evidenceId: string, path: string) => lookup.factOf(evidenceId, path)?.fact_id;
  const facts = (...ids: Array<string | undefined>) => [...new Set(ids.filter((x): x is string => !!x))];

  const anchor = lookup.anchor;
  if (anchor) {
    const has = valueAt(anchor.data, 'financial_info.has_existing_debt');
    const monthly = num(valueAt(anchor.data, 'financial_info.existing_monthly_debt_payment'));
    if (has === true || monthly !== null) {
      out.push({
        kind: 'DECLARED', person_id: borrowerId, lender: null, principal: null, monthly_payment: monthly, maturity_date: null, debt_group: null,
        fact_ids: facts(fact(anchor.evidence_id, 'financial_info.has_existing_debt'), fact(anchor.evidence_id, 'financial_info.existing_monthly_debt_payment')),
      });
    }
  }

  for (const e of lookup.evidences) {
    const parties = (e.data?.parties as DocumentParty[] | undefined) ?? [];
    const personAt = (idx: number | undefined) => (typeof idx === 'number' ? lookup.personOf(e.evidence_id, idx)?.person_id ?? null : null);
    if (e.doc_type_key === 'credit_contract') {
      const borrower = parties.find((p) => p.party_role === 'BORROWER');
      const lenderIdx = parties.findIndex((p) => p.party_role === 'LENDER');
      out.push({
        kind: 'CREDIT_CONTRACT', person_id: personAt(borrower?.party_index), lender: lenderIdx >= 0 ? text(parties[lenderIdx].full_name) : null,
        principal: num(valueAt(e.data, 'contract_info.loan_amount')), monthly_payment: null,
        maturity_date: text(valueAt(e.data, 'contract_info.maturity_date')), debt_group: null,
        fact_ids: facts(fact(e.evidence_id, 'contract_info.loan_amount'), fact(e.evidence_id, 'contract_info.maturity_date'), lenderIdx >= 0 ? fact(e.evidence_id, `parties[${lenderIdx}].full_name`) : undefined),
      });
    }
    if (e.doc_type_key === 'cic') {
      ((e.data?.reports as Array<Record<string, unknown>> | undefined) ?? []).forEach((r, i) => {
        const group = num(r.current_debt_group);
        if (group === null) return;
        out.push({
          kind: 'CIC', person_id: personAt(num(r.party_index) ?? undefined), lender: null, principal: null, monthly_payment: null, maturity_date: null,
          debt_group: String(group), fact_ids: facts(fact(e.evidence_id, `reports[${i}].current_debt_group`)),
        });
      });
    }
  }
  return out.map((o, i) => ({ obligation_id: `obl-${i + 1}`, ...o }));
}
