// T-S1-07 — lắp ráp stage S1 (S1-R12, R13, R15, R17, §5).
import { ClassifyStageResultSchema } from '@/lib/loan-dossier/contracts/stage-result';
import type { ClassifyPagesInput } from '@/lib/loan-dossier/s1/classifier-port';
import { computeFileId } from '@/lib/loan-dossier/s1/file-id';
import { runClassify, type ClassifyInputFile, type ClassifyPorts, type InspectResult } from '@/lib/loan-dossier/s1/run';

const pdf = (tag: string) => Buffer.from(`%PDF-1.7\n% ${tag}\n%%EOF`);
const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);

type Reply = (input: ClassifyPagesInput) => unknown;
const ok = (key: string, ranges: Array<[number, number]>, confidence = 0.9) => ({
  page_quality: 'OK',
  matches: [{ doc_type_key: key, confidence, instances: ranges.map((page_range) => ({ page_range, confidence, starts_new_document: true })) }],
});

interface Fixture { content: Buffer; pages?: number; inspect?: InspectResult; reply?: Reply }

function setup(fixtures: Record<string, Fixture>, extra: Partial<ClassifyPorts> = {}) {
  const calls: ClassifyPagesInput[] = [];
  const byId = new Map<string, Fixture>();
  for (const f of Object.values(fixtures)) if (!byId.has(computeFileId(f.content))) byId.set(computeFileId(f.content), f);
  const ports: ClassifyPorts = {
    readFile: async (ref) => {
      const f = fixtures[ref];
      if (!f) throw new Error('storage down');
      return f.content;
    },
    inspect: async (content) => {
      const f = byId.get(computeFileId(content))!;
      return f.inspect ?? { ok: true, page_count: f.pages ?? 2 };
    },
    classifier: {
      classifyPages: async (input) => {
        calls.push(input);
        return byId.get(input.file_ref)!.reply!(input);
      },
    },
    now: () => new Date('2026-10-19T02:00:00.000Z'),
    ...extra,
  };
  const files = (...refs: string[]): ClassifyInputFile[] => refs.map((ref) => ({ file_name: `${ref}.pdf`, ref }));
  return { ports, calls, files };
}

const valid = (r: unknown) => {
  const parsed = ClassifyStageResultSchema.safeParse(r);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues, null, 1));
};

describe('runClassify — trạng thái stage (§5)', () => {
  it('storage lỗi → UNAVAILABLE/INTEGRATION_SERVICE_DOWN, không CORRUPTED_FILE (S1-AC11)', async () => {
    const { ports } = setup({});
    const r = await runClassify([{ file_name: 'a.pdf', ref: 'missing' }], ports);
    expect([r.status, r.status_code, r.data]).toEqual(['UNAVAILABLE', 'INTEGRATION_SERVICE_DOWN', null]);
    expect(r.blocking_inputs[0].type).toBe('INTEGRATION');
    valid(r);
  });

  it('không file nào xử lý được → INSUFFICIENT_DATA/NO_PROCESSABLE_FILES', async () => {
    const { ports, files } = setup({ a: { content: docx }, b: { content: pdf('b'), reply: () => ({ page_quality: 'EMPTY', matches: [] }) } });
    const r = await runClassify(files('a', 'b'), ports);
    expect([r.status, r.status_code]).toEqual(['INSUFFICIENT_DATA', 'NO_PROCESSABLE_FILES']);
    valid(r);
  });

  it('không có file → INSUFFICIENT_DATA', async () => {
    const { ports } = setup({});
    const r = await runClassify([], ports);
    expect(r.status_code).toBe('NO_PROCESSABLE_FILES');
    valid(r);
  });

  it('có file không hỗ trợ → PARTIAL_SUCCESS/UNSUPPORTED_FILES_PRESENT (S1-AC01)', async () => {
    const { ports, files } = setup({ a: { content: docx }, b: { content: pdf('b'), reply: () => ok('id_card', [[1, 2]]) } });
    const r = await runClassify(files('a', 'b'), ports);
    expect([r.status, r.status_code]).toEqual(['PARTIAL_SUCCESS', 'UNSUPPORTED_FILES_PRESENT']);
    expect(r.data!.files[0]).toMatchObject({ status: 'UNSUPPORTED_FILE', next_action: 'CONVERT_AND_REUPLOAD' });
    expect(r.content_preview).toMatchObject({ file_count: 2, blocked_count: 1, classified_count: 1 });
    valid(r);
  });

  it('PDF mật khẩu / hỏng tính là file bị chặn', async () => {
    const { ports, files } = setup({
      a: { content: pdf('a'), inspect: { ok: false, kind: 'PASSWORD_PROTECTED' } },
      b: { content: pdf('b'), inspect: { ok: false, kind: 'CORRUPTED_FILE' } },
      c: { content: pdf('c'), reply: () => ok('cic', [[1, 2]]) },
    });
    const r = await runClassify(files('a', 'b', 'c'), ports);
    expect(r.data!.files.map((f) => f.status)).toEqual(['PASSWORD_PROTECTED', 'CORRUPTED_FILE', 'CLASSIFIED']);
    expect(r.status_code).toBe('UNSUPPORTED_FILES_PRESENT');
    valid(r);
  });

  it('có file UNKNOWN → PARTIAL_SUCCESS/UNKNOWN_FILES_PRESENT', async () => {
    const { ports, files } = setup({
      a: { content: pdf('a'), reply: () => ok('id_card', [[1, 2]]) },
      b: { content: pdf('b'), reply: () => ({ page_quality: 'OK', matches: [] }) },
    });
    const r = await runClassify(files('a', 'b'), ports);
    expect([r.status, r.status_code]).toEqual(['PARTIAL_SUCCESS', 'UNKNOWN_FILES_PRESENT']);
    expect(r.data!.files[1]).toMatchObject({ status: 'UNKNOWN', reason_code: 'UNCLASSIFIED' });
    valid(r);
  });

  it('còn lại → SUCCESS/COMPLETED, repeated_doc_types theo file (S1-AC10)', async () => {
    const { ports, files } = setup({
      a: { content: pdf('a'), reply: () => ok('land_use_certificate', [[1, 2]]) },
      b: { content: pdf('b'), reply: () => ok('land_use_certificate', [[1, 2]]) },
    });
    const r = await runClassify(files('a', 'b'), ports);
    expect([r.status, r.status_code]).toEqual(['SUCCESS', 'COMPLETED']);
    expect(r.data!.repeated_doc_types).toHaveLength(1);
    valid(r);
  });
});

describe('runClassify — quy tắc', () => {
  it('S1-AC08: 2 file cùng nội dung → 1 record, model gọi 1 lần', async () => {
    const content = pdf('same');
    const { ports, calls } = setup({ a: { content, reply: () => ok('id_card', [[1, 2]]) }, b: { content } });
    const r = await runClassify([{ file_name: 'a.pdf', ref: 'a' }, { file_name: 'b.pdf', ref: 'b' }], ports);
    expect(r.data!.files).toHaveLength(1);
    expect(r.data!.files[0].file_name).toBe('a.pdf');
    expect(calls).toHaveLength(1);
    valid(r);
  });

  it('S1-AC02 + S1-AC03: tên file không tới classifier', async () => {
    const { ports, calls } = setup({ x: { content: pdf('x'), reply: () => ok('loan_application', [[1, 2]]) } });
    // Tên file kiểu "CCCD.jpg" (đuôi sai, tên gợi ý sai loại); dùng chuỗi riêng để dò rò rỉ.
    const r = await runClassify([{ file_name: 'CCCD-hoso-zq7731.jpg', ref: 'x' }], ports);
    expect(r.data!.files[0].matches[0].doc_type_key).toBe('loan_application');
    expect(r.data!.files[0].file_name).toBe('CCCD-hoso-zq7731.jpg');
    const sent = JSON.stringify({ ...calls[0], content: undefined });
    expect(sent).not.toContain('zq7731');
    expect(calls[0].mime).toBe('application/pdf');
    expect(Object.keys(calls[0]).sort()).toEqual(['content', 'file_ref', 'mime', 'page_count', 'page_range', 'prompt']);
  });

  it('S1-AC06: PDF 130 trang, CCCD qua trang 20–21 → 1 instance [19,22]', async () => {
    const reply: Reply = ({ page_range: [from] }) => {
      if (from === 1) return { page_quality: 'OK', matches: [{ doc_type_key: 'id_card', confidence: 0.95, instances: [{ page_range: [19, 20], confidence: 0.95, starts_new_document: true }] }] };
      if (from === 21) return { page_quality: 'OK', matches: [{ doc_type_key: 'id_card', confidence: 0.9, instances: [{ page_range: [21, 22], confidence: 0.9, starts_new_document: false }] }] };
      return { page_quality: 'OK', matches: [] };
    };
    const { ports, calls } = setup({ big: { content: pdf('big'), pages: 130, reply } });
    const r = await runClassify([{ file_name: 'big.pdf', ref: 'big' }], ports);
    expect(calls.map((c) => c.page_range)).toEqual([[1, 20], [21, 40], [41, 60], [61, 80], [81, 100], [101, 120], [121, 130]]);
    const m = r.data!.files[0].matches[0];
    expect(m.instances).toEqual([{ instance_index: 1, page_range: [19, 22], confidence: 0.9, summary: '', key_facts: [] }]);
    valid(r);
  });

  it('phản hồi model hỏng → FAILED/JSON_PARSE_ERROR', async () => {
    const { ports, files } = setup({ a: { content: pdf('a'), reply: () => 'not json' } });
    const r = await runClassify(files('a'), ports);
    expect([r.status, r.status_code]).toEqual(['FAILED', 'JSON_PARSE_ERROR']);
    valid(r);
  });

  it('classifier không phản hồi → UNAVAILABLE', async () => {
    const { ports, files } = setup({ a: { content: pdf('a'), reply: () => { throw new Error('timeout'); } } });
    const r = await runClassify(files('a'), ports);
    expect([r.status, r.status_code]).toEqual(['UNAVAILABLE', 'INTEGRATION_SERVICE_DOWN']);
    valid(r);
  });

  it('lỗi pass-through (huỷ workflow) được ném ra', async () => {
    class Cancelled extends Error {}
    const { ports, files } = setup({ a: { content: pdf('a'), reply: () => { throw new Cancelled(); } } }, { isPassThroughError: (e) => e instanceof Cancelled });
    await expect(runClassify(files('a'), ports)).rejects.toBeInstanceOf(Cancelled);
  });

  it('không bao giờ FAILED vì file lỗi', async () => {
    const { ports, files } = setup({
      a: { content: docx },
      b: { content: pdf('b'), inspect: { ok: false, kind: 'CORRUPTED_FILE' } },
      c: { content: pdf('c'), reply: () => ({ page_quality: 'LOW_QUALITY', matches: [] }) },
    });
    const r = await runClassify(files('a', 'b', 'c'), ports);
    expect(r.status).not.toBe('FAILED');
    valid(r);
  });
});
