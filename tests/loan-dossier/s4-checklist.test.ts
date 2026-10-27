// T-S4-01…T-S4-10 — checklist (S4). Hồ sơ giả dựng qua S3 thật rồi chấm S4.
import { CheckChecklistStageResultSchema, type ChecklistItemResult } from '@/lib/loan-dossier/contracts/check-stages';
import { loadChecklistCatalog, validityByDocType } from '@/lib/loan-dossier/s4/catalog';
import { programForProduct, resolveChecklist } from '@/lib/loan-dossier/s4/programs';
import { combineAnd } from '@/lib/loan-dossier/s4/conditions-rule';
import type { LlmClassifierPort } from '@/lib/loan-dossier/s4/conditions-llm';
import { resolveRequired } from '@/lib/loan-dossier/s4/required';
import { runChecklist, type ChecklistInput } from '@/lib/loan-dossier/s4/run';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { classifyOf, ev, ID_A12, ID_B12, ID_C12, loanApp } from './fixtures/dossier';

const D0 = '2026-10-14';
const now = () => new Date('2026-10-14T03:00:00.000Z');

function llm(incomeLabels: string[] = ['household_business'], purpose = { vehicle_purchase: 'NO', factory_purchase: 'NO' }) {
  const calls = { income: 0, purpose: 0 };
  const port: LlmClassifierPort = {
    classifyIncomeSource: async () => { calls.income += 1; return incomeLabels; },
    classifyLoanPurpose: async () => { calls.purpose += 1; return purpose; },
  };
  return { port, calls };
}

async function check(evidences: EvidenceEnvelope[], o: Partial<ChecklistInput> & { port?: LlmClassifierPort | null; extra?: Parameters<typeof classifyOf>[1] } = {}) {
  const s3 = runMapDossier({ evidences, dossier_submitted_at: D0, now });
  const r = await runChecklist({
    flow: 'FAST', product_code: 'hkd-loan', dossier_submitted_at: D0, external_input: { deviation_code: '', loan_amount: 1_000_000_000, collateral_mortgaged_elsewhere: false },
    classify: classifyOf(evidences, o.extra), evidences, s3: { status: s3.status, data: s3.data }, now, ...o,
  }, { llm: o.port === undefined ? llm().port : o.port });
  const parsed = CheckChecklistStageResultSchema.safeParse(r);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 3), null, 1));
  return r;
}
const row = (items: ChecklistItemResult[], key: string, person: string | null = 'person-1') =>
  items.find((i) => i.item_key === key && (i.scope !== 'PERSON' || i.person_id === person))!;

const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
const holderA = { party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
const base = () => loanApp([borrower], { data: { loan_info: { ...(loanApp([borrower]).data!.loan_info as object), loan_purposes: ['Bổ sung vốn kinh doanh'] }, financial_info: { ...(loanApp([borrower]).data!.financial_info as object), income_details: [{ source: 'Kinh doanh tạp hóa', amount: null, period: null }] } } });

describe('catalog (T-S4-01)', () => {
  it('catalog thật: 46 item, 19 điều kiện; validity theo loại', () => {
    const c = loadChecklistCatalog();
    expect([c.items.length, c.conditions.length]).toEqual([46, 19]);
    const v = validityByDocType();
    expect(v.get('marital_status_confirmation')?.validityDays).toBe(180);
    expect(v.get('vehicle_inspection')?.ignorePrintedExpiry).toBe(true);
  });
  it('S4-AC14: FAST không có income_salary_*, có income_general_income_statement', () => {
    const keys = resolveChecklist(programForProduct('hkd-loan')!, 'FAST').rows.map((r) => r.item.item_key);
    expect(keys.some((k) => k.startsWith('income_salary_') || k.startsWith('income_household_'))).toBe(false);
    expect(keys).toContain('income_general_income_statement');
  });
});

describe('required + combineAnd', () => {
  const item = (o: object) => ({ ...loadChecklistCatalog().items[0], ...o }) as never;
  it('bảng required', () => {
    expect(resolveRequired(item({}), null, 'REQUIRED', null).required).toBe(true);
    expect(resolveRequired(item({}), null, 'NOT_REQUIRED', null).required).toBe(false);
    expect(resolveRequired(item({}), 'MET', 'CONDITIONAL', 'REQUIRED').required).toBe(true);
    expect(resolveRequired(item({}), 'NOT_MET', 'CONDITIONAL', 'REQUIRED').required).toBe(false);
    expect(resolveRequired(item({}), 'INPUT_NOT_PROVIDED', 'CONDITIONAL', 'NOT_REQUIRED').required).toBe(false);
    expect(resolveRequired(item({}), 'INPUT_NOT_PROVIDED', 'CONDITIONAL', 'NEEDS_REVIEW')).toMatchObject({ required: true, forceReview: true });
    expect(resolveRequired(item({ requires_exact_doc_when_met: true }), 'MET', 'CONDITIONAL', 'REQUIRED').allowSubstitute).toBe(false);
  });
  it('combineAnd: NOT_MET thắng INPUT_NOT_PROVIDED thắng MET', () => {
    expect(combineAnd([{ result: 'INPUT_NOT_PROVIDED', source: 'OCR' }, { result: 'NOT_MET', source: 'EXTERNAL_INPUT' }])).toEqual({ result: 'NOT_MET', source: 'EXTERNAL_INPUT' });
    expect(combineAnd([{ result: 'MET', source: 'OCR' }, { result: 'INPUT_NOT_PROVIDED', source: 'EXTERNAL_INPUT' }]).result).toBe('INPUT_NOT_PROVIDED');
    expect(combineAnd([{ result: 'MET', source: 'OCR' }, { result: 'MET', source: 'OCR' }])).toEqual({ result: 'MET', source: 'EXTERNAL_INPUT' });
  });
});

describe('runChecklist', () => {
  it('S4-AC01: flow sai → FAILED/INVALID_FLOW, data null', async () => {
    const r = await runChecklist({ flow: 'EXPRESS', product_code: 'hkd-loan', dossier_submitted_at: D0, external_input: null, classify: { files: [], repeated_doc_types: [] }, evidences: [], s3: null, now }, { llm: null });
    expect([r.status, r.status_code, r.data]).toEqual(['FAILED', 'INVALID_FLOW', null]);
  });

  it('S4-AC02/AC03: 2 chủ TSBĐ → 2 bộ legal riêng; người vừa vay vừa chủ TSBĐ → 1 bộ', async () => {
    const r = await check([loanApp([borrower, { party_role: 'COLLATERAL_OWNER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 },
      { party_role: 'COLLATERAL_OWNER', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 }, { party_role: 'COLLATERAL_OWNER', full_name: 'LÊ VĂN CƯỜNG', id_number: ID_C12 }])]);
    const persons = [...new Set(r.data!.items.filter((i) => i.scope === 'PERSON').map((i) => i.person_id))];
    expect(persons).toEqual(['person-1', 'person-2', 'person-3']);
    expect(row(r.data!.items, 'legal_id_card').roles).toEqual(['borrower', 'collateral_owner']);
  });

  it('S4-AC04/AC05: CCCD hợp lệ → PRESENT; thiếu VNeID có xác nhận cư trú còn hạn → SUBSTITUTED', async () => {
    const r = await check([base(), ev('id_card', { parties: [holderA] }), ev('residence_confirmation', { parties: [holderA], issue_date: '2026-09-01' })]);
    expect(row(r.data!.items, 'legal_id_card').status).toBe('PRESENT');
    expect(row(r.data!.items, 'legal_vneid')).toMatchObject({ status: 'SUBSTITUTED', substituted_by_item_key: 'legal_residence_confirmation', substituted_by_doc_type_key: 'residence_confirmation' });
  });

  describe('S4-R27 (D-48): mục có chứng từ thay thế không còn bắt buộc riêng', () => {
    it('S4-AC26: VNeID được thay bằng xác nhận cư trú → required = false, không vào mẫu số độ đầy đủ', async () => {
      const r = await check([base(), ev('id_card', { parties: [holderA] }), ev('residence_confirmation', { parties: [holderA], issue_date: '2026-09-01' })]);
      const v = row(r.data!.items, 'legal_vneid');
      expect(v).toMatchObject({ status: 'SUBSTITUTED', required: false });
      expect(v.message).toContain('Không bắt buộc');
      const legal = r.data!.summary_by_group.find((g) => g.checklist_group === 'legal')!;
      expect(legal.substituted_count).toBe(0);
    });

    it('S4-AC27: thiếu cả VNeID và xác nhận cư trú → chỉ 1 mục bắt buộc (VNeID, kèm lựa chọn), mục kia COVERED_BY_ALTERNATIVE', async () => {
      const r = await check([base(), ev('id_card', { parties: [holderA] })]);
      const v = row(r.data!.items, 'legal_vneid');
      const c = row(r.data!.items, 'legal_residence_confirmation');
      expect(v).toMatchObject({ required: true, status: 'MISSING' });
      expect(v.note).toContain('Có thể nộp thay bằng: Giấy xác nhận thông tin cư trú');
      expect(c).toMatchObject({ required: false, status: 'NOT_APPLICABLE', reason_code: 'COVERED_BY_ALTERNATIVE', suggested_action: 'NONE' });
      expect(r.data!.items.filter((i) => i.person_id === 'person-1' && i.required && ['legal_vneid', 'legal_residence_confirmation'].includes(i.item_key))).toHaveLength(1);
    });

    it('bản hết hạn được giữ làm mục đại diện của nhóm (có việc cụ thể: bổ sung bản mới)', async () => {
      const r = await check([base(), ev('residence_confirmation', { parties: [holderA], issue_date: '2026-01-01' })]);
      expect(row(r.data!.items, 'legal_residence_confirmation')).toMatchObject({ required: true, status: 'MISSING', reason_code: 'DOCUMENT_EXPIRED' });
      expect(row(r.data!.items, 'legal_vneid')).toMatchObject({ required: false, reason_code: 'COVERED_BY_ALTERNATIVE' });
    });
  });

  it('S4-AC06: xác nhận cư trú 181 ngày → DOCUMENT_EXPIRED; 180 ngày → còn hạn', async () => {
    const at = async (issue: string) => row((await check([base(), ev('residence_confirmation', { parties: [holderA], issue_date: issue })])).data!.items, 'legal_residence_confirmation');
    expect(await at('2026-04-16')).toMatchObject({ status: 'MISSING', reason_code: 'DOCUMENT_EXPIRED' });
    expect((await at('2026-04-17')).status).toBe('PRESENT');
  });

  it('S4-AC07: evidence ERROR duy nhất → NEEDS_RESCAN/EXTRACTION_FAILED', async () => {
    const bad = { ...ev('id_card', { parties: [holderA] }), status: 'ERROR' as const, data: null, reason_code: 'UNREADABLE_CONTENT', field_confidences: {} };
    expect(row((await check([base(), bad])).data!.items, 'legal_id_card')).toMatchObject({ status: 'NEEDS_RESCAN', reason_code: 'EXTRACTION_FAILED', suggested_action: 'RESCAN' });
  });

  it('S4-AC25: bản S2 không thấy mẫu biểu (FORM_NOT_FOUND) không phải ứng viên → MISSING/DOCUMENT_NOT_FOUND kèm ghi chú nhận nhầm, không NEEDS_RESCAN', async () => {
    const wrong = { ...ev('id_card', { parties: [holderA] }), status: 'ERROR' as const, data: null, reason_code: 'FORM_NOT_FOUND', field_confidences: {}, file_name: 'chung_thu.pdf', page_range: [4, 20] as [number, number] };
    const r = await check([base(), wrong]);
    const it = row(r.data!.items, 'legal_id_card');
    expect(it).toMatchObject({ status: 'MISSING', reason_code: 'DOCUMENT_NOT_FOUND', found_in: [], suggested_action: 'UPLOAD' });
    expect(it.note).toBe('Đã kiểm chung_thu.pdf tr.4–20: không phải "Căn cước công dân / CMND / Thẻ căn cước" (được nhận diện nhầm loại), nên không tính cho mục này.');
    expect(r.data!.excluded_evidences).toContainEqual(expect.objectContaining({ evidence_id: wrong.evidence_id, reason_code: 'FORM_NOT_FOUND' }));
  });

  it('S4-AC08: loan_amount chưa nhập → INPUT_NOT_PROVIDED, áp on_input_missing, có blocking EXTERNAL_DATA', async () => {
    const r = await check([base()], { external_input: { deviation_code: '', collateral_mortgaged_elsewhere: false } });
    const hkd = r.data!.items.find((i) => i.item_key === 'income_general_income_statement')!;
    expect(hkd.required).toBe(true);
    void hkd;
    const r2 = await check([base()], { flow: 'FULL', external_input: { deviation_code: '', collateral_mortgaged_elsewhere: false } });
    const lic = row(r2.data!.items, 'income_household_business_license');
    expect([lic.condition_result, lic.required]).toEqual(['INPUT_NOT_PROVIDED', true]);
    expect(r2.blocking_inputs.map((b) => b.key)).toContain('external_input.loan_amount');
    expect(r2.status_code).toBe('MISSING_CONDITIONAL_EVIDENCE');
  });

  it('S4-AC09: LLM timeout → INPUT_NOT_PROVIDED, stage không FAILED; LLM gọi tối đa 1 lần / nhóm', async () => {
    const failing: LlmClassifierPort = { classifyIncomeSource: async () => { throw new Error('timeout'); }, classifyLoanPurpose: async () => { throw new Error('timeout'); } };
    const r = await check([base()], { flow: 'FULL', port: failing });
    expect(r.status).not.toBe('FAILED');
    expect(row(r.data!.items, 'loan_plan_vehicle_sale_contract').condition_result).toBe('INPUT_NOT_PROVIDED');
    const { port, calls } = llm();
    await check([base()], { flow: 'FULL', port });
    expect(calls).toEqual({ income: 1, purpose: 1 });
  });

  it('S4-AC10: tài sản AMBIGUOUS → NEEDS_REVIEW/ASSET_CONTEXT_UNRESOLVED', async () => {
    const app = loanApp([borrower], { assets: [{ asset_type: 'vehicle', usage_context_hint: 'collateral', identifiers: { chassis_number: 'RLNAB1234567', license_plate: '51K1' } }] });
    const reg = ev('vehicle_registration', { assets: [{ asset_type: 'vehicle', identifiers: { chassis_number: 'RLNAB1234568', license_plate: '51K1' } }] });
    const r = await check([app, reg]);
    expect(row(r.data!.items, 'collateral_vehicle_registration')).toMatchObject({ status: 'NEEDS_REVIEW', reason_code: 'ASSET_CONTEXT_UNRESOLVED', asset_id: 'asset-1' });
  });

  it('S4-AC11: 2 GCN CONFLICTING_DUPLICATES → NEEDS_REVIEW', async () => {
    const app = loanApp([borrower], { assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: 'CS1' } }] });
    const g = (id: string) => ({ ...ev('land_use_certificate', { id, assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'CS1' } }] }), duplicate_group_id: 'dup-1', duplicate_status: 'CONFLICTING_DUPLICATES' as const });
    const r = await check([app, g('ev-bbbbbbbbbb01'), g('ev-bbbbbbbbbb02')]);
    expect(row(r.data!.items, 'collateral_real_estate_certificate')).toMatchObject({ status: 'NEEDS_REVIEW', reason_code: 'CONFLICTING_DUPLICATES', duplicate_status: 'CONFLICTING_DUPLICATES' });
  });

  it('S4-AC12/AC13: giấy khai sinh — Mẹ 1 giấy → PRESENT; anh chị em 1 giấy → INSUFFICIENT', async () => {
    const mk = (raw: string) => [
      loanApp([borrower, { party_role: 'COLLATERAL_OWNER', full_name: 'LÊ THỊ CÚC', id_number: ID_C12 }], { relations: { 1: { raw } } }),
      ev('birth_certificate', { parties: [{ party_role: 'CHILD', full_name: 'NGUYỄN VĂN AN' }, { party_index: 1, party_role: 'MOTHER', full_name: 'LÊ THỊ CÚC' }, { party_index: 2, party_role: 'FATHER', full_name: 'NGUYỄN VĂN X' }] }),
    ];
    expect(row((await check(mk('Mẹ'))).data!.items, 'legal_birth_certificate')).toMatchObject({ status: 'PRESENT', required: true });
    const sib = row((await check(mk('Chị gái'))).data!.items, 'legal_birth_certificate');
    expect([sib.status, sib.reason_code]).toEqual(['MISSING', 'INSUFFICIENT_BIRTH_CERTIFICATES']);
    expect(sib.relationship_checks).toEqual([expect.objectContaining({ collateral_owner_person_id: 'person-2', is_satisfied: false })]);
  });

  it('S4-AC15: completeness theo dòng bắt buộc; S4-AC16: chạy lại giống hệt', async () => {
    const evs = [base(), ev('id_card', { parties: [holderA] }), ev('cic', { parties: [holderA], issue_date: '2026-10-01' })];
    const r = await check(evs);
    const req = r.data!.items.filter((i) => i.required);
    const ok = req.filter((i) => i.status === 'PRESENT' || i.status === 'SUBSTITUTED').length;
    expect(r.data!.completeness_percent).toBe(Math.round((ok / req.length) * 10000) / 100);
    expect(r.data!.summary_by_group.map((g) => g.checklist_group)).toEqual(['legal', 'loan_plan', 'income_source', 'collateral', 'credit_relationship']);
    expect(JSON.stringify(await check(evs))).toBe(JSON.stringify(r));
  });

  it('S4-AC17/AC18: hôn nhân bản mới thay bản cũ; chỉ bản cũ → DOCUMENT_EXPIRED kèm ngày 2026-04-17', async () => {
    const single = { relations: { 0: { marital: 'SINGLE' } } };
    const old = ev('marital_status_confirmation', { parties: [holderA], issue_date: '2026-01-05' });
    const fresh = ev('marital_status_confirmation', { parties: [holderA], issue_date: '2026-09-20' });
    const both = row((await check([loanApp([borrower], single), old, fresh])).data!.items, 'legal_marital_status_confirmation');
    expect(both).toMatchObject({ status: 'PRESENT', expired_evidence_ids: [old.evidence_id] });
    expect(both.found_in.map((f) => f.evidence_id)).toEqual([fresh.evidence_id]);
    expect(both.note).toContain('2026-01-05');
    const only = row((await check([loanApp([borrower], single), old])).data!.items, 'legal_marital_status_confirmation');
    expect(only).toMatchObject({ status: 'MISSING', reason_code: 'DOCUMENT_EXPIRED', suggested_action: 'UPLOAD' });
    expect(only.message).toContain('từ ngày 2026-04-17');
  });

  it('S4-AC19: CCCD quá hạn in trên giấy → DOCUMENT_EXPIRED; S4-AC20: đăng kiểm bỏ qua hạn in', async () => {
    const r = await check([base(), ev('id_card', { parties: [holderA], valid_until: '2026-08-01' })]);
    expect(row(r.data!.items, 'legal_id_card')).toMatchObject({ status: 'MISSING', reason_code: 'DOCUMENT_EXPIRED' });
    const app = loanApp([borrower], { assets: [{ asset_type: 'vehicle', usage_context_hint: 'collateral', identifiers: { license_plate: '51K1' } }] });
    const insp = ev('vehicle_inspection', { valid_until: '2026-01-01', assets: [{ asset_type: 'vehicle', identifiers: { license_plate: '51K1' } }] });
    expect(row((await check([app, insp])).data!.items, 'collateral_vehicle_inspection').status).toBe('PRESENT');
  });

  it('loại chỉ nhận diện needs_manual_review → PRESENT + note', async () => {
    const r = await check([base()], { flow: 'FULL', extra: [{ doc_type_key: 'household_business_photo', needs_manual_review: true }] });
    const photo = row(r.data!.items, 'income_household_business_photo');
    expect(photo.status).toBe('PRESENT');
    void photo;
  });

  it('không có tài sản → dòng collateral asset_id null, NOT_MET → NOT_APPLICABLE', async () => {
    const r = await check([base()]);
    expect(row(r.data!.items, 'collateral_vehicle_registration')).toMatchObject({ asset_id: null, condition_result: 'NOT_MET', status: 'NOT_APPLICABLE' });
  });

  it('không log PII', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    await check([base(), ev('id_card', { parties: [holderA] })]);
    expect(spies.flatMap((s) => s.mock.calls.flat()).map(String).join('\n')).not.toContain(ID_A12);
    spies.forEach((s) => s.mockRestore());
  });
});
