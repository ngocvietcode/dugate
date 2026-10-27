// Luồng thu nhập (T-360-12; L360-B04, L360-G03). Mỗi dòng `income_sources[i]` giữ danh tính dòng; cùng khóa thì là một luồng dù
// nằm trên nhiều chứng từ; chứng từ bóc tách nhẹ chỉ chứng minh luồng tồn tại. Hàm thuần, tất định, không log.
import { orgNameLevel } from '../common/org-name';
import { normIdNumber } from '../common/normalize';
import type { MapDossierData } from '../contracts/check-stages';
import type { DocumentParty } from '../s2/common-schema';
import type { BusinessResult } from './business';
import { chooseMonthlyAmount, type MergePolicies } from './policies';
import { IncomeKindSchema, type IncomeKind, type IncomeStream, type ProfileGapCode, type ProfileRelation } from './schema';
import { normText, pickField, text, type Candidate, type Lookup } from './sources';

interface Entry {
  kind: IncomeKind;
  person_id: string | null;
  business_id: string | null;
  asset_id: string | null;
  employer?: Candidate & { tax: string | null };
  amount?: { value: number; doc_type_key: string; fact_id?: string };
}

/** Chứng từ bóc tách nhẹ chứng minh có nguồn thu của người chủ thể (`HOLDER`). */
const EVIDENCE_ONLY: Record<string, IncomeKind> = {
  payroll_bank_statement: 'salary', vssid_social_insurance: 'salary', asset_lease_contract: 'rental', rental_payment_receipt: 'rental',
};
/** Chứng từ lương có số tiền: đường dẫn số tiền theo tháng. */
const SALARY_DOCS: Record<string, string> = { labor_contract: 'contract_info.monthly_salary', salary_confirmation: 'salary_info.monthly_salary' };

function collectEntries(lookup: Lookup, s3: MapDossierData | null, business: BusinessResult) {
  const entries: Entry[] = [];
  const evidencedBy = new Map<string, Set<IncomeKind>>();
  let declared = 0;
  const assetOf = (evidenceId: string, assetIndex: unknown) => (typeof assetIndex === 'number'
    ? s3?.asset_registry.find((a) => a.sources.some((s) => s.evidence_id === evidenceId && s.asset_index === assetIndex))?.asset_id ?? null
    : null);

  for (const e of lookup.evidences) {
    const data = e.data as Record<string, unknown>;
    const parties = (data.parties as DocumentParty[] | undefined) ?? [];
    const personAt = (partyIndex: unknown) => (typeof partyIndex === 'number' ? lookup.personOf(e.evidence_id, partyIndex)?.person_id ?? null : null);
    const amountAt = (path: string, v: unknown) => (typeof v === 'number' ? { value: v, doc_type_key: e.doc_type_key, fact_id: lookup.factOf(e.evidence_id, path)?.fact_id } : undefined);

    if (e.doc_type_key === 'income_statement') {
      ((data.income_sources as Array<Record<string, unknown>> | undefined) ?? []).forEach((r, i) => {
        const parsed = IncomeKindSchema.safeParse(r.income_type);
        const kind: IncomeKind = parsed.success ? parsed.data : 'other';
        const salary = r.salary as { employer_name?: unknown } | null | undefined;
        const employerName = text(salary?.employer_name);
        entries.push({
          kind, person_id: personAt(r.party_index),
          business_id: business.unitOf.get(`${e.evidence_id}#income_sources[${i}]`) ?? null,
          asset_id: kind === 'rental' ? assetOf(e.evidence_id, (r.rental as { asset_index?: unknown } | null)?.asset_index) : null,
          employer: employerName ? { value: employerName, tax: null, fact: lookup.factOf(e.evidence_id, `income_sources[${i}].salary.employer_name`) } : undefined,
          amount: amountAt(`income_sources[${i}].monthly_amount`, r.monthly_amount),
        });
      });
    }

    const salaryPath = SALARY_DOCS[e.doc_type_key];
    if (salaryPath) {
      const employee = parties.find((p) => p.party_role === 'EMPLOYEE');
      const employerIdx = parties.findIndex((p) => p.party_role === 'EMPLOYER');
      const employer = employerIdx >= 0 ? parties[employerIdx] : undefined;
      const [block, leaf] = salaryPath.split('.');
      const name = text(employer?.full_name);
      entries.push({
        kind: 'salary', person_id: employee ? personAt(employee.party_index) : null, business_id: null, asset_id: null,
        employer: name ? { value: name, tax: normIdNumber(employer?.tax_id), fact: lookup.factOf(e.evidence_id, `parties[${employerIdx}].full_name`) } : undefined,
        amount: amountAt(salaryPath, (data[block] as Record<string, unknown> | null | undefined)?.[leaf]),
      });
    }

    const kind = EVIDENCE_ONLY[e.doc_type_key];
    const holder = kind ? parties.find((p) => p.party_role === 'HOLDER') : undefined;
    const holderPerson = holder ? personAt(holder.party_index) : null;
    if (kind && holderPerson) evidencedBy.set(holderPerson, (evidencedBy.get(holderPerson) ?? new Set()).add(kind));

    if (e.doc_type_key === 'loan_application') {
      declared += ((data.financial_info as { income_details?: unknown[] } | null)?.income_details ?? []).length;
    }
  }
  return { entries, evidencedBy, declared };
}

const sameEmployer = (a: Entry['employer'], b: Entry['employer']) => !!a && !!b
  && ((a.tax !== null && a.tax === b.tax) || orgNameLevel(String(a.value), String(b.value)) === 'EXACT');

export function buildIncomeStreams(lookup: Lookup, s3: MapDossierData | null, business: BusinessResult, policies: MergePolicies | null) {
  const { entries, evidencedBy, declared } = collectEntries(lookup, s3, business);
  const streams: Entry[][] = [];
  const mine = (e: Entry) => streams.filter((s) => s[0].kind === e.kind && s[0].person_id === e.person_id && e.person_id !== null);

  // Lần 1: lần nhắc có khóa đầy đủ (bên trả lương / tài sản / đơn vị); lần 2: không khóa → luồng duy nhất cùng loại của người.
  const keyed = (e: Entry) => (e.kind === 'salary' ? !!e.employer : e.kind === 'rental' ? e.asset_id !== null : e.kind === 'household_business' ? e.business_id !== null : false);
  for (const pass of [true, false]) {
    for (const e of entries.filter((x) => keyed(x) === pass)) {
      const candidates = mine(e);
      const hit = pass
        ? candidates.find((s) => (e.kind === 'salary' ? s.some((o) => sameEmployer(o.employer, e.employer))
          : e.kind === 'rental' ? s[0].asset_id === e.asset_id : e.kind === 'household_business' ? s[0].business_id === e.business_id : false))
        : (e.kind === 'salary' || e.kind === 'rental' || e.kind === 'household_business') && candidates.length === 1 ? candidates[0] : undefined;
      if (hit) hit.push(e);
      else streams.push([e]);
    }
  }

  const businessEvidence = new Set(business.units.filter((u) => u.mentioned_in.some((m) => m.doc_type_key !== 'income_statement' && m.doc_type_key !== 'loan_application')).map((u) => u.business_id));
  const operates = new Map(business.relations.map((r) => [`${r.from}#${r.to}`, r.verification]));
  const relations: ProfileRelation[] = [];
  const income_streams: IncomeStream[] = streams.map((s, i) => {
    const head = s[0];
    const income_id = `inc-${i + 1}`;
    const amounts = s.flatMap((e) => (e.amount ? [{ value: e.amount.value, doc_type_key: e.amount.doc_type_key, fact_ids: e.amount.fact_id ? [e.amount.fact_id] : [] }] : []));
    const employers = s.flatMap((e) => (e.employer ? [e.employer] : []));
    const onlyOfKind = head.person_id !== null && streams.filter((o) => o[0].kind === head.kind && o[0].person_id === head.person_id).length === 1;
    if (head.business_id) {
      relations.push({ type: 'EARNS_FROM', from: income_id, to: head.business_id, verification: (head.person_id && operates.get(`${head.person_id}#${head.business_id}`)) || 'UNVERIFIED' });
    }
    return {
      income_id, kind: head.kind, person_id: head.person_id, business_id: head.business_id, asset_id: head.asset_id,
      employer: head.kind === 'salary' ? pickField(employers, 'text', normText) : null,
      amounts,
      monthly_amount: chooseMonthlyAmount(amounts.map((a) => a.value), policies),
      evidenced: head.kind === 'household_business'
        ? head.business_id !== null && businessEvidence.has(head.business_id)
        : onlyOfKind && !!head.person_id && (evidencedBy.get(head.person_id)?.has(head.kind) ?? false),
    };
  });

  const gaps: Array<{ code: ProfileGapCode; count: number }> = [];
  const unmapped = income_streams.filter((s) => s.person_id === null).length;
  if (unmapped > 0) gaps.push({ code: 'INCOME_OWNER_NOT_MAPPED', count: unmapped });
  if (declared > 0) gaps.push({ code: 'DECLARED_INCOME_NOT_LINKED', count: declared });
  return { income_streams, relations, gaps };
}
