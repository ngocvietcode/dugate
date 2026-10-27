// T-S2-08 — cổng gọi model trích xuất (S2-R04, R06, R09).
import { buildExtractPrompt, parseExtractorResponse, validateExtraction } from '@/lib/loan-dossier/s2/extractor-port';

import { makeFullData, makeLightData, makeParty } from './fixtures/build';

const resp = (data: unknown, extra: Record<string, unknown> = {}) => ({ form_found: true, data, field_confidences: {}, source_pages: {}, ...extra });

describe('validateExtraction', () => {
  it('raw hợp lệ → SUCCESS', () => {
    const r = validateExtraction('loan_application', resp(makeFullData('loan_application')));
    expect([r.status, r.reason_code]).toEqual(['SUCCESS', null]);
  });

  it('chuỗi JSON cũng nhận', () => {
    expect(validateExtraction('cic', JSON.stringify(resp(makeFullData('cic')))).status).toBe('SUCCESS');
  });

  it('S2-AC03: model báo không thấy mẫu → ERROR/FORM_NOT_FOUND, data null', () => {
    const r = validateExtraction('id_card', { form_found: false, data: null });
    expect(r).toMatchObject({ status: 'ERROR', reason_code: 'FORM_NOT_FOUND', data: null });
  });

  it('S2-R21: thiếu field bắt buộc nhưng cho null → field đó null, SUCCESS', () => {
    const { legal_info: _drop, ...data } = makeFullData('id_card');
    const r = validateExtraction('id_card', resp(data));
    expect(r.status).toBe('SUCCESS');
    expect(r.data?.legal_info).toBeNull();
  });

  it('data không cứu được (không phải object) → ERROR/UNREADABLE_CONTENT, thông báo không chứa giá trị', () => {
    const r = validateExtraction('id_card', resp('NGUYEN VAN A'));
    expect(r).toMatchObject({ status: 'ERROR', reason_code: 'UNREADABLE_CONTENT', data: null });
    expect(r.message).not.toContain('NGUYEN');
  });

  it('phản hồi hỏng → ERROR/UNREADABLE_CONTENT', () => {
    expect(validateExtraction('id_card', '{oops').reason_code).toBe('UNREADABLE_CONTENT');
    expect(validateExtraction('id_card', { data: {} }).reason_code).toBe('UNREADABLE_CONTENT');
  });

  it('S2-AC04: id_number null ở id_card → SUCCESS + REQUIRED_FIELD_UNREADABLE', () => {
    const data = makeFullData('id_card');
    data.parties = [makeParty({ id_number: null })];
    const r = validateExtraction('id_card', resp(data));
    expect(r).toMatchObject({ status: 'SUCCESS', reason_code: 'REQUIRED_FIELD_UNREADABLE', message: 'parties.0.id_number' });
  });

  it('loại LIGHT đi qua validateLight', () => {
    expect(validateExtraction('household_business_license', resp(makeLightData('household_business_license'))).status).toBe('SUCCESS');
    const bad = { ...makeLightData('household_business_license'), fields: { lạ: 'x' } };
    const r = validateExtraction('household_business_license', resp(bad));
    expect(r.status).toBe('SUCCESS');
    expect((r.data as { fields: Record<string, unknown> }).fields).not.toHaveProperty('lạ');
  });
});

describe('parseExtractorResponse', () => {
  it('confidence mảng → min; trang đơn → mảng; null bị bỏ', () => {
    const r = parseExtractorResponse(resp({}, { field_confidences: { parties: [0.9, 0.6] }, source_pages: { parties: 2, assets: null, legal_info: [3, 2] } }));
    expect(r.field_confidences.parties).toBe(0.6);
    expect(r.source_pages).toEqual({ parties: [2], legal_info: [2, 3] });
  });
});

describe('buildExtractPrompt', () => {
  it('S1-R18 / S1-AC12: loại có dấu hiệu nhận biết thì gửi kèm cho extractor; loại không có thì không', () => {
    expect(buildExtractPrompt('real_estate_valuation_report', [4, 20])).toContain('Dấu hiệu nhận biết mẫu này: Do Công ty TNHH Thịnh Điền lập');
    expect(buildExtractPrompt('external_valuation_certificate', [4, 20])).toContain('không phải Thịnh Điền');
    expect(buildExtractPrompt('id_card', [1, 2])).not.toContain('Dấu hiệu nhận biết');
  });
  it('D-63 / S2-R22: ô chọn — chỉ lấy ô đã đánh dấu; giấy đề nghị vay có quy tắc tình trạng hôn nhân, không mặc định "Đã kết hôn"', () => {
    const app = buildExtractPrompt('loan_application', [1, 6]);
    expect(app).toContain('CHỈ lấy ô ĐÃ ĐÁNH DẤU');
    expect(app).toContain('đối chiếu dấu với đúng nhãn đứng ngay bên cạnh ô');
    expect(app).toContain('Ly hôn → DIVORCED');
    expect(app).toContain('Ly thân hoặc không thấy ô nào đánh dấu → null');
    expect(app).toContain('KHÔNG mặc định "Đã kết hôn"');
    // quy tắc chung về ô chọn áp dụng cho mọi loại; quy tắc riêng chỉ ở giấy đề nghị vay
    expect(buildExtractPrompt('id_card', [1, 2])).toContain('CHỈ lấy ô ĐÃ ĐÁNH DẤU');
    expect(buildExtractPrompt('id_card', [1, 2])).not.toContain('KHÔNG mặc định "Đã kết hôn"');
  });
  it('FULL kèm JSON Schema của loại; LIGHT kèm đặc tả nhẹ; không có tham số tên file', () => {
    expect(buildExtractPrompt.length).toBe(2);
    const full = buildExtractPrompt('loan_application', [1, 6]);
    expect(full).toContain('bank_proposed_amount');
    expect(full).toContain('section_pages');
    expect(full).toContain('interest_rate_code');
    const light = buildExtractPrompt('household_business_license', [1, 1]);
    expect(light).toContain('registration_number');
    expect(light).not.toContain('section_pages');
  });

  it('GCN có quy tắc chủ sở hữu trang biến động', () => {
    expect(buildExtractPrompt('land_use_certificate', [1, 4])).toContain('trang biến động');
    expect(buildExtractPrompt('id_card', [1, 2])).not.toContain('trang biến động');
  });
});
