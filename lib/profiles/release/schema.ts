import { z } from 'zod';
import { contentHash } from '@/lib/profiles/release/canonical';
import { SEMVER_PATTERN } from './version';

const MAX_BUNDLE_BYTES = 10 * 1024 * 1024;
const MAX_ENDPOINTS = 200;
const MAX_CONNECTION_STEPS = 100;

const AUTH_TYPES = [
  'none',
  'bearer',
  'header',
  'query',
  'csp_oauth2',
  'oauth2_client_credentials',
] as const;

const forbiddenKeys = new Set([
  'keyHash',
  'rawKey',
  'prefix',
  'totalUsed',
  'authSecret',
  'id',
  'apiKeyId',
  'connectionId',
  'userId',
  'fileAuthConfig',
  'callbackAuthConfig',
  'fileUrlAuthConfig',
  'token',
  'client_secret',
  'header_value',
  'query_value',
]);

function forbiddenName(key: string, parentKey?: string): string | null {
  if (parentKey === 'gateway_headers' && key === 'value') return 'gateway_headers[].value';
  return forbiddenKeys.has(key) ? key : null;
}

/** Rejects persisted identifiers, ciphertext, and inline secret values at every depth. */
export function assertNoForbiddenKeys(value: unknown, parentKey?: string): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenKeys(item, parentKey);
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const forbidden = forbiddenName(key, parentKey);
    if (forbidden) throw new Error(`bundle contains forbidden field '${forbidden}'`);
    assertNoForbiddenKeys(child, key);
  }
}

const authConfigSchema = z.object({
  type: z.enum(AUTH_TYPES),
  token_secret_ref: z.string().min(1).max(2_000).optional(),
  header_name: z.string().min(1).max(500).optional(),
  header_value_secret_ref: z.string().min(1).max(2_000).optional(),
  query_key: z.string().min(1).max(500).optional(),
  query_value_secret_ref: z.string().min(1).max(2_000).optional(),
  token_url: z.string().url().max(4_000).optional(),
  client_id: z.string().max(2_000).optional(),
  client_secret_ref: z.string().min(1).max(2_000).optional(),
  token_body_format: z.enum(['json', 'form']).optional(),
  token_auth_style: z.enum(['body', 'basic']).optional(),
  scope: z.string().max(2_000).optional(),
  audience: z.string().max(2_000).optional(),
  token_response_path: z.string().max(2_000).optional(),
  csp_chunk_size: z.number().int().min(1).max(1_000).optional(),
  ibm_client_id: z.string().max(2_000).optional(),
  gateway_headers: z.array(z.object({
    name: z.string().min(1).max(500),
    value_secret_ref: z.string().min(1).max(2_000).optional(),
  }).strict()).max(100).optional(),
}).strict();

const secretRefSchema = z.object({
  present: z.boolean(),
  type: z.enum(AUTH_TYPES),
  needsInlineSecret: z.boolean(),
}).strict();

const endpointSchema = z.object({
  endpointSlug: z.string().min(1).max(500),
  enabled: z.boolean(),
  parameters: z.record(z.unknown()).nullable(),
  connections: z.array(z.object({
    slug: z.string().min(1).max(500),
    stepId: z.string().max(500).nullable(),
    captureSession: z.string().max(1_000).nullable(),
    injectSession: z.string().max(1_000).nullable(),
  }).strict()).max(MAX_CONNECTION_STEPS).nullable(),
  jobPriority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  fileUrlDefaultChunks: z.number().int().min(1).max(1_000).nullable(),
  allowedFileExtensions: z.string().max(1_000).nullable(),
  referenceExtract: z.string().max(500).nullable(),
  overrides: z.array(z.object({
    connectorSlug: z.string().min(1).max(500),
    stepId: z.string().min(1).max(500),
    promptOverride: z.string().max(200_000).nullable(),
    modelOverride: z.string().max(200).nullable(),
    reasoningEffortOverride: z.enum(['minimal', 'low', 'medium', 'high']).nullable(),
  }).strict()).max(MAX_CONNECTION_STEPS),
  fileUrlAuth: authConfigSchema.nullable(),
  secretRefs: z.object({ fileUrlAuth: secretRefSchema }).strict(),
}).strict();

export const profileReleaseBundleSchema = z.object({
  bundleVersion: z.literal(1),
  kind: z.literal('dugate.profile'),
  profile: z.object({
    name: z.string().min(1).max(120),
    displayName: z.string().max(200).nullable(),
    note: z.string().max(2_000).nullable(),
    status: z.enum(['active', 'inactive', 'disabled']),
    role: z.enum(['STANDARD', 'ADMIN', 'VIEWER']),
    callbackPayload: z.enum(['WITH_RESULT']).nullable(),
    fileAuth: authConfigSchema.nullable(),
    callbackAuth: authConfigSchema.nullable(),
    secretRefs: z.object({
      fileAuth: secretRefSchema,
      callbackAuth: secretRefSchema,
    }).strict(),
  }).strict(),
  runtimeHints: z.object({
    workerGroup: z.string().max(500).nullable(),
    rateLimitPerMin: z.number().int().min(0),
    spendingLimit: z.number().min(0),
  }).strict(),
  requires: z.object({
    apiSurface: z.string().min(1).max(50),
    minAppVersion: z.string().min(1).max(100),
    endpointSlugs: z.array(z.string().min(1).max(500)).max(MAX_ENDPOINTS),
    connectorSlugs: z.array(z.string().min(1).max(500)).max(MAX_CONNECTION_STEPS),
    workerGroups: z.array(z.string().min(1).max(500)).max(MAX_CONNECTION_STEPS),
  }).strict(),
  endpoints: z.array(endpointSchema).min(1).max(MAX_ENDPOINTS),
  meta: z.object({
    sourceEnv: z.enum(['UAT', 'LIVE']),
    sourceRevision: z.number().int().min(0),
    exportedAt: z.string().datetime(),
    exportedBy: z.string().min(1).max(500),
    appVersion: z.string().min(1).max(100),
    version: z.string().regex(SEMVER_PATTERN, 'Phiên bản phải theo chuẩn semver').nullable().optional(),
    message: z.string().max(2_000).nullable(),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }).strict(),
}).strict();

export type ProfileReleaseBundleV1 = z.infer<typeof profileReleaseBundleSchema>;

function formatIssues(issues: z.ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.join('.') || 'bundle'}: ${issue.message}`).join('; ');
}

/** Parses a complete v1 release bundle without trusting its supplied checksum. */
export function parseProfileReleaseBundle(value: unknown): ProfileReleaseBundleV1 {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('Bundle must be JSON serializable');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BUNDLE_BYTES) {
    throw new Error('Bundle exceeds the 10 MB limit');
  }

  assertNoForbiddenKeys(value);
  const parsed = profileReleaseBundleSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid Profile Release bundle: ${formatIssues(parsed.error.issues)}`);

  const actualHash = contentHash(parsed.data);
  if (actualHash !== parsed.data.meta.contentHash) {
    throw new Error('Bundle checksum mismatch');
  }
  return parsed.data;
}
