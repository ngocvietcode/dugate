// T-S1-03 — chia batch PDF và ghép segment (S1-R09).
import { mergeSegments, planBatches, type RawSegment } from '@/lib/loan-dossier/s1/batching';

const seg = (key: string, from: number, to: number, confidence: number, startsNew = true): RawSegment =>
  ({ doc_type_key: key, page_range: [from, to], confidence, starts_new_document: startsNew, summary: '', key_facts: [] });

describe('planBatches', () => {
  it('≤ 100 trang → 1 batch', () => {
    expect(planBatches(1)).toEqual([[1, 1]]);
    expect(planBatches(100)).toEqual([[1, 100]]);
  });

  it('101 trang → 6 batch, batch cuối [101,101]', () => {
    const b = planBatches(101);
    expect(b).toHaveLength(6);
    expect(b[0]).toEqual([1, 20]);
    expect(b[5]).toEqual([101, 101]);
  });

  it('130 trang → batch cuối [121,130]', () => {
    expect(planBatches(130).at(-1)).toEqual([121, 130]);
  });

  it('0 trang → []', () => {
    expect(planBatches(0)).toEqual([]);
  });
});

describe('mergeSegments', () => {
  it('ghép khi starts_new_document = false, confidence = min (S1-AC06: CCCD trang 19–22)', () => {
    const out = mergeSegments([[seg('loan_application', 1, 18, 0.9), seg('id_card', 19, 20, 0.95)], [seg('id_card', 21, 22, 0.85, false)]]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ doc_type_key: 'id_card', page_range: [19, 22], confidence: 0.85 });
  });

  it('không ghép khi starts_new_document = true', () => {
    const out = mergeSegments([[seg('id_card', 19, 20, 0.95)], [seg('id_card', 21, 22, 0.9, true)]]);
    expect(out.map((s) => s.page_range)).toEqual([[19, 20], [21, 22]]);
  });

  it('không ghép nếu khác doc_type_key', () => {
    const out = mergeSegments([[seg('id_card', 19, 20, 0.95)], [seg('vneid', 21, 22, 0.9, false)]]);
    expect(out).toHaveLength(2);
  });

  it('không ghép khi segment trước không chạm cuối batch', () => {
    const out = mergeSegments([[seg('id_card', 15, 18, 0.95), seg('cic', 19, 20, 0.9)], [seg('id_card', 21, 22, 0.9, false)]]);
    expect(out).toHaveLength(3);
  });

  it('văn bản trải qua 3 batch được ghép thành 1', () => {
    const out = mergeSegments([[seg('cic', 15, 20, 0.9)], [seg('cic', 21, 40, 0.8, false)], [seg('cic', 41, 45, 0.7, false)]]);
    expect(out).toEqual([seg('cic', 15, 45, 0.7)]);
  });
});
