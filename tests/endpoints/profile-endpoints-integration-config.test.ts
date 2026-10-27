// tests/endpoints/profile-endpoints-integration-config.test.ts
// T7 — endpoint-level integration toggles/overrides persistence.
// Verifies has(key) semantics (update SETs ONLY sent columns, so existing
// parameters/connectionsOverride/fileUrlAuthConfig are never dropped) and
// validation of the new fields. No real DB.

const mockTxUpdateSet = jest.fn();
const mockState: { existingRows: unknown[] } = { existingRows: [] };
const mockTx = {
  update: () => ({
    set: (v: Record<string, unknown>) => {
      mockTxUpdateSet(v);
      return { where: () => ({ returning: () => Promise.resolve([{ id: 'e1', ...v }]) }) };
    },
  }),
  insert: () => ({ values: (v: Record<string, unknown>) => ({ returning: () => Promise.resolve([{ id: 'e1', ...v }]) }) }),
  select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  delete: () => ({ where: () => Promise.resolve(undefined) }),
};
jest.mock('@/lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(mockState.existingRows) }) }) }),
    transaction: async (cb: (tx: typeof mockTx) => unknown) => cb(mockTx),
  },
}));
jest.mock('@/lib/db/schema', () => {
  const p = new Proxy({}, { get: (_t, k) => String(k) });
  return { profileEndpoints: p, externalApiConnections: p, externalApiOverrides: p };
});
jest.mock('drizzle-orm', () => ({ eq: (...a: unknown[]) => ({ a }), and: (...a: unknown[]) => ({ a }) }));
jest.mock('@/lib/endpoints/registry', () => ({
  SERVICE_REGISTRY: { extract: {}, workflows: { subCases: { 'financial-report-translation': {}, 'loan-appraisal': {} } } },
  getAllEndpointSlugs: () => [
    { slug: 'extract', connections: [] },
    { slug: 'financial-report-translation', connections: [] },
    { slug: 'loan-appraisal', connections: [] },
  ],
}));
jest.mock('@/lib/endpoints/profile-resolver', () => ({ parseConnectionSteps: () => [] }));
jest.mock('@/lib/crypto', () => ({ encrypt: (s: string) => 'enc:' + s, decrypt: (s: string) => s }));
jest.mock('@/lib/file-url-downloader', () => ({ parseFileUrlAuthConfig: (v: unknown) => v }));
jest.mock('@/lib/logger', () => ({ Logger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));
jest.mock('@/lib/auth-guard', () => ({
  requireAdmin: jest.fn().mockResolvedValue({ session: { user: { role: 'ADMIN' } } }),
  requireCapability: jest.fn().mockResolvedValue({ session: { user: { id: 'u1', username: 'admin', role: 'ADMIN' } } }),
  requireProfileAccess: jest.fn().mockResolvedValue({ session: { user: { id: 'u1', username: 'admin', role: 'ADMIN' } } }),
}));
// The route asks the resolver whether the caller may see decrypted endpoint config.
jest.mock('@/lib/rbac/resolve', () => ({ roleHasCapability: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/endpoints/aihub-config', () => ({
  isValidReasoningEffortOverride: () => true,
  normalizeReasoningEffort: (v: unknown) => v,
}));
jest.mock('@/lib/pipelines/processors/http-client', () => ({
  assertSafeUrl: async (u: string) => u,
  isUrlOriginAllowed: () => true,
}));

import { POST } from '@/app/api/internal/profile-endpoints/route';

const post = (body: unknown) => POST({ json: async () => body } as never);
const base = { apiKeyId: 'p1', endpointSlug: 'extract' };

describe('profile-endpoints route — endpoint integration config (T7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.existingRows = [];
  });

  it('rejects fileUrlDefaultChunks outside 1..1000', async () => {
    const res = await post({ ...base, fileUrlDefaultChunks: 1001 });
    expect(res.status).toBe(400);
    expect(mockTxUpdateSet).not.toHaveBeenCalled();
  });

  it('ignores fileUrlEnabled entirely (gate removed — never persisted)', async () => {
    mockState.existingRows = [{ id: 'e1', enabled: true }];
    const res = await post({ ...base, fileUrlEnabled: false });
    // The field is no longer handled: it must not appear in the persisted set,
    // and (being the only "field") the request results in no meaningful update.
    if (res.status === 200 && mockTxUpdateSet.mock.calls.length > 0) {
      const setArg = mockTxUpdateSet.mock.calls[0][0] as Record<string, unknown>;
      expect(setArg).not.toHaveProperty('fileUrlEnabled');
    }
  });

  it('ignores legacy callback URL/payload overrides while persisting supported fields', async () => {
    mockState.existingRows = [{ id: 'e1', enabled: true }];
    const res = await post({
      ...base,
      fileUrlDefaultChunks: 500,
      callbackUrlOverride: 'https://legacy.test/callback',
      callbackPayloadOverride: 'WITH_RESULT',
    });
    expect(res.status).toBe(200);
    expect(mockTxUpdateSet.mock.calls[0][0]).toEqual({ fileUrlDefaultChunks: 500 });
  });

  it('persists a valid fileUrlDefaultChunks', async () => {
    mockState.existingRows = [{ id: 'e1', enabled: true }];
    const res = await post({ ...base, fileUrlDefaultChunks: 500 });
    expect(res.status).toBe(200);
    expect(mockTxUpdateSet.mock.calls[0][0]).toEqual({ fileUrlDefaultChunks: 500 });
  });
});


describe('Round 14 C1 — supplemental title aliases Profile validation', () => {
  const financialReportBase = { apiKeyId: 'p1', endpointSlug: 'financial-report-translation' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockState.existingRows = [{ id: 'financial-endpoint', enabled: true }];
  });

  it('rejects malformed aliases before a Profile update is persisted', async () => {
    const res = await post({
      ...financialReportBase,
      parameters: {
        supplemental_report_title_aliases: { value: '{"unknownReport":["Bad title"]}', isLocked: true },
      },
    });

    expect(res.status).toBe(400);
    expect(mockTxUpdateSet).not.toHaveBeenCalled();
  });

  it('persists a valid Profile JSON map without changing its parameter shape', async () => {
    const parameters = {
      supplemental_report_title_aliases: {
        value: '{"balanceSheet":["Custom Statement of Position"]}',
        isLocked: true,
      },
    };
    const res = await post({ ...financialReportBase, parameters });

    expect(res.status).toBe(200);
    expect(mockTxUpdateSet).toHaveBeenCalledWith({ parameters: JSON.stringify(parameters) });
  });
});

describe('loan_product_config — cấu hình theo sản phẩm (validate khi ghi)', () => {
  const loanBase = { apiKeyId: 'p1', endpointSlug: 'loan-appraisal' };
  const withConfig = (value: unknown) => ({ ...loanBase, parameters: { loan_product_config: { value, isLocked: true } } });

  beforeEach(() => {
    jest.clearAllMocks();
    mockState.existingRows = [{ id: 'loan-endpoint', enabled: true }];
  });

  it('từ chối override checklist cho mục không có trong catalog', async () => {
    const res = await post(withConfig({ products: { 'hkd-loan': { checklist: { muc_moi: { FULL: 'REQUIRED' } } } } }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('không tạo được mục mới');
    expect(mockTxUpdateSet).not.toHaveBeenCalled();
  });

  it('từ chối sản phẩm chưa khai báo và step key lạ', async () => {
    const unknownProduct = await post(withConfig({ products: { 'khong-co': {} } }));
    expect(unknownProduct.status).toBe(400);
    const unknownStep = await post(withConfig({ products: { 'hkd-loan': { models: { buoc_la: 'm' } } } }));
    expect(unknownStep.status).toBe(400);
    expect(mockTxUpdateSet).not.toHaveBeenCalled();
  });

  it('lưu cấu hình hợp lệ theo sản phẩm', async () => {
    const parameters = withConfig({ products: { 'hkd-loan': {
      models: { income_source_classify: 'gemini-flash' }, reasoning: { income_source_classify: 'low' },
      checklist: { legal_qr_code_info: { FAST: 'NOT_REQUIRED' } },
    } } }).parameters;
    const res = await post({ ...loanBase, parameters });
    expect(res.status).toBe(200);
    expect(mockTxUpdateSet).toHaveBeenCalledWith({ parameters: JSON.stringify(parameters) });
  });

  it('bỏ khoá cũ theo Profile khi ghi (không còn được runtime đọc)', async () => {
    const res = await post({ ...loanBase, parameters: { loan_policy: { value: { minimum_dscr: 1.5 }, isLocked: true }, other: { value: 'x', isLocked: false } } });
    expect(res.status).toBe(200);
    expect(mockTxUpdateSet).toHaveBeenCalledWith({ parameters: JSON.stringify({ other: { value: 'x', isLocked: false } }) });
  });
});