// app/api/internal/profile-endpoints/route.ts
// GET  — List all endpoints with their ProfileEndpoint config for a given apiKeyId
// POST — Upsert ProfileEndpoint config for an apiKeyId + endpointSlug

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { profileEndpoints, externalApiConnections, externalApiOverrides } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { SERVICE_REGISTRY, getAllEndpointSlugs } from '@/lib/endpoints/registry';
import { parseConnectionSteps } from '@/lib/endpoints/profile-resolver';
import { Logger } from '@/lib/logger';
import { requireProfileAccess } from '@/lib/auth-guard';
import { roleHasCapability } from '@/lib/rbac/resolve';
import { isValidReasoningEffortOverride, normalizeReasoningEffort } from '@/lib/endpoints/aihub-config';
import { validateFileUrlDefaultChunks } from '@/lib/profile-config/validate';
import { writeAudit } from '@/lib/audit/write';
import { buildChanges } from '@/lib/audit/diff';
import { AUDIT_POLICIES } from '@/lib/audit/policy';
import { auditActor, getSourceIp } from '@/lib/audit/context';
import { validateSupplementalReportTitleAliases } from '@/lib/pipelines/workflows/financial-report/types';
import {
  summarizeCheckSetChange as summarizeAccountCheckSetChange,
  summarizePolicyChange as summarizeAccountPolicyChange,
  validateCheckSetValue as validateAccountCheckSetValue,
  validatePolicyValue as validateAccountPolicyValue,
} from '@/lib/pipelines/workflows/account-opening/check-set';
import {
  summarizeDocumentCatalogChange as summarizeAccountDocumentCatalogChange,
  validateDocumentCatalogValue as validateAccountDocumentCatalogValue,
} from '@/lib/pipelines/workflows/account-opening/document-catalog';
import {
  LEGACY_LOAN_PARAMS,
  LOAN_PRODUCT_CONFIG_PARAM,
  summarizeLoanProductConfigChange,
  validateLoanProductConfig,
} from '@/lib/pipelines/workflows/loan-appraisal/product-config';
import { validateEncryptionParams } from '@/lib/crypto/validate-encryption-params';

const logger = new Logger({ service: 'profile-endpoints' });

function redactParameterValues(parameters: unknown): unknown {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return null;
  return Object.fromEntries(Object.entries(parameters as Record<string, unknown>).map(([key, rawConfig]) => {
    const config = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
      ? rawConfig as Record<string, unknown>
      : {};
    const value = config.value;
    return [key, {
      isLocked: config.isLocked === true,
      configured: value !== undefined && value !== null && value !== '',
      value: null,
    }];
  }));
}


export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const apiKeyId = searchParams.get('apiKeyId');

  if (!apiKeyId) {
    return NextResponse.json({ error: 'Missing apiKeyId' }, { status: 400 });
  }

  const guard = await requireProfileAccess(apiKeyId);
  if (guard instanceof NextResponse) return guard;
  const canManageEndpoints = await roleHasCapability(guard.session.user.role, 'endpoint:manage');

  try {
    const [profileEndpointsList, allExtConnections, allExtOverrides] = await Promise.all([
      db.select().from(profileEndpoints).where(eq(profileEndpoints.apiKeyId, apiKeyId)),
      db.select({ id: externalApiConnections.id, slug: externalApiConnections.slug, name: externalApiConnections.name, defaultPrompt: externalApiConnections.defaultPrompt, staticFormFields: externalApiConnections.staticFormFields }).from(externalApiConnections),
      db.select().from(externalApiOverrides).where(eq(externalApiOverrides.apiKeyId, apiKeyId)),
    ]);

    // Flatten SERVICE_REGISTRY into enriched endpoint list
    const enrichedEndpoints = getAllEndpointSlugs().map((endpointDef) => {
      const dbRecord = profileEndpointsList.find((p) => p.endpointSlug === endpointDef.slug);

      const activeSteps = parseConnectionSteps(
        dbRecord?.connectionsOverride,
        endpointDef.connections,
        () => logger.info('[PROFILE] Loaded legacy connectionsOverride', { apiKeyId, endpointSlug: endpointDef.slug }),
        () => logger.warn('[PROFILE] Invalid connectionsOverride', { apiKeyId, endpointSlug: endpointDef.slug }),
      );
      const dbConnectionsOverride = dbRecord?.connectionsOverride ? activeSteps : null;

      let dbParameters = null;
      try { dbParameters = dbRecord?.parameters ? JSON.parse(dbRecord.parameters as string) : null; } catch { /* skip corrupt JSON */ }

      // NOTE: the per-endpoint file-download credential override was removed.
      // This route deliberately never decrypts a stored credential: the previous
      // implementation returned the full plaintext AuthConfig (token / client_secret /
      // header_value / query_value) to the browser even though no UI consumed it.
      // File-download auth now lives only on the Profile (ApiKey.fileAuthConfig) and is
      // exposed through /api/internal/apikeys as masked metadata.

      const extConnections = activeSteps.map((stepItem) => {
        const conn = allExtConnections.find((c) => c.slug === stepItem.slug);
        if (!conn) return null;
        // Match override by connectionId + endpointSlug + stepId
        const resolvedStepId = stepItem.stepId ?? '_default';
        const override = allExtOverrides.find(
          (o) => o.connectionId === conn.id && o.endpointSlug === endpointDef.slug && o.stepId === resolvedStepId
        );
        // Default model / reasoning_effort = the matching entries in the
        // connector's staticFormFields (if any)
        let defaultModel: string | null = null;
        let defaultReasoningEffort: string | null = null;
        try {
          const sf = conn.staticFormFields ? JSON.parse(conn.staticFormFields) as Array<{ key: string; value: string }> : [];
          defaultModel = sf.find((f) => f.key === 'model')?.value ?? null;
          defaultReasoningEffort = sf.find((f) => f.key === 'reasoning_effort')?.value ?? null;
        } catch { /* skip corrupt JSON */ }
        return {
          connectionId: conn.id,
          slug: conn.slug,
          name: conn.name,
          defaultPrompt: conn.defaultPrompt,
          defaultModel,
          defaultReasoningEffort,
          promptOverride: override?.promptOverride ?? null,
          modelOverride: override?.modelOverride ?? null,
          reasoningEffortOverride: override?.reasoningEffortOverride ?? null,
          isActive: !!override,
          stepId: stepItem.stepId ?? null,
        };
      }).filter(Boolean);

      return {
        ...endpointDef,
        // Deny-by-default: an endpoint is only "active" for this API key when a
        // ProfileEndpoint row actually exists AND is enabled. Without a row the
        // runtime (loadProfileEndpoint) returns 403, so the UI must reflect that
        // by showing the endpoint as inactive until an admin explicitly enables it.
        enabled: dbRecord ? dbRecord.enabled : false,
        parameters: canManageEndpoints ? dbParameters : redactParameterValues(dbParameters),
        connectionsOverride: dbConnectionsOverride,
        jobPriority: dbRecord?.jobPriority ?? 'MEDIUM',
        // Destination, payload and file-auth override columns are retained as database
        // no-ops; only the chunk default remains configurable for this editor.
        fileUrlDefaultChunks: dbRecord?.fileUrlDefaultChunks ?? null,
        allowedFileExtensions: dbRecord?.allowedFileExtensions ?? null,
        referenceExtract: dbRecord?.referenceExtract ?? null,
        isWorkflow: endpointDef.isWorkflow ?? false,
        id: dbRecord?.id ?? null,
        extConnections,
      };
    });

    return NextResponse.json({ endpoints: enrichedEndpoints });
  } catch (error: unknown) {
    logger.error('[GET] Failed to list profile endpoints', { apiKeyId: apiKeyId ?? 'unknown' }, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKeyId, endpointSlug } = body;
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

    if (typeof apiKeyId !== 'string' || !apiKeyId || typeof endpointSlug !== 'string' || !endpointSlug) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Endpoint policy writes are allowed only for an operator with the
    // configurable endpoint-management grant and access to this Profile.
    const guard = await requireProfileAccess(apiKeyId, 'endpoint:manage');
    if (guard instanceof NextResponse) return guard;

    const allSlugs = getAllEndpointSlugs().map((e) => e.slug);
    if (!allSlugs.includes(endpointSlug) && !Object.keys(SERVICE_REGISTRY).includes(endpointSlug)) {
      return NextResponse.json({ error: `Invalid endpoint slug: '${endpointSlug}'` }, { status: 400 });
    }

    const parameters = body.parameters;
    if (has('parameters') && parameters !== null && (typeof parameters !== 'object' || Array.isArray(parameters))) {
      return NextResponse.json({ error: 'parameters must be an object or null' }, { status: 400 });
    }
    // Encryption opt-in is fail-closed: when enabled, mode is mandatory and
    // selective mode requires an explicit field list (no implicit default).
    if (has('parameters') && parameters) {
      const encryptionError = validateEncryptionParams(parameters as Record<string, { value?: unknown }>);
      if (encryptionError) {
        return NextResponse.json({ error: encryptionError }, { status: 400 });
      }
    }
    const supplementalAliasesParameter = parameters?.supplemental_report_title_aliases;
    if (endpointSlug === 'financial-report-translation' && supplementalAliasesParameter !== undefined) {
      if (!supplementalAliasesParameter || typeof supplementalAliasesParameter !== 'object' || Array.isArray(supplementalAliasesParameter)) {
        return NextResponse.json({ error: 'supplemental_report_title_aliases must use the Profile parameter shape' }, { status: 400 });
      }
      const supplementalAliasesValue = (supplementalAliasesParameter as Record<string, unknown>).value;
      if (supplementalAliasesValue !== undefined && supplementalAliasesValue !== null && supplementalAliasesValue !== '') {
        const validation = validateSupplementalReportTitleAliases(supplementalAliasesValue);
        if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
      }
    }
    // Cấu hình workflow vay theo sản phẩm: fail-closed ở đường ghi. Runtime khoan dung với cấu hình sai
    // (bỏ mục + warning) nên nếu không chặn ở đây, admin sẽ lưu được cấu hình sai và tin rằng nó đang chạy.
    if (endpointSlug.endsWith('loan-appraisal') && parameters) {
      // Khóa cũ (theo Profile) không còn được runtime đọc: bỏ khỏi dữ liệu ghi để không giữ cấu hình "ma" tưởng là đang chạy.
      // Trang cấu hình có nút chuyển cấu hình cũ sang sản phẩm trước khi lưu.
      for (const key of LEGACY_LOAN_PARAMS) {
        if ((parameters as Record<string, unknown>)[key] !== undefined) {
          delete (parameters as Record<string, unknown>)[key];
          logger.warn(`[PROFILE-ENDPOINTS] Bỏ khóa cũ "${key}" của loan-appraisal (nay là ${LOAN_PRODUCT_CONFIG_PARAM}).`);
        }
      }
      const productConfigParameter = (parameters as Record<string, unknown>)[LOAN_PRODUCT_CONFIG_PARAM];
      if (productConfigParameter !== undefined) {
        const config = productConfigParameter && typeof productConfigParameter === 'object' && !Array.isArray(productConfigParameter)
          ? productConfigParameter as Record<string, unknown>
          : null;
        if (!config) return NextResponse.json({ error: `${LOAN_PRODUCT_CONFIG_PARAM} must use the Profile parameter shape` }, { status: 400 });
        if (config.value !== undefined && config.value !== null && config.value !== '') {
          const validation = validateLoanProductConfig(config.value);
          if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
        }
      }
    }
    // Bộ kiểm tra hồ sơ mở tài khoản: cùng nguyên tắc fail-closed ở đường ghi.
    if (endpointSlug.endsWith('account-opening') && parameters) {
      const checkSetParameter = (parameters as Record<string, unknown>).account_check_set;
      if (checkSetParameter !== undefined) {
        const config = checkSetParameter && typeof checkSetParameter === 'object' && !Array.isArray(checkSetParameter)
          ? checkSetParameter as Record<string, unknown>
          : null;
        if (!config) return NextResponse.json({ error: 'account_check_set must use the Profile parameter shape' }, { status: 400 });
        if (config.value !== undefined && config.value !== null && config.value !== '') {
          const validation = validateAccountCheckSetValue(config.value);
          if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
        }
      }
      const policyParameter = (parameters as Record<string, unknown>).account_policy;
      if (policyParameter !== undefined) {
        const config = policyParameter && typeof policyParameter === 'object' && !Array.isArray(policyParameter)
          ? policyParameter as Record<string, unknown>
          : null;
        if (!config) return NextResponse.json({ error: 'account_policy must use the Profile parameter shape' }, { status: 400 });
        if (config.value !== undefined && config.value !== null && config.value !== '') {
          const validation = validateAccountPolicyValue(config.value);
          if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
        }
      }
      const documentCatalogParameter = (parameters as Record<string, unknown>).account_document_catalog;
      if (documentCatalogParameter !== undefined) {
        const config = documentCatalogParameter && typeof documentCatalogParameter === 'object' && !Array.isArray(documentCatalogParameter)
          ? documentCatalogParameter as Record<string, unknown>
          : null;
        if (!config) return NextResponse.json({ error: 'account_document_catalog must use the Profile parameter shape' }, { status: 400 });
        if (config.value !== undefined && config.value !== null && config.value !== '') {
          const validation = validateAccountDocumentCatalogValue(config.value);
          if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
        }
      }
    }

    const workflowModels = parameters?._workflowModels?.value;
    if (workflowModels !== undefined) {
      if (!workflowModels || typeof workflowModels !== 'object' || Array.isArray(workflowModels)) {
        return NextResponse.json({ error: '_workflowModels.value must be an object' }, { status: 400 });
      }
      const invalidModel = Object.entries(workflowModels).some(([step, value]) =>
        !step.trim() || step.length > 120 || typeof value !== 'string' || !value.trim() || value.length > 200,
      );
      if (invalidModel) {
        return NextResponse.json({ error: '_workflowModels contains an invalid step or model value' }, { status: 400 });
      }
    }
    const workflowReasoningEfforts = parameters?._workflowReasoningEfforts?.value;
    if (workflowReasoningEfforts !== undefined) {
      if (!workflowReasoningEfforts || typeof workflowReasoningEfforts !== 'object' || Array.isArray(workflowReasoningEfforts)) {
        return NextResponse.json({ error: '_workflowReasoningEfforts.value must be an object' }, { status: 400 });
      }
      const invalidEffort = Object.entries(workflowReasoningEfforts).some(([step, value]) =>
        !step.trim() || step.length > 120 || !isValidReasoningEffortOverride(value) || value === '' || value === null,
      );
      if (invalidEffort) {
        return NextResponse.json({ error: '_workflowReasoningEfforts contains an invalid step or reasoning_effort value' }, { status: 400 });
      }
    }

    const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];
    if (has('jobPriority') && !VALID_PRIORITIES.includes(body.jobPriority)) {
      return NextResponse.json({ error: 'Invalid jobPriority' }, { status: 400 });
    }

    type ConnectionStepInput = {
      slug: string;
      stepId?: string;
      captureSession?: string | null;
      injectSession?: string | null;
    };
    let normalizedConnectionsOverride: ConnectionStepInput[] | null | undefined;
    if (has('connectionsOverride')) {
      if (body.connectionsOverride === null) {
        normalizedConnectionsOverride = null;
      } else if (!Array.isArray(body.connectionsOverride) || body.connectionsOverride.length > 100) {
        return NextResponse.json({ error: 'connectionsOverride must be null or an array with at most 100 items' }, { status: 400 });
      } else {
        const seenStepIds = new Set<string>();
        normalizedConnectionsOverride = [];
        for (const rawItem of body.connectionsOverride as unknown[]) {
          const item = typeof rawItem === 'string' ? { slug: rawItem } : rawItem;
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return NextResponse.json({ error: 'Invalid connectionsOverride item' }, { status: 400 });
          }
          const candidate = item as Record<string, unknown>;
          if (typeof candidate.slug !== 'string' || !candidate.slug.trim() || candidate.slug.length > 120) {
            return NextResponse.json({ error: 'Each connection step requires a valid slug' }, { status: 400 });
          }
          let stepId: string | undefined;
          if (candidate.stepId !== undefined && candidate.stepId !== null) {
            if (typeof candidate.stepId !== 'string' || !candidate.stepId.trim() || candidate.stepId.length > 120) {
              return NextResponse.json({ error: 'Invalid connection stepId' }, { status: 400 });
            }
            stepId = candidate.stepId.trim();
            if (seenStepIds.has(stepId)) {
              return NextResponse.json({ error: `Duplicate connection stepId: '${stepId}'` }, { status: 400 });
            }
            seenStepIds.add(stepId);
          }
          const normalizeSessionField = (field: 'captureSession' | 'injectSession'): string | null | undefined => {
            const value = candidate[field];
            if (value === undefined) return undefined;
            if (value === null || value === '') return null;
            return typeof value === 'string' && value.length <= 200 ? value.trim() : undefined;
          };
          const captureSession = normalizeSessionField('captureSession');
          const injectSession = normalizeSessionField('injectSession');
          if ((candidate.captureSession !== undefined && captureSession === undefined)
              || (candidate.injectSession !== undefined && injectSession === undefined)) {
            return NextResponse.json({ error: 'Invalid connection session mapping' }, { status: 400 });
          }
          normalizedConnectionsOverride.push({
            slug: candidate.slug.trim(),
            ...(stepId ? { stepId } : {}),
            ...(captureSession !== undefined ? { captureSession } : {}),
            ...(injectSession !== undefined ? { injectSession } : {}),
          });
        }
      }
    }

    if (has('replaceOverrides') && typeof body.replaceOverrides !== 'boolean') {
      return NextResponse.json({ error: 'replaceOverrides must be a boolean' }, { status: 400 });
    }
    const replaceOverrides = body.replaceOverrides === true;

    type OverrideInput = {
      connectionId: string;
      stepId?: string | null;
      promptOverride?: string | null;
      modelOverride?: string | null;
      reasoningEffortOverride?: string | null;
      isActive?: boolean;
    };
    const overrides: OverrideInput[] = body.overrides ?? [];
    if (!Array.isArray(overrides) || overrides.length > 100) {
      return NextResponse.json({ error: 'overrides must be an array with at most 100 items' }, { status: 400 });
    }
    const overrideKeys = new Set<string>();
    for (const item of overrides) {
      if (!item || typeof item.connectionId !== 'string' || !item.connectionId) {
        return NextResponse.json({ error: 'Each override requires connectionId' }, { status: 400 });
      }
      if (item.stepId !== undefined && item.stepId !== null
          && (typeof item.stepId !== 'string' || !item.stepId.trim() || item.stepId.length > 120)) {
        return NextResponse.json({ error: 'Invalid override stepId' }, { status: 400 });
      }
      if (item.promptOverride !== undefined && item.promptOverride !== null
          && (typeof item.promptOverride !== 'string' || item.promptOverride.length > 200_000)) {
        return NextResponse.json({ error: 'Invalid promptOverride' }, { status: 400 });
      }
      if (item.modelOverride !== undefined && item.modelOverride !== null
          && (typeof item.modelOverride !== 'string' || item.modelOverride.length > 200)) {
        return NextResponse.json({ error: 'Invalid modelOverride' }, { status: 400 });
      }
      if (!isValidReasoningEffortOverride(item.reasoningEffortOverride)) {
        return NextResponse.json({ error: 'Invalid reasoningEffortOverride' }, { status: 400 });
      }
      if (item.isActive !== undefined && typeof item.isActive !== 'boolean') {
        return NextResponse.json({ error: 'Invalid override isActive value' }, { status: 400 });
      }
      const key = `${item.connectionId}\u0000${item.stepId?.trim() || '_default'}`;
      if (overrideKeys.has(key)) {
        return NextResponse.json({ error: 'Duplicate override connectionId/stepId' }, { status: 400 });
      }
      overrideKeys.add(key);
    }

    const connectionIds = [...new Set(overrides.map((item) => item.connectionId))];
    const connectionSlugs = normalizedConnectionsOverride?.map((item) => item.slug) ?? [];
    if (connectionIds.length > 0 || connectionSlugs.length > 0) {
      const knownConnections = await db.select({ id: externalApiConnections.id, slug: externalApiConnections.slug })
        .from(externalApiConnections);
      const knownIds = new Set(knownConnections.map((connection) => connection.id));
      const knownSlugs = new Set(knownConnections.map((connection) => connection.slug));
      if (connectionIds.some((id) => !knownIds.has(id))) {
        return NextResponse.json({ error: 'One or more override connections do not exist' }, { status: 400 });
      }
      if (connectionSlugs.some((slug) => !knownSlugs.has(slug))) {
        return NextResponse.json({ error: 'One or more connection step slugs do not exist' }, { status: 400 });
      }
    }

    const endpointWhere = and(
      eq(profileEndpoints.apiKeyId, apiKeyId),
      eq(profileEndpoints.endpointSlug, endpointSlug),
    );
    const [existingEndpoint] = await db.select().from(profileEndpoints).where(endpointWhere).limit(1);

    const updatePayload: Partial<{
      enabled: boolean;
      parameters: string | null;
      connectionsOverride: string | null;
      allowedFileExtensions: string | null;
      referenceExtract: string | null;
      jobPriority: string;
      fileUrlDefaultChunks: number | null;
    }> = {};

    if (has('parameters')) updatePayload.parameters = parameters === null ? null : JSON.stringify(parameters);
    if (has('connectionsOverride')) {
      updatePayload.connectionsOverride = normalizedConnectionsOverride === null
        ? null
        : JSON.stringify(normalizedConnectionsOverride);
    }
    if (typeof body.enabled === 'boolean') updatePayload.enabled = body.enabled;
    // `fileUrlAuthConfig` is intentionally NOT accepted here any more. The per-endpoint
    // credential override was removed; a client that still sends the key is ignored
    // rather than rejected, so an older tab cannot fail an otherwise valid save.
    if (has('allowedFileExtensions')) {
      if (body.allowedFileExtensions !== null && typeof body.allowedFileExtensions !== 'string') {
        return NextResponse.json({ error: 'Invalid allowedFileExtensions' }, { status: 400 });
      }
      const value = body.allowedFileExtensions?.trim() ?? '';
      if (value.length > 1_000) return NextResponse.json({ error: 'allowedFileExtensions is too long' }, { status: 400 });
      updatePayload.allowedFileExtensions = value || null;
    }
    if (has('referenceExtract')) {
      if (body.referenceExtract !== null && typeof body.referenceExtract !== 'string') {
        return NextResponse.json({ error: 'Invalid referenceExtract' }, { status: 400 });
      }
      const value = body.referenceExtract?.trim() ?? '';
      if (value.length > 500) return NextResponse.json({ error: 'referenceExtract is too long' }, { status: 400 });
      updatePayload.referenceExtract = value || null;
    }
    if (has('jobPriority')) updatePayload.jobPriority = body.jobPriority;
    // ── Endpoint-level integration overrides ─────────────────────────────────
    // (No fileUrlEnabled / callbackEnabled on/off toggles: file-URL input is always
    //  accepted, and callback fires iff a destination URL is resolved.)
    if (has('fileUrlDefaultChunks')) {
      const result = validateFileUrlDefaultChunks(body.fileUrlDefaultChunks);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      updatePayload.fileUrlDefaultChunks = result.value;
    }
    const record = await db.transaction(async (tx) => {
      let savedEndpoint = existingEndpoint;
      if (!existingEndpoint) {
        [savedEndpoint] = await tx.insert(profileEndpoints).values({
          apiKeyId,
          endpointSlug,
          enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
          parameters: has('parameters') ? updatePayload.parameters ?? null : null,
          connectionsOverride: has('connectionsOverride') ? updatePayload.connectionsOverride ?? null : null,
          allowedFileExtensions: has('allowedFileExtensions') ? updatePayload.allowedFileExtensions ?? null : null,
          referenceExtract: has('referenceExtract') ? updatePayload.referenceExtract ?? null : null,
          jobPriority: has('jobPriority') ? body.jobPriority : 'MEDIUM',
          fileUrlDefaultChunks: has('fileUrlDefaultChunks') ? updatePayload.fileUrlDefaultChunks ?? null : null,
        }).returning();
      } else if (Object.keys(updatePayload).length > 0) {
        [savedEndpoint] = await tx.update(profileEndpoints)
          .set(updatePayload)
          .where(endpointWhere)
          .returning();
      }

      for (const item of overrides) {
        const stepId = item.stepId?.trim() || '_default';
        const overrideWhere = and(
          eq(externalApiOverrides.connectionId, item.connectionId),
          eq(externalApiOverrides.apiKeyId, apiKeyId),
          eq(externalApiOverrides.endpointSlug, endpointSlug),
          eq(externalApiOverrides.stepId, stepId),
        );
        const promptOverride = item.promptOverride?.trim() || null;
        const modelOverride = item.modelOverride?.trim() || null;
        const reasoningEffortOverride = normalizeReasoningEffort(item.reasoningEffortOverride) || null;
        if (item.isActive === false || (!promptOverride && !modelOverride && !reasoningEffortOverride)) {
          await tx.delete(externalApiOverrides).where(overrideWhere);
        } else {
          await tx.insert(externalApiOverrides).values({
            connectionId: item.connectionId,
            apiKeyId,
            endpointSlug,
            stepId,
            promptOverride,
            modelOverride,
            reasoningEffortOverride,
          }).onConflictDoUpdate({
            target: [externalApiOverrides.connectionId, externalApiOverrides.apiKeyId, externalApiOverrides.endpointSlug, externalApiOverrides.stepId],
            set: { promptOverride, modelOverride, reasoningEffortOverride },
          });
        }
      }

      if (replaceOverrides) {
        const submittedKeys = new Set(overrides.map((item) => `${item.connectionId}\u0000${item.stepId?.trim() || '_default'}`));
        const persistedOverrides = await tx.select({
          connectionId: externalApiOverrides.connectionId,
          stepId: externalApiOverrides.stepId,
        }).from(externalApiOverrides).where(and(
          eq(externalApiOverrides.apiKeyId, apiKeyId),
          eq(externalApiOverrides.endpointSlug, endpointSlug),
        ));
        for (const persisted of persistedOverrides) {
          if (!submittedKeys.has(`${persisted.connectionId}\u0000${persisted.stepId}`)) {
            await tx.delete(externalApiOverrides).where(and(
              eq(externalApiOverrides.connectionId, persisted.connectionId),
              eq(externalApiOverrides.apiKeyId, apiKeyId),
              eq(externalApiOverrides.endpointSlug, endpointSlug),
              eq(externalApiOverrides.stepId, persisted.stepId),
            ));
          }
        }
      }
      return savedEndpoint;
    });

    // Audit endpoint config change. `parameters` may hold operator-locked values
    // (potentially sensitive) so it is redacted to presence-only.
    // connectionsOverride (routing) is recorded in full.
    const auditableFields = (row: typeof record | null | undefined) => (row ? {
      enabled: row.enabled,
      jobPriority: row.jobPriority,
      allowedFileExtensions: row.allowedFileExtensions,
      referenceExtract: row.referenceExtract,
      fileUrlDefaultChunks: row.fileUrlDefaultChunks,
      connectionsOverride: row.connectionsOverride,
      parameters: row.parameters,
    } : null);
    // `parameters` bị redact thành presence-only, nên thay đổi bộ kiểm tra hồ sơ vay
    // sẽ không còn dấu vết nào. Ghi thêm tóm tắt id rule đã thêm/bỏ/sửa (không kèm
    // nội dung prompt) để vẫn truy được ai đổi rule nào.
    const parseStoredParameters = (raw: unknown): Record<string, { value?: unknown }> | null => {
      if (typeof raw !== 'string' || !raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      } catch { return null; }
    };
    let configSummary = '';
    if (endpointSlug.endsWith('loan-appraisal')) {
      const previousParameters = parseStoredParameters(existingEndpoint?.parameters);
      const nextParameters = parseStoredParameters(record?.parameters);
      configSummary = summarizeLoanProductConfigChange(previousParameters?.[LOAN_PRODUCT_CONFIG_PARAM]?.value, nextParameters?.[LOAN_PRODUCT_CONFIG_PARAM]?.value) ?? '';
    } else if (endpointSlug.endsWith('account-opening')) {
      const previousParameters = parseStoredParameters(existingEndpoint?.parameters);
      const nextParameters = parseStoredParameters(record?.parameters);
      configSummary = [
        summarizeAccountCheckSetChange(previousParameters?.account_check_set?.value, nextParameters?.account_check_set?.value),
        summarizeAccountPolicyChange(previousParameters?.account_policy?.value, nextParameters?.account_policy?.value),
        summarizeAccountDocumentCatalogChange(previousParameters?.account_document_catalog?.value, nextParameters?.account_document_catalog?.value),
      ].filter(Boolean).join(' ');
    }
    await writeAudit({
      entityType: 'ENDPOINT',
      entityId: record?.id ?? undefined,
      entityName: endpointSlug,
      scopeEntityId: apiKeyId,
      action: existingEndpoint ? 'UPDATE' : 'CREATE',
      outcome: 'SUCCESS',
      changes: buildChanges(
        auditableFields(existingEndpoint),
        auditableFields(record),
        AUDIT_POLICIES.ENDPOINT,
      ),
      detail: configSummary ? `apiKeyId=${apiKeyId} ${configSummary}` : `apiKeyId=${apiKeyId}`,
      ...auditActor((guard as { session?: { user?: { id?: string; role?: string } } }).session),
      sourceIp: getSourceIp(req),
    });

    return NextResponse.json({ profileEndpoint: record }, { status: 200 });
  } catch (error: unknown) {
    logger.error('[POST] Failed to save profile endpoint', {}, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
