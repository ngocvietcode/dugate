import {
  buildOperationBackfill,
  createInitialCheckpoint,
  deriveCanonicalResults,
  deriveUnpricedFlag,
  extractTrustedChildOperationIds,
  runOperationsBackfill,
  type ApplyOperationBatchResult,
  type BackfillCheckpoint,
  type HistoricalOperationRow,
  type OperationCursor,
  type OperationMetadataPatch,
  type OperationsBackfillRepository,
  type SnapshotGroupRow,
  type SnapshotPatch,
} from '@/lib/operations/backfill';

const silentLogger = { info: jest.fn(), warn: jest.fn() };

function operation(overrides: Partial<HistoricalOperationRow> = {}): HistoricalOperationRow {
  return {
    id: 'operation-1',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    endpointSlug: null,
    usageBreakdown: null,
    stepsResultJson: null,
    extractedData: null,
    outputContent: null,
    logicResult: null,
    extractionResult: null,
    ...overrides,
  };
}

describe('Operations historical metadata classifiers', () => {
  it('derives unpriced flags only from a valid usageBreakdown array', () => {
    expect(deriveUnpricedFlag(JSON.stringify([
      { model: 'priced', cost_source: 'provider' },
      { model: 'missing-rate', cost_source: 'unpriced' },
    ]))).toBe(true);
    expect(deriveUnpricedFlag(JSON.stringify([{ cost_source: 'none' }]))).toBe(false);
    expect(deriveUnpricedFlag('{invalid')).toBeNull();
    expect(deriveUnpricedFlag(null)).toBeNull();
  });

  it('extracts only exact persisted workflow child ID fields', () => {
    const ids = extractTrustedChildOperationIds(JSON.stringify({
      steps: [
        { sub_operation_id: ' child-b ' },
        { nested: { subOperationId: 'child-a' } },
        { childOperationId: 'not-trusted' },
      ],
    }));

    expect(ids).toEqual(['child-a', 'child-b']);
  });

  it('maps only endpoint-specific trusted workflow outcomes', () => {
    expect(deriveCanonicalResults('workflows:payroll-verify', JSON.stringify({
      skill_code: 'payroll-batch-validation',
      result: { final_decision: 'APPROVED' },
    }))).toEqual({ logicResult: 'PASS', extractionResult: null });

    expect(deriveCanonicalResults('workflows:margin-deposit-profile', JSON.stringify({
      summary: { overall_verdict: 'FAIL' },
    }))).toEqual({ logicResult: 'FAIL', extractionResult: null });

    expect(deriveCanonicalResults('workflows:tracing-portal', JSON.stringify({
      skill_code: 'tracing-portal',
      status: 'PARTIAL',
    }))).toEqual({ logicResult: null, extractionResult: 'FAIL' });

    expect(deriveCanonicalResults('workflows:other', JSON.stringify({
      skill_code: 'payroll-batch-validation',
      result: { final_decision: 'APPROVED' },
    }))).toEqual({ logicResult: null, extractionResult: null });
    expect(deriveCanonicalResults('workflows:margin-deposit-profile', JSON.stringify({
      summary: { overall_verdict: 'WARNING' },
    }))).toEqual({ logicResult: null, extractionResult: null });
  });

  it('does not overwrite an already canonical result or infer missing flags', () => {
    const result = buildOperationBackfill(operation({
      endpointSlug: 'workflows:payroll-verify',
      extractedData: JSON.stringify({
        skill_code: 'payroll-batch-validation',
        result: { final_decision: 'APPROVED' },
      }),
      logicResult: 'FAIL',
    }));

    expect(result.patch).toBeNull();
    expect(result).not.toHaveProperty('inputTokensMissing');
    expect(result).not.toHaveProperty('outputTokensMissing');
    expect(result).not.toHaveProperty('costMissing');
  });
});

class MemoryRepository implements OperationsBackfillRepository {
  checkpoint: BackfillCheckpoint | null = null;
  readonly metadata = new Map<string, OperationMetadataPatch>();
  readonly hiddenChildren = new Set<string>();
  readonly snapshots = new Map<string, string>();
  operationApplyCalls = 0;
  snapshotApplyCalls = 0;

  constructor(
    readonly operationRows: HistoricalOperationRow[],
    readonly snapshotRows: SnapshotGroupRow[],
  ) {}

  async loadCheckpoint(): Promise<BackfillCheckpoint | null> {
    return this.checkpoint ? structuredClone(this.checkpoint) : null;
  }

  async saveCheckpoint(checkpoint: BackfillCheckpoint): Promise<void> {
    this.checkpoint = structuredClone(checkpoint);
  }

  async readOperationBatch(cursor: OperationCursor | null, limit: number): Promise<HistoricalOperationRow[]> {
    const start = cursor
      ? this.operationRows.findIndex((row) => row.id === cursor.id && row.createdAt.toISOString() === cursor.createdAt) + 1
      : 0;
    return this.operationRows.slice(start, start + limit);
  }

  async applyOperationBatch(
    patches: OperationMetadataPatch[],
    hiddenChildIds: string[],
    checkpoint: BackfillCheckpoint,
  ): Promise<ApplyOperationBatchResult> {
    this.operationApplyCalls += 1;
    patches.forEach((patch) => this.metadata.set(patch.id, { ...this.metadata.get(patch.id), ...patch }));
    const before = this.hiddenChildren.size;
    hiddenChildIds.forEach((id) => this.hiddenChildren.add(id));
    this.checkpoint = structuredClone(checkpoint);
    return {
      metadataRowsUpdated: patches.length,
      hiddenChildrenMarked: this.hiddenChildren.size - before,
    };
  }

  async readSnapshotBatch(cursor: string | null, limit: number): Promise<SnapshotGroupRow[]> {
    const start = cursor
      ? this.snapshotRows.findIndex((row) => row.businessGroupKey === cursor) + 1
      : 0;
    return this.snapshotRows.slice(start, start + limit);
  }

  async applySnapshotBatch(patches: SnapshotPatch[], checkpoint: BackfillCheckpoint): Promise<number> {
    this.snapshotApplyCalls += 1;
    patches.forEach((patch) => this.snapshots.set(patch.businessGroupKey, patch.lastValidStatus));
    this.checkpoint = structuredClone(checkpoint);
    return patches.length;
  }
}

describe('runOperationsBackfill', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resumes batches, hides exact children, and snapshots only groups without unknown states', async () => {
    const repository = new MemoryRepository([
      operation({
        id: 'parent-1',
        usageBreakdown: JSON.stringify([{ cost_source: 'unpriced' }]),
        stepsResultJson: JSON.stringify([{ sub_operation_id: 'child-1' }]),
      }),
      operation({
        id: 'payroll-1',
        createdAt: new Date('2025-01-02T00:00:00.000Z'),
        endpointSlug: 'workflows:payroll-verify',
        extractedData: JSON.stringify({
          skill_code: 'payroll-batch-validation',
          result: { final_decision: 'REVIEW_REQUIRED' },
        }),
      }),
    ], [
      { businessGroupKey: 'group:active', states: ['RUNNING', 'SUCCEEDED'] },
      { businessGroupKey: 'group:failed', states: ['SUCCEEDED', 'FAILED'] },
      { businessGroupKey: 'group:unknown', states: ['SUCCEEDED', 'LEGACY_STATE'] },
    ]);

    const paused = await runOperationsBackfill(repository, {
      batchSize: 1,
      maxBatches: 1,
      logger: silentLogger,
    });
    expect(paused.phase).toBe('operations');
    expect(paused.operationCursor?.id).toBe('parent-1');

    const completed = await runOperationsBackfill(repository, {
      batchSize: 1,
      logger: silentLogger,
    });

    expect(completed.phase).toBe('complete');
    expect(repository.metadata.get('parent-1')).toMatchObject({ hasUnpricedCost: true });
    expect(repository.metadata.get('payroll-1')).toMatchObject({ logicResult: 'FAIL' });
    expect(repository.hiddenChildren).toEqual(new Set(['child-1']));
    expect(repository.snapshots).toEqual(new Map([
      ['group:active', 'IN_PROGRESS'],
      ['group:failed', 'FAILED'],
    ]));
    expect(completed.counters.unknownGroupsSkipped).toBe(1);
  });

  it('is a no-op after completion and uses UPSERT semantics on an explicit restart', async () => {
    const repository = new MemoryRepository([
      operation({ id: 'only-row', usageBreakdown: '[]' }),
    ], [
      { businessGroupKey: 'group:success', states: ['SUCCEEDED'] },
    ]);

    const first = await runOperationsBackfill(repository, { batchSize: 10, logger: silentLogger });
    const operationCalls = repository.operationApplyCalls;
    const snapshotCalls = repository.snapshotApplyCalls;
    const second = await runOperationsBackfill(repository, { batchSize: 10, logger: silentLogger });

    expect(second).toEqual(first);
    expect(repository.operationApplyCalls).toBe(operationCalls);
    expect(repository.snapshotApplyCalls).toBe(snapshotCalls);

    const restarted = await runOperationsBackfill(repository, {
      batchSize: 10,
      restart: true,
      logger: silentLogger,
    });
    expect(restarted.phase).toBe('complete');
    expect(repository.metadata.size).toBe(1);
    expect(repository.snapshots).toEqual(new Map([['group:success', 'SUCCEEDED']]));
  });

  it('does not advance the checkpoint or expose partial writes when an atomic batch fails', async () => {
    class FailingAtomicMemoryRepository extends MemoryRepository {
      failNextBatch = true;

      override async applyOperationBatch(
        patches: OperationMetadataPatch[],
        hiddenChildIds: string[],
        checkpoint: BackfillCheckpoint,
      ): Promise<ApplyOperationBatchResult> {
        if (!this.failNextBatch) {
          return super.applyOperationBatch(patches, hiddenChildIds, checkpoint);
        }

        this.failNextBatch = false;
        // Model a database transaction: writes are staged and discarded when the
        // failure happens before the source mutations and cursor commit atomically.
        const stagedMetadata = new Map(this.metadata);
        const stagedChildren = new Set(this.hiddenChildren);
        patches.forEach((patch) => stagedMetadata.set(patch.id, patch));
        hiddenChildIds.forEach((id) => stagedChildren.add(id));
        throw new Error('simulated transaction failure after staged writes');
      }
    }

    const repository = new FailingAtomicMemoryRepository([
      operation({
        id: 'parent-rollback',
        usageBreakdown: JSON.stringify([{ cost_source: 'unpriced' }]),
        stepsResultJson: JSON.stringify({ sub_operation_id: 'child-rollback' }),
      }),
    ], []);

    await expect(runOperationsBackfill(repository, {
      batchSize: 1,
      logger: silentLogger,
    })).rejects.toThrow('simulated transaction failure');
    expect(repository.checkpoint).toBeNull();
    expect(repository.metadata.size).toBe(0);
    expect(repository.hiddenChildren.size).toBe(0);

    const resumed = await runOperationsBackfill(repository, {
      batchSize: 1,
      logger: silentLogger,
    });
    expect(resumed.phase).toBe('complete');
    expect(repository.metadata.get('parent-rollback')).toMatchObject({ hasUnpricedCost: true });
    expect(repository.hiddenChildren).toEqual(new Set(['child-rollback']));
  });

  it('starts from a versioned empty checkpoint', () => {
    expect(createInitialCheckpoint()).toMatchObject({
      version: 1,
      phase: 'operations',
      operationCursor: null,
      snapshotCursor: null,
    });
  });
});
