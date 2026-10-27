import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ALL_FILTER_VALUE,
  BUSINESS_QUERY_LIST_SORTS,
  BUSINESS_QUERY_SEARCH_MODES,
  BusinessQueryError,
  INTERNAL_PROFILE_SCOPE,
  validateBusinessOperationsQueryInput,
  validateBusinessQueryAuthorization,
  type BusinessOperationsQueryInput,
  type BusinessQueryAuthorizationContext,
} from './business-query';
import { CALENDAR_PRESETS } from './time-window';

const BUSINESS_STATUSES = [
  ALL_FILTER_VALUE,
  'IN_PROGRESS',
  'SUCCEEDED',
  'FAILED',
  'N/A',
] as const;

const QUERY_PARAMETER_NAMES = [
  'range',
  'profile',
  'operation_type',
  'status',
  'q',
  'search_mode',
  'page',
  'sort',
] as const;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DATABASE_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  '57P01',
  '57P02',
  '57P03',
]);

const trimmedFilterSchema = z.string().transform((value) => value.trim()).superRefine(
  (value, context) => {
    const length = Array.from(value).length;
    if (length < 1 || length > 256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Filter must contain between 1 and 256 characters',
      });
    }
  },
);

const searchQuerySchema = z.string().transform((value) => value.trim()).superRefine(
  (value, context) => {
    const length = Array.from(value).length;
    if (length < 1 || length > 256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Search must contain between 1 and 256 characters',
      });
    }
  },
);

const positivePageSchema = z.string()
  .regex(/^\d+$/)
  .transform((value) => Number(value))
  .refine((value) => Number.isSafeInteger(value) && value >= 1);

const dashboardQuerySchema = z.object({
  range: z.enum(CALENDAR_PRESETS).default('today'),
  profile: trimmedFilterSchema.default(ALL_FILTER_VALUE),
  operation_type: trimmedFilterSchema.default(ALL_FILTER_VALUE),
  status: z.enum(BUSINESS_STATUSES).default(ALL_FILTER_VALUE),
  q: searchQuerySchema.optional(),
  search_mode: z.enum(BUSINESS_QUERY_SEARCH_MODES).default('exact'),
  page: positivePageSchema.default('1'),
  sort: z.enum(BUSINESS_QUERY_LIST_SORTS).default('recent'),
}).strict();

export type ApiProblemCode =
  | 'INVALID_FILTER'
  | 'INVALID_SEARCH'
  | 'INVALID_OPERATION_TOKEN'
  | 'UNAUTHORIZED'
  | 'OPERATIONS_FORBIDDEN'
  | 'PROFILE_SCOPE_FORBIDDEN'
  | 'BUSINESS_OPERATION_NOT_FOUND'
  | 'DASHBOARD_QUERY_FAILED'
  | 'DASHBOARD_UNAVAILABLE'
  | 'DASHBOARD_TIMEOUT';

export interface ApiProblem {
  error: {
    code: ApiProblemCode;
    message: string;
    retryable: boolean;
    requestId: string;
  };
}

interface ApiProblemDefinition {
  status: 400 | 401 | 403 | 404 | 500 | 503 | 504;
  message: string;
  retryable: boolean;
}

const PROBLEM_DEFINITIONS: Record<ApiProblemCode, ApiProblemDefinition> = {
  INVALID_FILTER: {
    status: 400,
    message: 'One or more dashboard filters are invalid.',
    retryable: false,
  },
  INVALID_SEARCH: {
    status: 400,
    message: 'Search must contain between 1 and 256 characters.',
    retryable: false,
  },
  INVALID_OPERATION_TOKEN: {
    status: 400,
    message: 'The Business Operation token is invalid.',
    retryable: false,
  },
  UNAUTHORIZED: {
    status: 401,
    message: 'Authentication is required.',
    retryable: false,
  },
  OPERATIONS_FORBIDDEN: {
    status: 403,
    message: 'Operations read access is required.',
    retryable: false,
  },
  PROFILE_SCOPE_FORBIDDEN: {
    status: 403,
    message: 'The selected Profile scope is not available.',
    retryable: false,
  },
  BUSINESS_OPERATION_NOT_FOUND: {
    status: 404,
    message: 'Business Operation not found.',
    retryable: false,
  },
  DASHBOARD_QUERY_FAILED: {
    status: 500,
    message: 'The Business Operations query failed.',
    retryable: false,
  },
  DASHBOARD_UNAVAILABLE: {
    status: 503,
    message: 'The Business Operations dashboard is temporarily unavailable.',
    retryable: true,
  },
  DASHBOARD_TIMEOUT: {
    status: 504,
    message: 'The Business Operations query timed out.',
    retryable: true,
  },
};

/**
 * A route-safe error whose public representation is selected exclusively from
 * the fixed problem catalog. Callers cannot accidentally expose source error
 * messages, SQL text, stack traces, or identifiers through this type.
 */
export class ApiProblemError extends Error {
  constructor(readonly code: ApiProblemCode) {
    super(PROBLEM_DEFINITIONS[code].message);
    this.name = 'ApiProblemError';
  }
}

/**
 * Parse dashboard query parameters without touching persistence. Defaults are
 * stable API defaults; blank values are invalid rather than silently defaulted.
 */
export function parseBusinessOperationsDashboardQuery(
  searchParams: URLSearchParams,
): BusinessOperationsQueryInput {
  const raw: Record<string, string | undefined> = {};

  for (const parameterName of QUERY_PARAMETER_NAMES) {
    const values = searchParams.getAll(parameterName);
    if (values.length > 1) {
      throw new ApiProblemError(parameterName === 'q' ? 'INVALID_SEARCH' : 'INVALID_FILTER');
    }
    raw[parameterName] = values[0];
  }

  const result = dashboardQuerySchema.safeParse(raw);
  if (!result.success) {
    const invalidSearch = result.error.issues.some((issue) => issue.path[0] === 'q');
    throw new ApiProblemError(invalidSearch ? 'INVALID_SEARCH' : 'INVALID_FILTER');
  }

  const input: BusinessOperationsQueryInput = {
    range: result.data.range,
    profile: result.data.profile,
    operationType: result.data.operation_type,
    status: result.data.status,
    query: result.data.q ?? null,
    searchMode: result.data.q === undefined ? null : result.data.search_mode,
    page: result.data.page,
    sort: result.data.sort,
  };

  // Keep the HTTP parser and query service normalization in lockstep. This is
  // still pure validation and occurs before a transaction can be opened.
  validateBusinessOperationsQueryInput(input);
  return input;
}

/**
 * Route entry-point parser. Selected-profile authorization is checked before a
 * route can invoke the aggregate query service, preserving the prior snapshot
 * on invalid/forbidden filter changes.
 */
export function parseAuthorizedBusinessOperationsDashboardQuery(
  searchParams: URLSearchParams,
  authorization: BusinessQueryAuthorizationContext,
): BusinessOperationsQueryInput {
  const input = parseBusinessOperationsDashboardQuery(searchParams);
  const validatedInput = validateBusinessOperationsQueryInput(input);
  validateBusinessQueryAuthorization(validatedInput, authorization);
  return input;
}

/** Parse the sole detail-list query parameter without touching persistence. */
export function parseBusinessOperationDetailPage(searchParams: URLSearchParams): number {
  const values = searchParams.getAll('page');
  if (values.length > 1) {
    throw new ApiProblemError('INVALID_FILTER');
  }

  const result = positivePageSchema.safeParse(values[0] ?? '1');
  if (!result.success) {
    throw new ApiProblemError('INVALID_FILTER');
  }
  return result.data;
}

/** Accept a bounded caller request ID, otherwise issue an opaque server ID. */
export function getOrCreateApiRequestId(candidate?: string | null): string {
  const normalized = candidate?.trim() ?? '';
  return REQUEST_ID_PATTERN.test(normalized) ? normalized : randomUUID();
}

export function toApiProblem(
  error: unknown,
  requestId = getOrCreateApiRequestId(),
): { status: ApiProblemDefinition['status']; body: ApiProblem } {
  const code = classifyApiProblem(error);
  const definition = PROBLEM_DEFINITIONS[code];
  return {
    status: definition.status,
    body: {
      error: {
        code,
        message: definition.message,
        retryable: definition.retryable,
        requestId,
      },
    },
  };
}

/** Build a no-store JSON response containing only the public problem contract. */
export function apiProblemResponse(
  error: unknown,
  requestId = getOrCreateApiRequestId(),
): NextResponse<ApiProblem> {
  const problem = toApiProblem(error, requestId);
  return NextResponse.json(problem.body, {
    status: problem.status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
    },
  });
}

/** Normalize legacy auth-guard responses into the shared problem contract. */
export function authGuardProblemResponse(
  status: 401 | 403,
  requestId = getOrCreateApiRequestId(),
): NextResponse<ApiProblem> {
  return apiProblemResponse(
    new ApiProblemError(status === 401 ? 'UNAUTHORIZED' : 'OPERATIONS_FORBIDDEN'),
    requestId,
  );
}

function classifyApiProblem(error: unknown): ApiProblemCode {
  if (error instanceof ApiProblemError) return error.code;

  if (error instanceof BusinessQueryError) {
    switch (error.code) {
      case 'INVALID_FILTER':
      case 'INVALID_SEARCH':
      case 'INVALID_OPERATION_TOKEN':
      case 'OPERATIONS_FORBIDDEN':
      case 'PROFILE_SCOPE_FORBIDDEN':
      case 'BUSINESS_OPERATION_NOT_FOUND':
        return error.code;
      case 'SNAPSHOT_METADATA_INVALID':
        return 'DASHBOARD_QUERY_FAILED';
    }
  }

  if (hasErrorName(error, 'AbortError') || hasErrorCode(error, '57014')) {
    return 'DASHBOARD_TIMEOUT';
  }

  if (hasDatabaseUnavailableCode(error)) {
    return 'DASHBOARD_UNAVAILABLE';
  }

  return 'DASHBOARD_QUERY_FAILED';
}

function hasErrorName(error: unknown, expectedName: string): boolean {
  return readErrorChain(error).some((candidate) => candidate.name === expectedName);
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return readErrorChain(error).some((candidate) => candidate.code === expectedCode);
}

function hasDatabaseUnavailableCode(error: unknown): boolean {
  return readErrorChain(error).some((candidate) => (
    typeof candidate.code === 'string' && DATABASE_UNAVAILABLE_CODES.has(candidate.code)
  ));
}

function readErrorChain(error: unknown): Array<{ name?: unknown; code?: unknown }> {
  const chain: Array<{ name?: unknown; code?: unknown }> = [];
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current !== null && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const candidate = current as { name?: unknown; code?: unknown; cause?: unknown };
    chain.push(candidate);
    current = candidate.cause;
  }

  return chain;
}

// Exported constants make route-level schemas and contract tests avoid magic
// strings without exposing internal Zod diagnostics.
export const BUSINESS_OPERATIONS_API_DEFAULTS = {
  range: 'today',
  profile: ALL_FILTER_VALUE,
  operationType: ALL_FILTER_VALUE,
  status: ALL_FILTER_VALUE,
  searchMode: 'exact',
  page: 1,
  sort: 'recent',
} as const;

export { INTERNAL_PROFILE_SCOPE };
