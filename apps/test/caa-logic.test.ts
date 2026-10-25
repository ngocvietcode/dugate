import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyDecision, decisionViolation, emptyOverrides, merge, reconcile, reviewTasks, type Resolution }
  from '../src/credit-appraisal-assist/merge';
import { buildVerifyContext, numberAllowed, parseConclusions, readings, verifyConclusion } from '../src/credit-appraisal-assist/verify';
import { type Lac, LacSchema } from '../src/generated/lac.zod';
import type { DecisionInput } from '../src/platform/workflow-kit';

const load = (n: string): Lac => LacSchema.parse(JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'credit-kit', 'contracts', 'examples', `${n}.lac.json`), 'utf8')));
const income = load('hkd_income_x12');
const forms = load('hkd_forms_plan_role');
const actor = { userId: 'cv02', roles: ['CREDIT_APPRAISER'] };
const dec = (taskId: string, d: Partial<DecisionInput>): DecisionInput =>
  ({ taskId, action: 'CONFIRM', reason: 'đã kiểm', actor, at: '2026-10-25T00:00:00Z', ...d });

describe('verify (FR-22, FR-23)', () => {
  const ctx = buildVerifyContext(income);

  it('đọc số định dạng VN', () => {
    expect(readings('1.670.000.000').map((r) => r.value)).toContain(1670000000);
    expect(readings('69,98%').map((r) => r.value)).toEqual(expect.arrayContaining([69.98, 0.6998]));
    expect(readings('0.5333').map((r) => r.value)).toContain(0.5333);
    expect(numberAllowed('1,5', 1e9, ctx.numbers)).toBe(true);   // "1,5 tỷ" = doanh thu
    expect(numberAllowed('1,6', 1e9, ctx.numbers)).toBe(true);    // giá trị TSBĐ
    expect(numberAllowed('1,7', 1e9, ctx.numbers)).toBe(false);
  });

  it('nhận kết luận trích đúng mã, đúng số', () => {
    const k = { id: 'K1', text: 'Lợi nhuận năm 300.000.000 (F37) mâu thuẫn với thu nhập khai X01; số vay/doanh thu 0,5333 (M-LOAN-REVENUE).',
      fields: ['F37', 'F65'], conflicts: ['X01'], signals: ['T2'] };
    expect(verifyConclusion(k, ctx)).toEqual([]);
  });

  it('loại kết luận bịa số, trích mã sai, đề xuất cho vay', () => {
    const bad = { id: 'K2', text: 'Doanh thu 2,1 tỷ (F99), đề xuất cho vay.', fields: ['F99'], conflicts: ['X77'], signals: [] };
    const why = verifyConclusion(bad, ctx).join(' | ');
    expect(why).toMatch(/F99 không tồn tại/);
    expect(why).toMatch(/X77/);
    expect(why).toMatch(/con số 2,1/);
    expect(why).toMatch(/đề xuất quyết định/);
  });

  it('loại ngày không có trong LAC; chấp nhận ngày có', () => {
    const d = income.documents.find((x) => x.date)!.date!;
    const ok = { id: 'K3', text: `Chứng từ lập ${d}.`, fields: ['F37'], conflicts: [], signals: [] };
    const bad = { ...ok, text: 'Chứng từ lập 2019-01-01.' };
    expect(verifyConclusion(ok, ctx)).toEqual([]);
    expect(verifyConclusion(bad, ctx).join()).toMatch(/ngày 2019-01-01/);
  });

  it('đơn vị tỷ/triệu trong câu văn (ký tự có dấu)', () => {
    const k = { id: 'K4', text: 'Doanh thu năm 1,5 tỷ (F33), giá vốn 1.050 triệu.', fields: ['F33'], conflicts: [], signals: [] };
    expect(verifyConclusion(k, ctx)).toEqual([]);
    expect(verifyConclusion({ ...k, text: 'Doanh thu năm 1,7 tỷ (F33).' }, ctx).join()).toMatch(/con số 1,7/);
  });

  it('bóc JSON trong ```json', () => {
    expect(parseConclusions('Kết quả:\n```json\n[{"id":"K1"}]\n```', null)).toEqual([{ id: 'K1' }]);
    expect(parseConclusions(null, { conclusions: [{ id: 'K2' }] })).toEqual([{ id: 'K2' }]);
    expect(parseConclusions('không phải json', null)).toEqual([]);
  });
});

describe('task, quyết định, ghép (FR-15..17, FR-24)', () => {
  it('task cho sai lệch chờ xác nhận + liên kết mức trung bình, S1 trước', () => {
    const t = reviewTasks(forms, 'run1');
    expect(t.filter((x) => x.kind === 'DISCREPANCY').map((x) => x.title.split(' ')[0])).toEqual(['X01', 'X04', 'X05', 'X07', 'X08']);
    expect(t.some((x) => x.kind === 'PERSON_LINK')).toBe(true);
    const x01 = forms.discrepancies.find((x) => x.id === 'X01')!;
    expect(reviewTasks(forms, 'run1', new Set([`run1:X:${x01.key}`])).some((x) => x.ref === x01.key)).toBe(false);
  });

  it('kiểm nghiệp vụ quyết định', () => {
    const t = reviewTasks(forms, 'r');
    const ab = t.find((x) => x.title.startsWith('X01'))!;
    expect(decisionViolation(dec(ab.taskId, {}), ab, forms)).toMatch(/A\|B phải được phân loại lại/);
    expect(decisionViolation(dec(ab.taskId, { action: 'RECLASSIFY', newClass: 'A' }), ab, forms)).toBeNull();
    const link = t.find((x) => x.kind === 'PERSON_LINK')!;
    expect(decisionViolation(dec(link.taskId, { action: 'RECLASSIFY', newClass: 'A' }), link, forms)).toMatch(/liên kết người/);
    expect(decisionViolation(dec('zzz', {}), undefined, forms)).toMatch(/không tồn tại/);
  });

  it('ghép: S1 mở -> PENDING_SUPPLEMENT; K# vướng S2 -> tạm thời', () => {
    const ks = [{ id: 'K1', text: 'x', fields: ['F51'], conflicts: [], signals: [] },
      { id: 'K2', text: 'y', fields: ['F33'], conflicts: [], signals: [] }];
    const m = merge(forms, {}, ks);
    expect(m.outcome).toBe('PENDING_SUPPLEMENT');
    expect(m.blocking.some((b) => b.startsWith('X01'))).toBe(true);
    expect(m.conclusions.find((k) => k.id === 'K1')!.provisional).toBe(true);   // F51 giá trị TSBĐ không nguồn (X03, S2)
    expect(m.conclusions.find((k) => k.id === 'K2')!.provisional).toBe(false);
  });

  it('ghép AC-9: income_x12 — K# trích thu nhập vướng S2 -> PROVISIONAL; xử lý xong -> ELIGIBLE', () => {
    const k = [{ id: 'K1', text: 't', fields: ['F37'], conflicts: ['X01'], signals: [] }];
    expect(merge(income, {}, k).outcome).toBe('PROVISIONAL');
    const ledger: Record<string, Resolution> = {};
    const task = reviewTasks(income, 'r').find((x) => x.kind === 'DISCREPANCY')!;
    const o = emptyOverrides();
    applyDecision(o, ledger, dec(task.taskId, { action: 'RECLASSIFY', newClass: 'C', reason: 'mâu thuẫn thật' }), task, income);
    expect(merge(income, ledger, k).outcome).toBe('ELIGIBLE_TO_SUBMIT');
    expect(o.discrepancies).toEqual([]); // giữ C -> không cần override lớp
  });

  it('CORRECT_VALUE -> override fact + phân loại lại A', () => {
    const task = reviewTasks(income, 'r').find((x) => x.kind === 'DISCREPANCY')!;
    const o = emptyOverrides();
    const ledger: Record<string, Resolution> = {};
    const field = income.facts.find((f) => f.field === 'financial_info.total_income_period')!.id;
    const d = dec(task.taskId, { action: 'CORRECT_VALUE', value: 'ANNUAL', reason: 'ảnh ghi /năm' });
    expect(decisionViolation(d, task, income)).toMatch(/cần chỉ rõ field/);
    expect(decisionViolation({ ...d, field }, task, income)).toBeNull();
    applyDecision(o, ledger, { ...d, field }, task, income);
    expect(o.facts[0]).toMatchObject({ entity: 'L1', field: 'financial_info.total_income_period', value: 'ANNUAL', by: 'cv02' });
    expect(o.discrepancies[0]).toMatchObject({ key: task.ref, class: 'A' });
    expect(ledger[task.ref]).toBe('RESOLVED');
  });

  it('reconcile: K# trích mâu thuẫn bị hạ khỏi C là bị ảnh hưởng; K# khác giữ nguyên', () => {
    const next = structuredClone(income);
    next.discrepancies[0].class = 'A';
    next.discrepancies[0].to_branch2 = false;
    const ks = [{ id: 'K1', text: 'a', fields: ['F37'], conflicts: ['X01'], signals: [] },
      { id: 'K2', text: 'b', fields: ['F33'], conflicts: [], signals: ['T1'] }];
    const r = reconcile(income, next, ks);
    expect(r.affected).toEqual(['K1']);
    expect(r.conclusions.find((k) => k.id === 'K1')!.conflicts).toEqual([]);
    expect(r.conclusions.find((k) => k.id === 'K2')!.signals).toEqual(['T1']);
  });
});
