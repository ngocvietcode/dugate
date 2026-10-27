// Đánh giá điều kiện bằng rule (T-S4-03; S4-R10, R11, R12). Theo đúng `logic` trong checklist_catalog.json.
import { normIdNumber } from '../common/normalize';
import { evidencePersons, type Asset, type ChecklistContext, type ConditionResult, type ConditionSource } from './context';
import type { SemanticResults } from './conditions-llm';

export interface ConditionOutcome {
  result: ConditionResult;
  source: ConditionSource;
}

export const RULE_CONDITIONS = [
  'person_is_married', 'person_is_not_married', 'person_has_multiple_id_numbers', 'same_person_commitment_required',
  'collateral_owner_differs_from_person', 'deviation_code_present', 'loan_amount_over_3_billion', 'collateral_vehicle_present',
  'collateral_real_estate_present', 'rental_vehicle_present', 'rental_real_estate_present', 'collateral_mortgaged_elsewhere',
] as const;

const PROPERTY = new Set(['real_estate', 'apartment']);
const negate = (r: ConditionResult): ConditionResult => (r === 'MET' ? 'NOT_MET' : r === 'NOT_MET' ? 'MET' : r);

function personIsMarried(ctx: ChecklistContext, personId: string | null): ConditionResult {
  const usable = ctx.evidences.filter((e) => e.status === 'SUCCESS' && !ctx.superseded.has(e.evidence_id));
  const persons = evidencePersons(ctx.s3);
  const mine = (docType: string) => usable.some((e) => e.doc_type_key === docType
    && (personId === null || (persons.get(e.evidence_id) ?? []).some((x) => x.person_id === personId)));
  if (personId !== null) {
    const ms = ctx.s3?.customer_360.find((c) => c.person_id === personId)?.marital_status ?? null;
    if (ms === 'MARRIED') return 'MET';
    if (ms !== null) return 'NOT_MET';
  }
  if (mine('marriage_certificate')) return 'MET';
  if (mine('marital_status_confirmation')) return 'NOT_MET';
  return 'INPUT_NOT_PROVIDED';
}

function multipleIds(ctx: ChecklistContext, personId: string | null): ConditionResult {
  const p = personId ? ctx.s3?.role_registry.find((x) => x.person_id === personId) : undefined;
  if (!p) return 'INPUT_NOT_PROVIDED';
  const ids = new Set([p.declared_id_number, p.current_id_number, ...p.historical_id_numbers, ...p.observed_id_numbers]
    .map((n) => normIdNumber(n)).filter((n): n is string => n !== null));
  return ids.size >= 2 ? 'MET' : 'NOT_MET';
}

function ownerDiffers(ctx: ChecklistContext, personId: string | null): ConditionResult {
  if (!personId || !ctx.s3) return 'INPUT_NOT_PROVIDED';
  const p = ctx.s3.role_registry.find((x) => x.person_id === personId);
  if (!p) return 'INPUT_NOT_PROVIDED';
  const spouse = ctx.s3.customer_360.find((c) => c.person_id === personId)?.spouse_person_id ?? null;
  const isMain = p.roles.includes('borrower') || p.roles.includes('co_borrower');
  if (!isMain || p.roles.includes('collateral_owner')) return 'NOT_MET';
  const owners = ctx.s3.role_registry.filter((q) => q.person_id !== personId && q.roles.includes('collateral_owner'));
  const nonSpouse = owners.some((q) => q.person_id !== spouse && !ctx.s3!.relationship_verifications.some((r) =>
    r.subject_person_id === personId && r.collateral_owner_person_id === q.person_id && r.relationship_type === 'SPOUSE'));
  return nonSpouse ? 'MET' : 'NOT_MET';
}

/** Điều kiện theo từng tài sản: tài sản khớp (loại, ngữ cảnh) → MET; dòng không có tài sản → NOT_MET. */
export function assetCondition(id: string, asset: Asset | null): ConditionResult {
  if (!asset) return 'NOT_MET';
  const vehicle = asset.asset_type === 'vehicle';
  const property = PROPERTY.has(asset.asset_type);
  const ctxs = asset.usage_contexts as string[];
  switch (id) {
    case 'collateral_vehicle_present': return vehicle && ctxs.includes('collateral') ? 'MET' : 'NOT_MET';
    case 'collateral_real_estate_present': return property && ctxs.includes('collateral') ? 'MET' : 'NOT_MET';
    case 'rental_vehicle_present': return vehicle && ctxs.includes('rental_income') ? 'MET' : 'NOT_MET';
    case 'rental_real_estate_present': return property && ctxs.includes('rental_income') ? 'MET' : 'NOT_MET';
    default: throw new Error(`không phải điều kiện tài sản: ${id}`);
  }
}

export function combineAnd(parts: ConditionOutcome[]): ConditionOutcome {
  const notMet = parts.find((p) => p.result === 'NOT_MET');
  if (notMet) return notMet;
  const missing = parts.find((p) => p.result === 'INPUT_NOT_PROVIDED');
  if (missing) return missing;
  return { result: 'MET', source: 'EXTERNAL_INPUT' };
}

/**
 * Điều kiện mức người/hồ sơ (không gồm điều kiện theo tài sản — xem `assetCondition`). `personId = null` ở chế độ
 * dự phòng. `semantic` là kết quả LLM đã tính một lần (T-S4-04).
 */
export function evaluateCondition(id: string, ctx: ChecklistContext, personId: string | null, semantic: SemanticResults): ConditionOutcome {
  const ocr = (result: ConditionResult): ConditionOutcome => ({ result, source: 'OCR' });
  const ext = (result: ConditionResult): ConditionOutcome => ({ result, source: 'EXTERNAL_INPUT' });
  switch (id) {
    case 'person_is_married': return ocr(personIsMarried(ctx, personId));
    case 'person_is_not_married': return ocr(negate(personIsMarried(ctx, personId)));
    case 'person_has_multiple_id_numbers': return ocr(ctx.subjectMapping ? multipleIds(ctx, personId) : 'INPUT_NOT_PROVIDED');
    case 'same_person_commitment_required': {
      if (!ctx.subjectMapping || personId === null) return ocr(ctx.flow === 'FULL' ? 'MET' : 'INPUT_NOT_PROVIDED');
      const p = ctx.s3?.role_registry.find((x) => x.person_id === personId);
      if (ctx.flow === 'FULL' && p && (p.roles.includes('borrower') || p.roles.includes('co_borrower'))) return ocr('MET');
      return ocr(multipleIds(ctx, personId));
    }
    case 'collateral_owner_differs_from_person': return ocr(ownerDiffers(ctx, personId));
    case 'deviation_code_present': {
      const v = ctx.external?.deviation_code;
      if (v === undefined || v === null) return ext('INPUT_NOT_PROVIDED');
      return ext(v.trim() === '' ? 'NOT_MET' : 'MET');
    }
    case 'loan_amount_over_3_billion': {
      const v = ctx.external?.loan_amount;
      if (v === undefined || v === null) return ext('INPUT_NOT_PROVIDED');
      return ext(v > 3_000_000_000 ? 'MET' : 'NOT_MET');
    }
    case 'collateral_mortgaged_elsewhere': {
      const v = ctx.external?.collateral_mortgaged_elsewhere;
      if (v === undefined || v === null) return ext('INPUT_NOT_PROVIDED');
      return ext(v ? 'MET' : 'NOT_MET');
    }
    case 'household_business_license_required':
      return combineAnd([evaluateCondition('income_source_household_business', ctx, personId, semantic), evaluateCondition('loan_amount_over_3_billion', ctx, personId, semantic)]);
    case 'loan_purpose_vehicle_purchase':
    case 'loan_purpose_factory_purchase':
    case 'income_source_salary':
    case 'income_source_rental':
    case 'income_source_household_business':
    case 'income_source_enterprise':
      return ocr(semantic[id]);
    default:
      throw new Error(`điều kiện lạ: ${id}`);
  }
}
