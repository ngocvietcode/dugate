import {
  BUSINESS_OPERATION_LIST_PAGE_SIZE,
  CONSTITUENT_REQUEST_PAGE_SIZE,
  buildBusinessOperationTrend,
  createBusinessOperationListPage,
  createConstituentRequestDetailPage,
  createTrendDrillDownPredicate,
  matchesTrendDrillDown,
  searchBusinessOperations,
  validateBusinessOperationSearchQuery,
  type OperationalDetailSource,
} from '@/lib/operations/reference-helpers';
import { projectBusinessOperations } from '@/lib/operations/projection';
import { resolveTimeWindow } from '@/lib/operations/time-window';

interface TestSource extends OperationalDetailSource {
  filesJson?: string;
  pipelineJson?: string;
  extractedData?: string;
  outputContent?: string;
}

const at = (iso: string): Date => new Date(iso);

function request(
  overrides: Partial<TestSource> & Pick<TestSource, 'id'>,
): TestSource {
  return {
    apiKeyId: 'profile-a',
    clientReference: 'REF-1',
    endpointSlug: 'extract',
    state: 'SUCCEEDED',
    createdAt: at('2026-03-01T00:00:00.000Z'),
    updatedAt: at('2026-03-01T00:05:00.000Z'),
    completedAt: at('2026-03-01T00:04:00.000Z'),
    deletedAt: null,
    hiddenFromOperations: false,
    totalInputTokens: 10,
    totalOutputTokens: 5,
    totalCostUsd: '0.1234567890',
    inputTokensMissing: false,
    outputTokensMissing: false,
    costMissing: false,
    hasUnpricedCost: false,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

describe('Business Operation reference search helpers', () => {
  it('validates trimmed queries from 1 through 256 Unicode characters', () => {
    expect(validateBusinessOperationSearchQuery('   ')).toEqual({
      valid: false,
      reason: 'EMPTY',
    });
    expect(validateBusinessOperationSearchQuery(` ${'😀'.repeat(256)} `)).toEqual({
      valid: true,
      query: '😀'.repeat(256),
    });
    expect(validateBusinessOperationSearchQuery('😀'.repeat(257))).toEqual({
      valid: false,
      reason: 'TOO_LONG',
    });
  });

  it('matches exact normalized references or request IDs and contains references case-insensitively', () => {
    const allOperations = projectBusinessOperations([
      request({ id: 'request-a', clientReference: '  Case-Alpha  ' }),
      request({ id: 'request-b', clientReference: 'case-beta' }),
      request({
        id: 'unauthorized-request',
        apiKeyId: 'profile-private',
        clientReference: 'Case-Private',
      }),
    ]);
    const authorized = allOperations.filter(
      (operation) => operation.profileScope.kind === 'profile'
        && operation.profileScope.apiKeyId === 'profile-a',
    );

    const exactReference = searchBusinessOperations(authorized, ' Case-Alpha ', 'exact');
    const exactRequest = searchBusinessOperations(authorized, 'request-b', 'exact');
    const contains = searchBusinessOperations(authorized, 'CASE-', 'contains');
    const invalid = searchBusinessOperations(authorized, ' ', 'exact');

    expect(exactReference.valid && exactReference.items.map(
      (operation) => operation.operationIdentifier,
    )).toEqual(['Case-Alpha']);
    expect(exactRequest.valid && exactRequest.items.map(
      (operation) => operation.operationIdentifier,
    )).toEqual(['case-beta']);
    expect(contains.valid && contains.items.map(
      (operation) => operation.operationIdentifier,
    )).toEqual(['Case-Alpha', 'case-beta']);
    expect(invalid).toEqual({ valid: false, reason: 'EMPTY' });
    expect(contains.valid && contains.items.some(
      (operation) => operation.operationIdentifier === 'Case-Private',
    )).toBe(false);
  });
});

describe('Business Operation list and detail pagination helpers', () => {
  it('orders list rows by updated time descending then binary identifier and pages at 50', () => {
    const operations = projectBusinessOperations(Array.from({ length: 51 }, (_, index) => {
      const identifier = `REF-${String(50 - index).padStart(2, '0')}`;
      return request({
        id: `request-${index}`,
        clientReference: identifier,
        updatedAt: index === 50
          ? at('2026-03-02T00:00:00.000Z')
          : at('2026-03-01T00:05:00.000Z'),
      });
    }));

    const first = createBusinessOperationListPage(operations, 1);
    const second = createBusinessOperationListPage(operations, 2);
    const identifiers = [...first.items, ...second.items].map(
      (operation) => operation.operationIdentifier,
    );

    expect(first.pageSize).toBe(BUSINESS_OPERATION_LIST_PAGE_SIZE);
    expect(first.items).toHaveLength(50);
    expect(first.total).toBe(51);
    expect(first.totalPages).toBe(2);
    expect(second.items).toHaveLength(1);
    expect(identifiers[0]).toBe('REF-00');
    expect(identifiers.slice(1)).toEqual(
      [...identifiers.slice(1)].sort(),
    );
    expect(new Set(identifiers).size).toBe(51);
    expect(() => createBusinessOperationListPage(operations, 0)).toThrow(RangeError);
  });

  it('maps only operational detail fields, null display semantics, and pages at 100', () => {
    const requests = Array.from({ length: 101 }, (_, index) => request({
      id: `request-${String(index).padStart(3, '0')}`,
      clientReference: 'DETAIL',
      endpointSlug: index === 0 ? null : 'extract',
      state: 'RUNNING',
      completedAt: null,
      totalInputTokens: index === 0 ? null : index,
      totalOutputTokens: index,
      totalCostUsd: index === 0 ? null : '1.0000000000',
      inputTokensMissing: index === 0,
      costMissing: index === 0,
      filesJson: 'private document payload',
      pipelineJson: 'private pipeline payload',
      extractedData: 'private extracted payload',
      outputContent: 'private output payload',
    })).reverse();
    const operation = projectBusinessOperations(requests)[0];

    const first = createConstituentRequestDetailPage(operation, 1);
    const second = createConstituentRequestDetailPage(operation, 2);
    const firstItem = first.items[0];

    expect(first.pageSize).toBe(CONSTITUENT_REQUEST_PAGE_SIZE);
    expect(first.items).toHaveLength(100);
    expect(first.totalPages).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(['request-100']);
    expect(firstItem).toMatchObject({
      id: 'request-000',
      operationType: null,
      completedAt: null,
      inputTokens: null,
      costUsd: null,
      missingData: true,
      nullDisplay: {
        operationType: 'MISSING',
        completedAt: 'PROCESSING',
        inputTokens: 'MISSING',
        costUsd: 'MISSING',
      },
    });
    expect(firstItem).not.toHaveProperty('source');
    expect(firstItem).not.toHaveProperty('filesJson');
    expect(firstItem).not.toHaveProperty('pipelineJson');
    expect(firstItem).not.toHaveProperty('extractedData');
    expect(firstItem).not.toHaveProperty('outputContent');
  });
});

describe('Business Operation trend reference helpers', () => {
  it('gap-fills local buckets, assigns valid statuses once, and creates a composable drill-down', () => {
    const window = resolveTimeWindow(
      'today',
      at('2025-01-15T05:30:00.000Z'),
      'Asia/Ho_Chi_Minh',
    );
    const operations = projectBusinessOperations([
      request({
        id: 'succeeded',
        clientReference: 'SUCCEEDED',
        createdAt: at('2025-01-15T03:15:00.000Z'),
        updatedAt: at('2025-01-15T03:20:00.000Z'),
        completedAt: at('2025-01-15T03:20:00.000Z'),
      }),
      request({
        id: 'failed',
        clientReference: 'FAILED',
        state: 'FAILED',
        createdAt: at('2025-01-15T04:00:00.000Z'),
        updatedAt: at('2025-01-15T04:20:00.000Z'),
        completedAt: at('2025-01-15T04:20:00.000Z'),
      }),
      request({
        id: 'running',
        clientReference: 'RUNNING',
        state: 'RUNNING',
        createdAt: at('2025-01-15T04:10:00.000Z'),
        updatedAt: at('2025-01-15T04:20:00.000Z'),
        completedAt: null,
      }),
      request({
        id: 'unknown',
        clientReference: 'UNKNOWN',
        state: 'CORRUPT',
        createdAt: at('2025-01-15T04:20:00.000Z'),
        updatedAt: at('2025-01-15T04:20:00.000Z'),
        completedAt: null,
      }),
    ]);

    const points = buildBusinessOperationTrend(operations, window);
    const hour10 = points.find((point) => point.localKey === '2025-01-15T10')!;
    const hour11 = points.find((point) => point.localKey === '2025-01-15T11')!;
    const emptyHour = points.find((point) => point.localKey === '2025-01-15T00')!;

    expect(emptyHour.counts).toEqual({
      IN_PROGRESS: 0,
      SUCCEEDED: 0,
      FAILED: 0,
    });
    expect(emptyHour.total).toBe(0);
    expect(hour10.counts).toEqual({
      IN_PROGRESS: 0,
      SUCCEEDED: 1,
      FAILED: 0,
    });
    expect(hour11.counts).toEqual({
      IN_PROGRESS: 1,
      SUCCEEDED: 0,
      FAILED: 1,
    });
    expect(hour11.total).toBe(2);
    expect(points.reduce((sum, point) => sum + point.total, 0)).toBe(3);

    const drillDown = createTrendDrillDownPredicate(hour11, 'FAILED');
    expect(operations.filter((operation) => matchesTrendDrillDown(
      operation,
      drillDown,
    )).map((operation) => operation.operationIdentifier)).toEqual(['FAILED']);
    expect(drillDown).toMatchObject({
      start: at('2025-01-15T04:00:00.000Z'),
      end: at('2025-01-15T05:00:00.000Z'),
      endInclusive: false,
      businessStatus: 'FAILED',
    });
  });
});
