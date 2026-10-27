// S2-R21 / S2-AC16 — kiểm schema mềm: 1 field sai định dạng không làm hỏng cả bản chứng từ.
import { z } from 'zod';

import { docTypeByKey } from '@/lib/loan-dossier/catalog';
import { ExtractStageResultSchema, type ClassifyData } from '@/lib/loan-dossier/contracts/stage-result';
import { validateExtraction } from '@/lib/loan-dossier/s2/extractor-port';
import { runExtract, type ExtractPorts } from '@/lib/loan-dossier/s2/run';
import { parseWithSalvage } from '@/lib/loan-dossier/s2/salvage';

import { makeFullData, makeLightData, makeParty } from './fixtures/build';

type Json = Record<string, unknown>;
const resp = (data: unknown, extra: Json = {}) => ({ form_found: true, data, field_confidences: {}, source_pages: {}, ...extra });

describe('parseWithSalvage', () => {
  const Schema = z.object({
    name: z.string().nullable(),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    tags: z.array(z.string()),
    info: z.object({ a: z.string().nullable(), b: z.boolean() }).strict(),
    items: z.array(z.object({ k: z.enum(['X', 'Y']), v: z.string().nullable() }).strict()).min(1),
  }).strict();
  const good = { name: 'A', dob: '2000-01-02', tags: ['t'], info: { a: 'x', b: true }, items: [{ k: 'X', v: '1' }] };

  it('hợp lệ → giữ nguyên, invalid_fields rỗng', () => {
    expect(parseWithSalvage(Schema, good)).toEqual({ success: true, data: good, invalid_fields: [] });
  });

  it('field sai định dạng → null, các field khác giữ nguyên', () => {
    const r = parseWithSalvage(Schema, { ...good, dob: '02/01/2000' });
    expect(r).toEqual({ success: true, data: { ...good, dob: null }, invalid_fields: ['dob'] });
  });

  it('mảng không nhận null → []; phần tử mảng sai → bỏ phần tử', () => {
    const r = parseWithSalvage(Schema, { ...good, tags: 'abc', items: [{ k: 'Z', v: '1' }, { k: 'Y', v: '2' }] });
    if (!r.success) throw new Error('phải cứu được');
    expect(r.data).toEqual({ ...good, tags: [], items: [{ k: 'Y', v: '2' }] });
    expect(r.invalid_fields).toEqual(expect.arrayContaining(['tags', 'items.0']));
  });

  it('field thiếu → null không tính là sai; key lạ bị bỏ', () => {
    const { name: _n, ...rest } = good;
    const r = parseWithSalvage(Schema, { ...rest, extra: 1 });
    expect(r).toEqual({ success: true, data: { ...good, name: null }, invalid_fields: [] });
  });

  it('không cứu được ở cấp gốc → lỗi (mảng min(1) rỗng hết, data không phải object)', () => {
    expect(parseWithSalvage(Schema, { ...good, items: [{ k: 'Z', v: null }] }).success).toBe(false);
    expect(parseWithSalvage(Schema, 'abc').success).toBe(false);
  });
});

describe('validateExtraction với schema mềm (S2-AC16)', () => {
  it('CIC: report_datetime không parse được → chỉ field đó null, bản CIC vẫn SUCCESS/FIELD_FORMAT_INVALID', () => {
    const data = makeFullData('cic');
    const reports = data.reports as Json[];
    reports[0] = { ...reports[0], report_datetime: 'sáng hôm qua' };
    const r = validateExtraction('cic', resp(data));
    expect(r).toMatchObject({ status: 'SUCCESS', reason_code: 'FIELD_FORMAT_INVALID', message: 'reports.0.report_datetime' });
    expect(((r.data!.reports as Json[])[0]).report_datetime).toBeNull();
    expect(r.message).not.toContain('hôm qua');
  });

  it('enum một giá trị: CIC party_role BORROWER → HOLDER (schema cố định), không tính là sai', () => {
    const data = makeFullData('cic');
    (data.parties as Json[])[0].party_role = 'BORROWER';
    const r = validateExtraction('cic', resp(data));
    expect(r).toMatchObject({ status: 'SUCCESS', reason_code: null });
    expect((r.data!.parties as Json[])[0].party_role).toBe('HOLDER');
  });

  it('party thiếu nhiều field DocumentParty (lỗi GCN ĐKHKD trước khi sửa prompt) → SUCCESS, party_index theo vị trí', () => {
    const data = makeLightData('household_business_license');
    const party = (data.parties as Json[])[0];
    for (const k of ['party_index', 'date_of_birth', 'permanent_address', 'phone_number', 'previous_id_numbers']) delete party[k];
    party.id_type = 'GIAY_PHEP';
    const r = validateExtraction('household_business_license', resp(data));
    expect(r.status).toBe('SUCCESS');
    const p = (r.data!.parties as Json[])[0];
    expect(p).toMatchObject({ party_index: 0, date_of_birth: null, permanent_address: null, id_type: null, previous_id_numbers: [] });
    expect(p.full_name).toBe(party.full_name);
    expect(r.reason_code).toBe('FIELD_FORMAT_INVALID');
    expect(r.message).toContain('parties.0.id_type');
  });

  it('CCCD: số CMND cũ sai định dạng → bỏ đúng số đó; định danh vẫn đọc được', () => {
    const data = makeFullData('id_card');
    data.parties = [makeParty({ previous_id_numbers: ['12-34'] })];
    const r = validateExtraction('id_card', resp(data));
    expect(r).toMatchObject({ status: 'SUCCESS', reason_code: 'FIELD_FORMAT_INVALID' });
    expect((r.data!.parties as Json[])[0].previous_id_numbers).toEqual([]);
  });

  it('định danh bắt buộc null + field sai định dạng → REQUIRED_FIELD_UNREADABLE, message nêu cả hai', () => {
    const data = makeFullData('id_card');
    data.parties = [makeParty({ id_number: 'abc', date_of_birth: '1/1/90' })];
    const r = validateExtraction('id_card', resp(data));
    expect(r.reason_code).toBe('REQUIRED_FIELD_UNREADABLE');
    expect(r.message).toContain('parties.0.id_number');
    expect(r.message).toContain('parties.0.date_of_birth');
  });

  it('metadata sai kiểu (confidence > 1, trang chữ) bị bỏ, không làm hỏng phản hồi', () => {
    const r = validateExtraction('cic', resp(makeFullData('cic'), {
      field_confidences: { parties: 1.5, reports: 0.9 }, source_pages: { parties: 'một' }, detected_form_name: 12, form_found: 'true',
    }));
    expect(r.status).toBe('SUCCESS');
  });
});

describe('runExtract: field sai định dạng → confidence field cấp 1 ≤ 0.5', () => {
  it('reports chứa ngày giờ hỏng → field_confidences.reports = 0.5, evidence hợp lệ theo hợp đồng', async () => {
    const FILE = 'file-00000000000c';
    const classify: ClassifyData = {
      files: [{
        file_id: FILE, file_name: 'cic.pdf', status: 'CLASSIFIED', reason_code: null, next_action: null, message: null, page_count: 3,
        matches: [{
          doc_type_key: 'cic', confidence: 0.9, needs_manual_review: false, needs_extraction: docTypeByKey('cic')!.needs_extraction,
          instances_count: 1, hint_mismatch: false, instances: [{ instance_index: 1, page_range: [1, 3], confidence: 0.9, summary: '', key_facts: [] }],
        }],
      }],
      repeated_doc_types: [],
    };
    const data = makeFullData('cic');
    (data.reports as Json[])[0].report_datetime = 'không rõ';
    const ports: ExtractPorts = {
      readFile: async () => ({ content: Buffer.from('%PDF-1.4'), mime: 'application/pdf', page_count: 3 }),
      extractor: { extract: async () => resp(data, { field_confidences: { parties: 0.95, reports: 0.95, legal_info: 0.95 } }) },
      now: () => new Date('2026-10-19T02:00:00.000Z'),
    };
    const r = await runExtract(classify, ports);
    const ev = r.data!.evidences[0];
    expect([ev.status, ev.reason_code]).toEqual(['SUCCESS', 'FIELD_FORMAT_INVALID']);
    expect(ev.field_confidences.reports).toBe(0.5);
    expect(ev.field_confidences.parties).toBe(0.95);
    expect(ExtractStageResultSchema.safeParse(r).success).toBe(true);
  });
});
