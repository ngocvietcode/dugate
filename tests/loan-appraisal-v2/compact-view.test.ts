import { compactAppraisalResult, compactLoanSteps } from '@/lib/pipelines/workflows/loan-appraisal/compact-view';
import { formatOperationResponse } from '@/lib/pipelines/format';
import { hiddenChecklistCount, checklistGroups } from '@/app/loan-appraisal-v2/lib/dossier-view';
import { buildEvidenceLookup, sourceDocumentsOf } from '@/app/loan-appraisal-v2/lib/selectors';
import { applyOperation } from '@/app/loan-appraisal-v2/lib/operation-mapper';

const rec = (id: string, extra: Record<string, unknown> = {}) => ({
  evidence_id: id, field_path: 'f', value: 'v', normalized_value: 'v', file_name: `${id}.pdf`, doc_type_key: 'id_card', doc_type_label: 'CCCD',
  classification_confidence: 0.9, extraction_confidence: 0.95, extraction_method: 'AI_EXTRACT', evidence_kind: 'EXTRACTED_FIELD', review_status: 'ACCEPTED', ...extra,
});

const field = (path: string, status: string, value: unknown = null) => ({ path, label: path, kind: 'text', candidates: [], outliers: [], note: null, value, status, review_status: 'OK', confidence: 1, sources: [] });

function result() {
  return {
    output_version: '3.0',
    checklist: {
      status: 'OK', status_code: 'OK', flow: 'FULL', completeness_percent: 50,
      items: [
        { item_key: 'a', checklist_group: 'legal', status: 'PRESENT', required: true, found_in: [{ evidence_id: 'ev-1', file_name: 'a.pdf' }] },
        { item_key: 'b', checklist_group: 'legal', status: 'NOT_APPLICABLE', required: false, found_in: [] },
        { item_key: 'c', checklist_group: 'loan_plan', status: 'MISSING', required: true, found_in: [] },
        { item_key: 'd', checklist_group: 'loan_plan', status: 'NOT_APPLICABLE', required: false, found_in: [] },
      ],
      summary_by_group: [{ checklist_group: 'legal' }],
    },
    intake: { required_present: 1, missing_required_keys: ['c'], checklist: [1, 2, 3] },
    audit: { config_snapshot: { x: 1 }, stages: [1] },
    config_snapshot: { x: 1 },
    dossier_readiness: { missing_required_keys: ['c'] },
    policy_compliance: { rule_results: [{ rule_id: 'R', evidence_ids: ['ev-1'] }] },
    evidence: {
      records: [
        rec('ev-1'), rec('ev-2'), rec('ev-3'),
        rec('chk:a:person-1', { evidence_kind: 'CHECKLIST_STATUS', source_evidence_ids: ['ev-2'] }),
        rec('chk:b:person-1', { evidence_kind: 'CHECKLIST_STATUS', source_evidence_ids: [] }),
      ],
      by_file: [{ file_name: 'a.pdf', evidence_ids: ['ev-1', 'ev-2'] }],
      by_document_type: [{ doc_type_key: 'id_card', evidence_ids: ['ev-1', 'ev-2'] }],
    },
  };
}

describe('compactAppraisalResult', () => {
  it('không mutate đầu vào', () => {
    const input = result();
    const snapshot = JSON.stringify(input);
    compactAppraisalResult(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('bỏ intake/audit; giữ config_snapshot và dossier_readiness', () => {
    const out = compactAppraisalResult(result()) as Record<string, unknown>;
    expect(out).not.toHaveProperty('intake');
    expect(out).not.toHaveProperty('audit');
    expect(out.config_snapshot).toEqual({ x: 1 });
    expect(out.dossier_readiness).toEqual({ missing_required_keys: ['c'] });
  });

  it('checklist: bỏ NOT_APPLICABLE, ghi not_applicable_count; UI vẫn tính đúng số mục ẩn và nhóm', () => {
    const full = result().checklist as never;
    const out = (compactAppraisalResult(result()) as { checklist: typeof full }).checklist as { items: Array<{ status: string }>; not_applicable_count?: number };
    expect(out.items.map((i) => i.status)).toEqual(['PRESENT', 'MISSING']);
    expect(out.not_applicable_count).toBe(2);
    expect(hiddenChecklistCount(full)).toBe(2);
    expect(hiddenChecklistCount(out as never)).toBe(2);
    const groupsOf = (c: never) => checklistGroups(c).map((g) => [g.group, g.items.map((i) => i.status)]);
    expect(groupsOf(out as never)).toEqual(groupsOf(full));
  });

  it('checklist không có NOT_APPLICABLE: giữ nguyên, không thêm not_applicable_count', () => {
    const r = result();
    r.checklist.items = r.checklist.items.filter((i) => i.status !== 'NOT_APPLICABLE');
    const out = (compactAppraisalResult(r) as { checklist: Record<string, unknown> }).checklist;
    expect(out).not.toHaveProperty('not_applicable_count');
  });

  it('evidence: bỏ by_file/by_document_type và bản ghi không ai tham chiếu; giữ bản ghi được tham chiếu và nguồn của chúng', () => {
    const out = (compactAppraisalResult(result()) as { evidence: { records: Array<{ evidence_id: string }> } }).evidence;
    expect(out).not.toHaveProperty('by_file');
    expect(out).not.toHaveProperty('by_document_type');
    const ids = out.records.map((r) => r.evidence_id);
    // ev-1: policy rule + checklist found_in. ev-2: nguồn của chk:a. chk:a: không ai tham chiếu nên bị bỏ (cùng chk:b).
    expect(ids).toEqual(['ev-1']);
    expect(ids).not.toContain('ev-3');
  });

  it('evidence được tham chiếu qua bản ghi CHECKLIST_STATUS vẫn tra được nguồn thật như trước', () => {
    const r = result();
    r.policy_compliance.rule_results[0].evidence_ids = ['chk:a:person-1'];
    const full = sourceDocumentsOf(['chk:a:person-1'], buildEvidenceLookup(r.evidence.records as never));
    const out = (compactAppraisalResult(r) as { evidence: { records: never[] } }).evidence;
    const slim = sourceDocumentsOf(['chk:a:person-1'], buildEvidenceLookup(out.records));
    expect(slim).toEqual(full);
    expect(slim.documents).toEqual([{ file_name: 'ev-2.pdf', doc_type_label: 'CCCD' }]);
    expect(slim.unresolved).toBe(0);
  });

  it('bản ghi evidence chỉ còn trường giao diện đọc', () => {
    const out = (compactAppraisalResult(result()) as { evidence: { records: Array<Record<string, unknown>> } }).evidence.records[0];
    expect(Object.keys(out).sort()).toEqual(['doc_type_key', 'doc_type_label', 'evidence_id', 'evidence_kind', 'file_name']);
  });

  it('chịu được dữ liệu thiếu hoặc kết quả cũ', () => {
    expect(compactAppraisalResult(null)).toBeNull();
    expect(compactAppraisalResult('x')).toBe('x');
    expect(compactAppraisalResult({ output_version: '2.0' })).toEqual({ output_version: '2.0' });
    expect(compactAppraisalResult({ checklist: 'lạ', evidence: { records: 'lạ' } })).toEqual({ checklist: 'lạ', evidence: { records: 'lạ' } });
  });
});

describe('compactLoanSteps', () => {
  const steps = [
    { step: 0, stage_key: 'classify', status: 'SUCCESS', extracted_data: { files: [1], precheck: { checklist: [] } } },
    { step: 1, stage_key: 'extract_evidence', status: 'SUCCESS', extracted_data: { evidences: [1] } },
    { step: 2, stage_key: 'consolidate_dossier', status: 'SUCCESS', extracted_data: { big: 'x'.repeat(5000) }, content_preview: 'p' },
    { step: 3, stage_key: 'calculate_financials', status: 'SUCCESS', extracted_data: { y: 1 } },
  ];

  it('giữ classify + extract_evidence (UI reveal), bỏ extracted_data của các bước còn lại', () => {
    const out = compactLoanSteps(steps);
    expect(out[0].extracted_data).toBeDefined();
    expect(out[1].extracted_data).toBeDefined();
    expect(out[2]).not.toHaveProperty('extracted_data');
    expect(out[2].content_preview).toBe('p');
    expect(out[3]).not.toHaveProperty('extracted_data');
  });

  it('bước cũ chưa có stage_key: suy từ chỉ số', () => {
    const out = compactLoanSteps([{ step: 0, extracted_data: { a: 1 } }, { step: 1, extracted_data: { b: 1 } }, { step: 2, extracted_data: { c: 1 } }]);
    expect(out[0].extracted_data).toBeDefined();
    expect(out[1].extracted_data).toBeDefined();
    expect(out[2]).not.toHaveProperty('extracted_data');
  });
});

describe('formatOperationResponse view=compact (loan-appraisal)', () => {
  const op = (state: string, done: boolean, extra: Record<string, unknown> = {}) => ({
    id: 'op-1', endpointSlug: 'workflows:loan-appraisal', pipelineJson: '[]', progressLogJson: '[]', usageBreakdown: '[]',
    createdAt: new Date(), updatedAt: new Date(), completedAt: null, outputFormat: 'json', outputContent: 'x',
    currentStep: 3, progressPercent: 50, state, done,
    stepsResultJson: JSON.stringify([
      { step: 0, stage_key: 'classify', status: 'SUCCESS', processor: 'p', extracted_data: { files: [{ file_name: 'a.pdf' }] } },
      { step: 2, stage_key: 'consolidate_dossier', status: 'SUCCESS', processor: 'p', extracted_data: { big: 'x'.repeat(4000) } },
    ]),
    extractedData: JSON.stringify(result()),
    ...extra,
  }) as never;
  const steps = (r: unknown) => (r as { metadata: { pipeline_steps: Array<Record<string, unknown>> } }).metadata.pipeline_steps;

  it('RUNNING / PAUSED: cắt extracted_data của bước nặng; SUCCEEDED: cắt hết như trước', () => {
    for (const [state, done] of [['RUNNING', false], ['WAITING_USER_INPUT', false]] as const) {
      const s = steps(formatOperationResponse(op(state, done), { compact: true }));
      expect(s[0].extracted_data).toBeDefined();
      expect(s[1]).not.toHaveProperty('extracted_data');
    }
    const ok = steps(formatOperationResponse(op('SUCCEEDED', true), { compact: true }));
    expect(ok.every((s) => !('extracted_data' in s))).toBe(true);
  });

  it('không compact thì không đổi gì (client khác, view mặc định)', () => {
    const s = steps(formatOperationResponse(op('RUNNING', false)));
    expect(s[1].extracted_data).toBeDefined();
    const full = formatOperationResponse(op('SUCCEEDED', true)) as { result: { extracted_data: Record<string, unknown> } };
    expect(full.result.extracted_data).toHaveProperty('intake');
    expect(full.result.extracted_data).toHaveProperty('audit');
  });

  it('endpoint khác loan-appraisal không bị đụng', () => {
    const other = formatOperationResponse(op('RUNNING', false, { endpointSlug: 'workflows:other' }), { compact: true });
    expect(steps(other)[1].extracted_data).toBeDefined();
  });

  it('SUCCEEDED compact: kết quả gọn, giao diện (applyOperation) vẫn nhận kết quả hợp lệ', () => {
    const response = formatOperationResponse(op('SUCCEEDED', true), { compact: true }) as { result: { extracted_data: Record<string, unknown> } };
    expect(response.result.extracted_data).not.toHaveProperty('intake');
    const applied = applyOperation(response, new Set());
    expect(applied.outcome).toBe('done');
    const done = applied.actions.find((a) => a.type === 'SUCCEEDED') as { result: { checklist: { items: unknown[] } } };
    expect(done.result.checklist.items).toHaveLength(2);
  });
});

describe('kết quả MỚI (không còn intake/audit/chỉ mục) và kết quả CŨ cùng đọc được', () => {
  it('kết quả mới: compact không làm đổi gì ngoài phần giao diện đã ẩn', () => {
    const slim = result() as Record<string, unknown>;
    delete slim.intake; delete slim.audit;
    const ev = slim.evidence as { records: unknown[]; by_file?: unknown; by_document_type?: unknown };
    delete ev.by_file; delete ev.by_document_type;
    ev.records = ev.records.filter((r) => (r as { evidence_kind: string }).evidence_kind !== 'CHECKLIST_STATUS');
    const out = compactAppraisalResult(slim) as Record<string, unknown>;
    expect(out).not.toHaveProperty('intake');
    expect(out).not.toHaveProperty('audit');
    expect((out.evidence as { records: Array<{ evidence_id: string }> }).records.map((r) => r.evidence_id)).toEqual(['ev-1']);
    expect(out.dossier_readiness).toEqual({ missing_required_keys: ['c'] });
  });

  it('kết quả cũ (còn đủ các trường) vẫn đọc được qua UI sau compact', () => {
    const out = compactAppraisalResult(result()) as { checklist: never; evidence: { records: never[] } };
    expect(hiddenChecklistCount(out.checklist)).toBe(2);
    expect(sourceDocumentsOf(['ev-1'], buildEvidenceLookup(out.evidence.records)).unresolved).toBe(0);
  });
});
