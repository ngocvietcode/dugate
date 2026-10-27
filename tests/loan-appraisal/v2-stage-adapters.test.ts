// Tên file ở bảng bước con: model chỉ thấy tên trung tính (S1-R03), trang chi tiết thấy tên gốc + dải trang.
const enqueueSubStep = jest.fn(async () => ({ content: '{}' }));
jest.mock('@/lib/pipelines/workflow-engine', () => ({
  enqueueSubStep: (...args: unknown[]) => enqueueSubStep(...(args as [])),
  assertNotCancelled: jest.fn(async () => undefined),
  WorkflowCancelledError: class extends Error {},
}));
const upload = jest.fn(async () => undefined);
jest.mock('@/lib/storage', () => ({ getStorageBackend: async () => ({ upload, deleteMany: jest.fn() }) }));
jest.mock('@/lib/pipelines/workflows/financial-report/pdf-utils', () => ({ readWorkflowFile: jest.fn() }));

import { createDossierPorts } from '@/lib/pipelines/workflows/loan-appraisal/stage-adapters';
import type { WorkflowContext } from '@/lib/pipelines/workflow-engine';

const ctx = {
  operationId: 'op-1',
  filesData: [{ name: 'CCCD Tran Thanh Tuan.pdf', path: 'uploads/a.pdf', mime: 'application/pdf', size: 10 }],
  modelOverrides: {}, reasoningEffortOverrides: {},
  logger: { warn: jest.fn() },
} as unknown as WorkflowContext;

function sentFile(callIndex: number): { name: string; display_name?: string } {
  const filesJson = (enqueueSubStep.mock.calls[callIndex] as unknown[])[3] as string;
  return JSON.parse(filesJson)[0];
}

describe('stage-adapters · tên file của bước con', () => {
  beforeEach(() => enqueueSubStep.mockClear());

  it('S2: name trung tính gửi connector, display_name = tên gốc + dải trang', async () => {
    const ports = createDossierPorts(ctx).extractPorts({ 'file-abc': 'uploads/a.pdf' });
    const base = { file_ref: 'file-abc', mime: 'image/png' as const, doc_type_key: 'id_card', extraction_level: 'FULL' as const, prompt: 'p', content: new Uint8Array([1]) };
    await ports.extractor.extract({ ...base, page_range: [3, 4], page_count: 12 });
    await ports.extractor.extract({ ...base, page_range: [5, 5], page_count: 12 });
    await ports.extractor.extract({ ...base, page_range: [1, 12], page_count: 12 });
    expect(sentFile(0)).toMatchObject({ name: 'file-abc-p3-4.png', display_name: 'CCCD Tran Thanh Tuan.pdf (tr. 3-4)' });
    expect(sentFile(0).name).not.toContain('Tuan');
    expect(sentFile(1).display_name).toBe('CCCD Tran Thanh Tuan.pdf (tr. 5)');
    expect(sentFile(2).display_name).toBe('CCCD Tran Thanh Tuan.pdf');
  });

  it('không tra được tên gốc → không có display_name', async () => {
    const ports = createDossierPorts(ctx).extractPorts({ 'file-x': 'uploads/other.pdf' });
    await ports.extractor.extract({ file_ref: 'file-x', mime: 'image/png', doc_type_key: 'id_card', extraction_level: 'FULL', prompt: 'p', content: new Uint8Array([1]), page_range: [1, 1], page_count: 1 });
    expect(sentFile(0).display_name).toBeUndefined();
  });
});
