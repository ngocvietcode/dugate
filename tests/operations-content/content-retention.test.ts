// Giai đoạn 2 — customer content is not kept long-term, rows and metadata are.
// lib/operations/content-retention.ts: scrub helpers, workflow sub-step purge,
// the N-day TTL with its legacy/backfill gate, dry-run and per-run cap.

import { createQueryRecorder, toSqlText } from '../operations-visibility/helpers';

const mockRecorder = createQueryRecorder();

jest.mock('@/lib/db', () => ({
  get db() { return mockRecorder.db; },
}));

import {
  buildContentPurgePatch,
  DEFAULT_CONTENT_RETENTION_DAYS,
  PURGED_VALUE,
  purgeExpiredOperationContent,
  purgeWorkflowSubSteps,
  readContentRetentionConfig,
  scrubFilesJson,
  scrubPipelineJson,
  scrubStepsResultJson,
  sha256Hex,
  sweepWorkflowSubSteps,
} from '@/lib/operations/content-retention';
import { extractTrustedChildOperationIds } from '@/lib/operations/backfill';

const CUSTOMER = 'NGUYEN VAN A — CCCD 001099012345';
const PROMPT = `Trích xuất thông tin từ hồ sơ: ${CUSTOMER}`;
const NOW = new Date('2026-09-17T08:00:00.000Z');

const logger = { info: jest.fn(), warn: jest.fn() };

/** completedAt < cutoff, or updatedAt < cutoff for legacy rows without completedAt. */
const FINISHED_BEFORE = /"completedAt" < \$\d+ or \("Operation"\."completedAt" is null and "Operation"\."updatedAt" < \$\d+\)/;

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'op-1',
    pipelineJson: JSON.stringify([{
      processor: 'ext-data-extractor',
      stepId: 'step-a',
      variables: {
        customer_name: CUSTOMER,
        empty_field: '',
        _prompt: PROMPT,
        _model: 'gpt-5',
        _reasoning_effort: 'high',
        encryption_fields: 'extracted_data.name',
        _original_file_urls: [{ url: 'https://files.example/a.pdf?sig=SECRET', filename: 'a.pdf', mime_type: 'application/pdf' }],
      },
    }]),
    stepsResultJson: JSON.stringify([{
      step: 0,
      stepName: 'Phân loại',
      processor: 'ext-classifier',
      sub_operation_id: 'child-top',
      status: 'SUCCESS',
      content_preview: CUSTOMER,
      extracted_data: { name: CUSTOMER, sub_documents: [{ sub_operation_id: 'child-nested', content: CUSTOMER }] },
      pipeline_state_snapshot: { x: CUSTOMER },
    }]),
    filesJson: JSON.stringify([{
      name: 'a.pdf', mime: 'application/pdf', size: 10, path: 'uploads/op-1/a.pdf',
      url: 'https://files.example/a.pdf?sig=SECRET', isRemoteUrl: true,
      s3Key: 'op-1/a.pdf', fileCacheId: 'cache-1',
    }]),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRecorder.reset();
});

describe('configuration', () => {
  it('defaults to 7 days, 5000 rows per run, dry-run off', () => {
    expect(readContentRetentionConfig({})).toEqual({
      retentionDays: DEFAULT_CONTENT_RETENTION_DAYS,
      maxPerRun: 5000,
      dryRun: false,
      warnings: [],
    });
    expect(DEFAULT_CONTENT_RETENTION_DAYS).toBe(7);
  });

  it('reads the parameters, 0 disables the TTL, invalid values fall back with a warning', () => {
    expect(readContentRetentionConfig({
      OPERATION_CONTENT_RETENTION_DAYS: '30',
      OPERATION_CONTENT_PURGE_MAX_PER_RUN: '100',
      OPERATION_CONTENT_PURGE_DRY_RUN: 'true',
    })).toMatchObject({ retentionDays: 30, maxPerRun: 100, dryRun: true, warnings: [] });
    expect(readContentRetentionConfig({ OPERATION_CONTENT_RETENTION_DAYS: '0' }).retentionDays).toBe(0);

    const invalid = readContentRetentionConfig({
      OPERATION_CONTENT_RETENTION_DAYS: '-1',
      OPERATION_CONTENT_PURGE_MAX_PER_RUN: '0',
    });
    expect(invalid).toMatchObject({ retentionDays: 7, maxPerRun: 5000 });
    expect(invalid.warnings).toHaveLength(2);
  });
});

describe('scrub helpers', () => {
  it('keeps parameter names, encryption config and model overrides; hashes the prompt', () => {
    const [step] = JSON.parse(scrubPipelineJson(sourceRow().pipelineJson));
    expect(step).toEqual({
      processor: 'ext-data-extractor',
      stepId: 'step-a',
      variables: {
        customer_name: PURGED_VALUE,
        empty_field: '',
        _prompt: PURGED_VALUE,
        _prompt_length: PROMPT.length,
        _prompt_sha256: sha256Hex(PROMPT),
        _model: 'gpt-5',
        _reasoning_effort: 'high',
        encryption_fields: 'extracted_data.name',
        _original_file_urls: [{ filename: 'a.pdf', mime_type: 'application/pdf', url: 'https://files.example/a.pdf' }],
      },
    });
  });

  it('reduces step results to a skeleton but keeps every child operation link', () => {
    const raw = sourceRow().stepsResultJson;
    const scrubbed = scrubStepsResultJson(raw)!;
    expect(JSON.parse(scrubbed)).toEqual([{
      step: 0,
      stepName: 'Phân loại',
      processor: 'ext-classifier',
      sub_operation_id: 'child-top',
      status: 'SUCCESS',
      sub_results: [{ sub_operation_id: 'child-nested' }],
      content_purged: true,
    }]);
    // The request-tracking backfill still finds the same children after a purge.
    expect(extractTrustedChildOperationIds(scrubbed)).toEqual(extractTrustedChildOperationIds(raw));
    expect(scrubStepsResultJson(null)).toBeNull();
  });

  it('drops file URLs but keeps name, type, size and the storage keys file cleanup needs', () => {
    expect(JSON.parse(scrubFilesJson(sourceRow().filesJson)!)).toEqual([{
      name: 'a.pdf', mime: 'application/pdf', size: 10, path: 'uploads/op-1/a.pdf', isRemoteUrl: true,
      s3Key: 'op-1/a.pdf', fileCacheId: 'cache-1',
    }]);
  });

  it('builds a patch that clears results and leaves no customer text', () => {
    const patch = buildContentPurgePatch(sourceRow(), NOW);
    expect(patch).toMatchObject({ extractedData: null, outputContent: null, contentPurgedAt: NOW });
    expect(JSON.stringify(patch)).not.toContain(CUSTOMER);
    expect(JSON.stringify(patch)).not.toContain('SECRET');
  });
});

describe('purgeWorkflowSubSteps', () => {
  it('scrubs finished hidden children linked by ID or by correlationId, preserving updatedAt', async () => {
    mockRecorder.enqueueResult([{ correlationId: 'corr-stored', createdAt: new Date('2026-09-17T07:00:00Z') }]);
    mockRecorder.enqueueResult([{ id: 'child-top' }]); // candidate IDs
    mockRecorder.enqueueResult([sourceRow({ id: 'child-top' })]); // content, one row at a time
    mockRecorder.enqueueResult([{ id: 'child-top' }]); // UPDATE … RETURNING

    const purged = await purgeWorkflowSubSteps({
      parentOperationId: 'parent-1',
      correlationIds: ['corr-job'],
      references: [[{ step: 0, sub_operation_id: 'child-top' }], { nested: { subOperationId: 'child-2' } }],
      logger,
      now: NOW,
    });

    expect(purged).toBe(1);
    const childQuery = toSqlText(mockRecorder.whereArgs[1]);
    expect(childQuery).toMatch(/"id" <> \$/);
    expect(childQuery).toMatch(/"contentPurgedAt" is null/);
    expect(childQuery).toMatch(/"hiddenFromOperations" = \$/);
    expect(childQuery).toMatch(/"done" = \$/);
    expect(childQuery).toMatch(/"id" in \(\$\d+, \$\d+\)/);
    expect(childQuery).toMatch(/"correlationId" in \(\$\d+, \$\d+\)/);
    // Correlation links (client-controlled id) only take children finished a while ago.
    expect(childQuery).toMatch(FINISHED_BEFORE);

    const update = mockRecorder.setArgs[0] as Record<string, unknown>;
    expect(update).toMatchObject({ extractedData: null, outputContent: null, contentPurgedAt: NOW });
    expect(toSqlText(update.updatedAt)).toBe('"Operation"."updatedAt"');
    expect(toSqlText(mockRecorder.whereArgs[3])).toMatch(/"id" = \$1 and "Operation"\."contentPurgedAt" is null/);
  });

  it('never throws: a database failure is logged and left to the sweeper', async () => {
    mockRecorder.db.select.mockImplementationOnce(() => { throw new Error('db down'); });
    await expect(purgeWorkflowSubSteps({
      parentOperationId: 'parent-1', correlationIds: ['corr'], references: [], logger,
    })).resolves.toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('sweepWorkflowSubSteps', () => {
  it('targets finished hidden connector children past the grace period', async () => {
    mockRecorder.enqueueResult([]);
    await sweepWorkflowSubSteps({ env: {}, now: NOW, pauseMs: 0, logger });
    const where = toSqlText(mockRecorder.whereArgs[0]);
    expect(where).toMatch(/"hiddenFromOperations" = \$/);
    expect(where).toMatch(/not like \$/); // never a workflows:* parent
    expect(where).toMatch(/"state" in/);
    expect(mockRecorder.db.update).not.toHaveBeenCalled();
  });
});

describe('purgeExpiredOperationContent (TTL)', () => {
  const legacyCutoff = '2026-09-01T00:00:00.000Z';

  function enqueueGateLookups(backfillPhase: string | null) {
    mockRecorder.enqueueResult([]); // INSERT … ON CONFLICT DO NOTHING (legacy cutoff)
    mockRecorder.enqueueResult([{ value: JSON.stringify({ legacyCutoff }) }]);
    mockRecorder.enqueueResult(backfillPhase ? [{ value: JSON.stringify({ phase: backfillPhase }) }] : []);
  }

  it('does nothing when OPERATION_CONTENT_RETENTION_DAYS=0', async () => {
    const result = await purgeExpiredOperationContent({ env: { OPERATION_CONTENT_RETENTION_DAYS: '0' }, now: NOW, logger });
    expect(result).toMatchObject({ skipped: 'disabled', purged: 0 });
    expect(mockRecorder.db.select).not.toHaveBeenCalled();
    expect(mockRecorder.db.update).not.toHaveBeenCalled();
  });

  it('only scrubs terminal rows past N days, and spares legacy rows until the backfill completes', async () => {
    enqueueGateLookups('operations');
    mockRecorder.enqueueResult([{ id: 'op-1' }]);
    mockRecorder.enqueueResult([sourceRow()]);
    mockRecorder.enqueueResult([{ id: 'op-1' }]);

    const result = await purgeExpiredOperationContent({ env: {}, now: NOW, pauseMs: 0, logger });

    expect(result).toMatchObject({ purged: 1, scanned: 1, legacyBlocked: true, retentionDays: 7, capped: false });
    const where = toSqlText(mockRecorder.whereArgs[2]);
    expect(where).toMatch(/"contentPurgedAt" is null/);
    expect(where).toMatch(/"done" = \$/);
    expect(where).toMatch(/"state" in \(\$\d+, \$\d+, \$\d+\)/);
    expect(where).toMatch(FINISHED_BEFORE);
    expect(where).toMatch(/"createdAt" >= \$/);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('backfill'), expect.anything());
    // Rows are never deleted.
    expect(mockRecorder.db).not.toHaveProperty('delete');
  });

  it('includes legacy rows once the backfill reports phase=complete', async () => {
    enqueueGateLookups('complete');
    mockRecorder.enqueueResult([]);
    const result = await purgeExpiredOperationContent({ env: {}, now: NOW, pauseMs: 0, logger });
    expect(result.legacyBlocked).toBe(false);
    expect(toSqlText(mockRecorder.whereArgs[2])).not.toMatch(/"createdAt" >=/);
  });

  it('dry-run only counts', async () => {
    enqueueGateLookups('complete');
    mockRecorder.enqueueResult([{ count: 42 }]);
    const result = await purgeExpiredOperationContent({
      env: { OPERATION_CONTENT_PURGE_DRY_RUN: 'true' }, now: NOW, pauseMs: 0, logger,
    });
    expect(result).toMatchObject({ dryRun: true, scanned: 42, purged: 0 });
    expect(mockRecorder.db.update).not.toHaveBeenCalled();
  });

  it('stops at OPERATION_CONTENT_PURGE_MAX_PER_RUN', async () => {
    enqueueGateLookups('complete');
    mockRecorder.enqueueResult([{ id: 'a' }, { id: 'b' }]);
    mockRecorder.enqueueResult([sourceRow({ id: 'a' })]);
    mockRecorder.enqueueResult([{ id: 'a' }]);
    mockRecorder.enqueueResult([sourceRow({ id: 'b' })]);
    mockRecorder.enqueueResult([{ id: 'b' }]);
    const result = await purgeExpiredOperationContent({
      env: { OPERATION_CONTENT_PURGE_MAX_PER_RUN: '2' }, now: NOW, pauseMs: 0, logger,
    });
    expect(result).toMatchObject({ scanned: 2, purged: 2, capped: true });
    expect(mockRecorder.db.update).toHaveBeenCalledTimes(2);
  });
});
