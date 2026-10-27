import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BusinessOperationsTable from '../../app/operations/components/BusinessOperationsTable';
import BusinessOperationDetail from '../../app/operations/components/BusinessOperationDetail';
import type {
  BusinessOperationDetailResponse,
  BusinessOperationListItem,
  BusinessOperationListPage,
  ConstituentRequestItem,
} from '../../app/operations/types';

function makeBusinessOperation(
  overrides: Partial<BusinessOperationListItem> = {},
): BusinessOperationListItem {
  return {
    token: 'signed-token-a',
    operationIdentifier: 'CASE-NEWEST',
    normalizedReference: 'CASE-NEWEST',
    profileScope: { id: 'profile-a', name: 'Payroll Profile' },
    operationTypes: ['extract:payroll', 'logic:validate'],
    businessStatus: 'IN_PROGRESS',
    invalidData: true,
    requestCount: 3,
    startTime: '2026-08-19T01:00:00.000Z',
    updatedTime: '2026-08-19T03:00:00.000Z',
    endTime: null,
    durationSeconds: null,
    totalTokens: 12345,
    totalCostUsd: '42.5000000000',
    unpricedRequestCount: 2,
    missingData: true,
    ...overrides,
  };
}

const list: BusinessOperationListPage = {
  items: [
    makeBusinessOperation(),
    makeBusinessOperation({
      token: 'signed-token-b',
      operationIdentifier: 'CASE-OLDER',
      normalizedReference: 'CASE-OLDER',
      businessStatus: 'SUCCEEDED',
      invalidData: false,
      missingData: false,
      unpricedRequestCount: 0,
      requestCount: 1,
      totalTokens: 100,
      totalCostUsd: '0.1250000000',
      updatedTime: '2026-08-18T03:00:00.000Z',
      endTime: '2026-08-19T02:00:00.000Z',
    }),
  ],
  page: 1,
  pageSize: 50,
  total: 52,
  totalPages: 2,
};

function makeRequest(
  id: string,
  overrides: Partial<ConstituentRequestItem> = {},
): ConstituentRequestItem {
  return {
    id,
    operationType: 'extract:payroll',
    state: 'SUCCEEDED',
    startedAt: '2026-08-19T01:00:00.000Z',
    completedAt: '2026-08-19T01:01:00.000Z',
    inputTokens: 100,
    outputTokens: 25,
    costUsd: '0.7500000000',
    errorCode: null,
    errorMessage: null,
    missingData: false,
    unpricedCost: false,
    ...overrides,
  };
}

const detailResponse: BusinessOperationDetailResponse = {
  queryTimestamp: '2026-08-19T04:00:00.000Z',
  operation: {
    ...makeBusinessOperation(),
    endTime: null,
    durationSeconds: null,
  },
  requests: {
    items: [
      makeRequest('request-running', {
        operationType: null,
        state: 'RUNNING',
        completedAt: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        missingData: true,
      }),
      makeRequest('request-failed', {
        state: 'FAILED',
        errorCode: 'PIPELINE_FAILED',
        errorMessage: 'Không thể đọc tài liệu',
      }),
      makeRequest('request-cancelled', {
        state: 'CANCELLED',
        errorCode: null,
        errorMessage: null,
        unpricedCost: true,
      }),
    ],
    page: 2,
    pageSize: 100,
    total: 203,
    totalPages: 3,
  },
};

const noOp = () => undefined;

describe('Business Operations table', () => {
  it('renders one row per API item in API order with fixed page size and aggregate markers', () => {
    const html = renderToStaticMarkup(createElement(BusinessOperationsTable, {
      list,
      timeZone: 'Asia/Ho_Chi_Minh',
      sort: 'recent',
      onSortChange: noOp,
      onOpenOperation: noOp,
      onPageChange: noOp,
    }));

    expect((html.match(/data-business-operation-token=/g) ?? [])).toHaveLength(2);
    expect(html.indexOf('CASE-NEWEST')).toBeLessThan(html.indexOf('CASE-OLDER'));
    expect(html).toContain('52 nghiệp vụ · 50 dòng/trang');
    expect(html).toContain('Trang 1/2');
    expect(html).toContain('Dữ liệu trạng thái không hợp lệ');
    expect(html).toContain('Thiếu dữ liệu nguồn');
    expect(html).toContain('2 chưa định giá');
    expect(html).toContain('12,345 tokens');
    expect(html).toContain('$42.5');
    expect(html).toContain('Payroll Profile');
    expect(html).toContain('extract:payroll');
    expect(html).toContain('logic:validate');
  });

  it('labels the table and fixed pagination while keeping all controls keyboard focusable', () => {
    const html = renderToStaticMarkup(createElement(BusinessOperationsTable, {
      list,
      timeZone: 'Asia/Ho_Chi_Minh',
      sort: 'recent',
      onSortChange: noOp,
      onOpenOperation: noOp,
      onPageChange: noOp,
    }));

    expect(html).toContain('<table');
    expect(html).toContain('aria-labelledby="business-operations-list-title"');
    expect(html).toContain('<nav');
    expect(html).toContain('aria-label="Phân trang danh sách Business Operations"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Trang đầu"');
    expect(html).toContain('aria-label="Trang trước"');
    expect(html).toContain('aria-label="Trang sau"');
    expect(html).toContain('aria-label="Trang cuối"');
    expect((html.match(/<button type="button"/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(html).toContain('aria-label="Mở Business Operation CASE-NEWEST"');
    expect(html).toContain('aria-label="Mở chi tiết CASE-NEWEST"');
    expect(html).toContain('focus-visible:ring-2');
  });

  it('isolates empty and failed list states from previously loaded business identifiers', () => {
    const emptyHtml = renderToStaticMarkup(createElement(BusinessOperationsTable, {
      list: { ...list, items: [], total: 0, totalPages: 1 },
      timeZone: 'Asia/Ho_Chi_Minh',
      sort: 'recent',
      onSortChange: noOp,
      onOpenOperation: noOp,
      onPageChange: noOp,
    }));
    const errorHtml = renderToStaticMarkup(createElement(BusinessOperationsTable, {
      list,
      error: 'Dashboard unavailable',
      timeZone: 'Asia/Ho_Chi_Minh',
      sort: 'recent',
      onSortChange: noOp,
      onRetry: noOp,
      onOpenOperation: noOp,
      onPageChange: noOp,
    }));

    expect(emptyHtml).toContain('Không có Business Operation phù hợp');
    expect(emptyHtml).toContain('role="status"');
    expect(emptyHtml).not.toContain('CASE-NEWEST');
    expect(errorHtml).toContain('Không thể tải danh sách nghiệp vụ');
    expect(errorHtml).toContain('Thử lại');
    expect(errorHtml).not.toContain('CASE-NEWEST');
    expect(errorHtml).toContain('role="alert"');
  });
});

describe('Business Operation constituent detail', () => {
  it('renders operational fields, source-null displays, processing state, exact request links, and fixed pagination', () => {
    const html = renderToStaticMarkup(createElement(BusinessOperationDetail, {
      token: 'signed-token-a',
      timeZone: 'UTC',
      response: detailResponse,
      onPageChange: noOp,
    }));

    expect(html).toContain('data-business-operation-token="signed-token-a"');
    expect(html).toContain('CASE-NEWEST');
    expect(html).toContain('203 request · 100 request/trang');
    expect(html).toContain('Trang 2/3');
    expect(html).toContain('href="/operations/request-running"');
    expect(html).toContain('href="/operations/request-failed"');
    expect(html).toContain('href="/operations/request-cancelled"');
    expect(html).toContain('Đang xử lý');
    expect(html).toContain('—');
    expect(html).toContain('Input token');
    expect(html).toContain('Output token');
    expect(html).toContain('$0.75');
    expect(html).toContain('Chưa định giá');
  });

  it('encodes the exact constituent request ID in request-detail navigation', () => {
    const requestId = 'request/failing 42?#';
    const html = renderToStaticMarkup(createElement(BusinessOperationDetail, {
      token: 'signed-token-a',
      timeZone: 'UTC',
      response: {
        ...detailResponse,
        requests: {
          items: [makeRequest(requestId)],
          page: 1,
          pageSize: 100,
          total: 1,
          totalPages: 1,
        },
      },
      onPageChange: noOp,
    }));

    expect(html).toContain(`href="/operations/${encodeURIComponent(requestId)}"`);
    expect(html).not.toContain('href="/operations/request/failing 42?#"');
  });

  it('always renders labelled, non-collapsible error panels for FAILED and CANCELLED requests', () => {
    const html = renderToStaticMarkup(createElement(BusinessOperationDetail, {
      token: 'signed-token-a',
      timeZone: 'UTC',
      response: detailResponse,
      onPageChange: noOp,
    }));

    expect((html.match(/aria-label="Lỗi xử lý request/g) ?? [])).toHaveLength(2);
    expect((html.match(/role="alert" aria-label="Lỗi xử lý request/g) ?? [])).toHaveLength(2);
    expect((html.match(/Lỗi xử lý<\/p>/g) ?? [])).toHaveLength(2);
    expect(html).toContain('PIPELINE_FAILED');
    expect(html).toContain('Không thể đọc tài liệu');
    expect(html).toContain('Mã lỗi');
    expect(html).toContain('Thông báo lỗi');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('aria-expanded');
  });

  it('exposes dialog, table, pagination, link, and close-control accessibility semantics', () => {
    const html = renderToStaticMarkup(createElement(BusinessOperationDetail, {
      token: 'signed-token-a',
      timeZone: 'UTC',
      response: detailResponse,
      onClose: noOp,
      onPageChange: noOp,
    }));

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="business-operation-detail-title"');
    expect(html).toContain('aria-labelledby="constituent-requests-title"');
    expect(html).toContain('aria-label="Đóng chi tiết Business Operation"');
    expect(html).toContain('aria-label="Phân trang Constituent Requests"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('<a href="/operations/request-running"');
    expect((html.match(/focus-visible:ring-2/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect((html.match(/<button type="button"/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('isolates loading, error, mismatched-token, and empty constituent states from stale detail data', () => {
    const loadingHtml = renderToStaticMarkup(createElement(BusinessOperationDetail, {
      token: 'signed-token-a',
      timeZone: 'UTC',
      response: detailResponse,
      loading: true,
      onPageChange: noOp,
    }));
    const errorHtml = renderToStaticMarkup(createElement(BusinessOperationDetail, {
      token: 'signed-token-a',
      timeZone: 'UTC',
      response: detailResponse,
      error: 'Detail unavailable',
      onRetry: noOp,
      onPageChange: noOp,
    }));
    const mismatchedHtml = renderToStaticMarkup(createElement(BusinessOperationDetail, {
      token: 'signed-token-other',
      timeZone: 'UTC',
      response: detailResponse,
      onPageChange: noOp,
    }));
    const emptyHtml = renderToStaticMarkup(createElement(BusinessOperationDetail, {
      token: 'signed-token-a',
      timeZone: 'UTC',
      response: {
        ...detailResponse,
        requests: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 1 },
      },
      onPageChange: noOp,
    }));

    expect(loadingHtml).toContain('Đang tải request thành phần');
    expect(loadingHtml).toContain('aria-busy="true"');
    expect(loadingHtml).not.toContain('request-failed');
    expect(loadingHtml).not.toContain('CASE-NEWEST');
    expect(errorHtml).toContain('Không thể tải chi tiết Business Operation');
    expect(errorHtml).toContain('Thử lại');
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).not.toContain('request-failed');
    expect(errorHtml).not.toContain('CASE-NEWEST');
    expect(mismatchedHtml).toContain('Không có dữ liệu chi tiết khớp');
    expect(mismatchedHtml).not.toContain('CASE-NEWEST');
    expect(emptyHtml).toContain('Không có request thành phần');
    expect(emptyHtml).toContain('role="status"');
    expect(emptyHtml).not.toContain('request-failed');
  });
});
