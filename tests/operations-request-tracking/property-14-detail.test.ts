import fc from 'fast-check';

import {
  CONSTITUENT_REQUEST_PAGE_SIZE,
  createConstituentRequestDetailPage,
  type OperationalDetailSource,
} from '@/lib/operations/reference-helpers';
import { projectBusinessOperations } from '@/lib/operations/projection';

const BASE_TIMESTAMP = Date.parse('2026-01-01T00:00:00.000Z');
const DETAIL_OUTPUT_FIELDS = [
  'completedAt',
  'costUsd',
  'errorCode',
  'errorMessage',
  'id',
  'inputTokens',
  'missingData',
  'nullDisplay',
  'operationType',
  'outputTokens',
  'startedAt',
  'state',
  'unpricedCost',
].sort();
const SENSITIVE_FIELDS = [
  'documentContent',
  'extractedData',
  'filesJson',
  'outputContent',
  'pipelineJson',
  'prompts',
] as const;

interface DetailSource extends OperationalDetailSource {
  authorized: boolean;
  sensitiveMarker: string;
  filesJson: string;
  pipelineJson: string;
  outputContent: string;
  extractedData: string;
  prompts: string;
  documentContent: string;
}

interface ConstituentSpec {
  createdOffsetSeconds: number;
  completedDelaySeconds: number | null;
  operationType: string | null;
  state: 'RUNNING' | 'PENDING' | 'WAITING_USER_INPUT' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  inputTokensMissing: boolean;
  outputTokensMissing: boolean;
  costMissing: boolean;
  hasUnpricedCost: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

interface DetailScenario {
  authorizedSpecs: ConstituentSpec[];
  unauthorizedSpecs: ConstituentSpec[];
}

const nullableShortStringArb = fc.option(
  fc.string({ minLength: 1, maxLength: 24 }),
  { nil: null },
);

const decimalCostArb = fc.option(
  fc.integer({ min: 0, max: 1_000_000 }).map((minorUnits) => (
    `${Math.floor(minorUnits / 10_000)}.${String(minorUnits % 10_000).padStart(4, '0')}`
  )),
  { nil: null },
);

const constituentSpecArb: fc.Arbitrary<ConstituentSpec> = fc.record({
  createdOffsetSeconds: fc.integer({ min: 0, max: 20 }),
  completedDelaySeconds: fc.option(
    fc.integer({ min: 0, max: 3_600 }),
    { nil: null },
  ),
  operationType: fc.option(
    fc.constantFrom('extract', 'validate', 'classify', 'archive'),
    { nil: null },
  ),
  state: fc.constantFrom(
    'RUNNING',
    'PENDING',
    'WAITING_USER_INPUT',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
  ),
  inputTokens: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: null }),
  outputTokens: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: null }),
  costUsd: decimalCostArb,
  inputTokensMissing: fc.boolean(),
  outputTokensMissing: fc.boolean(),
  costMissing: fc.boolean(),
  hasUnpricedCost: fc.boolean(),
  errorCode: nullableShortStringArb,
  errorMessage: nullableShortStringArb,
});

const exactLengthArray = <T>(
  arbitrary: fc.Arbitrary<T>,
  minimum: number,
  maximum: number,
): fc.Arbitrary<T[]> => fc.integer({ min: minimum, max: maximum }).chain((length) => (
  fc.array(arbitrary, { minLength: length, maxLength: length })
));

const detailScenarioArb: fc.Arbitrary<DetailScenario> = fc.record({
  authorizedSpecs: exactLengthArray(constituentSpecArb, 1, 220),
  unauthorizedSpecs: exactLengthArray(constituentSpecArb, 0, 20),
});

function createSources(
  visibility: 'authorized' | 'unauthorized',
  specs: readonly ConstituentSpec[],
): DetailSource[] {
  const authorized = visibility === 'authorized';

  return specs.map((spec, index) => {
    const id = `${visibility}-request-${String(index).padStart(3, '0')}`;
    const createdAt = new Date(BASE_TIMESTAMP + spec.createdOffsetSeconds * 1_000);
    const completedAt = spec.completedDelaySeconds === null
      ? null
      : new Date(createdAt.getTime() + spec.completedDelaySeconds * 1_000);
    const marker = `sensitive:${visibility}:${index}`;

    return {
      id,
      apiKeyId: 'profile-authorized-boundary',
      clientReference: 'DETAIL-PROPERTY-14',
      endpointSlug: spec.operationType,
      state: spec.state,
      createdAt,
      updatedAt: completedAt ?? new Date(createdAt.getTime() + 1_000),
      completedAt,
      deletedAt: null,
      hiddenFromOperations: false,
      totalInputTokens: spec.inputTokens,
      totalOutputTokens: spec.outputTokens,
      totalCostUsd: spec.costUsd,
      inputTokensMissing: spec.inputTokensMissing,
      outputTokensMissing: spec.outputTokensMissing,
      costMissing: spec.costMissing,
      hasUnpricedCost: spec.hasUnpricedCost,
      errorCode: spec.errorCode,
      errorMessage: spec.errorMessage,
      authorized,
      sensitiveMarker: marker,
      filesJson: `${marker}:filesJson`,
      pipelineJson: `${marker}:pipelineJson`,
      outputContent: `${marker}:outputContent`,
      extractedData: `${marker}:extractedData`,
      prompts: `${marker}:prompts`,
      documentContent: `${marker}:documentContent`,
    };
  });
}

function compareByCreatedAtThenId(left: DetailSource, right: DetailSource): number {
  const byCreatedAt = left.createdAt.getTime() - right.createdAt.getTime();
  if (byCreatedAt !== 0) return byCreatedAt;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

describe('Business Operation constituent detail property', () => {
  // Feature: operations-request-tracking, Property 14: Constituent detail bảo toàn source mapping, sort và pagination
  // **Validates: Requirements 7.1, 7.2, 7.5, 7.8, 7.9**
  it('returns only authorized operational fields in source order-independent fixed pages', () => {
    fc.assert(
      fc.property(detailScenarioArb, (scenario) => {
        const authorizedSources = createSources('authorized', scenario.authorizedSpecs);
        const unauthorizedSources = createSources('unauthorized', scenario.unauthorizedSpecs);
        const allSources = [
          ...unauthorizedSources,
          ...[...authorizedSources].reverse(),
        ];
        const authorizedOperations = projectBusinessOperations(
          allSources.filter((source) => source.authorized),
        );

        expect(authorizedOperations).toHaveLength(1);
        const operation = authorizedOperations[0];
        const expectedSources = [...authorizedSources].sort(compareByCreatedAtThenId);
        const totalPages = Math.max(
          1,
          Math.ceil(expectedSources.length / CONSTITUENT_REQUEST_PAGE_SIZE),
        );
        const pages = Array.from(
          { length: totalPages },
          (_, index) => createConstituentRequestDetailPage(operation, index + 1),
        );
        const actualItems = pages.flatMap((page) => page.items);
        const actualIds = actualItems.map((item) => item.id);
        const expectedIds = expectedSources.map((source) => source.id);
        const unauthorizedIds = new Set(unauthorizedSources.map((source) => source.id));

        for (const [index, page] of pages.entries()) {
          const expectedPageLength = Math.min(
            CONSTITUENT_REQUEST_PAGE_SIZE,
            expectedSources.length - index * CONSTITUENT_REQUEST_PAGE_SIZE,
          );

          expect(page.page).toBe(index + 1);
          expect(page.pageSize).toBe(CONSTITUENT_REQUEST_PAGE_SIZE);
          expect(page.total).toBe(expectedSources.length);
          expect(page.totalPages).toBe(totalPages);
          expect(page.items).toHaveLength(expectedPageLength);
        }

        expect(actualIds).toEqual(expectedIds);
        expect(actualIds).toHaveLength(authorizedSources.length);
        expect(new Set(actualIds).size).toBe(actualIds.length);
        expect(actualIds.some((id) => unauthorizedIds.has(id))).toBe(false);

        for (const [index, item] of actualItems.entries()) {
          const source = expectedSources[index];
          const serializedItem = JSON.stringify(item);

          expect(item).toMatchObject({
            id: source.id,
            operationType: source.endpointSlug,
            state: source.state,
            startedAt: source.createdAt.toISOString(),
            completedAt: source.completedAt?.toISOString() ?? null,
            inputTokens: source.totalInputTokens,
            outputTokens: source.totalOutputTokens,
            costUsd: source.totalCostUsd,
            errorCode: source.errorCode,
            errorMessage: source.errorMessage,
            missingData: source.inputTokensMissing
              || source.outputTokensMissing
              || source.costMissing
              || source.totalInputTokens === null
              || source.totalOutputTokens === null
              || source.totalCostUsd === null,
            unpricedCost: source.hasUnpricedCost,
          });
          expect(Object.keys(item).sort()).toEqual(DETAIL_OUTPUT_FIELDS);
          expect(item).not.toHaveProperty('source');
          expect(item).not.toHaveProperty('authorized');
          expect(item).not.toHaveProperty('sensitiveMarker');
          for (const field of SENSITIVE_FIELDS) {
            expect(item).not.toHaveProperty(field);
          }
          expect(serializedItem).not.toContain(source.sensitiveMarker);
        }
      }),
      { numRuns: 100 },
    );
  });
});
