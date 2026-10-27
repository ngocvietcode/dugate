import {
  createBusinessOperationDetailProjection,
  createBusinessOperationListProjection,
  filterBusinessOperations,
  isEligibleOperationRequest,
  projectBusinessOperations,
  type OperationRequestProjectionSource,
} from '@/lib/operations/projection';

interface TestRequest extends OperationRequestProjectionSource {
  inputTokens: number;
}

const at = (iso: string): Date => new Date(iso);

function request(overrides: Partial<TestRequest> & Pick<TestRequest, 'id'>): TestRequest {
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
    inputTokens: 10,
    ...overrides,
  };
}

describe('Business Operation request eligibility and projection', () => {
  it('excludes soft-deleted and internal-hidden rows before grouping', () => {
    const visible = request({ id: 'visible' });
    const deleted = request({
      id: 'deleted',
      state: 'FAILED',
      deletedAt: at('2026-03-01T00:06:00.000Z'),
      updatedAt: at('2026-03-01T10:00:00.000Z'),
    });
    const hidden = request({
      id: 'hidden',
      state: 'RUNNING',
      hiddenFromOperations: true,
      updatedAt: at('2026-03-01T11:00:00.000Z'),
    });

    expect(isEligibleOperationRequest(visible)).toBe(true);
    expect(isEligibleOperationRequest(deleted)).toBe(false);
    expect(isEligibleOperationRequest(hidden)).toBe(false);

    const [operation] = projectBusinessOperations([deleted, visible, hidden]);

    expect(operation.requestCount).toBe(1);
    expect(operation.requests.map((item) => item.requestId)).toEqual(['visible']);
    expect(operation.businessStatus).toBe('SUCCEEDED');
    expect(operation.updatedTime).toEqual(visible.updatedAt);
  });

  it('groups eligible requests and computes deterministic source-based times', () => {
    const first = request({
      id: 'request-b',
      endpointSlug: 'validate',
      createdAt: at('2026-03-01T00:00:00.000Z'),
      completedAt: at('2026-03-01T00:04:00.000Z'),
      updatedAt: at('2026-03-01T00:09:00.000Z'),
    });
    const second = request({
      id: 'request-a',
      endpointSlug: 'extract',
      state: 'FAILED',
      createdAt: at('2026-03-01T00:01:00.000Z'),
      completedAt: at('2026-03-01T00:06:00.000Z'),
      updatedAt: at('2026-03-01T00:08:00.000Z'),
    });

    const forward = projectBusinessOperations([first, second]);
    const reversed = projectBusinessOperations([second, first]);
    const [operation] = forward;

    expect(reversed).toEqual(forward);
    expect(operation.operationTypes).toEqual(['extract', 'validate']);
    expect(operation.requests.map((item) => item.requestId)).toEqual([
      'request-b',
      'request-a',
    ]);
    expect(operation.startTime).toEqual(at('2026-03-01T00:00:00.000Z'));
    expect(operation.updatedTime).toEqual(at('2026-03-01T00:09:00.000Z'));
    expect(operation.endTime).toEqual(at('2026-03-01T00:06:00.000Z'));
    expect(operation.durationSeconds).toBe(360);
    expect(operation.businessStatus).toBe('FAILED');
  });

  it('keeps active operations open and uses a last-valid snapshot for unknown states', () => {
    const active = projectBusinessOperations([
      request({ id: 'active', state: 'RUNNING', completedAt: null }),
    ])[0];

    expect(active.businessStatus).toBe('IN_PROGRESS');
    expect(active.endTime).toBeNull();
    expect(active.durationSeconds).toBeNull();

    const unknownSource = request({ id: 'unknown', state: 'CORRUPT', completedAt: null });
    const key = 'profile:profile-a:reference:REF-1';
    const unknown = projectBusinessOperations([unknownSource], {
      lastValidStatusByBusinessGroupKey: new Map([[key, 'SUCCEEDED']]),
    })[0];

    expect(unknown.businessStatus).toBe('SUCCEEDED');
    expect(unknown.invalidData).toBe(true);
    expect(unknown.endTime).toBeNull();
  });
});

describe('Business Operation dashboard filtering', () => {
  it('applies time, profile, type, and status as an intersection without trimming constituents', () => {
    const selectedGroup = [
      request({
        id: 'selected-start',
        clientReference: 'SELECTED',
        endpointSlug: 'extract',
        createdAt: at('2026-03-01T10:00:00.000Z'),
      }),
      request({
        id: 'selected-later-type',
        clientReference: 'SELECTED',
        endpointSlug: 'validate',
        createdAt: at('2026-03-01T13:00:00.000Z'),
      }),
    ];
    const wrongStatus = request({
      id: 'wrong-status',
      clientReference: 'FAILED',
      endpointSlug: 'extract',
      state: 'FAILED',
      createdAt: at('2026-03-01T11:00:00.000Z'),
    });
    const wrongProfile = request({
      id: 'wrong-profile',
      apiKeyId: 'profile-b',
      clientReference: 'OTHER-PROFILE',
      endpointSlug: 'extract',
      createdAt: at('2026-03-01T11:00:00.000Z'),
    });
    const exclusiveEnd = request({
      id: 'exclusive-end',
      clientReference: 'END',
      endpointSlug: 'extract',
      createdAt: at('2026-03-01T12:00:00.000Z'),
    });

    const operations = projectBusinessOperations([
      ...selectedGroup,
      wrongStatus,
      wrongProfile,
      exclusiveEnd,
    ]);
    const filtered = filterBusinessOperations(operations, {
      timeWindow: {
        start: at('2026-03-01T10:00:00.000Z'),
        end: at('2026-03-01T12:00:00.000Z'),
        startInclusive: true,
        endInclusive: false,
      },
      profileScope: { kind: 'profile', apiKeyId: 'profile-a' },
      operationType: 'extract',
      businessStatus: 'SUCCEEDED',
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].operationIdentifier).toBe('SELECTED');
    expect(filtered[0].operationTypes).toEqual(['extract', 'validate']);
    expect(filtered[0].requestCount).toBe(2);
    expect(filtered[0].requests.map((item) => item.requestId)).toEqual([
      'selected-start',
      'selected-later-type',
    ]);
  });

  it('supports the internal profile scope and all-value selectors', () => {
    const operations = projectBusinessOperations([
      request({ id: 'profile' }),
      request({
        id: 'internal',
        apiKeyId: null,
        clientReference: null,
        endpointSlug: null,
        state: 'RUNNING',
      }),
    ]);

    const filtered = filterBusinessOperations(operations, {
      timeWindow: {
        start: at('2026-03-01T00:00:00.000Z'),
        end: at('2026-03-02T00:00:00.000Z'),
        startInclusive: true,
        endInclusive: false,
      },
      profileScope: { kind: 'internal' },
      operationType: 'ALL',
      businessStatus: 'ALL',
    });

    expect(filtered.map((operation) => operation.operationIdentifier)).toEqual(['internal']);
  });
});

describe('Business Operation list and detail projections', () => {
  it('creates one list row per group and a detail projection with all source requests', () => {
    const operation = projectBusinessOperations([
      request({ id: 'request-1' }),
      request({ id: 'request-2', endpointSlug: 'validate' }),
    ])[0];

    const listItem = createBusinessOperationListProjection(operation);
    const detail = createBusinessOperationDetailProjection(operation);

    expect(listItem.requestCount).toBe(2);
    expect(listItem.operationTypes).toEqual(['extract', 'validate']);
    expect(listItem).not.toHaveProperty('requests');
    expect(listItem).not.toHaveProperty('durationSeconds');

    expect(detail.requestCount).toBe(2);
    expect(detail.requests.map((item) => item.requestId)).toEqual(['request-1', 'request-2']);
    expect(detail.requests[0].source.inputTokens).toBe(10);
    expect(detail.durationSeconds).toBe(240);
  });
});
