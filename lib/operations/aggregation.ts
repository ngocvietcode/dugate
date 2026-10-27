import type { ProfileScope } from './business-key';
import type {
  BusinessOperationProjection,
  OperationRequestProjectionSource,
  RequestProjection,
} from './projection';

export const COST_DECIMAL_PRECISION = 30;
export const COST_DECIMAL_SCALE = 10;

export type DecimalCostInput = string | number;
export type LogicResult = 'PASS' | 'FAIL' | null;
export type ExtractionResult = 'SUCCESS' | 'FAIL' | null;

export interface AggregationRequestSource extends OperationRequestProjectionSource {
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalCostUsd: DecimalCostInput | null;
  logicResult: LogicResult;
  extractionResult: ExtractionResult;
  inputTokensMissing: boolean;
  outputTokensMissing: boolean;
  costMissing: boolean;
  hasUnpricedCost: boolean;
}

export interface BusinessOperationsSummary {
  totalCases: number;
  tokensProcessed: number;
  totalCostUsd: string;
  logicSuccessRate: number | null;
  aiExtractionRate: number | null;
  unpricedRequestCount: number;
  costIncomplete: boolean;
  missingRequestCount: number;
  missingData: boolean;
}

export interface BreakdownCardReference {
  profileScope: ProfileScope;
  operationType: string;
  businessOperationCount: number;
  succeededCount: number;
  failedCount: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  averageTokensPerBusinessOperation: number;
  averageDurationSeconds: number | null;
  maxDurationOperationIdentifier: string | null;
  maxTokenOperationIdentifier: string;
  unpricedRequestCount: number;
  costIncomplete: boolean;
  missingRequestCount: number;
  missingData: boolean;
}

interface DecimalAccumulator {
  coefficient: bigint;
}

interface CardAccumulator<TSource extends AggregationRequestSource> {
  profileScope: ProfileScope;
  operationType: string;
  operations: Map<string, BusinessOperationProjection<TSource>>;
  requests: RequestProjection<TSource>[];
}

/**
 * Aggregates an already-authorized and filtered business-operation partition.
 * Every business key contributes at most once, while all requests belonging to
 * each selected business operation contribute to its summary metrics.
 */
export function aggregateBusinessOperationsSummary<
  TSource extends AggregationRequestSource,
>(
  operations: readonly BusinessOperationProjection<TSource>[],
): BusinessOperationsSummary {
  const distinctOperations = uniqueBusinessOperations(operations);
  const requests = distinctOperations.flatMap((operation) => operation.requests);
  const totalCost = createDecimalAccumulator();
  let tokensProcessed = 0;
  let unpricedRequestCount = 0;
  let missingRequestCount = 0;
  let logicEligibleCount = 0;
  let logicSuccessfulCount = 0;
  let extractionEligibleCount = 0;
  let extractionSuccessfulCount = 0;

  for (const request of requests) {
    tokensProcessed = addSafeIntegers(
      tokensProcessed,
      requestTokens(request.source),
      'summary tokens',
    );
    addRequestCost(totalCost, request.source);
    if (request.source.hasUnpricedCost) unpricedRequestCount += 1;
    if (requestHasMissingData(request.source)) missingRequestCount += 1;
  }

  for (const operation of distinctOperations) {
    const logicResults = operation.requests
      .map((request) => request.source.logicResult)
      .filter((result): result is Exclude<LogicResult, null> => (
        result === 'PASS' || result === 'FAIL'
      ));
    if (logicResults.length > 0) {
      logicEligibleCount += 1;
      if (logicResults.every((result) => result === 'PASS')) {
        logicSuccessfulCount += 1;
      }
    }

    const extractionResults = operation.requests
      .map((request) => request.source.extractionResult)
      .filter((result): result is Exclude<ExtractionResult, null> => (
        result === 'SUCCESS' || result === 'FAIL'
      ));
    if (extractionResults.length > 0) {
      extractionEligibleCount += 1;
      if (extractionResults.every((result) => result === 'SUCCESS')) {
        extractionSuccessfulCount += 1;
      }
    }
  }

  return {
    totalCases: distinctOperations.length,
    tokensProcessed,
    totalCostUsd: formatDecimalAccumulator(totalCost),
    logicSuccessRate: percentage(logicSuccessfulCount, logicEligibleCount),
    aiExtractionRate: percentage(
      extractionSuccessfulCount,
      extractionEligibleCount,
    ),
    unpricedRequestCount,
    costIncomplete: unpricedRequestCount > 0,
    missingRequestCount,
    missingData: missingRequestCount > 0,
  };
}

/**
 * Creates one card for every represented (profile scope, operation type) pair.
 * Request metrics are deliberately restricted to requests of the card type;
 * business counts, status, duration, and identifiers remain group-level.
 */
export function aggregateBusinessOperationBreakdown<
  TSource extends AggregationRequestSource,
>(
  operations: readonly BusinessOperationProjection<TSource>[],
): BreakdownCardReference[] {
  const cards = new Map<string, CardAccumulator<TSource>>();

  for (const operation of uniqueBusinessOperations(operations)) {
    for (const request of operation.requests) {
      const operationType = request.operationType;
      if (operationType === null) continue;

      const key = breakdownCardKey(operation.profileScope, operationType);
      let card = cards.get(key);
      if (!card) {
        card = {
          profileScope: cloneProfileScope(operation.profileScope),
          operationType,
          operations: new Map(),
          requests: [],
        };
        cards.set(key, card);
      }
      card.operations.set(operation.businessGroupKey, operation);
      card.requests.push(request);
    }
  }

  return [...cards.values()]
    .sort(compareCardAccumulators)
    .map(finalizeBreakdownCard);
}

export function aggregateBusinessOperations<
  TSource extends AggregationRequestSource,
>(operations: readonly BusinessOperationProjection<TSource>[]): {
  summary: BusinessOperationsSummary;
  breakdownCards: BreakdownCardReference[];
} {
  return {
    summary: aggregateBusinessOperationsSummary(operations),
    breakdownCards: aggregateBusinessOperationBreakdown(operations),
  };
}

function finalizeBreakdownCard<TSource extends AggregationRequestSource>(
  card: CardAccumulator<TSource>,
): BreakdownCardReference {
  const operations = [...card.operations.values()];
  const totalCost = createDecimalAccumulator();
  const tokensByBusinessGroupKey = new Map<string, number>();
  let inputTokens = 0;
  let outputTokens = 0;
  let unpricedRequestCount = 0;
  let missingRequestCount = 0;

  for (const request of card.requests) {
    const requestInputTokens = nullableToken(request.source.totalInputTokens);
    const requestOutputTokens = nullableToken(request.source.totalOutputTokens);
    const totalRequestTokens = addSafeIntegers(
      requestInputTokens,
      requestOutputTokens,
      'request tokens',
    );

    inputTokens = addSafeIntegers(inputTokens, requestInputTokens, 'card input tokens');
    outputTokens = addSafeIntegers(outputTokens, requestOutputTokens, 'card output tokens');
    addRequestCost(totalCost, request.source);
    if (request.source.hasUnpricedCost) unpricedRequestCount += 1;
    if (requestHasMissingData(request.source)) missingRequestCount += 1;

    tokensByBusinessGroupKey.set(
      request.businessGroupKey,
      addSafeIntegers(
        tokensByBusinessGroupKey.get(request.businessGroupKey) ?? 0,
        totalRequestTokens,
        'card business-operation tokens',
      ),
    );
  }

  const totalTokens = addSafeIntegers(inputTokens, outputTokens, 'card total tokens');
  const terminalOperations = operations.filter((operation) => (
    (operation.businessStatus === 'SUCCEEDED' || operation.businessStatus === 'FAILED')
      && operation.durationSeconds !== null
  ));
  const averageDurationSeconds = terminalOperations.length === 0
    ? null
    : roundTo(
      terminalOperations.reduce((sum, operation) => (
        sum + (operation.durationSeconds as number)
      ), 0) / terminalOperations.length,
      1,
    );

  return {
    profileScope: cloneProfileScope(card.profileScope),
    operationType: card.operationType,
    businessOperationCount: operations.length,
    succeededCount: operations.filter(
      (operation) => operation.businessStatus === 'SUCCEEDED',
    ).length,
    failedCount: operations.filter(
      (operation) => operation.businessStatus === 'FAILED',
    ).length,
    requestCount: card.requests.length,
    inputTokens,
    outputTokens,
    costUsd: formatDecimalAccumulator(totalCost),
    averageTokensPerBusinessOperation: roundRatio(
      totalTokens,
      operations.length,
      1,
    ),
    averageDurationSeconds,
    maxDurationOperationIdentifier: selectMaximumIdentifier(
      terminalOperations,
      (operation) => operation.durationSeconds as number,
    ),
    maxTokenOperationIdentifier: selectMaximumIdentifier(
      operations,
      (operation) => tokensByBusinessGroupKey.get(operation.businessGroupKey) ?? 0,
    ) as string,
    unpricedRequestCount,
    costIncomplete: unpricedRequestCount > 0,
    missingRequestCount,
    missingData: missingRequestCount > 0,
  };
}

function uniqueBusinessOperations<TSource extends AggregationRequestSource>(
  operations: readonly BusinessOperationProjection<TSource>[],
): BusinessOperationProjection<TSource>[] {
  const distinct = new Map<string, BusinessOperationProjection<TSource>>();
  for (const operation of operations) {
    if (!distinct.has(operation.businessGroupKey)) {
      distinct.set(operation.businessGroupKey, operation);
    }
  }
  return [...distinct.values()];
}

function requestTokens(source: AggregationRequestSource): number {
  return addSafeIntegers(
    nullableToken(source.totalInputTokens),
    nullableToken(source.totalOutputTokens),
    'request tokens',
  );
}

function nullableToken(value: number | null): number {
  if (value === null) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Token values must be non-negative safe integers or null');
  }
  return value;
}

function requestHasMissingData(source: AggregationRequestSource): boolean {
  return source.inputTokensMissing
    || source.outputTokensMissing
    || source.costMissing
    || source.totalInputTokens === null
    || source.totalOutputTokens === null
    || (source.totalCostUsd === null && !source.hasUnpricedCost);
}

function addRequestCost(
  accumulator: DecimalAccumulator,
  source: AggregationRequestSource,
): void {
  if (
    source.hasUnpricedCost
    || source.costMissing
    || source.totalCostUsd === null
  ) {
    return;
  }
  accumulator.coefficient += decimalToFixedCoefficient(source.totalCostUsd);
}

function createDecimalAccumulator(): DecimalAccumulator {
  return { coefficient: BigInt(0) };
}

function decimalToFixedCoefficient(value: DecimalCostInput): bigint {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError('Cost values must be finite decimals');
  }

  const text = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw new RangeError(`Invalid decimal cost: ${text}`);

  const sign = match[1] === '-' ? BigInt(-1) : BigInt(1);
  const fraction = match[3] ?? '';
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent)) {
    throw new RangeError(`Invalid decimal exponent: ${text}`);
  }

  let coefficient = BigInt(`${match[2]}${fraction}`) * sign;
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= powerOfTen(-scale);
    scale = 0;
  }

  while (
    scale > COST_DECIMAL_SCALE
    && coefficient % BigInt(10) === BigInt(0)
  ) {
    coefficient /= BigInt(10);
    scale -= 1;
  }
  if (scale > COST_DECIMAL_SCALE) {
    throw new RangeError(
      `Cost exceeds numeric(30,${COST_DECIMAL_SCALE}) scale: ${text}`,
    );
  }

  const scaledCoefficient = coefficient * powerOfTen(COST_DECIMAL_SCALE - scale);
  if (absoluteBigInt(scaledCoefficient) >= powerOfTen(COST_DECIMAL_PRECISION)) {
    throw new RangeError(
      `Cost exceeds numeric(${COST_DECIMAL_PRECISION},${COST_DECIMAL_SCALE}) precision: ${text}`,
    );
  }

  return scaledCoefficient;
}

function absoluteBigInt(value: bigint): bigint {
  return value < BigInt(0) ? -value : value;
}

function formatDecimalAccumulator(accumulator: DecimalAccumulator): string {
  const negative = accumulator.coefficient < BigInt(0);
  const digits = (negative ? -accumulator.coefficient : accumulator.coefficient)
    .toString()
    .padStart(COST_DECIMAL_SCALE + 1, '0');
  const integer = digits.slice(0, -COST_DECIMAL_SCALE);
  const fraction = digits.slice(-COST_DECIMAL_SCALE);
  return `${negative ? '-' : ''}${integer}.${fraction}`;
}

function powerOfTen(exponent: number): bigint {
  return BigInt(10) ** BigInt(exponent);
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : roundRatio(numerator * 100, denominator, 2);
}

function roundRatio(numerator: number, denominator: number, decimals: number): number {
  if (denominator <= 0) {
    throw new RangeError('Ratio denominator must be positive');
  }
  return roundTo(numerator / denominator, decimals);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function selectMaximumIdentifier<TSource extends AggregationRequestSource>(
  operations: readonly BusinessOperationProjection<TSource>[],
  valueOf: (operation: BusinessOperationProjection<TSource>) => number,
): string | null {
  let selected: BusinessOperationProjection<TSource> | null = null;
  let maximum = Number.NEGATIVE_INFINITY;

  for (const operation of operations) {
    const value = valueOf(operation);
    if (
      selected === null
      || value > maximum
      || (value === maximum
        && compareBinary(
          operation.operationIdentifier,
          selected.operationIdentifier,
        ) < 0)
    ) {
      selected = operation;
      maximum = value;
    }
  }

  return selected?.operationIdentifier ?? null;
}

function breakdownCardKey(scope: ProfileScope, operationType: string): string {
  return JSON.stringify([
    scope.kind,
    scope.kind === 'profile' ? scope.apiKeyId : null,
    operationType,
  ]);
}

function compareCardAccumulators(
  left: CardAccumulator<AggregationRequestSource>,
  right: CardAccumulator<AggregationRequestSource>,
): number {
  const byScope = compareBinary(profileScopeSortKey(left.profileScope), profileScopeSortKey(right.profileScope));
  return byScope !== 0
    ? byScope
    : compareBinary(left.operationType, right.operationType);
}

function profileScopeSortKey(scope: ProfileScope): string {
  return scope.kind === 'internal' ? '__internal__' : scope.apiKeyId;
}

function cloneProfileScope(scope: ProfileScope): ProfileScope {
  return scope.kind === 'internal'
    ? { kind: 'internal' }
    : { kind: 'profile', apiKeyId: scope.apiKeyId };
}

function addSafeIntegers(left: number, right: number, label: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError(`${label} exceed JavaScript safe integer precision`);
  }
  return sum;
}

function compareBinary(left: string, right: string): number {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return Math.sign(Buffer.compare(leftBytes, rightBytes));
}
