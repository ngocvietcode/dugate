// T-S2-10 — bóc tách nhẹ (LIGHT), S2-R20.
import { loadDocTypes, loadLightExtraction } from '@/lib/loan-dossier/catalog';
import { lightPromptSpec, lightSchema, validateLight } from '@/lib/loan-dossier/s2/light';

import { FAKE_ID12, FAKE_NAME, makeAddress, makeLightData, makeParty } from './fixtures/build';

type Json = Record<string, unknown>;
const LIGHT_KEYS = loadDocTypes().filter((d) => d.extraction_level === 'LIGHT').map((d) => d.doc_type_key);

describe('bóc tách nhẹ (T-S2-10)', () => {
  it('20 loại LIGHT đều dựng được schema và nhận fixture; loại FULL → ném lỗi', () => {
    expect(LIGHT_KEYS).toHaveLength(20);
    for (const k of LIGHT_KEYS) {
      const r = lightSchema(k).safeParse(makeLightData(k));
      expect({ k, issues: r.success ? [] : r.error.issues }).toEqual({ k, issues: [] });
    }
    expect(() => lightSchema('id_card')).toThrow('UNKNOWN_DOC_TYPE');
    expect(() => lightSchema('khong_co')).toThrow('UNKNOWN_DOC_TYPE');
  });

  it('S2-AC14: GCN ĐKHKD → party HOLDER có tên + CCCD, fields đúng 4 key, business_address là Address', () => {
    const raw = {
      parties: [makeParty({ party_role: 'HOLDER', full_name: FAKE_NAME, id_number: FAKE_ID12 })],
      legal_info: null,
      fields: { registration_number: '01A8000000', business_name: 'HO KINH DOANH A', business_address: makeAddress(), business_line: 'BAN LE' },
    };
    const r = validateLight('household_business_license', raw);
    expect(r).toMatchObject({ status: 'SUCCESS', reason_code: null });
    const data = r.data as { parties: Json[]; fields: Json };
    expect(Object.keys(data.fields).sort()).toEqual(['business_address', 'business_line', 'business_name', 'registration_number']);
    expect(data.parties[0]).toMatchObject({ party_role: 'HOLDER', full_name: FAKE_NAME, id_number: FAKE_ID12 });
  });

  it('S2-AC15: ảnh HKD không thể hiện tên → SUCCESS, full_name null, REQUIRED_FIELD_UNREADABLE', () => {
    const raw = makeLightData('household_business_photo');
    ((raw.parties as Json[])[0]).full_name = null;
    const r = validateLight('household_business_photo', raw);
    expect(r.status).toBe('SUCCESS');
    expect(r.reason_code).toBe('REQUIRED_FIELD_UNREADABLE');
    expect(r.message).toBe('parties.0.full_name');
    expect(((r.data as { parties: Json[] }).parties[0]).full_name).toBeNull();
  });

  it('S2-R21: fields có key lạ → bỏ key lạ, SUCCESS; schema chặt vẫn từ chối', () => {
    const raw = makeLightData('household_business_license');
    (raw.fields as Json).extra_key = 'X';
    expect(lightSchema('household_business_license').safeParse(raw).success).toBe(false);
    const r = validateLight('household_business_license', raw);
    expect(r).toMatchObject({ status: 'SUCCESS', reason_code: null });
    expect((r.data as { fields: Json }).fields).not.toHaveProperty('extra_key');
  });

  it('S2-R21: fields thiếu key của loại → key đó null, SUCCESS', () => {
    const raw = makeLightData('household_business_license');
    delete (raw.fields as Json).business_line;
    expect(lightSchema('household_business_license').safeParse(raw).success).toBe(false);
    const r = validateLight('household_business_license', raw);
    expect(r.status).toBe('SUCCESS');
    expect((r.data as { fields: Json }).fields.business_line).toBeNull();
  });

  it('S2-R21: business_address dạng chuỗi → schema chặt từ chối; validateLight bỏ giá trị, FIELD_FORMAT_INVALID', () => {
    const raw = makeLightData('household_business_license');
    (raw.fields as Json).business_address = 'SO 1 DUONG A, HA NOI';
    expect(lightSchema('household_business_license').safeParse(raw).success).toBe(false);
    const r = validateLight('household_business_license', raw);
    expect(r).toMatchObject({ status: 'SUCCESS', reason_code: 'FIELD_FORMAT_INVALID', message: 'fields.business_address' });
    expect((r.data as { fields: Json }).fields.business_address).toBeNull();
    expect(r.message).not.toContain('HA NOI');
  });

  it('field TEXT không nhận số: schema chặt từ chối; validateLight để null, các field khác giữ nguyên', () => {
    const raw = makeLightData('payroll_bank_statement');
    (raw.fields as Json).statement_type = 123;
    expect(lightSchema('payroll_bank_statement').safeParse(raw).success).toBe(false);
    const r = validateLight('payroll_bank_statement', raw);
    expect(r).toMatchObject({ status: 'SUCCESS', reason_code: 'FIELD_FORMAT_INVALID' });
    expect((r.data as { fields: Json }).fields.statement_type).toBeNull();
    expect((r.data as { parties: Json[] }).parties).toHaveLength((raw.parties as Json[]).length);
  });

  it('party chủ thể sai party_role → bị từ chối; party khác đi kèm vẫn được (biên bản HĐTV)', () => {
    const wrong = makeLightData('household_business_license');
    ((wrong.parties as Json[])[0]).party_role = 'OWNER';
    expect(validateLight('household_business_license', wrong).status).toBe('ERROR');

    const minutes = makeLightData('board_meeting_minutes');
    (minutes.parties as Json[]).push(makeParty({ party_index: 1, party_role: 'OTHER', party_role_raw: 'Thành viên' }));
    expect(validateLight('board_meeting_minutes', minutes)).toMatchObject({ status: 'SUCCESS', reason_code: null });
  });

  it('party chủ thể sai party_type → bị từ chối', () => {
    const raw = makeLightData('enterprise_registration_license');
    ((raw.parties as Json[])[0]).party_type = 'INDIVIDUAL';
    expect(validateLight('enterprise_registration_license', raw).status).toBe('ERROR');
  });

  it('parties rỗng → ERROR; thiếu legal_info → legal_info null, SUCCESS (S2-R21)', () => {
    const empty = makeLightData('passport');
    empty.parties = [];
    expect(validateLight('passport', empty).status).toBe('ERROR');
    const noLegal = makeLightData('passport');
    delete noLegal.legal_info;
    const r = validateLight('passport', noLegal);
    expect(r.status).toBe('SUCCESS');
    expect((r.data as Json).legal_info).toBeNull();
  });

  it('message lỗi không chứa giá trị của data (PII, S2-R19)', () => {
    const raw = makeLightData('household_business_license');
    ((raw.parties as Json[])[0]).party_role = 'NGUYEN VAN B';
    const r = validateLight('household_business_license', raw);
    expect(r.status).toBe('ERROR');
    expect(r.message).not.toContain('NGUYEN VAN B');
  });

  it('prompt liệt kê đúng key fields và vai trò chủ thể của loại', () => {
    for (const light of loadLightExtraction()) {
      const p = lightPromptSpec(light.doc_type_key);
      expect(p).toContain(`party_role = ${light.subject_party_role}`);
      expect(p).toContain(`party_type = ${light.subject_party_type}`);
      for (const f of light.fields) expect(p).toContain(`- ${f.key} (`);
      expect((p.match(/^- /gm) ?? []).length).toBe(light.fields.length);
    }
  });
});
