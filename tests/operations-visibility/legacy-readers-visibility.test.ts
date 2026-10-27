// Regression suite for commit 80e309b: workflow sub-steps are hidden with
// `hiddenFromOperations = true, deletedAt = null`. Every legacy Operations reader
// must exclude them, otherwise sub-steps are listed and their cost is counted a
// second time (the parent workflow already rolls child usage up).

import { NextRequest, NextResponse } from 'next/server';
import { createQueryRecorder, opsSession, toSqlText, VISIBLE_PREDICATE } from './helpers';

const mockRecorder = createQueryRecorder();
const mockRequireCapability = jest.fn();
const mockGetAssignedProfileIds = jest.fn();

jest.mock('@/lib/db', () => ({
  get db() { return mockRecorder.db; },
}));
jest.mock('@/lib/auth-guard', () => ({
  requireCapability: (...args: unknown[]) => mockRequireCapability(...args),
  getAssignedProfileIds: (...args: unknown[]) => mockGetAssignedProfileIds(...args),
}));
jest.mock('@/lib/ops/config', () => ({
  getStuckThresholds: async () => ({ runningMin: 10, pendingMin: 5 }),
  getExportMaxDays: async () => 31,
}));
jest.mock('@/lib/settings', () => ({
  getSetting: async () => '',
}));
jest.mock('@/lib/storage', () => ({
  getStorageBackend: async () => ({
    getMetadata: async () => null,
    delete: async () => undefined,
    deleteMany: async () => undefined,
  }),
}));

function anyWhereIsVisible(): boolean {
  return mockRecorder.whereArgs.some((condition) => VISIBLE_PREDICATE.test(toSqlText(condition)));
}

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

/** Run a handler; downstream crashes on the empty fake result are irrelevant here. */
async function run(invoke: () => Promise<unknown>): Promise<void> {
  try {
    const result = await invoke();
    // Streaming CSV responses query lazily — drain the body so the batch runs.
    if (result instanceof Response && result.body) await result.text().catch(() => undefined);
  } catch {
    /* the predicate is recorded before any post-query failure */
  }
}

describe('legacy Operations readers exclude hidden workflow sub-steps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecorder.reset();
    mockRequireCapability.mockResolvedValue(opsSession());
    mockGetAssignedProfileIds.mockResolvedValue(['profile-1']);
  });

  const readers: Array<[string, () => Promise<unknown>]> = [
    ['GET /api/internal/operations', async () => {
      const { GET } = await import('@/app/api/internal/operations/route');
      return GET(request('/api/internal/operations?include_filter_options=0'));
    }],
    ['GET /api/internal/operations/stats', async () => {
      const { GET } = await import('@/app/api/internal/operations/stats/route');
      return GET(request('/api/internal/operations/stats'));
    }],
    ['GET /api/internal/operations/stats/breakdown', async () => {
      const { GET } = await import('@/app/api/internal/operations/stats/breakdown/route');
      return GET(request('/api/internal/operations/stats/breakdown?group_by=endpoint'));
    }],
    ['GET /api/internal/operations/stats/timeseries', async () => {
      const { GET } = await import('@/app/api/internal/operations/stats/timeseries/route');
      return GET(request('/api/internal/operations/stats/timeseries'));
    }],
    ['GET /api/internal/operations/stats/throughput', async () => {
      const { GET } = await import('@/app/api/internal/operations/stats/throughput/route');
      return GET(request('/api/internal/operations/stats/throughput'));
    }],
    ['GET /api/internal/operations/stuck', async () => {
      const { GET } = await import('@/app/api/internal/operations/stuck/route');
      return GET(request('/api/internal/operations/stuck'));
    }],
    ['GET /api/internal/operations/filter-options', async () => {
      const { GET } = await import('@/app/api/internal/operations/filter-options/route');
      return GET();
    }],
    ['GET /api/internal/operations/export-csv', async () => {
      const { GET } = await import('@/app/api/internal/operations/export-csv/route');
      return GET(request('/api/internal/operations/export-csv'));
    }],
    ['GET /api/operations (history page)', async () => {
      const { GET } = await import('@/app/api/operations/route');
      return GET(request('/api/operations?page_size=10'));
    }],
    ['GET /api/settings/cache', async () => {
      // Three FileCache stats queries run first; give them well-formed rows.
      mockRecorder.enqueueResult([{ count: 0 }]);
      mockRecorder.enqueueResult([{ sum: 0 }]);
      mockRecorder.enqueueResult([]);
      const { GET } = await import('@/app/api/settings/cache/route');
      return GET();
    }],
    ['cleanupExpiredFiles()', async () => {
      const { cleanupExpiredFiles } = await import('@/lib/cleanup');
      return cleanupExpiredFiles();
    }],
  ];

  it.each(readers)('%s filters with the shared visibility predicate', async (_name, invoke) => {
    await run(invoke);
    expect(mockRecorder.whereArgs.length).toBeGreaterThan(0);
    expect(anyWhereIsVisible()).toBe(true);
  });

  it('keeps the global-scope include_deleted diagnostic view unfiltered', async () => {
    mockGetAssignedProfileIds.mockResolvedValue(null);
    const { GET } = await import('@/app/api/internal/operations/route');
    await run(() => GET(request('/api/internal/operations?include_filter_options=0&include_deleted=true')));
    expect(anyWhereIsVisible()).toBe(false);
  });

  it('ignores include_deleted for assigned-only users', async () => {
    const { GET } = await import('@/app/api/internal/operations/route');
    await run(() => GET(request('/api/internal/operations?include_filter_options=0&include_deleted=true')));
    expect(anyWhereIsVisible()).toBe(true);
  });
});

describe('GET /api/internal/operations/[id] guard for hidden rows', () => {
  const baseRow = {
    id: 'sub-1',
    done: true,
    state: 'SUCCEEDED',
    endpointSlug: 'ext-data-extractor',
    progressPercent: 100,
    progressMessage: null,
    progressLogJson: null,
    currentStep: 0,
    errorCode: null,
    errorMessage: null,
    failedAtStep: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    apiKeyId: 'profile-1',
    profileName: 'Profile 1',
    correlationId: 'corr-1',
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:01.000Z'),
    completedAt: new Date('2026-10-01T00:00:01.000Z'),
    idempotencyKey: null,
    pipelineJson: '[]',
    stepsResultJson: '[]',
    extractedData: null,
    outputFormat: 'json',
    outputContent: null,
    filesJson: '[]',
    usageBreakdown: '[]',
    webhookUrl: null,
    webhookSentAt: null,
    webhookAttempts: null,
    webhookLastError: null,
    pagesProcessed: 0,
    modelUsed: null,
    filesDeleted: false,
    deletedAt: null as Date | null,
    hiddenFromOperations: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRecorder.reset();
    mockRequireCapability.mockResolvedValue(opsSession());
  });

  async function getDetail() {
    const { GET } = await import('@/app/api/internal/operations/[id]/route');
    return GET(request('/api/internal/operations/sub-1'), { params: Promise.resolve({ id: 'sub-1' }) });
  }

  it('returns 404 to an assigned-only user for a hidden workflow sub-step', async () => {
    mockGetAssignedProfileIds.mockResolvedValue(['profile-1']);
    mockRecorder.enqueueResult([{ ...baseRow, hiddenFromOperations: true }]);
    const response = await getDetail();
    expect(response.status).toBe(404);
  });

  it('returns 404 to an assigned-only user for a soft-deleted row (unchanged)', async () => {
    mockGetAssignedProfileIds.mockResolvedValue(['profile-1']);
    mockRecorder.enqueueResult([{ ...baseRow, deletedAt: new Date() }]);
    const response = await getDetail();
    expect(response.status).toBe(404);
  });

  it('lets a global-scope user open a hidden sub-step for diagnostics', async () => {
    mockGetAssignedProfileIds.mockResolvedValue(null);
    mockRecorder.enqueueResult([{ ...baseRow, hiddenFromOperations: true }]);
    const response = await getDetail();
    expect(response.status).toBe(200);
  });

  it('serves a visible row to an assigned user (unchanged)', async () => {
    mockGetAssignedProfileIds.mockResolvedValue(['profile-1']);
    mockRecorder.enqueueResult([baseRow]);
    const response = await getDetail();
    expect(response.status).toBe(200);
  });

  it('still forbids a visible row from an unassigned profile (unchanged)', async () => {
    mockGetAssignedProfileIds.mockResolvedValue(['profile-other']);
    mockRecorder.enqueueResult([baseRow]);
    const response = await getDetail();
    expect(response.status).toBe(403);
  });

  it('propagates an auth guard failure before touching the database', async () => {
    mockRequireCapability.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const response = await getDetail();
    expect(response.status).toBe(403);
    expect(mockRecorder.db.select).not.toHaveBeenCalled();
  });
});
