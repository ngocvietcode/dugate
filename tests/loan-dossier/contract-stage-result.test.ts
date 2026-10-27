// T-CON-01 — hợp đồng StageResult và data của S1, S2.
import {
  ClassifyDataSchema, ClassifyStageResultSchema, ExtractDataSchema, ExtractStageResultSchema,
} from '@/lib/loan-dossier/contracts/stage-result';

import { makeEvidence } from './fixtures/build';

/** Ví dụ output ở S1 §2 (stages/S1_classify.md). */
const S1_EXAMPLE = {
  files: [
    {
      file_id: 'file-3f9a1c2b7d10',
      file_name: 'ho-so-1.pdf',
      status: 'CLASSIFIED',
      reason_code: null,
      next_action: null,
      message: null,
      page_count: 6,
      matches: [
        {
          doc_type_key: 'id_card',
          confidence: 0.93,
          needs_manual_review: false,
          needs_extraction: true,
          instances_count: 2,
          hint_mismatch: false,
          instances: [
            { instance_index: 1, page_range: [1, 2], confidence: 0.95, summary: 'CCCD người vay.', key_facts: [{ subject: 'borrower', key: 'full_name', value: 'NGUYEN VAN A', page: 1 }] },
            { instance_index: 2, page_range: [3, 4], confidence: 0.93, summary: '', key_facts: [] },
          ],
        },
      ],
    },
  ],
  repeated_doc_types: [
    { doc_type_key: 'land_use_certificate', file_ids: ['file-3f9a1c2b7d10', 'file-8e2d4b6a1c03'], status: 'DUPLICATE_CANDIDATE', requires_review: true },
  ],
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function stage(overrides: Record<string, unknown> = {}) {
  return {
    stage_key: 'classify',
    status: 'SUCCESS',
    status_code: 'COMPLETED',
    message: null,
    started_at: '2026-10-14T03:00:00Z',
    finished_at: '2026-10-14T03:00:02Z',
    content_preview: { file_count: 1, classified_count: 1, unknown_count: 0, blocked_count: 0, match_count: 1 },
    data: clone(S1_EXAMPLE),
    blocking_inputs: [],
    ...overrides,
  };
}

describe('contracts/stage-result (T-CON-01)', () => {
  it('ví dụ output S1 §2 parse qua ClassifyDataSchema', () => {
    const r = ClassifyDataSchema.safeParse(S1_EXAMPLE);
    expect(r.success).toBe(true);
  });

  it('StageResult S1 hợp lệ parse qua; ví dụ 02_conventions §4 có blocking_inputs EXTERNAL_DATA', () => {
    expect(ClassifyStageResultSchema.safeParse(stage()).success).toBe(true);
    const withBlocking = stage({
      status: 'PARTIAL_SUCCESS', status_code: 'UNKNOWN_FILES_PRESENT',
      blocking_inputs: [{ type: 'EXTERNAL_DATA', key: 'loan_amount', message: 'Cần số tiền vay.' }],
    });
    expect(ClassifyStageResultSchema.safeParse(withBlocking).success).toBe(true);
  });

  it('status_code không có trong reason_codes.json bị từ chối', () => {
    expect(ClassifyStageResultSchema.safeParse(stage({ status_code: 'NOT_A_CODE' })).success).toBe(false);
    // Mã scope khác (FILE) cũng bị từ chối.
    expect(ClassifyStageResultSchema.safeParse(stage({ status_code: 'UNSUPPORTED_FORMAT' })).success).toBe(false);
  });

  it('status_code lệch status theo catalog bị từ chối', () => {
    expect(ClassifyStageResultSchema.safeParse(stage({ status: 'SUCCESS', status_code: 'NO_PROCESSABLE_FILES' })).success).toBe(false);
  });

  it('status = PENDING bị từ chối', () => {
    expect(ClassifyStageResultSchema.safeParse(stage({ status: 'PENDING' })).success).toBe(false);
  });

  it('field lạ ở StageResult và trong files[] bị từ chối', () => {
    expect(ClassifyStageResultSchema.safeParse(stage({ extra: 1 })).success).toBe(false);
    const data = clone(S1_EXAMPLE) as { files: Array<Record<string, unknown>> };
    data.files[0].extra = 1;
    expect(ClassifyDataSchema.safeParse(data).success).toBe(false);
  });

  it('blocking_inputs[].type ngoài DOCUMENT/EXTERNAL_DATA/INTEGRATION bị từ chối', () => {
    const r = ClassifyStageResultSchema.safeParse(stage({ blocking_inputs: [{ type: 'USER', key: 'x', message: 'y' }] }));
    expect(r.success).toBe(false);
  });

  it('stage_key phải đúng stage của schema', () => {
    expect(ClassifyStageResultSchema.safeParse(stage({ stage_key: 'extract_evidence' })).success).toBe(false);
  });

  it('SUCCESS mà data = null bị từ chối; FAILED cho phép data = null', () => {
    expect(ClassifyStageResultSchema.safeParse(stage({ data: null })).success).toBe(false);
    expect(ClassifyStageResultSchema.safeParse(stage({ status: 'FAILED', status_code: 'ENGINE_CRASH', data: null, content_preview: null })).success).toBe(true);
  });

  it('S1: confidence < 0.50 và needs_manual_review lệch ngưỡng bị từ chối (S1-R04)', () => {
    const low = clone(S1_EXAMPLE);
    low.files[0].matches[0].confidence = 0.45;
    expect(ClassifyDataSchema.safeParse(low).success).toBe(false);
    const review = clone(S1_EXAMPLE);
    review.files[0].matches[0].confidence = 0.7;
    expect(ClassifyDataSchema.safeParse(review).success).toBe(false);
    review.files[0].matches[0].needs_manual_review = true;
    expect(ClassifyDataSchema.safeParse(review).success).toBe(true);
  });

  it('S1: instances_count lệch, needs_extraction lệch doc_types.json, doc_type_key trùng trong 1 file bị từ chối', () => {
    const a = clone(S1_EXAMPLE); a.files[0].matches[0].instances_count = 3;
    const b = clone(S1_EXAMPLE); b.files[0].matches[0].needs_extraction = false;
    const c = clone(S1_EXAMPLE); c.files[0].matches.push(clone(c.files[0].matches[0]));
    for (const d of [a, b, c]) expect(ClassifyDataSchema.safeParse(d).success).toBe(false);
  });

  it('S1: reason_code/next_action theo bảng §4', () => {
    const base = clone(S1_EXAMPLE.files[0]);
    const unknown = { ...base, status: 'UNKNOWN', reason_code: 'UNCLASSIFIED', next_action: null, message: 'x', matches: [] };
    expect(ClassifyDataSchema.safeParse({ files: [unknown], repeated_doc_types: [] }).success).toBe(true);
    const wrong = { ...unknown, next_action: 'RESCAN_AND_REUPLOAD' };
    expect(ClassifyDataSchema.safeParse({ files: [wrong], repeated_doc_types: [] }).success).toBe(false);
    const unsupported = { ...base, status: 'UNSUPPORTED_FILE', reason_code: 'UNSUPPORTED_FORMAT', next_action: 'CONVERT_AND_REUPLOAD', matches: [] };
    expect(ClassifyDataSchema.safeParse({ files: [unsupported], repeated_doc_types: [] }).success).toBe(true);
  });

  it('S2: ExtractDataSchema nhận evidence fixture; evidence_id trùng bị từ chối', () => {
    const ev = makeEvidence('id_card');
    expect(ExtractDataSchema.safeParse({ evidences: [ev] }).success).toBe(true);
    expect(ExtractDataSchema.safeParse({ evidences: [ev, ev] }).success).toBe(false);
    const result = {
      stage_key: 'extract_evidence', status: 'SUCCESS', status_code: 'COMPLETED', message: null,
      started_at: '2026-10-14T03:00:00Z', finished_at: '2026-10-14T03:00:05Z',
      content_preview: { evidence_count: 1, success_count: 1, error_count: 0, duplicate_group_count: 0 },
      data: { evidences: [ev] }, blocking_inputs: [],
    };
    expect(ExtractStageResultSchema.safeParse(result).success).toBe(true);
    expect(ExtractStageResultSchema.safeParse({ ...result, data: { evidences: [ev], extra: [] } }).success).toBe(false);
  });
});
