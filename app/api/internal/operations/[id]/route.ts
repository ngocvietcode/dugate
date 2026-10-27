// app/api/internal/operations/[id]/route.ts
// GET /api/internal/operations/{id} — Operation detail with session-based auth + RBAC
//
// METADATA ONLY. The Operations page monitors how a request ran; it does not show
// what the customer sent or what the models produced. Parameter values, prompts,
// extracted data, output content, per-step artifacts and signed file-URL queries
// are cut here, at the API (anything sent to the browser can be read or saved
// regardless of what the UI renders). The one exception is the extracted data of
// the step an operator must review while the operation is WAITING_USER_INPUT.
// See lib/operations/detail-view.ts and OperationsDataExposure/05-WORKPLAN.md.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations, apiKeys } from '@/lib/db/schema';
import { getAssignedProfileIds, requireCapability } from '@/lib/auth-guard';
import { isHiddenFromOperations } from '@/lib/operations/operational-metadata';
import {
  referencedChildIds,
  safeParseJson,
  selectRunSubSteps,
  toFileViews,
  toFinancialReportSummary,
  toOriginalFileUrls,
  toPipelineStepViews,
  toStepViews,
  toWaitingInput,
  type SubStepView,
} from '@/lib/operations/detail-view';
import { keepWorkflowSubStepContent, stripUrlQuery } from '@/lib/operations/content-retention';
import { eq, inArray, or } from 'drizzle-orm';

const SUB_STEP_LIMIT = 500;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireCapability('operations:read');
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;

  // 3. Query operation with LEFT JOIN to ApiKey for profileName
  const [row] = await db
    .select({
      id: operations.id,
      done: operations.done,
      state: operations.state,
      endpointSlug: operations.endpointSlug,
      progressPercent: operations.progressPercent,
      progressMessage: operations.progressMessage,
      progressLogJson: operations.progressLogJson,
      currentStep: operations.currentStep,
      errorCode: operations.errorCode,
      errorMessage: operations.errorMessage,
      failedAtStep: operations.failedAtStep,
      totalInputTokens: operations.totalInputTokens,
      totalOutputTokens: operations.totalOutputTokens,
      totalCostUsd: operations.totalCostUsd,
      apiKeyId: operations.apiKeyId,
      profileName: apiKeys.name,
      correlationId: operations.correlationId,
      createdAt: operations.createdAt,
      updatedAt: operations.updatedAt,
      completedAt: operations.completedAt,
      // Detail-specific fields (content columns are read only to derive metadata)
      idempotencyKey: operations.idempotencyKey,
      pipelineJson: operations.pipelineJson,
      stepsResultJson: operations.stepsResultJson,
      extractedData: operations.extractedData,
      outputFormat: operations.outputFormat,
      filesJson: operations.filesJson,
      usageBreakdown: operations.usageBreakdown,
      webhookUrl: operations.webhookUrl,
      webhookSentAt: operations.webhookSentAt,
      webhookAttempts: operations.webhookAttempts,
      webhookLastError: operations.webhookLastError,
      pagesProcessed: operations.pagesProcessed,
      modelUsed: operations.modelUsed,
      filesDeleted: operations.filesDeleted,
      deletedAt: operations.deletedAt,
      hiddenFromOperations: operations.hiddenFromOperations,
      contentPurgedAt: operations.contentPurgedAt,
    })
    .from(operations)
    .leftJoin(apiKeys, eq(operations.apiKeyId, apiKeys.id))
    .where(eq(operations.id, id))
    .limit(1);

  // 4. Not found
  if (!row) {
    return NextResponse.json({ error: 'Operation not found' }, { status: 404 });
  }

  // A globally scoped operations user may inspect soft-deleted rows and hidden
  // workflow sub-operations for diagnostics; assigned-only users cannot.
  const profileIds = await getAssignedProfileIds('operations:read');
  if (isHiddenFromOperations(row) && profileIds !== null) {
    return NextResponse.json({ error: 'Operation not found' }, { status: 404 });
  }

  // Scope details to assigned Profiles while retaining the established
  // no-profile operational work visibility.
  if (profileIds !== null && row.apiKeyId && !profileIds.includes(row.apiKeyId)) {
    return NextResponse.json(
      { error: 'Forbidden — Profile not assigned to this user' },
      { status: 403 },
    );
  }

  const pipeline = safeParseJson<unknown>(row.pipelineJson, []);
  const steps = safeParseJson<unknown>(row.stepsResultJson, []);
  const extracted = safeParseJson<unknown>(row.extractedData, null);

  // 5b. Workflow sub-steps (one hidden child Operation per AI call): which
  // connector ran, with which model, state, timing, tokens, cost and error.
  let subSteps: SubStepView[] = [];
  // Prompt + kết quả bước con (không có file): chỉ ADMIN, và chỉ khi WORKFLOW_SUBSTEP_KEEP_CONTENT bật.
  const includeSubStepContent = guard.session.user.role === 'ADMIN' && keepWorkflowSubStepContent();
  if (row.endpointSlug?.startsWith('workflows:')) {
    const childIds = referencedChildIds(row.stepsResultJson, row.extractedData);
    const links = [
      ...(row.correlationId ? [eq(operations.correlationId, row.correlationId)] : []),
      ...(childIds.length > 0 ? [inArray(operations.id, childIds)] : []),
    ];
    if (links.length > 0) {
      const subs = await db
        .select({
          id: operations.id,
          endpointSlug: operations.endpointSlug,
          pipelineJson: operations.pipelineJson,
          filesJson: operations.filesJson,
          state: operations.state,
          done: operations.done,
          createdAt: operations.createdAt,
          updatedAt: operations.updatedAt,
          completedAt: operations.completedAt,
          totalInputTokens: operations.totalInputTokens,
          totalOutputTokens: operations.totalOutputTokens,
          totalCostUsd: operations.totalCostUsd,
          errorCode: operations.errorCode,
          errorMessage: operations.errorMessage,
          contentPurgedAt: operations.contentPurgedAt,
          correlationId: operations.correlationId,
          modelUsed: operations.modelUsed,
          ...(includeSubStepContent
            ? { outputContent: operations.outputContent, extractedData: operations.extractedData }
            : {}),
        })
        .from(operations)
        .where(links.length === 1 ? links[0] : or(...links))
        .limit(SUB_STEP_LIMIT);

      subSteps = selectRunSubSteps(row, subs, new Set(childIds), includeSubStepContent);
    }
  }

  // 6. Metadata-only response
  const response = {
    id: row.id,
    done: row.done,
    state: row.state,
    endpointSlug: row.endpointSlug,
    progressPercent: row.progressPercent,
    progressMessage: row.progressMessage,
    progressHistory: safeParseJson(row.progressLogJson, []),
    currentStep: row.currentStep,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    failedAtStep: row.failedAtStep,
    totalInputTokens: row.totalInputTokens,
    totalOutputTokens: row.totalOutputTokens,
    totalCostUsd: row.totalCostUsd,
    apiKeyId: row.apiKeyId,
    profileName: row.profileName ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    idempotencyKey: row.idempotencyKey ?? null,
    pipelineJson: toPipelineStepViews(pipeline),
    originalFileUrls: toOriginalFileUrls(pipeline),
    stepsResultJson: toStepViews(steps),
    waitingInput: toWaitingInput(row.state, row.currentStep, steps, extracted),
    resultSummary: row.state === 'SUCCEEDED' ? toFinancialReportSummary(extracted) : null,
    outputFormat: row.outputFormat,
    filesJson: toFileViews(safeParseJson(row.filesJson, [])),
    usageBreakdown: safeParseJson(row.usageBreakdown, []),
    // Callback URLs may carry a token in the query string; show origin + path only.
    webhookUrl: row.webhookUrl ? stripUrlQuery(row.webhookUrl) : null,
    webhookSentAt: row.webhookSentAt?.toISOString() ?? null,
    webhookAttempts: row.webhookAttempts ?? null,
    webhookLastError: row.webhookLastError ?? null,
    pagesProcessed: row.pagesProcessed,
    modelUsed: row.modelUsed ?? null,
    filesDeleted: row.filesDeleted,
    contentPurgedAt: row.contentPurgedAt ? row.contentPurgedAt.toISOString() : null,
    subSteps,
  };

  return NextResponse.json(response, includeSubStepContent ? { headers: { 'Cache-Control': 'no-store' } } : undefined);
}
