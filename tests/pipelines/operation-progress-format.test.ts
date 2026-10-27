import { formatOperationResponse } from '@/lib/pipelines/format';

describe('R14-O6 operation progress formatting', () => {
  it('exposes only the additive in-flight financial-report progress snapshot', () => {
    const response = formatOperationResponse({
      id: 'operation-1', done: false, state: 'RUNNING', pipelineJson: '[]',
      progressPercent: 25, progressMessage: 'Đang phân loại',
      extractedData: JSON.stringify({ progress_details: { total_pages: 48, current_file: 1, file_count: 2, seconds_per_page: 13 } }),
      currentStep: 0, createdAt: new Date(), updatedAt: new Date(), webhookSentAt: null,
      stepsResultJson: null,
    } as never) as { metadata: { progress_details: unknown } };

    expect(response.metadata.progress_details).toEqual({ total_pages: 48, current_file: 1, file_count: 2, seconds_per_page: 13 });
  });

  it('does not expose a stale running snapshot after operation completion', () => {
    const response = formatOperationResponse({
      id: 'operation-1', done: true, state: 'SUCCEEDED', pipelineJson: '[]',
      progressPercent: 100, progressMessage: null, extractedData: JSON.stringify({ code: 200 }),
      currentStep: 1, createdAt: new Date(), updatedAt: new Date(), webhookSentAt: null,
      stepsResultJson: null, outputFormat: 'json', outputContent: null,
      totalInputTokens: 0, totalOutputTokens: 0, pagesProcessed: 0, modelUsed: null, totalCostUsd: 0, usageBreakdown: null,
    } as never) as { metadata: { progress_details: unknown } };

    expect(response.metadata.progress_details).toBeNull();
  });
});
