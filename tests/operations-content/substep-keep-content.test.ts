// WORKFLOW_SUBSTEP_KEEP_CONTENT: giữ prompt + kết quả của bước con workflow (không file), chỉ ADMIN xem.

import { keepWorkflowSubStepContent, sweepWorkflowSubSteps } from '@/lib/operations/content-retention';
import { toSubStepView, type SubStepSourceRow } from '@/lib/operations/detail-view';

jest.mock('@/lib/db', () => ({ db: { select: jest.fn(), update: jest.fn(), insert: jest.fn() } }));

const NOW = new Date('2026-10-21T08:00:00Z');

function row(over: Partial<SubStepSourceRow & { outputContent: string | null; extractedData: string | null }> = {}) {
  return {
    id: 'sub-1',
    endpointSlug: 'ext-fact-verifier',
    pipelineJson: JSON.stringify([{ processor: 'ext-fact-verifier', variables: { _prompt: 'PROMPT-GOC', _model: 'm' } }]),
    filesJson: JSON.stringify([{ name: 'neutral.pdf', path: '/s/x.pdf' }]),
    state: 'SUCCEEDED',
    createdAt: NOW, completedAt: NOW, updatedAt: NOW, done: true,
    totalInputTokens: 1, totalOutputTokens: 2, totalCostUsd: 0.1,
    errorCode: null, errorMessage: null, contentPurgedAt: null, correlationId: 'c',
    outputContent: '{"ok":true}', extractedData: null,
    ...over,
  };
}

describe('keepWorkflowSubStepContent', () => {
  it.each([['true', true], ['1', true], ['YES', true], ['false', false], ['', false], [undefined, false]])(
    '%p → %p', (value, expected) => {
      expect(keepWorkflowSubStepContent({ WORKFLOW_SUBSTEP_KEEP_CONTENT: value })).toBe(expected);
    },
  );
});

describe('toSubStepView nội dung bước con', () => {
  it('mặc định không trả prompt / output', () => {
    const v = toSubStepView(row());
    expect(v).not.toHaveProperty('prompt');
    expect(v).not.toHaveProperty('output');
    expect(v.promptLength).toBe('PROMPT-GOC'.length);
  });

  it('includeContent: trả prompt + output, không trả file', () => {
    const v = toSubStepView(row(), true);
    expect(v.prompt).toBe('PROMPT-GOC');
    expect(v.output).toBe('{"ok":true}');
    expect(JSON.stringify(v)).not.toContain('/s/x.pdf');
  });

  it('output rỗng thì lấy extractedData', () => {
    expect(toSubStepView(row({ outputContent: null, extractedData: '{"a":1}' }), true).output).toBe('{"a":1}');
  });

  it('đã purge (contentPurgedAt) hoặc prompt là [purged] → không trả nội dung', () => {
    expect(toSubStepView(row({ contentPurgedAt: NOW }), true)).not.toHaveProperty('prompt');
    const purged = row({ pipelineJson: JSON.stringify([{ variables: { _prompt: '[purged]', _prompt_length: 10 } }]) });
    expect(toSubStepView(purged, true).prompt).toBeNull();
  });
});

describe('sweepWorkflowSubSteps khi giữ nội dung', () => {
  it('không quét, không chạm DB', async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    const result = await sweepWorkflowSubSteps({
      env: { WORKFLOW_SUBSTEP_KEEP_CONTENT: 'true' }, now: NOW, pauseMs: 0, logger,
    });
    expect(result).toMatchObject({ scanned: 0, purged: 0 });
    const { db } = jest.requireMock('@/lib/db');
    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
});
