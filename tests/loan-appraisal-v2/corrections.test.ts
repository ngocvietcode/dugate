// T-COR-06 — khay hiệu chỉnh: reducer, case input, nhãn (COR-R16).
import type { AppraisalResult } from '@/app/loan-appraisal/types';
import {
  buildCaseInput, correctionsReducer, correctionTarget, evidenceLeaves, KIND_LABELS, SKIP_LABELS, type Correction,
} from '@/app/loan-appraisal-v2/lib/corrections';
import { CorrectionSkipCodeSchema } from '@/lib/loan-dossier/corrections/schema';

const meta = { reason: 'lý do', corrected_by: 'u1', corrected_at: '2026-10-30T09:00:00Z' };
const fix = (id: string, value: string): Correction => ({ ...meta, correction_id: id, kind: 'OCR_FIX', record_id: 'ev-0123456789ab#parties[0].id_number', original_value: '1', value });
const link = (id: string, kind: 'SAME_SUBJECT' | 'DIFFERENT_SUBJECT', flip = false): Correction => {
  const a = { evidence_id: 'ev-0123456789ab', index: 0 }; const b = { evidence_id: 'ev-ba9876543210', index: 1 };
  return { ...meta, correction_id: id, kind, subject_kind: 'person', a: flip ? b : a, b: flip ? a : b };
};

describe('correctionsReducer', () => {
  it('cùng đích → bản sau thay bản trước; xóa; xóa hết', () => {
    let s = correctionsReducer([], { type: 'add', correction: fix('c1', '2') });
    s = correctionsReducer(s, { type: 'add', correction: fix('c2', '3') });
    expect(s.map((c) => c.correction_id)).toEqual(['c2']);
    s = correctionsReducer(s, { type: 'add', correction: link('c3', 'SAME_SUBJECT') });
    // Đảo hai đầu, đổi loại: vẫn cùng cặp → thay.
    s = correctionsReducer(s, { type: 'add', correction: link('c4', 'DIFFERENT_SUBJECT', true) });
    expect(s.map((c) => c.correction_id)).toEqual(['c2', 'c4']);
    expect(correctionsReducer(s, { type: 'remove', correction_id: 'c2' }).map((c) => c.correction_id)).toEqual(['c4']);
    expect(correctionsReducer(s, { type: 'clear' })).toEqual([]);
    expect(correctionTarget(link('x', 'SAME_SUBJECT'))).toBe(correctionTarget(link('y', 'DIFFERENT_SUBJECT', true)));
  });
});

describe('buildCaseInput', () => {
  const seal = { alg: 'HMAC-SHA256' as const, key_id: 'v1' as const, source_operation_id: 'op-1', product_code: 'hkd-loan', flow: 'FULL', workflow_version: '2', mac: 'a'.repeat(64) };
  const result = { documents: { classify: { files: [], repeated_doc_types: [] }, evidences: [] }, dossier_precheck: null, case_seal: seal } as unknown as AppraisalResult;

  it('dùng nguyên documents + case_seal của kết quả, kèm hiệu chỉnh', () => {
    const input = buildCaseInput(result, [fix('c1', '2')])!;
    expect(input).toMatchObject({ contract: 'loan-appraisal.case-input', case_seal: seal, documents: result.documents, corrections: [{ correction_id: 'c1' }] });
  });

  it('kết quả không có niêm phong → null', () => {
    expect(buildCaseInput({ ...result, case_seal: undefined } as AppraisalResult, [])).toBeNull();
  });

  it('mã tham chiếu là mã ổn định, không có person-n / F<n>', () => {
    const json = JSON.stringify(buildCaseInput(result, [fix('c1', '2'), link('c2', 'SAME_SUBJECT')]));
    expect(json).not.toMatch(/person-\d|asset-\d|"F\d+"/);
  });
});

it('mọi mã bỏ qua và mọi loại hiệu chỉnh có nhãn tiếng Việt', () => {
  for (const code of CorrectionSkipCodeSchema.options) expect(SKIP_LABELS[code]).toBeTruthy();
  for (const kind of ['OCR_FIX', 'FACT_RESOLUTION', 'SAME_SUBJECT', 'DIFFERENT_SUBJECT'] as const) expect(KIND_LABELS[kind]).toBeTruthy();
});

it('evidenceLeaves: lá scalar với record_id = evidence_id#đường dẫn', () => {
  expect(evidenceLeaves({ evidence_id: 'ev-0123456789ab', data: { parties: [{ full_name: 'A', id_number: null }], n: 3 } }))
    .toEqual([{ record_id: 'ev-0123456789ab#parties[0].full_name', path: 'parties[0].full_name', value: 'A' }, { record_id: 'ev-0123456789ab#n', path: 'n', value: 3 }]);
});
