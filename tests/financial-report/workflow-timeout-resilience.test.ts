const mockCompleteWorkflow = jest.fn();
const mockFailWorkflow = jest.fn();

jest.mock('@/lib/pipelines/workflow-engine', () => ({
  completeWorkflow: (...args: unknown[]) => mockCompleteWorkflow(...args),
  failWorkflow: (...args: unknown[]) => mockFailWorkflow(...args),
  updateProgress: jest.fn(),
  updateWorkflowProgressDetails: jest.fn(),
}));

import {
  buildEnvelope,
  buildWorkflowTimeoutFileResults,
  runFinancialReportTranslation,
} from '@/lib/pipelines/workflows/financial-report-translation';
import type { FileResult, FinancialReportConfig } from '@/lib/pipelines/workflows/financial-report/types';

function config(): FinancialReportConfig {
  return {
    targetLang: 'vi',
    requestId: 'TIMEOUT-BATCH',
    pagesPerChunk: 2,
    notesPagesPerChunk: 1,
    classifyPagesPerCall: 1,
    classifyRecheckUnassigned: true,
    classifyRecheckMaxWindows: 4,
    maxRetries: 3,
    maxConcurrency: 3,
    staggerDelayMs: 0,
    enableTranslation: false,
    renderScale: 2.5,
    reportTypes: [],
  };
}

const succeeded = (index: number): FileResult => ({
  fileId: `GRP-${index}`,
  fileName: `file-${index}.pdf`,
  status: 'SUCCESS',
  errorCode: null,
  errorMessage: null,
  diagnostic: null,
  report: null,
  processingInfo: null,
});

describe('financial report workflow timeout resilience — Round 14.5 P3', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps completed batch files and returns 207 when the deadline reaches file 3', () => {
    const files = [
      { name: 'file-1.pdf', path: '1.pdf', mime: 'application/pdf' },
      { name: 'file-2.pdf', path: '2.pdf', mime: 'application/pdf' },
      { name: 'file-3.pdf', path: '3.pdf', mime: 'application/pdf' },
    ];
    const results = [...[succeeded(1), succeeded(2)], ...buildWorkflowTimeoutFileResults(files, 2)];
    const envelope = buildEnvelope(config(), results);

    const fileResults = envelope.data ?? [];
    expect(envelope.code).toBe(207);
    expect(fileResults.map((result) => result.status)).toEqual(['SUCCESS', 'SUCCESS', 'FAILED']);
    expect(fileResults[2]).toMatchObject({
      fileId: 'GRP-3',
      errorCode: null,
      diagnostic: 'Workflow deadline exceeded before processing this file.',
    });
  });

  it('keeps the existing parent FAILED behavior when a single file times out before any result', async () => {
    const dateNow = jest.spyOn(Date, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValue(101);
    const ctx = {
      operationId: 'single-file-timeout',
      filesData: [{ name: 'only.pdf', path: 'only.pdf', mime: 'application/pdf' }],
      pipelineVars: { workflow_deadline_ms: 1 },
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    } as never;

    await runFinancialReportTranslation(ctx);

    expect(mockCompleteWorkflow).not.toHaveBeenCalled();
    expect(mockFailWorkflow).toHaveBeenCalledWith(ctx, expect.objectContaining({
      message: 'WORKFLOW_TIMEOUT: exceeded 1ms',
    }));
    dateNow.mockRestore();
  });
});
