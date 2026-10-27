import { contentHash } from './canonical';
import type { ProfileReleaseBundleV1 } from './schema';

export type ChangeOp = 'CREATE' | 'UPDATE' | 'DELETE' | 'NOOP';

export interface TargetState {
  profile?: any;
  profilesByName?: number;
  endpoints: any[];
  connectors: any[];
  workerGroups: string[];
  endpointSlugs: string[];
  appVersion: string;
  targetProfileName?: string;
  pendingRunningJobs?: number;
}

export interface Plan {
  planHash: string;
  targetHash: string;
  sourceHash: string;
  targetProfileName?: string;
  applicable: boolean;
  preconditions: any[];
  endpoints: any[];
  breaking: any[];
  warnings: any[];
}

const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

export function planApply(bundle: ProfileReleaseBundleV1, target: TargetState): Plan {
  const preconditions: any[] = [];
  const enabled = new Map(target.connectors.map((connector) => [connector.slug, connector.state === 'ENABLED']));

  for (const slug of bundle.requires.connectorSlugs) {
    if (!enabled.get(slug)) preconditions.push({ check: 'connectorSlugs', status: 'FAIL', detail: slug });
  }
  for (const slug of bundle.requires.endpointSlugs) {
    if (!target.endpointSlugs.includes(slug)) preconditions.push({ check: 'endpointSlugs', status: 'FAIL', detail: slug });
  }
  for (const group of bundle.requires.workerGroups) {
    if (!target.workerGroups.includes(group)) preconditions.push({ check: 'workerGroups', status: 'FAIL', detail: group });
  }
  if ((target.profilesByName ?? (target.profile ? 1 : 0)) > 1) {
    preconditions.push({ check: 'profileNameUnique', status: 'FAIL' });
  }

  const sourceHash = bundle.meta.contentHash;
  const targetHash = contentHash(target.profile ? { profile: target.profile, endpoints: target.endpoints } : {});
  const breaking: any[] = [];
  const endpoints = bundle.endpoints.map((next) => {
    const current = target.endpoints.find((endpoint) => endpoint.endpointSlug === next.endpointSlug);
    const fields: any[] = [];
    if (!current) return { endpointSlug: next.endpointSlug, op: 'CREATE', fields: [] };

    // `fileUrlAuth` is deliberately absent: the per-endpoint credential override was
    // removed, so it is always null on both sides and would only add NOOP diff noise.
    for (const key of ['enabled', 'parameters', 'connections', 'jobPriority', 'fileUrlDefaultChunks', 'allowedFileExtensions', 'referenceExtract', 'overrides'] as const) {
      const from = key === 'connections' ? current.connectionsOverride ?? null : current[key] ?? null;
      const to = (next as any)[key] ?? null;
      const op = same(from, to) ? 'NOOP' : 'UPDATE';
      fields.push({ field: key, op, from, to });
      if (op === 'UPDATE' && key === 'enabled' && from === true && to === false) {
        breaking.push({ id: `${next.endpointSlug}:${key}`, endpointSlug: next.endpointSlug, kind: 'ENDPOINT_DISABLED', consequence: 'Client sẽ nhận 403 Endpoint Disabled.' });
      }
      if (op === 'UPDATE' && key === 'connections') {
        breaking.push({ id: `${next.endpointSlug}:${key}`, endpointSlug: next.endpointSlug, kind: 'PIPELINE_CHANGED', consequence: 'Pipeline thay đổi có thể làm đổi kết quả.' });
      }
    }
    return { endpointSlug: next.endpointSlug, op: fields.every((field) => field.op === 'NOOP') ? 'NOOP' : 'UPDATE', fields };
  });

  const warnings: any[] = [];
  // No per-endpoint SECRET_REQUIRED warning any more: the endpoint credential override
  // was removed, so an older bundle carrying needsInlineSecret has nothing to apply to.
  if (bundle.profile.secretRefs.fileAuth.needsInlineSecret || bundle.profile.secretRefs.callbackAuth.needsInlineSecret) {
    warnings.push({ code: 'SECRET_REQUIRED', scope: 'profile' });
  }
  if ((target.pendingRunningJobs ?? 0) > 0) warnings.push({ code: 'QUEUE_NOT_EMPTY', count: target.pendingRunningJobs });

  const applicable = !preconditions.some((precondition) => precondition.status === 'FAIL');
  const plan: any = {
    sourceHash,
    targetHash,
    targetProfileName: target.targetProfileName,
    preconditions,
    endpoints,
    breaking,
    warnings,
    applicable,
  };
  plan.planHash = contentHash(plan);
  return plan;
}
