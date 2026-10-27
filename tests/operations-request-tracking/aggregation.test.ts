import {
  aggregateBusinessOperationBreakdown,
  aggregateBusinessOperations,
  aggregateBusinessOperationsSummary,
  type AggregationRequestSource,
} from '@/lib/operations/aggregation';
import {
  projectBusinessOperations,
  type BusinessOperationProjection,
} from '@/lib/operations/projection';

const at = (iso: string): Date => new Date(iso);

function request(
  overrides: Partial<AggregationRequestSource> & Pick<AggregationRequestSource, 'id'>,
): AggregationRequestSource {
  return {
    apiKeyId: 'profile-a',
    clientReference: 'CASE-A',
    endpointSlug: 'extract',
    state: 'SUCCEEDED',
    createdAt: at('2026-03-01T00:00:00.000Z'),
    updatedAt: at('2026-03-01T00:02:00.000Z'),
    completedAt: at('2026-03-01T00:01:40.000Z'),
    deletedAt: null,
    hiddenFromOperations: false,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: '0',
    logicResult: null,
    extractionResult: null,
    inputTokensMissing: false,
    outputTokensMissing: false,
    costMissing: false,
    hasUnpricedCost: false,
    ...overrides,
  };
}

function project(
  requests: readonly AggregationRequestSource[],
): BusinessOperationProjection<AggregationRequestSource>[] {
  return projectBusinessOperations(requests);
}

describe('Business Operation summary reference aggregation', () => {
  it('counts distinct groups and aggregates exact priced cost, tokens, results, and markers', () => {
    const operations = project([
      request({
        id: 'case-a-extract',
        totalInputTokens: null,
        totalOutputTokens: 10,
        totalCostUsd: 0.1,
        logicResult: 'PASS',
        extractionResult: 'SUCCESS',
        inputTokensMissing: true,
      }),
      request({
        id: 'case-a-validate',
        endpointSlug: 'validate',
        totalInputTokens: 20,
        totalOutputTokens: 5,
        totalCostUsd: 0.2,
        extractionResult: 'FAIL',
      }),
      request({
        id: 'case-b',
        clientReference: 'CASE-B',
        state: 'FAILED',
        totalInputTokens: 3,
        totalOutputTokens: 2,
        totalCostUsd: '99.0000000000',
        logicResult: 'FAIL',
        hasUnpricedCost: true,
      }),
      request({
        id: 'case-c',
        clientReference: 'CASE-C',
        totalInputTokens: 1,
        totalCostUsd: '12.5',
        logicResult: 'FAIL',
        extractionResult: 'SUCCESS',
        costMissing: true,
      }),
    ]);

    const summary = aggregateBusinessOperationsSummary([
      ...operations,
      operations[0], // distinct business keys must not be counted twice
    ]);

    expect(summary).toEqual({
      totalCases: 3,
      tokensProcessed: 41,
      totalCostUsd: '0.3000000000',
      logicSuccessRate: 33.33,
      aiExtractionRate: 50,
      unpricedRequestCount: 1,
      costIncomplete: true,
      missingRequestCount: 2,
      missingData: true,
    });
  });

  it('returns zero totals, N/A rates, and no warnings for an empty partition', () => {
    expect(aggregateBusinessOperationsSummary([])).toEqual({
      totalCases: 0,
      tokensProcessed: 0,
      totalCostUsd: '0.0000000000',
      logicSuccessRate: null,
      aiExtractionRate: null,
      unpricedRequestCount: 0,
      costIncomplete: false,
      missingRequestCount: 0,
      missingData: false,
    });
    expect(aggregateBusinessOperations([])).toEqual({
      summary: aggregateBusinessOperationsSummary([]),
      breakdownCards: [],
    });
  });

  it('rejects costs beyond persisted numeric scale or precision instead of silently rounding', () => {
    const overScale = project([
      request({ id: 'over-scale', totalCostUsd: '0.12345678901' }),
    ]);
    const overPrecision = project([
      request({
        id: 'over-precision',
        totalCostUsd: '100000000000000000000.0000000000',
      }),
    ]);

    expect(() => aggregateBusinessOperationsSummary(overScale)).toThrow(
      'Cost exceeds numeric(30,10) scale',
    );
    expect(() => aggregateBusinessOperationsSummary(overPrecision)).toThrow(
      'Cost exceeds numeric(30,10) precision',
    );
  });
});

describe('Business Operation breakdown reference aggregation', () => {
  it('builds profile/type cards with type-local request metrics and deterministic extrema', () => {
    const operations = project([
      request({
        id: 'b-extract-1',
        clientReference: 'B',
        endpointSlug: 'extract',
        totalInputTokens: 10,
        totalOutputTokens: 10,
        totalCostUsd: '0.1',
      }),
      request({
        id: 'b-extract-2',
        clientReference: 'B',
        endpointSlug: 'extract',
        totalInputTokens: 5,
        totalOutputTokens: 5,
        totalCostUsd: '0.2',
      }),
      request({
        id: 'b-validate',
        clientReference: 'B',
        endpointSlug: 'validate',
        totalInputTokens: 100,
        totalCostUsd: '1',
      }),
      request({
        id: 'a-extract',
        clientReference: 'A',
        endpointSlug: 'extract',
        state: 'FAILED',
        totalInputTokens: 30,
        totalOutputTokens: null,
        totalCostUsd: '50',
        outputTokensMissing: true,
        hasUnpricedCost: true,
      }),
      request({
        id: 'c-validate',
        clientReference: 'C',
        endpointSlug: 'validate',
        state: 'RUNNING',
        completedAt: null,
        totalInputTokens: 10,
      }),
      request({
        id: 'no-type',
        clientReference: 'NO-TYPE',
        endpointSlug: null,
        totalInputTokens: 999,
        totalCostUsd: '999',
      }),
    ]);

    const cards = aggregateBusinessOperationBreakdown(operations);

    expect(cards.map((card) => card.operationType)).toEqual(['extract', 'validate']);
    expect(cards[0]).toEqual({
      profileScope: { kind: 'profile', apiKeyId: 'profile-a' },
      operationType: 'extract',
      businessOperationCount: 2,
      succeededCount: 1,
      failedCount: 1,
      requestCount: 3,
      inputTokens: 45,
      outputTokens: 15,
      costUsd: '0.3000000000',
      averageTokensPerBusinessOperation: 30,
      averageDurationSeconds: 100,
      maxDurationOperationIdentifier: 'A',
      maxTokenOperationIdentifier: 'A',
      unpricedRequestCount: 1,
      costIncomplete: true,
      missingRequestCount: 1,
      missingData: true,
    });
    expect(cards[1]).toEqual({
      profileScope: { kind: 'profile', apiKeyId: 'profile-a' },
      operationType: 'validate',
      businessOperationCount: 2,
      succeededCount: 1,
      failedCount: 0,
      requestCount: 2,
      inputTokens: 110,
      outputTokens: 0,
      costUsd: '1.0000000000',
      averageTokensPerBusinessOperation: 55,
      averageDurationSeconds: 100,
      maxDurationOperationIdentifier: 'B',
      maxTokenOperationIdentifier: 'B',
      unpricedRequestCount: 0,
      costIncomplete: false,
      missingRequestCount: 0,
      missingData: false,
    });
  });

  it('uses C-collation byte ordering for extrema ties and partitions cards by profile scope', () => {
    const cards = aggregateBusinessOperationBreakdown(project([
      request({
        id: 'unicode-supplementary',
        clientReference: '\u{10000}',
        totalInputTokens: 1,
      }),
      request({
        id: 'unicode-private-use',
        clientReference: '\uE000',
        totalInputTokens: 1,
      }),
      request({
        id: 'profile-b',
        apiKeyId: 'profile-b',
        clientReference: 'SAME-REFERENCE',
        totalInputTokens: 1,
      }),
      request({
        id: 'internal',
        apiKeyId: null,
        clientReference: 'SAME-REFERENCE',
        totalInputTokens: 1,
      }),
    ]));

    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.profileScope)).toEqual([
      { kind: 'internal' },
      { kind: 'profile', apiKeyId: 'profile-a' },
      { kind: 'profile', apiKeyId: 'profile-b' },
    ]);

    const profileACard = cards[1];
    expect(profileACard.businessOperationCount).toBe(2);
    expect(profileACard.maxDurationOperationIdentifier).toBe('\uE000');
    expect(profileACard.maxTokenOperationIdentifier).toBe('\uE000');
  });

  it('returns N/A duration extrema for a card with no terminal operation', () => {
    const [card] = aggregateBusinessOperationBreakdown(project([
      request({
        id: 'active',
        clientReference: 'ACTIVE',
        state: 'WAITING_USER_INPUT',
        completedAt: null,
        totalInputTokens: 1,
      }),
    ]));

    expect(card.averageDurationSeconds).toBeNull();
    expect(card.maxDurationOperationIdentifier).toBeNull();
    expect(card.maxTokenOperationIdentifier).toBe('ACTIVE');
  });
});
