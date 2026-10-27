import { encrypt } from '@/lib/crypto';
import { parseFileUrlAuthConfig } from '@/lib/file-url-downloader';
import { writeAudit } from '@/lib/audit/write';
import type { ProfileReleaseBundleV1 } from './schema';
import type { Plan } from './plan';

export interface ApplyOptions {
  bundle: ProfileReleaseBundleV1;
  plan: Plan;
  expectedPlanHash: string;
  expectedTargetHash: string;
  targetProfileName: string;
  secrets?: Record<string, string>;
  createMissingProfile?: boolean;
  applyRuntimeHints?: boolean;
  pruneUnknownEndpoints?: boolean;
  message?: string;
  ticketId?: string;
  actorUserId: string;
  actorRole: string;
}

export interface ApplyResult {
  success: boolean;
  revision?: number;
  rawKey?: string;
  error?: string;
  status?: number;
}

export interface TransactionLike {
  profile?: any;
  endpoints?: any[];
  revision?: number;
  _rawKey?: string;
  update: (table: string, payload: Record<string, unknown>) => Promise<void> | void;
  insert: (table: string, payload: Record<string, unknown>) => Promise<void> | void;
  delete?: (table: string, payload: Record<string, unknown>) => Promise<void> | void;
  deleteOverridesNotIn?: (endpointSlug: string, keepKeys: string[]) => Promise<void> | void;
}

function storedAuth(config: any, secret?: string): string | null {
  if (!config) return null;
  const parsed = parseFileUrlAuthConfig(secret ? { ...config, token: secret } : config);
  if (!parsed) throw new Error('Invalid authentication configuration');
  return encrypt(JSON.stringify(parsed));
}

/** Applies only the explicit release allow-list; raw API key state is never written. */
export async function applyBundle(options: ApplyOptions, tx: TransactionLike): Promise<ApplyResult> {
  if (options.expectedPlanHash !== options.plan.planHash) {
    return { success: false, status: 409, error: 'Plan đã thay đổi, vui lòng chạy lại đối chiếu' };
  }
  if (options.expectedTargetHash !== options.plan.targetHash) {
    return { success: false, status: 409, error: 'Cấu hình đích đã thay đổi, vui lòng chạy lại đối chiếu' };
  }
  if (options.plan.targetProfileName && options.plan.targetProfileName !== options.targetProfileName) {
    return { success: false, status: 409, error: 'Profile đích đã thay đổi, vui lòng chạy lại đối chiếu' };
  }
  if (!options.plan.applicable) return { success: false, status: 422, error: 'Plan has failed preconditions' };

  const bundle: any = options.bundle;
  const targetProfileName = options.targetProfileName;
  let rawKey: string | undefined;

  try {
    if (!tx.profile) {
      if (!options.createMissingProfile) return { success: false, status: 404, error: 'Profile chưa tồn tại' };
      await tx.insert('ApiKey', {
        name: targetProfileName,
        displayName: bundle.profile.displayName,
        status: bundle.profile.status,
        role: bundle.profile.role,
        note: bundle.profile.note,
      });
      rawKey = tx._rawKey;
    }

    const safeProfile: any = {
      displayName: bundle.profile.displayName,
      note: bundle.profile.note,
      status: bundle.profile.status,
      role: bundle.profile.role,
      callbackPayload: bundle.profile.callbackPayload,
    };
    if (options.applyRuntimeHints) Object.assign(safeProfile, bundle.runtimeHints);

    const fileAuth = storedAuth(bundle.profile.fileAuth, options.secrets?.fileAuth);
    const callbackAuth = storedAuth(bundle.profile.callbackAuth, options.secrets?.callbackAuth);
    if (fileAuth) safeProfile.fileAuthConfig = fileAuth;
    if (callbackAuth) safeProfile.callbackAuthConfig = callbackAuth;
    await tx.update('ApiKey', safeProfile);

    for (const endpoint of bundle.endpoints) {
      const payload: any = {
        endpointSlug: endpoint.endpointSlug,
        enabled: endpoint.enabled,
        parameters: endpoint.parameters === null ? null : JSON.stringify(endpoint.parameters),
        connectionsOverride: endpoint.connections === null ? null : JSON.stringify(endpoint.connections),
        jobPriority: endpoint.jobPriority,
        fileUrlDefaultChunks: endpoint.fileUrlDefaultChunks,
        allowedFileExtensions: endpoint.allowedFileExtensions,
        referenceExtract: endpoint.referenceExtract,
      };
      // `endpoint.fileUrlAuth` is intentionally ignored: the per-endpoint file-download
      // credential override was removed. Older bundles may still carry a value (and an
      // operator-supplied secret); both are dropped instead of being written back.
      await tx.update('ProfileEndpoint', payload);
      for (const override of endpoint.overrides) {
        await tx.update('ExternalApiOverride', { endpointSlug: endpoint.endpointSlug, ...override });
      }

      if (tx.deleteOverridesNotIn) {
        const bundleOverrideKeys = endpoint.overrides.map(
          (override: any) => `${override.connectorSlug}\0${override.stepId ?? '_default'}`,
        );
        await tx.deleteOverridesNotIn(endpoint.endpointSlug, bundleOverrideKeys);
      }
    }

    if (options.pruneUnknownEndpoints && tx.delete) {
      await tx.delete('ProfileEndpoint', { except: bundle.endpoints.map((endpoint: any) => endpoint.endpointSlug) });
    }

    const revision = (tx.revision ?? 0) + 1;
    await tx.insert('ProfileRelease', {
      profileName: targetProfileName,
      revision,
      version: bundle.meta.version ?? null,
      contentHash: bundle.meta.contentHash,
      bundle: JSON.stringify(bundle),
      action: 'IMPORT',
      sourceEnv: bundle.meta.sourceEnv,
      sourceHash: bundle.meta.contentHash,
      message: options.message ?? null,
      createdByUserId: options.actorUserId,
    });
    await writeAudit({
      entityType: 'RELEASE',
      entityName: targetProfileName,
      action: 'APPLY',
      outcome: 'SUCCESS',
      fromHash: options.plan.targetHash,
      toHash: bundle.meta.contentHash,
      planHash: options.plan.planHash,
      ticketId: options.ticketId,
      actorUserId: options.actorUserId,
      actorRole: options.actorRole,
    });
    return { success: true, revision, rawKey };
  } catch (error) {
    await writeAudit({
      entityType: 'RELEASE',
      entityName: targetProfileName,
      action: 'APPLY',
      outcome: 'FAIL',
      planHash: options.plan.planHash,
      ticketId: options.ticketId,
      actorUserId: options.actorUserId,
      actorRole: options.actorRole,
      detail: error instanceof Error ? error.message : 'Apply failed',
    });
    return { success: false, error: error instanceof Error ? error.message : 'Apply failed' };
  }
}
