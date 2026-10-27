// T-V2-01 — stage 0 của workflow v2 chạy S1 (V2-R01, V2-R03).
import { loadDocTypes } from '@/lib/loan-dossier/catalog';
import { ClassifyDataSchema } from '@/lib/loan-dossier/contracts/stage-result';
import type { ClassifyPorts } from '@/lib/loan-dossier/s1/run';
import {
  isClassifyCheckpoint, runClassifyStage, toLegacyClassification, toWorkflowStatus, type ClassifyCheckpoint,
} from '@/lib/pipelines/workflows/loan-appraisal/dossier-stages';

const pdf = (tag: string) => Buffer.from(`%PDF-1.7\n% ${tag}\n%%EOF`);
const contents: Record<string, Buffer> = { '/s/a.pdf': pdf('a'), '/s/b.pdf': pdf('b'), '/s/c.pdf': pdf('a') };

function ports(reply: (ref: string) => unknown): ClassifyPorts {
  const byContent = new Map(Object.entries(contents).map(([ref, buf]) => [buf.toString('latin1'), ref]));
  return {
    readFile: async (ref) => {
      if (!contents[ref]) throw new Error('down');
      return contents[ref];
    },
    inspect: async () => ({ ok: true, page_count: 4 }),
    classifier: { classifyPages: async (input) => reply(byContent.get(Buffer.from(input.content).toString('latin1'))!) },
  };
}

const gcn = { page_quality: 'OK', matches: [{ doc_type_key: 'land_use_certificate', confidence: 0.9, instances: [{ page_range: [1, 4], confidence: 0.9 }] }] };
const files = [{ name: 'a.pdf', path: '/s/a.pdf' }, { name: 'b.pdf', path: '/s/b.pdf' }, { name: 'c.pdf', path: '/s/c.pdf' }];

describe('runClassifyStage', () => {
  it('lưu đúng files, matches, repeated_doc_types của S1 + trạng thái gốc', async () => {
    const refs = { 'file-x': '/s/a.pdf' };
    const { step, failure } = await runClassifyStage(files, ports(() => gcn), () => refs);
    expect(failure).toBeNull();
    expect(step).toMatchObject({ step: 0, stage_key: 'classify', status: 'SUCCESS', artifact_version: '3.0' });
    const cp = step.extracted_data as ClassifyCheckpoint;
    expect(isClassifyCheckpoint(cp)).toBe(true);
    // c.pdf trùng nội dung a.pdf → bị bỏ (S1-R13)
    expect(cp.files.map((f) => f.file_name)).toEqual(['a.pdf', 'b.pdf']);
    expect(cp.repeated_doc_types).toHaveLength(1);
    expect([cp.stage_status, cp.status_code, cp.file_refs]).toEqual(['SUCCESS', 'COMPLETED', refs]);
    const { stage_status: _s, status_code: _c, message: _m, file_refs: _r, ...data } = cp;
    expect(ClassifyDataSchema.safeParse(data).success).toBe(true);
  });

  it('S1 FAILED → bước FAILED, mã gốc ở extracted_data.status_code, workflow dừng', async () => {
    const { step, failure } = await runClassifyStage(files.slice(0, 1), ports(() => 'not json'), () => ({}));
    expect(step.status).toBe('FAILED');
    expect((step.extracted_data as ClassifyCheckpoint).status_code).toBe('JSON_PARSE_ERROR');
    expect(failure?.message).toMatch(/JSON_PARSE_ERROR/);
  });

  it('storage lỗi → FAILED/INTEGRATION_SERVICE_DOWN, lỗi retryable', async () => {
    const { step, failure } = await runClassifyStage([{ name: 'x.pdf', path: '/s/missing.pdf' }], ports(() => gcn), () => ({}));
    expect(step.status).toBe('FAILED');
    expect((step.extracted_data as ClassifyCheckpoint).stage_status).toBe('UNAVAILABLE');
    expect(failure?.message).toMatch(/timed out/);
  });

  it('không nhận dạng được file nào → PARTIAL_SUCCESS + INVALID_INPUT', async () => {
    const { step, failure } = await runClassifyStage(files.slice(0, 1), ports(() => ({ page_quality: 'OK', matches: [] })), () => ({}));
    expect(step.status).toBe('PARTIAL_SUCCESS');
    expect((step.extracted_data as ClassifyCheckpoint).status_code).toBe('NO_PROCESSABLE_FILES');
    expect(failure?.message).toMatch(/^INVALID_INPUT/);
  });

  it('matches[].doc_type_key thuộc 47 khóa của doc_types.json', async () => {
    const keys = loadDocTypes().map((d) => d.doc_type_key);
    expect(keys).toHaveLength(47);
    const reply = () => ({
      page_quality: 'OK',
      matches: [
        { doc_type_key: 'id_card', confidence: 0.9, instances: [{ page_range: [1, 2], confidence: 0.9 }] },
        { doc_type_key: 'cccd', confidence: 0.9, instances: [{ page_range: [3, 4], confidence: 0.9 }] },
      ],
    });
    const { step } = await runClassifyStage(files.slice(0, 1), ports(reply), () => ({}));
    const cp = step.extracted_data as ClassifyCheckpoint;
    expect(cp.files[0].matches.map((m) => m.doc_type_key)).toEqual(['id_card']);
    for (const m of cp.files.flatMap((f) => f.matches)) expect(keys).toContain(m.doc_type_key);
  });

  it('cầu nối tạm sang ClassifiedDoc[] cho stage 2–7', async () => {
    const { step } = await runClassifyStage(files.slice(0, 2), ports(() => gcn), () => ({}));
    const legacy = toLegacyClassification(step.extracted_data as ClassifyCheckpoint);
    expect(legacy[0]).toMatchObject({ file_name: 'a.pdf', status: 'classified', matches: [{ key: 'land_use_certificate', confidence: 0.9 }] });
  });

  it('V2-R03: ánh xạ trạng thái', () => {
    expect(['SUCCESS', 'PARTIAL_SUCCESS', 'INSUFFICIENT_DATA', 'NOT_EVALUATED', 'FAILED', 'UNAVAILABLE'].map((s) => toWorkflowStatus(s as never)))
      .toEqual(['SUCCESS', 'PARTIAL_SUCCESS', 'PARTIAL_SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'FAILED']);
  });
});
