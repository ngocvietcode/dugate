// Ngày giờ thiếu múi giờ (VD report_datetime của CIC) không làm hỏng cả bản chứng từ.
import { DateTimeStringSchema, normalizeDateTime } from '@/lib/loan-dossier/s2/common-schema';
import { validateExtraction } from '@/lib/loan-dossier/s2/extractor-port';
import { makeParty } from './fixtures/build';

describe('S2 · chuẩn hóa ngày giờ', () => {
  it.each([
    ['2026-03-05T10:20:00+07:00', '2026-03-05T10:20:00+07:00'],
    ['2026-03-05T10:20:00Z', '2026-03-05T10:20:00Z'],
    ['2026-03-05T10:20:00', '2026-03-05T10:20:00+07:00'],
    ['2026-03-05 10:20', '2026-03-05T10:20:00+07:00'],
    ['2026-03-05T10:20:00.5+0700', '2026-03-05T10:20:00.5+07:00'],
    ['2026-03-05', '2026-03-05T00:00:00+07:00'],
    ['05/03/2026 10:20:30', '2026-03-05T10:20:30+07:00'],
    ['10:20:30 05/03/2026', '2026-03-05T10:20:30+07:00'],
    ['5/3/2026', '2026-03-05T00:00:00+07:00'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeDateTime(input)).toBe(expected);
    expect(DateTimeStringSchema.parse(input)).toBe(expected);
  });

  it('chuỗi không phải ngày giờ vẫn bị từ chối; null/khác chuỗi giữ nguyên', () => {
    expect(DateTimeStringSchema.safeParse('hôm qua').success).toBe(false);
    expect(DateTimeStringSchema.safeParse('2026-13-45T10:20:00').success).toBe(false);
    expect(normalizeDateTime(null)).toBeNull();
  });

  it('CIC: report_datetime không múi giờ → SUCCESS, lưu giá trị đã chuẩn hóa', () => {
    const party = makeParty({ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN A', id_number: '001234567890' });
    const report = {
      party_index: 0, report_datetime: '05/03/2026 10:20:30', cic_code: null, current_debt_group: 1, current_debt_group_raw: null,
      bad_debt_5y: { has_records: false, records_raw: null }, card_late_payment_3y: { has_records: false, records_raw: null },
      watchlist_debt_12m: { has_records: false, records_raw: null }, queried_institutions_1y_count: 0, queried_institutions: [],
    };
    const r = validateExtraction('cic', { form_found: true, data: { parties: [party], reports: [report], legal_info: null } });
    if (r.status !== 'SUCCESS') throw new Error(`${r.reason_code}: ${r.message}`);
    expect((r.data as { reports: Array<{ report_datetime: string }> }).reports[0].report_datetime).toBe('2026-03-05T10:20:30+07:00');
  });
});
