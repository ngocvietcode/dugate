// Giai đoạn 2 — the Operations detail page renders metadata only and no longer
// offers JSON / HTML / raw-output downloads.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';

import ResultSection from '@/app/operations/[id]/components/ResultSection';
import RequestInfoSection from '@/app/operations/[id]/components/RequestInfoSection';
import PipelineTimeline from '@/app/operations/[id]/components/PipelineTimeline';
import type { OperationDetail } from '@/app/operations/types';

function detail(overrides: Partial<OperationDetail> = {}): OperationDetail {
  return {
    id: 'parent-1',
    done: true,
    state: 'SUCCEEDED',
    endpointSlug: 'workflows:loan-appraisal',
    progressPercent: 100,
    progressMessage: null,
    progressHistory: [],
    currentStep: 1,
    errorCode: null,
    errorMessage: null,
    failedAtStep: null,
    totalInputTokens: 120,
    totalOutputTokens: 30,
    totalCostUsd: 0.25,
    apiKeyId: 'profile-1',
    profileName: 'Loan',
    createdAt: '2026-09-17T01:00:00.000Z',
    updatedAt: '2026-09-17T01:05:00.000Z',
    completedAt: '2026-09-17T01:04:00.000Z',
    idempotencyKey: null,
    pipelineJson: [{ processor: 'workflows:loan-appraisal', parameterNames: ['cif', 'customer_name'] }],
    originalFileUrls: [],
    stepsResultJson: [{ step: 0, stepName: 'Phân loại', processor: 'ext-classifier' }],
    waitingInput: null,
    resultSummary: null,
    outputFormat: 'json',
    filesJson: [{ name: 'hs.pdf', mime: 'application/pdf', size: 2048, isRemoteUrl: false, url: null }],
    usageBreakdown: [],
    webhookUrl: null,
    webhookSentAt: null,
    webhookAttempts: null,
    webhookLastError: null,
    pagesProcessed: 3,
    modelUsed: null,
    filesDeleted: false,
    contentPurgedAt: null,
    subSteps: [{
      id: 'child-1', processor: 'ext-classifier', model: 'gpt-5', reasoningEffort: null, fileName: 'hs.pdf',
      state: 'SUCCEEDED', createdAt: '2026-09-17T01:01:00.000Z', completedAt: '2026-09-17T01:01:04.000Z',
      durationMs: 4000, inputTokens: 100, outputTokens: 20, costUsd: 0.2, errorCode: null, errorMessage: null,
      promptLength: 1200, promptSha256: 'abc', contentPurged: false,
    }],
    ...overrides,
  } as OperationDetail;
}

describe('Operations detail UI', () => {
  it('shows a successful result without any download or result viewer', () => {
    const html = renderToStaticMarkup(createElement(ResultSection, { operation: detail() }));
    expect(html).toContain('Kết quả xử lý');
    for (const removed of ['Tải JSON', 'Export HTML', 'Tải output gốc', 'Output Summary', 'Extracted Data']) {
      expect(html).not.toContain(removed);
    }
  });

  it('lists parameter names only', () => {
    const html = renderToStaticMarkup(createElement(RequestInfoSection, { operation: detail() }));
    expect(html).toContain('customer_name');
    expect(html).toContain('cif');
    expect(html).toContain('hs.pdf');
    expect(html).toContain('giá trị được ẩn');
  });

  it('summarises steps and sub-steps without a prompt panel', () => {
    const operation = detail();
    const html = renderToStaticMarkup(createElement(PipelineTimeline, {
      pipelineJson: operation.pipelineJson,
      stepsResultJson: operation.stepsResultJson,
      currentStep: operation.currentStep,
      failedAtStep: null,
      operationState: 'SUCCEEDED',
      endpointSlug: operation.endpointSlug,
      subSteps: operation.subSteps,
    }));
    expect(html).toContain('Phân loại');
    expect(html).toContain('1 bước con');
    expect(html).not.toContain('Prompt đã gửi cho model');
    expect(html).not.toContain('Xem chi tiết');
  });

  it('removes the JSON / HTML export toolbar and its row selection', () => {
    const root = path.join(__dirname, '..', '..', 'app', 'operations');
    expect(fs.existsSync(path.join(root, 'components', 'ExportToolbar.tsx'))).toBe(false);
    const table = fs.readFileSync(path.join(root, 'components', 'OperationsTable.tsx'), 'utf8');
    expect(table).not.toContain('type="checkbox"');
    const requests = fs.readFileSync(path.join(root, 'components', 'RequestsTab.tsx'), 'utf8');
    expect(requests).toContain('CsvExportButton');
  });
});
