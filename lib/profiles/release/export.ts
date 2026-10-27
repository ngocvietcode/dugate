import { decrypt } from '@/lib/crypto';
import { parseFileUrlAuthConfig } from '@/lib/file-url-downloader';
import { contentHash } from './canonical';
import type { ProfileReleaseBundleV1 } from './schema';

type Row = Record<string, any>;
export interface ExportInput { profile: Row; endpoints: Row[]; overrides: Row[]; connections: Row[]; appVersion: string; message: string; version?: string | null; sourceEnv?: 'UAT' | 'LIVE'; sourceRevision?: number; exportedBy?: string; }
const INLINE = new Set(['token', 'client_secret', 'header_value', 'query_value']);
function auth(raw: unknown): { value: any | null; needsInlineSecret: boolean } {
  if (!raw) return { value: null, needsInlineSecret: false };
  let parsed: any;
  try { parsed = JSON.parse(decrypt(String(raw))); } catch { try { parsed = JSON.parse(String(raw)); } catch { return { value: null, needsInlineSecret: false }; } }
  const config = parseFileUrlAuthConfig(parsed) as any;
  if (!config) return { value: null, needsInlineSecret: false };
  let needsInlineSecret = false;
  const safe: any = {};
  for (const [key, value] of Object.entries(config)) {
    if (INLINE.has(key)) { needsInlineSecret ||= Boolean(value); continue; }
    if (key === 'gateway_headers') {
      safe[key] = (value as any[]).map(({ value: secret, ...header }) => { needsInlineSecret ||= Boolean(secret); return header; });
    } else safe[key] = value;
  }
  return { value: safe, needsInlineSecret };
}
function json(raw: unknown): any { if (!raw) return null; try { return JSON.parse(String(raw)); } catch { return null; } }
export function buildBundle(input: ExportInput): ProfileReleaseBundleV1 {
  const fileAuth = auth(input.profile.fileAuthConfig), callbackAuth = auth(input.profile.callbackAuthConfig);
  const connectionSlugs = new Map(input.connections.map(c => [c.id, c.slug]));
  const endpoints = input.endpoints.map(endpoint => {
    // The per-endpoint file-download credential override was removed. `fileUrlAuth` and
    // its secretRef are still emitted (as an empty configuration) because endpointSchema
    // is strict and declares both as required: keeping the shape lets bundles exported
    // before the removal continue to validate and keeps contentHash stable for Profiles
    // that never used the override.
    const overrides = input.overrides.filter(o => o.endpointSlug === endpoint.endpointSlug).flatMap(o => {
      const connectorSlug = connectionSlugs.get(o.connectionId); return connectorSlug ? [{ connectorSlug, stepId: o.stepId ?? '_default', promptOverride: o.promptOverride ?? null, modelOverride: o.modelOverride ?? null, reasoningEffortOverride: o.reasoningEffortOverride ?? null }] : [];
    });
    return { endpointSlug: endpoint.endpointSlug, enabled: Boolean(endpoint.enabled), parameters: json(endpoint.parameters), connections: json(endpoint.connectionsOverride), jobPriority: endpoint.jobPriority ?? 'MEDIUM', fileUrlDefaultChunks: endpoint.fileUrlDefaultChunks ?? null, allowedFileExtensions: endpoint.allowedFileExtensions ?? null, referenceExtract: endpoint.referenceExtract ?? null, overrides, fileUrlAuth: null, secretRefs: { fileUrlAuth: { present: false, type: 'none' as const, needsInlineSecret: false } } };
  });
  const bundle: any = { bundleVersion: 1, kind: 'dugate.profile', profile: { name: input.profile.name, displayName: input.profile.displayName ?? null, note: input.profile.note ?? null, status: input.profile.status, role: input.profile.role, callbackPayload: input.profile.callbackPayload === 'WITH_RESULT' ? 'WITH_RESULT' : null, fileAuth: fileAuth.value, callbackAuth: callbackAuth.value, secretRefs: { fileAuth: { present: fileAuth.value !== null, type: fileAuth.value?.type ?? 'none', needsInlineSecret: fileAuth.needsInlineSecret }, callbackAuth: { present: callbackAuth.value !== null, type: callbackAuth.value?.type ?? 'none', needsInlineSecret: callbackAuth.needsInlineSecret } } }, runtimeHints: { workerGroup: input.profile.workerGroup ?? null, rateLimitPerMin: input.profile.rateLimitPerMin ?? 0, spendingLimit: input.profile.spendingLimit ?? 0 }, requires: { apiSurface: 'v2', minAppVersion: input.appVersion, endpointSlugs: endpoints.map(e => e.endpointSlug), connectorSlugs: [...new Set(endpoints.flatMap(e => [ ...(e.connections ?? []).map((x: any) => x.slug), ...e.overrides.map((x: any) => x.connectorSlug) ]))], workerGroups: input.profile.workerGroup ? [input.profile.workerGroup] : [] }, endpoints, meta: { sourceEnv: input.sourceEnv ?? 'UAT', sourceRevision: input.sourceRevision ?? 0, exportedAt: new Date().toISOString(), exportedBy: input.exportedBy ?? 'system', appVersion: input.appVersion, version: input.version ?? null, message: input.message || null, contentHash: '' } };
  bundle.meta.contentHash = contentHash(bundle); return bundle;
}
