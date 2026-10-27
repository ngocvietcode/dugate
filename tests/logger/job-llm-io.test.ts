// tests/logger/job-llm-io.test.ts
// Logger.jobLlmIo(): ghi prompt/output của LLM vào Bull Board (job.log) — ngoại lệ có kiểm soát của chính sách "job.log luôn bị cắt".

import type { Job } from 'bullmq';
import { Logger, stripRawBase64 } from '@/lib/logger';

const ENVS = ['LOG_LEVEL', 'LOG_FORMAT', 'LOG_JOB_LLM_IO', 'LOG_JOB_LLM_IO_CAP', 'LOG_JOBLOG_HARD_CAP', 'LOG_MAX_STRING_LEN'] as const;
const saved: Record<string, string | undefined> = {};
let stdout: jest.SpyInstance;
let stderr: jest.SpyInstance;

function makeJob() {
  const lines: string[] = [];
  const job = { log: jest.fn(async (row: string) => { lines.push(row); return lines.length; }) };
  return { job: job as unknown as Job<any, any, any>, lines };
}

beforeEach(() => {
  for (const k of ENVS) saved[k] = process.env[k];
  process.env.LOG_LEVEL = 'DEBUG';
  process.env.LOG_FORMAT = 'json';
  for (const k of ['LOG_JOB_LLM_IO', 'LOG_JOB_LLM_IO_CAP', 'LOG_JOBLOG_HARD_CAP', 'LOG_MAX_STRING_LEN']) delete process.env[k];
  stdout = jest.spyOn(console, 'log').mockImplementation(() => {});
  stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  stdout.mockRestore();
  stderr.mockRestore();
  for (const k of ENVS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('Logger.jobLlmIo', () => {
  it('mặc định TẮT: không ghi gì vào job.log', () => {
    const { job, lines } = makeJob();
    new Logger({ operationId: 'op' }, job).jobLlmIo('[AIHub] PROMPT', 'nội dung prompt');
    expect(lines).toHaveLength(0);
  });

  it('bật: ghi đủ prompt dài (vượt LOG_JOBLOG_HARD_CAP) kèm số ký tự; không in ra stdout', () => {
    process.env.LOG_JOB_LLM_IO = 'true';
    const { job, lines } = makeJob();
    const prompt = 'Hồ sơ vay. '.repeat(2000); // ~22.000 ký tự
    new Logger({ operationId: 'op' }, job).jobLlmIo('[AIHub] PROMPT → ext-fact-verifier', prompt, { chars: prompt.length, model: 'x' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[AIHub] PROMPT → ext-fact-verifier');
    expect(lines[0]).toContain(`"chars":${prompt.length}`);
    expect(lines[0].length).toBeGreaterThan(20_000);
    expect(lines[0]).toContain(prompt.slice(0, 500));
    expect(lines[0]).not.toContain('capped');
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it('vẫn che secret và base64 nhúng sẵn dù đang bật', () => {
    process.env.LOG_JOB_LLM_IO = '1';
    const { job, lines } = makeJob();
    const base64 = `data:image/png;base64,${'A'.repeat(200)}`;
    new Logger({}, job).jobLlmIo('[AIHub] OUTPUT', `api_key: sk-abc123456789 ${base64} redis://u:pw@host Bearer abcdefghijklmnop`);
    expect(lines[0]).not.toContain('sk-abc123456789');
    expect(lines[0]).not.toContain('abcdefghijklmnop');
    expect(lines[0]).not.toContain('u:pw@');
    expect(lines[0]).not.toContain('A'.repeat(100));
    expect(lines[0]).toContain('<REDACTED_BASE64');
  });

  it('KHÔNG ghi base64 của file: data URL và cả chuỗi base64 thô (không tiền tố) đều bị thay bằng độ dài', () => {
    process.env.LOG_JOB_LLM_IO = 'true';
    const { job, lines } = makeJob();
    const pdfB64 = 'JVBERi0xLjQKJcfsj6IKNSAwIG9iag' + 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo'.repeat(400); // ~14.000 ký tự
    new Logger({}, job).jobLlmIo('[AIHub] OUTPUT', `Kết quả: ${pdfB64} và data:application/pdf;base64,${pdfB64}`);
    expect(lines[0]).toContain('<REDACTED_BASE64');
    expect(lines[0]).not.toContain('QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo'.repeat(3));
    expect(lines[0].length).toBeLessThan(1000);
  });

  it('stripRawBase64: giữ 16 ký tự đầu để nhận ra loại dữ liệu, không đụng văn bản thường, hash, UUID hay JSON', () => {
    const raw = 'JVBERi0xLjQK' + 'A'.repeat(500);
    expect(stripRawBase64(raw)).toBe(`${raw.slice(0, 16)}<REDACTED_BASE64 chars=${raw.length}>`);
    const normal = 'Hồ sơ vay của ông Nguyễn Văn An, số tiền 500.000.000 đồng. {"id":"0c0ef6d8-ded7-4f12-8ac5-6689027c7d53"}';
    expect(stripRawBase64(normal)).toBe(normal);
    const sha256 = 'a'.repeat(64);
    expect(stripRawBase64(`hash ${sha256} md5 ${'b'.repeat(32)}`)).toBe(`hash ${sha256} md5 ${'b'.repeat(32)}`);
  });

  it('cắt theo LOG_JOB_LLM_IO_CAP, kết quả không vượt trần (kèm phần đệm tiền tố)', () => {
    process.env.LOG_JOB_LLM_IO = 'true';
    process.env.LOG_JOB_LLM_IO_CAP = '1000';
    const { job, lines } = makeJob();
    new Logger({}, job).jobLlmIo('[AIHub] OUTPUT', 'x'.repeat(50_000));
    expect(lines[0].length).toBeLessThanOrEqual(1000 + 96);
    expect(lines[0]).toMatch(/len=\d+/);
  });

  it('không có job gắn kèm (log hệ thống) thì không làm gì và không ném lỗi', () => {
    process.env.LOG_JOB_LLM_IO = 'true';
    expect(() => new Logger({ service: 'worker' }).jobLlmIo('[AIHub] PROMPT', 'abc')).not.toThrow();
  });

  it('job.log bị từ chối (Redis lỗi) không làm sập worker', async () => {
    process.env.LOG_JOB_LLM_IO = 'true';
    const job = { log: jest.fn(async () => { throw new Error('redis down'); }) } as unknown as Job<any, any, any>;
    expect(() => new Logger({}, job).jobLlmIo('[AIHub] PROMPT', 'abc')).not.toThrow();
    await Promise.resolve();
  });

  it('log thường vẫn bị cắt như cũ khi LOG_JOB_LLM_IO bật (ngoại lệ chỉ áp cho jobLlmIo)', () => {
    process.env.LOG_JOB_LLM_IO = 'true';
    const { job, lines } = makeJob();
    new Logger({}, job).info('thông thường', { note: 'y'.repeat(50_000) });
    expect(lines[0].length).toBeLessThanOrEqual(2000);
  });
});
