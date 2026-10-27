import fc from 'fast-check';

import { createBusinessOperationListPage } from '@/lib/operations/reference-helpers';
import {
  projectBusinessOperations,
  type BusinessOperationProjection,
  type OperationRequestProjectionSource,
} from '@/lib/operations/projection';

const BASE_TIMESTAMP = Date.parse('2026-01-01T00:00:00.000Z');
const PAGE_SIZE = 50;

interface OperationSpec {
  identifier: string;
  updatedOffsetSeconds: number;
}

const operationSpecsArb = fc.array(
  fc.record({
    identifier: fc.constantFrom(
      'CASE-00',
      'CASE-01',
      'CASE-02',
      'Case-00',
      'case-00',
      'Á-00',
      'Ω-00',
    ),
    updatedOffsetSeconds: fc.integer({ min: 0, max: 20 }),
  }),
  { maxLength: 160 },
);

function buildRequests(
  specs: readonly OperationSpec[],
): OperationRequestProjectionSource[] {
  return specs.map((spec, index) => ({
    id: `request-${index}`,
    apiKeyId: `profile-${index}`,
    clientReference: spec.identifier,
    endpointSlug: 'sort-pagination',
    state: 'SUCCEEDED',
    createdAt: new Date(BASE_TIMESTAMP - 60_000),
    updatedAt: new Date(BASE_TIMESTAMP + spec.updatedOffsetSeconds * 1_000),
    completedAt: new Date(BASE_TIMESTAMP),
    deletedAt: null,
    hiddenFromOperations: false,
  }));
}

function compareBinary(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function expectedOrder(
  operations: readonly BusinessOperationProjection<OperationRequestProjectionSource>[],
): BusinessOperationProjection<OperationRequestProjectionSource>[] {
  return [...operations].sort((left, right) => {
    const byUpdatedTime = right.updatedTime.getTime() - left.updatedTime.getTime();
    if (byUpdatedTime !== 0) return byUpdatedTime;

    const byIdentifier = compareBinary(
      left.operationIdentifier,
      right.operationIdentifier,
    );
    if (byIdentifier !== 0) return byIdentifier;

    return compareBinary(left.businessGroupKey, right.businessGroupKey);
  });
}

describe('Business Operation sort and pagination property', () => {
  // Feature: operations-request-tracking, Property 13: Sort và pagination không làm mất hoặc lặp business operation
  // **Validates: Requirements 6.9, 6.10, 6.11**
  it('orders by updated time and identifier, then partitions the full list into fixed disjoint pages', () => {
    fc.assert(
      fc.property(operationSpecsArb, (specs) => {
        const operations = projectBusinessOperations(buildRequests(specs));
        const expected = expectedOrder(operations);
        const expectedKeys = expected.map((operation) => operation.businessGroupKey);
        const expectedPageCount = Math.max(1, Math.ceil(expected.length / PAGE_SIZE));
        const pages = Array.from(
          { length: expectedPageCount },
          (_, index) => createBusinessOperationListPage(operations, index + 1),
        );
        const actualKeys = pages.flatMap((page) => (
          page.items.map((operation) => operation.businessGroupKey)
        ));

        for (const [index, page] of pages.entries()) {
          const expectedLength = Math.min(
            PAGE_SIZE,
            Math.max(0, expected.length - index * PAGE_SIZE),
          );

          expect(page.page).toBe(index + 1);
          expect(page.pageSize).toBe(PAGE_SIZE);
          expect(page.total).toBe(expected.length);
          expect(page.totalPages).toBe(expectedPageCount);
          expect(page.items).toHaveLength(expectedLength);
        }

        expect(actualKeys).toEqual(expectedKeys);
        expect(new Set(actualKeys).size).toBe(actualKeys.length);
        expect(actualKeys).toHaveLength(operations.length);

        for (let leftPage = 0; leftPage < pages.length; leftPage += 1) {
          const leftKeys = new Set(
            pages[leftPage].items.map((operation) => operation.businessGroupKey),
          );
          for (let rightPage = leftPage + 1; rightPage < pages.length; rightPage += 1) {
            expect(pages[rightPage].items.some(
              (operation) => leftKeys.has(operation.businessGroupKey),
            )).toBe(false);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
