// T-S1-04 — hậu xử lý kết quả model (S1-R03, R04, R06, R07, R14).
import { postprocess, type RawMatch } from '@/lib/loan-dossier/s1/postprocess';

const match = (key: string, ...confs: number[]): RawMatch => ({
  doc_type_key: key,
  confidence: Math.min(...confs),
  instances: confs.map((c, i) => ({ page_range: [i * 2 + 1, i * 2 + 2], confidence: c })),
});
const run = (matches: RawMatch[], hint: string | null = null) => postprocess({ page_quality: 'OK', matches }, hint);

describe('postprocess', () => {
  it('ngưỡng: 0.80 nhận không review; 0.79 nhận có review; 0.49 loại', () => {
    expect(run([match('id_card', 0.8)]).matches[0]).toMatchObject({ confidence: 0.8, needs_manual_review: false });
    expect(run([match('id_card', 0.79)]).matches[0]).toMatchObject({ confidence: 0.79, needs_manual_review: true });
    expect(run([match('id_card', 0.49)]).matches).toEqual([]);
  });

  it('S1-AC04: instance 0.65 → match needs_manual_review', () => {
    const m = run([match('id_card', 0.95, 0.65)]).matches[0];
    expect(m).toMatchObject({ confidence: 0.65, needs_manual_review: true, instances_count: 2 });
  });

  it('instance < 0.50 bị bỏ, instance còn lại đánh lại số', () => {
    const m = run([match('id_card', 0.3, 0.9)]).matches[0];
    expect(m.instances).toEqual([{ instance_index: 1, page_range: [3, 4], confidence: 0.9, summary: '', key_facts: [] }]);
    expect(m.instances_count).toBe(1);
  });

  it('hết match → UNKNOWN/UNCLASSIFIED', () => {
    const r = run([match('id_card', 0.2)]);
    expect(r).toMatchObject({ status: 'UNKNOWN', reason_code: 'UNCLASSIFIED', next_action: null, matches: [] });
  });

  it('page_quality EMPTY / LOW_QUALITY → mã tương ứng', () => {
    expect(postprocess({ page_quality: 'EMPTY', matches: [] }, null).reason_code).toBe('EMPTY_OR_UNREADABLE');
    expect(postprocess({ page_quality: 'LOW_QUALITY', matches: [] }, null).reason_code).toBe('LOW_QUALITY_UNREADABLE');
  });

  it('2 match cùng doc_type_key → còn 1 (giữ confidence cao)', () => {
    const r = run([match('id_card', 0.7), match('id_card', 0.9)]);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].confidence).toBe(0.9);
  });

  it('S1-AC05: 2 CCCD trong file 4 trang → 1 match, 2 instance [1,2] [3,4]', () => {
    const m = run([match('id_card', 0.95, 0.93)]).matches[0];
    expect(m.instances_count).toBe(2);
    expect(m.instances.map((i) => i.page_range)).toEqual([[1, 2], [3, 4]]);
    // D-70 (S1-R07): chỉ các field khai báo; không có field tự do kiểu tên / vai trò ngoài key_facts.
    expect(Object.keys(m.instances[0]).sort()).toEqual(['confidence', 'instance_index', 'key_facts', 'page_range', 'summary']);
  });

  it('needs_extraction tra catalog, bỏ qua giá trị model', () => {
    const raw = { ...match('deposit_certificate', 0.9), needs_extraction: true } as RawMatch;
    const r = run([match('id_card', 0.9), raw]);
    expect(r.matches.find((m) => m.doc_type_key === 'id_card')!.needs_extraction).toBe(true);
    expect(r.matches.find((m) => m.doc_type_key === 'deposit_certificate')!.needs_extraction).toBe(false);
  });

  it('hint_mismatch: S1-AC09 hint collateral nhưng là CCCD', () => {
    expect(run([match('id_card', 0.9)], 'collateral').matches[0]).toMatchObject({ doc_type_key: 'id_card', hint_mismatch: true });
    expect(run([match('id_card', 0.9)], 'legal').matches[0].hint_mismatch).toBe(false);
    expect(run([match('id_card', 0.9)], null).matches[0].hint_mismatch).toBe(false);
  });

  it('doc_type_key ngoài catalog → bị loại', () => {
    expect(run([match('passport_xyz', 0.99)])).toMatchObject({ status: 'UNKNOWN', matches: [] });
  });
});
