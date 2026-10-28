// Đơn vị kinh doanh HKD và cạnh OPERATES (T-360-07; L360-B01…B03, B06). Hàm thuần, tất định, không log.
// v1 chỉ HKD: doanh nghiệp (`ENTERPRISE`) thêm ở T-360-09. `business_info` của đơn vay chỉ là HKD khi sản phẩm thuộc phân khúc HKD
// (D-112: khách vay SME là pháp nhân, không phải hộ kinh doanh).
import { orgNameLevel } from '../common/org-name';
import { normIdNumber, normKey } from '../common/normalize';
import type { MapDossierData } from '../contracts/check-stages';
import type { DocumentParty } from '../s2/common-schema';
import type { BusinessFlag, BusinessUnit, ProfileRelation, Verification } from './schema';
import { normText, pickField, text, VERIFICATION_RANK, verificationOf, type Candidate, type Lookup } from './sources';

interface Owner { person_id: string; verification: Verification }

interface Mention {
  evidence_id: string;
  doc_type_key: string;
  /** Khóa để nguồn thu tìm lại đơn vị của mình: `{evidence_id}#income_sources[i]`, các chứng từ khác: `{evidence_id}`. */
  key: string;
  owner: Owner | null;
  name?: Candidate;
  registration_number?: Candidate;
  tax_id?: Candidate;
  business_line?: Candidate;
  business_address?: Candidate;
}

/** Chứng từ HKD bóc tách nhẹ: party chủ thể và các trường `fields` mang thông tin đơn vị. */
const LIGHT_HKD: Record<string, { role: string; name?: string; registration_number?: string; business_line?: string; business_address?: string }> = {
  household_business_license: { role: 'HOLDER', name: 'business_name', registration_number: 'registration_number', business_line: 'business_line', business_address: 'business_address' },
  local_business_confirmation: { role: 'HOLDER', business_line: 'business_line', business_address: 'business_address' },
  tax_payment_receipt: { role: 'TAXPAYER' },
  business_account_ledger: { role: 'HOLDER' },
  household_business_photo: { role: 'HOLDER' },
};

function collectMentions(lookup: Lookup, s3: MapDossierData | null, segment: string | null): Mention[] {
  const borrower = s3?.role_registry.find((p) => p.roles.includes('borrower'))?.person_id ?? null;
  const out: Mention[] = [];
  for (const e of lookup.evidences) {
    const data = e.data as Record<string, unknown>;
    const at = (path: string, v: unknown): Candidate | undefined => {
      const value = typeof v === 'number' ? v : text(v);
      return value === null ? undefined : { value, fact: lookup.factOf(e.evidence_id, path) };
    };
    const base = { evidence_id: e.evidence_id, doc_type_key: e.doc_type_key };

    if (e.doc_type_key === 'loan_application' && data.business_info && segment !== 'SME') {
      const b = data.business_info as Record<string, unknown>;
      const addr = (b.business_address as { full_text?: unknown } | null)?.full_text;
      out.push({
        ...base, key: e.evidence_id, owner: borrower ? { person_id: borrower, verification: 'UNVERIFIED' } : null,
        name: at('business_info.business_name', b.business_name), registration_number: at('business_info.registration_number', b.registration_number),
        tax_id: at('business_info.tax_id', b.tax_id), business_line: at('business_info.business_line', b.business_line),
        business_address: at('business_info.business_address.full_text', addr),
      });
    }

    const light = LIGHT_HKD[e.doc_type_key];
    if (light) {
      const parties = (data.parties as DocumentParty[] | undefined) ?? [];
      const subject = parties.find((p) => p.party_role === light.role);
      const mapped = subject ? lookup.personOf(e.evidence_id, subject.party_index) : undefined;
      const fields = (data.fields as Record<string, unknown> | undefined) ?? {};
      const field = (k?: string) => {
        if (!k) return undefined;
        const v = fields[k];
        return v && typeof v === 'object' ? at(`fields.${k}.full_text`, (v as { full_text?: unknown }).full_text) : at(`fields.${k}`, v);
      };
      const taxIndex = subject ? parties.indexOf(subject) : -1;
      out.push({
        ...base, key: e.evidence_id, owner: mapped ? { person_id: mapped.person_id, verification: verificationOf(mapped.matched_by) } : null,
        name: field(light.name), registration_number: field(light.registration_number), business_line: field(light.business_line),
        business_address: field(light.business_address), tax_id: subject && taxIndex >= 0 ? at(`parties[${taxIndex}].tax_id`, subject.tax_id) : undefined,
      });
    }

    if (e.doc_type_key === 'income_statement') {
      const rows = (data.income_sources as Array<Record<string, unknown>> | undefined) ?? [];
      rows.forEach((r, i) => {
        if (r.income_type !== 'household_business' || !r.household_business) return;
        const h = r.household_business as Record<string, unknown>;
        const mapped = typeof r.party_index === 'number' ? lookup.personOf(e.evidence_id, r.party_index) : undefined;
        const p = `income_sources[${i}].household_business`;
        out.push({
          ...base, key: `${e.evidence_id}#income_sources[${i}]`,
          owner: mapped ? { person_id: mapped.person_id, verification: 'UNVERIFIED' } : null,
          name: at(`${p}.business_name`, h.business_name), business_line: at(`${p}.business_line`, h.business_line),
          business_address: at(`${p}.actual_address.full_text`, (h.actual_address as { full_text?: unknown } | null)?.full_text),
        });
      });
    }
  }
  return out;
}

const numKeys = (ms: readonly Mention[]) => ({
  reg: new Set(ms.map((m) => (m.registration_number ? normKey(String(m.registration_number.value)) : null)).filter((x): x is string => !!x)),
  tax: new Set(ms.map((m) => (m.tax_id ? normIdNumber(String(m.tax_id.value)) : null)).filter((x): x is string => !!x)),
});
const ownersOf = (ms: readonly Mention[]) => new Set(ms.map((m) => m.owner?.person_id).filter((x): x is string => !!x));
const namesOf = (ms: readonly Mention[]) => ms.map((m) => m.name?.value).filter((x): x is string => typeof x === 'string');
const conflicts = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size > 0 && b.size > 0 && ![...a].some((x) => b.has(x));

export interface BusinessResult {
  units: BusinessUnit[];
  relations: ProfileRelation[];
  /** `Mention.key` → `business_id`. */
  unitOf: Map<string, string>;
}

export function buildBusinessUnits(lookup: Lookup, s3: MapDossierData | null, segment: string | null): BusinessResult {
  const mentions = collectMentions(lookup, s3, segment);
  let groups: Array<{ ms: Mention[]; flags: Set<BusinessFlag> }> = [];

  // L360-B01 (1): cùng số GCN hoặc cùng mã số thuế → một đơn vị.
  for (const m of mentions) {
    const k = numKeys([m]);
    const hit = groups.find((g) => { const gk = numKeys(g.ms); return [...k.reg].some((x) => gk.reg.has(x)) || [...k.tax].some((x) => gk.tax.has(x)); });
    if (hit && (k.reg.size > 0 || k.tax.size > 0)) hit.ms.push(m);
    else groups.push({ ms: [m], flags: new Set() });
  }

  // L360-B01 (2): cùng chủ + tên đơn vị EXACT → một đơn vị, trừ khi số khác nhau (AC-12: không gộp, gắn cờ cả hai). Một bên chưa biết chủ
  // (bảng kê không ghi party_index) thì coi là cùng chủ: tách đôi một HKD làm thu nhập bị cộng hai lần, nguy hiểm hơn gộp nhầm (D-114).
  const ownersCompatible = (a: Mention[], b: Mention[]) => {
    const oa = ownersOf(a); const ob = ownersOf(b);
    return oa.size === 0 || ob.size === 0 || [...oa].some((o) => ob.has(o));
  };
  const sameOwnerName = (a: Mention[], b: Mention[]) => ownersCompatible(a, b)
    && namesOf(a).some((x) => namesOf(b).some((y) => orgNameLevel(x, y) === 'EXACT'));
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) {
      if (!sameOwnerName(groups[i].ms, groups[j].ms)) continue;
      const a = numKeys(groups[i].ms); const b = numKeys(groups[j].ms);
      if (conflicts(a.reg, b.reg) || conflicts(a.tax, b.tax)) {
        groups[i].flags.add('BUSINESS_NUMBER_MISMATCH'); groups[j].flags.add('BUSINESS_NUMBER_MISMATCH');
        continue;
      }
      groups[i].ms.push(...groups[j].ms);
      groups[i].flags = new Set([...groups[i].flags, ...groups[j].flags]);
      groups.splice(j, 1);
      j = i;
    }
  }

  // L360-B01 (3): lần nhắc không số, không tên (ảnh, sổ sách, xác nhận địa phương…) → đơn vị DUY NHẤT của cùng chủ; nhiều ứng viên → cờ.
  const anonymous = (g: { ms: Mention[] }) => numKeys(g.ms).reg.size === 0 && numKeys(g.ms).tax.size === 0 && namesOf(g.ms).length === 0;
  const kept: typeof groups = [];
  for (const g of groups) {
    if (!anonymous(g)) { kept.push(g); continue; }
    const targets = groups.filter((o) => o !== g && !anonymous(o) && [...ownersOf(g.ms)].some((x) => ownersOf(o.ms).has(x)));
    if (targets.length === 1) targets[0].ms.push(...g.ms);
    else { if (targets.length > 1) g.flags.add('BUSINESS_MATCH_REVIEW'); kept.push(g); }
  }
  groups = kept;

  const units: BusinessUnit[] = [];
  const relations: ProfileRelation[] = [];
  const unitOf = new Map<string, string>();
  const order = new Map(mentions.map((m, i) => [m, i]));
  groups.sort((a, b) => Math.min(...a.ms.map((m) => order.get(m)!)) - Math.min(...b.ms.map((m) => order.get(m)!)));
  groups.forEach((g, i) => {
    const business_id = `biz-${i + 1}`;
    const ms = [...g.ms].sort((a, b) => order.get(a)! - order.get(b)!);
    for (const m of ms) unitOf.set(m.key, business_id);
    const pick = (f: 'name' | 'registration_number' | 'tax_id' | 'business_line' | 'business_address', mode: 'identity' | 'text', norm = normText) =>
      pickField(ms.map((m) => m[f]).filter((c): c is Candidate => !!c), mode, norm);
    const best = new Map<string, Verification>();
    for (const m of ms) {
      if (!m.owner) continue;
      const cur = best.get(m.owner.person_id);
      if (!cur || VERIFICATION_RANK[m.owner.verification] < VERIFICATION_RANK[cur]) best.set(m.owner.person_id, m.owner.verification);
    }
    for (const [person_id, verification] of best) relations.push({ type: 'OPERATES', from: person_id, to: business_id, verification });
    const docs = new Map<string, Set<string>>();
    for (const m of ms) docs.set(m.doc_type_key, (docs.get(m.doc_type_key) ?? new Set()).add(m.evidence_id));
    units.push({
      business_id, kind: 'HKD',
      name: pick('name', 'text'),
      registration_number: pick('registration_number', 'identity', (v) => normKey(String(v)) ?? ''),
      tax_id: pick('tax_id', 'identity', (v) => normIdNumber(String(v)) ?? ''),
      business_line: pick('business_line', 'text'),
      business_address: pick('business_address', 'text'),
      owner_person_ids: [...best.keys()],
      mentioned_in: [...docs].map(([doc_type_key, evs]) => ({ doc_type_key, count: evs.size })),
      flags: [...g.flags].sort(),
    });
  });
  return { units, relations, unitOf };
}
