// lib/pipelines/workflows/loan-appraisal.ts
// Loan Appraisal V2 — AI evidence extraction + deterministic credit control plane.
//
// Stable DAG:
//   0 classify                    spec-v3 S1 (lib/loan-dossier/s1) — checkpoint = data S1 (V2-R03)
//   1 extract_evidence            spec-v3 S2 (lib/loan-dossier/s2) — checkpoint = data S2 (EvidenceEnvelope[])
//   2 calculate_financials        deterministic Strategy (đọc OCR; không tính giá trị TSBĐ/LTV)
//   3 evaluate_policy_compliance  composable rule set (rule engine + rule LLM, theo nhóm)
//   4 synthesize_recommendation   bounded recommendation + final AppraisalResultV2
//
// Giai đoạn 2 TẠM THỜI không chạy các bước kiểm tra hồ sơ: checklist, đối chiếu chéo, master data, kiểm tra nháp (intake_assessment) và
// readiness. Gom người & tài sản (S3, Customer 360) CHẠY sau S2 (thuần, không LLM, không stage riêng) và được dùng cho: `customer_360` của kết quả,
// giá trị TSBĐ / LTV, và khối người & tài sản (dạng gọn dựng từ DossierGraph) trong prompt rule LLM. Kết quả gồm OCR (S2), Customer 360, chỉ số
// tài chính, bộ rule (engine + LLM) và khuyến nghị chạy cuối cùng.
// Code các bước còn lại (lib/loan-dossier/s4..s5, master, intake-*) còn nguyên, chỉ không được gọi từ workflow (D-98).
// Đường resume operation cũ (checkpoint `consolidate_dossier`, artifact không có stage_key) đã gỡ ở D-99.

import { cleanLlmJson } from '@/lib/loan-dossier/common/llm-json';
import {
  type WorkflowContext,
  type WorkflowStepResult,
  enqueueSubStep,
  assertNotCancelled,
  WorkflowCancelledError,
  updateProgress,
  completeWorkflow,
  failWorkflow,
  pauseWorkflow,
  parseDeep,
} from '@/lib/pipelines/workflow-engine';

/** Cờ boolean từ form-data/JSON: true, "true", "1", "yes". */
function isTruthyFlag(v: unknown): boolean {
  return v === true || (typeof v === 'string' && ['true', '1', 'yes'].includes(v.trim().toLowerCase()));
}

/**
 * D-53: `stop_after_intake` mặc định true — không truyền (hoặc rỗng) thì dừng sau giai đoạn 1.
 * Chỉ chạy hết 5 stage một lần khi truyền rõ false/"false"/"0"/"no".
 */
function shouldStopAfterIntake(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  if (v === false) return false;
  if (typeof v === 'string' && ['false', '0', 'no'].includes(v.trim().toLowerCase())) return false;
  return isTruthyFlag(v);
}

import {
  type ClassifiedDoc,
  type ExtractedDoc,
  type AppraisalResult,
  getLoanProduct,
} from './prompts/loan-appraisal-prompts';
import { buildEvidenceRegistryV3, toStoredEvidence } from './loan-appraisal/evidence-v3';
import { dropSucceededStepArtifacts } from './loan-appraisal/compact-view';
import { DOSSIER_PRECHECK_STEP, isPrecheckEnabled, runDossierPrecheck, skippedPrecheck } from './loan-appraisal/dossier-precheck';
import {
  DOSSIER_CHECKS_DISABLED, buildDeferredDossierOutput, buildPrecheckReadiness,
} from './loan-appraisal/precheck-intake';
import {
  type ClassifyCheckpoint,
  type ExtractCheckpoint,
  isClassifyCheckpoint,
  isExtractCheckpoint,
  runClassifyStage,
  runExtractStage,
} from './loan-appraisal/dossier-stages';
import { createDossierPorts } from './loan-appraisal/stage-adapters';
import { runMapStage } from './loan-appraisal/dossier-map';
import { buildDossierGraph, toDossierGraphView, type DossierGraph } from '@/lib/loan-dossier/graph';
import { buildClaimLedger } from '@/lib/loan-dossier/graph/claims';
import { selectNotableClaims } from '@/lib/loan-dossier/graph/claims-store';
import { resolveLoanProductPolicy, snapshotPolicy } from './loan-appraisal/product-policy';
import { buildReproducibilitySnapshot } from './loan-appraisal/reproducibility';
import { resolveLoanConfig, LOAN_PRODUCT_CONFIG_PARAM } from './loan-appraisal/product-config';
import { resolveLoanFlow } from './loan-appraisal/check-set';
import { buildLoanAppraisalIntegrationPayload } from './loan-appraisal/integration-payload';
import {
  buildPromptCheckVars,
  enabledPromptChecks,
  parsePromptCheckResults,
  promptChecksNotRun,
  resolveLacMode,
  type LacPromptOutcome,
} from './loan-appraisal/prompt-checks';
import { buildLoanApplicationContext } from '@/lib/loan-dossier/context/build';
import { renderLoanApplicationContext } from '@/lib/loan-dossier/context/render';
import type { LoanApplicationContext } from '@/lib/loan-dossier/context/schema';
import { lacScopeFromInputs } from '@/lib/loan-dossier/context/scope';
import { buildProfile360 } from '@/lib/loan-dossier/profile360/build';
import type { Profile360 } from '@/lib/loan-dossier/profile360/schema';
import { packForProduct } from './loan-appraisal/segment-packs/registry';
import { deriveProcessingStatus, LOAN_STAGE_DEFINITIONS } from './loan-appraisal/state-machine';
import {
  LOAN_APPRAISAL_OUTPUT_VERSION,
  LOAN_APPRAISAL_WORKFLOW_VERSION,
  type AppraisalResultV2,
  type FinancialMetrics,
  type IntakeResult,
  type EvidenceRegistry,
  type PolicyComplianceResult,
  type RuleResult,
} from './loan-appraisal/types';

const TOTAL_STEPS = LOAN_STAGE_DEFINITIONS.length;

const STEP_PROGRESS: Record<number, [number, number]> = {
  0: [5, 18],
  1: [20, 45],
  2: [50, 62],
  3: [65, 90],
  4: [94, 98],
};

function stepProgress(step: number, phase: 'start' | 'end'): number {
  const range = STEP_PROGRESS[step] ?? [5, 95];
  return phase === 'start' ? range[0] : range[1];
}

function getStep(ctx: WorkflowContext, step: number): WorkflowStepResult | undefined {
  const stageKey = LOAN_STAGE_DEFINITIONS[step]?.key;
  return ctx.stepsResult.find((item) => item.stage_key === stageKey);
}

function saveStep(ctx: WorkflowContext, stepResult: WorkflowStepResult): void {
  const existing = ctx.stepsResult.findIndex((item) => Boolean(stepResult.stage_key) && item.stage_key === stepResult.stage_key);
  if (existing >= 0) ctx.stepsResult[existing] = stepResult;
  else ctx.stepsResult.push(stepResult);
  ctx.stepsResult.sort((a, b) => a.step - b.step);
}

async function beginStage(ctx: WorkflowContext, step: number, message: string): Promise<void> {
  // H4: dừng sớm nếu operation đã bị huỷ (ném WorkflowCancelledError, failWorkflow bỏ qua).
  await assertNotCancelled(ctx);
  ctx.currentStep = step;
  await updateProgress(ctx, stepProgress(step, 'start'), `Bước ${step + 1}/${TOTAL_STEPS}: ${message}`);
}

/** enqueueSubStep nhưng kiểm tra cancel trước mỗi lần tạo sub-step mới. */
async function enqueueChecked(...args: Parameters<typeof enqueueSubStep>): ReturnType<typeof enqueueSubStep> {
  await assertNotCancelled(args[0]);
  return enqueueSubStep(...args);
}

async function finishStage(ctx: WorkflowContext, step: number, message: string): Promise<void> {
  // currentStep means the NEXT stage to run. If a worker crashes after this update,
  // resume skips the materialized stage instead of appending a duplicate artifact.
  ctx.currentStep = step + 1;
  await updateProgress(ctx, stepProgress(step, 'end'), message);
}

function stageResult(
  step: number,
  values: Omit<WorkflowStepResult, 'step' | 'stage_key' | 'artifact_version' | 'status'>,
  status: WorkflowStepResult['status'] = 'SUCCESS',
): WorkflowStepResult {
  return {
    step,
    stage_key: LOAN_STAGE_DEFINITIONS[step].key,
    artifact_version: '1.0',
    status,
    ...values,
  };
}

export async function runLoanAppraisal(ctx: WorkflowContext): Promise<void> {
  const { logger, filesData, pipelineVars } = ctx;
  const resumeFromStep = ctx.currentStep;
  const product = getLoanProduct(pipelineVars.product_code as string | undefined);
  // Logic stage 2–4 theo phân khúc của sản phẩm (D-100); sản phẩm chưa có pack ném lỗi, không có pack mặc định.
  const { pack, snapshot: packSnapshot } = packForProduct(product.code);

  // Cấu hình workflow đọc THEO SẢN PHẨM (param `loan_product_config`): prompt / model / reasoning của từng bước AI,
  // ngưỡng policy, bộ rule (bật/tắt theo luồng) và override checklist. Cấu hình sai chỉ tạo warning và rơi về mặc định,
  // không làm hỏng run. resolveLoanFlow thuần nên gọi sớm được.
  const loanFlow = resolveLoanFlow(pipelineVars, product.code);
  const loanConfig = resolveLoanConfig(pipelineVars[LOAN_PRODUCT_CONFIG_PARAM], product.code, loanFlow);
  // Từ đây mọi bước LLM (đọc ctx.promptOverrides / modelOverrides / reasoningEffortOverrides) dùng cấu hình của sản phẩm,
  // không còn lấy theo Profile. Mutate tại chỗ vì các port/adapter giữ tham chiếu tới ctx.
  ctx.promptOverrides = loanConfig.promptOverrides;
  ctx.modelOverrides = loanConfig.modelOverrides;
  ctx.reasoningEffortOverrides = loanConfig.reasoningEffortOverrides;
  const checkSet = loanConfig.checkSet;
  const checklistOverrides = { overrides: loanConfig.checklistOverrides };
  const configWarnings = [...loanConfig.warnings];
  for (const warning of configWarnings) {
    logger.warn(`[LOAN-APPRAISAL] Cấu hình: ${warning}`);
  }
  const productPolicy = resolveLoanProductPolicy(product.code, loanConfig.policyOverrides);
  const configSnapshot = {
    ...snapshotPolicy(productPolicy, checkSet),
    ...(configWarnings.length ? { warnings: configWarnings } : {}),
    segment_pack: packSnapshot,
    reproducibility: buildReproducibilitySnapshot(ctx),
  };
  const fileCount = filesData.length;

  // Checkpoint spec-v3 của bước 0–2 (S1, S2, S3–S5). Không còn đường đọc checkpoint v2 cũ (V2-R09).
  const step0Data = getStep(ctx, 0)?.extracted_data;
  let classifyCheckpoint = isClassifyCheckpoint(step0Data) ? step0Data : undefined;
  const dossierPorts = createDossierPorts(ctx);

  try {
    if (fileCount === 0) throw new Error('INVALID_INPUT: Loan appraisal requires at least one document.');

    // ── Stage 0: classify (S1) ─────────────────────────────────────────────
    if (resumeFromStep <= 0) {
      await beginStage(ctx, 0, `Đang phân loại ${fileCount} tài liệu...`);
      const outcome = await runClassifyStage(filesData, dossierPorts.classifyPorts, dossierPorts.fileRefs);
      saveStep(ctx, outcome.step);
      if (outcome.failure) throw outcome.failure;
      classifyCheckpoint = outcome.step.extracted_data as ClassifyCheckpoint;
      const preview = outcome.result.content_preview;
      await finishStage(ctx, 0, `Bước 1 hoàn tất. ${preview?.classified_count ?? 0}/${preview?.file_count ?? fileCount} file được nhận dạng.`);
    }
    if (!classifyCheckpoint) throw new Error('SYSTEM_ERROR: Thiếu checkpoint phân loại kiểu spec-v3.');

    // ── Kiểm tra sơ bộ (D-73, D-74; V2-R16…R20): LLM đánh giá checklist + quan hệ hồ sơ trên summary/key_facts của S1 ──
    // Chạy ngay sau S1, trước S2, để Sale thấy sớm. Kết quả lưu ở checkpoint bước 0 nên resume không gọi lại; resume sau S2
    // (currentStep ≥ 3) không bao giờ chạy bước này; currentStep ≤ 2 mà checkpoint thiếu precheck thì chạy bù. Lỗi LLM → UNAVAILABLE, không đổ stage.
    if (resumeFromStep <= 2 && !classifyCheckpoint.precheck) {
      let precheck;
      if (isPrecheckEnabled(pipelineVars.dossier_precheck)) {
        await updateProgress(ctx, stepProgress(0, 'end'), 'Đang kiểm tra sơ bộ checklist và quan hệ giữa các chứng từ...');
        const askPrecheck = async (prompt: string) => {
          const response = await enqueueChecked(
            ctx, 'ext-fact-verifier', { _prompt: prompt }, null,
            ctx.modelOverrides[DOSSIER_PRECHECK_STEP] ?? ctx.modelOverrides.evaluate,
            ctx.reasoningEffortOverrides[DOSSIER_PRECHECK_STEP] ?? ctx.reasoningEffortOverrides.evaluate,
          );
          return parseDeep(cleanLlmJson(response.content));
        };
        precheck = await runDossierPrecheck(
          { classify: classifyCheckpoint, product_code: product.code, flow: loanFlow, checklist_overrides: checklistOverrides.overrides },
          askPrecheck, ctx.promptOverrides, (err) => err instanceof WorkflowCancelledError,
        );
        if (precheck.warning) logger.warn(`[LOAN-APPRAISAL] Kiểm tra sơ bộ: ${precheck.warning}`);
      } else {
        precheck = skippedPrecheck('Bước kiểm tra sơ bộ đã tắt bằng tham số dossier_precheck.');
      }
      classifyCheckpoint = { ...classifyCheckpoint, precheck };
      const step0 = getStep(ctx, 0);
      if (step0) saveStep(ctx, { ...step0, extracted_data: classifyCheckpoint });
      await updateProgress(ctx, stepProgress(0, 'end'), `Kiểm tra sơ bộ xong (${precheck.status}).`);
    }

    // ── Giai đoạn 1 tinh gọn (D-81…D-84, D-90, D-91; V2-R21): DỪNG NGAY SAU kiểm tra sơ bộ ──────────────────────
    // Giai đoạn 1 = S1 + `dossier_precheck`. OCR (S2) và các stage sau chạy khi resume (giai đoạn 2).
    if (resumeFromStep <= 2 && !classifyCheckpoint.intake_phase1 && shouldStopAfterIntake(pipelineVars.stop_after_intake)) {
      const flowKey = typeof loanFlow === 'string' ? loanFlow : null;
      const precheckOnly = classifyCheckpoint.precheck ?? null;
      // Marker lưu ở checkpoint bước 0: resume không dừng lại lần nữa.
      classifyCheckpoint = { ...classifyCheckpoint, intake_phase1: { version: '1.0' } };
      const step0 = getStep(ctx, 0);
      if (step0) saveStep(ctx, { ...step0, extracted_data: classifyCheckpoint });
      await dossierPorts.cleanup();
      const leanResult = {
        ...buildDeferredDossierOutput(product, classifyCheckpoint, [], flowKey),
        output_version: LOAN_APPRAISAL_OUTPUT_VERSION,
        workflow_version: LOAN_APPRAISAL_WORKFLOW_VERSION,
        result_phase: 'DOSSIER_INTAKE' as const,
        risk_notes: [],
        system_notes: ['Đã dừng sau bước phân loại và kiểm tra sơ bộ; bóc tách (OCR), kiểm tra nháp & tổng kết hồ sơ, gom người & tài sản, checklist 46 mục và đối chiếu chéo chạy ở giai đoạn 2.'],
        config_snapshot: configWarnings.length && !configSnapshot.warnings ? { ...configSnapshot, warnings: configWarnings } : configSnapshot,
        master_dossier: null,
        dossier_precheck: precheckOnly,
        flow: loanFlow,
        dossier_readiness: buildPrecheckReadiness(precheckOnly, classifyCheckpoint, []),
        evidence: toStoredEvidence(buildEvidenceRegistryV3([], new Set(), null)),
      };
      ctx.currentStep = 1;
      await pauseWorkflow(ctx, 'Đã xong giai đoạn 1 (phân loại và kiểm tra sơ bộ). Chuyển sang giai đoạn 2 để bóc tách, đối chiếu và thẩm định.', 1, leanResult);
      return;
    }

    // ── Stage 1: extract evidence (S2) ─────────────────────────────────────
    if (resumeFromStep <= 1) {
      await beginStage(ctx, 1, 'Đang bóc tách dữ liệu và lập nguồn chứng cứ...');
      const outcome = await runExtractStage(classifyCheckpoint, dossierPorts.extractPorts(classifyCheckpoint.file_refs));
      saveStep(ctx, outcome.step);
      if (outcome.failure) throw outcome.failure;
      const preview = outcome.result.content_preview;
      await finishStage(ctx, 1, `Bước 2 hoàn tất. Bóc tách ${preview?.success_count ?? 0}/${preview?.evidence_count ?? 0} chứng từ.`);
    }
    await dossierPorts.cleanup();
    const extractData = getStep(ctx, 1)?.extracted_data;
    if (!isExtractCheckpoint(extractData)) throw new Error('SYSTEM_ERROR: Thiếu checkpoint bóc tách kiểu spec-v3.');
    const extractCheckpoint: ExtractCheckpoint = extractData;

    // ── Dữ liệu cho các stage sau: CHỈ OCR (S2). Registry dựng từ EvidenceEnvelope (V2-R04), thuần nên dựng lại mỗi lần resume. ──
    // Không có bản ghi trạng thái checklist (không có S4) và không loại bản bị thay thế (không có S3).
    const evidence: EvidenceRegistry = buildEvidenceRegistryV3(extractCheckpoint.evidences, new Set(), null);

    // ── Gom người & tài sản (S3): thuần, tất định, không LLM → dựng lại mỗi lần (kể cả resume), không checkpoint, không thêm stage. ──
    // Kết quả đi vào: (1) `customer_360` của kết quả; (2) giá trị TSBĐ / LTV ở stage tài chính; (3) khối {{master_data}} của rule LLM, dưới dạng
    // gọn dựng từ DossierGraph. Lỗi S3 không đổ workflow: customer_360 = null, tài chính giữ skipCollateral, rule LLM không có khối người & tài sản.
    const mapOutcome = runMapStage(extractCheckpoint.evidences, pipelineVars);
    if (mapOutcome.warning) logger.warn(`[LOAN-APPRAISAL] ${mapOutcome.warning}`);
    let dossierGraph: DossierGraph | null = null;
    if (mapOutcome.data) {
      try { dossierGraph = buildDossierGraph(mapOutcome.data); } catch (error) {
        logger.warn(`[LOAN-APPRAISAL] DOSSIER_GRAPH_UNAVAILABLE: ${error instanceof Error ? error.name : 'Error'}`);
      }
    }
    // Sổ Claim lossless dựng từ OCR + S3, chỉ LƯU phần đáng chú ý (phần còn lại dựng lại được từ evidences[].data). Lỗi không đổ workflow.
    let storedClaims: ReturnType<typeof selectNotableClaims> | null = null;
    if (mapOutcome.data) {
      try { storedClaims = selectNotableClaims(buildClaimLedger(extractCheckpoint.evidences, mapOutcome.data)); } catch (error) {
        logger.warn(`[LOAN-APPRAISAL] CLAIMS_UNAVAILABLE: ${error instanceof Error ? error.name : 'Error'}`);
      }
    }

    // ── Loan Application Context (D-103): view tất định, dẫn nguồn được cho rule LLM. Dựng lại mỗi lần, không checkpoint. ──
    // lac_mode: off (mặc định) | shadow (chỉ thống kê, không đổi prompt) | on (prompt dùng {{context}}). Lỗi dựng → đường cũ + warning.
    const lacMode = resolveLacMode(pipelineVars.lac_mode);
    let lac: LoanApplicationContext | null = null;
    if (lacMode !== 'off') {
      try {
        lac = buildLoanApplicationContext({
          product_code: product.code,
          flow: typeof loanFlow === 'string' ? loanFlow : null,
          evidences: extractCheckpoint.evidences,
          s3: mapOutcome.data,
          s3_status: mapOutcome.data ? mapOutcome.status : null,
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : 'Error';
        configWarnings.push(`LAC_UNAVAILABLE:${name}`);
        logger.warn(`[LOAN-APPRAISAL] LAC_UNAVAILABLE: ${name}`);
      }
    }

    // ── Hồ sơ 360 (D-110, D-113): view có kiểu cho giao diện Customer 360. Cần S3 + LAC; LAC dựng riêng khi lac_mode = off (hàm thuần, rẻ).
    // Chưa nối vào tài chính / rule (T-360-03). Lỗi không đổ workflow.
    let profile360: Profile360 | null = null;
    if (mapOutcome.data) {
      try {
        const context = lac ?? buildLoanApplicationContext({
          product_code: product.code,
          flow: typeof loanFlow === 'string' ? loanFlow : null,
          evidences: extractCheckpoint.evidences,
          s3: mapOutcome.data,
          s3_status: mapOutcome.status,
        });
        profile360 = buildProfile360({ evidences: extractCheckpoint.evidences, s3: mapOutcome.data, lac: context });
      } catch (error) {
        const name = error instanceof Error ? error.name : 'Error';
        configWarnings.push(`PROFILE_360_UNAVAILABLE:${name}`);
        logger.warn(`[LOAN-APPRAISAL] PROFILE_360_UNAVAILABLE: ${name}`);
      }
    }

    // ── Stage 2: deterministic financial calculations (đọc OCR + asset_registry của S3 để tính giá trị TSBĐ / LTV) ──
    let financial = getStep(ctx, 2)?.extracted_data as FinancialMetrics | undefined;
    if (resumeFromStep <= 2) {
      await beginStage(ctx, 2, 'Đang tính toán CFADS, DSCR và các chỉ số tài chính...');
      financial = pack.calculateFinancials({ evidences: extractCheckpoint.evidences, s3: mapOutcome.data });
      const calculated = Object.values(financial).filter((metric) => metric.status === 'CALCULATED').length;
      saveStep(ctx, stageResult(2, {
        stepName: 'Tính toán tài chính deterministic',
        processor: 'loan-financial-strategy',
        content_preview: {
          calculated_metrics: calculated,
          dscr: financial.dscr.value,
          ltv: financial.ltv.value,
          warnings: Object.values(financial).flatMap((metric) => metric.warnings),
        },
        extracted_data: financial,
      }, Object.values(financial).every((metric) => metric.status === 'CALCULATED' || metric.status === 'NOT_APPLICABLE') ? 'SUCCESS' : 'PARTIAL_SUCCESS'));
      await finishStage(ctx, 2, `Bước 3 hoàn tất. Tính được ${calculated}/${Object.keys(financial).length} chỉ số.`);
    }
    if (!financial) throw new Error('SYSTEM_ERROR: Missing financial metrics artifact.');

    // ── Stage 3: versioned policy rules (rule engine + rule LLM) ────────────────────────────────────
    let policy = getStep(ctx, 3)?.extracted_data as PolicyComplianceResult | undefined;
    /** D-103: LAC trong prompt của lần chạy này (cho loan_application_context_summary). */
    let lacPromptUse: { used: boolean; facts_rendered: number } | null = null;
    if (resumeFromStep <= 3) {
      await beginStage(ctx, 3, 'Đang chạy bộ rule sản phẩm và kiểm tra tuân thủ...');

      // Rule LLM: gộp toàn bộ kiểm tra dạng prompt vào một lần gọi connector.
      // Lỗi gọi model không làm đổ stage, chỉ hạ kết quả xuống NOT_RUN.
      let promptResults: RuleResult[] = [];
      const promptChecks = enabledPromptChecks(checkSet);
      let promptSubOperationId: string | null = null;
      let promptEvidenceStats: Record<string, number> | null = null;
      let lacOutcome: LacPromptOutcome | null = null;
      // LAC-R17: shadow chỉ đo (độ dài, số dữ kiện, cắt bớt…) để so với đường cũ; không gửi model, không đổi kết quả.
      const lacStats = lac && lacMode === 'shadow' && promptChecks.length > 0
        ? renderLoanApplicationContext(lac, lacScopeFromInputs(promptChecks.map((c) => c.input))).stats
        : null;
      if (promptChecks.length > 0) {
        try {
          const response = await enqueueChecked(
            ctx,
            'ext-fact-verifier',
            buildPromptCheckVars({
              checkSet,
              // Rule LLM đọc OCR trực tiếp + người & tài sản đã gom (S3) dạng gọn dựng từ graph. S3 lỗi ⇒ khối master_data ra rỗng.
              // lac_mode = on: thay bằng Loan Application Context ({{context}}, mã F<n>).
              evidence,
              customer360: {},
              dossierGraph,
              financial,
              lac,
              lacMode,
            }, ctx.promptOverrides.policy_checks, (stats) => {
              promptEvidenceStats = { ...stats };
              logger.info(`[LOAN-APPRAISAL] Rule LLM evidence: ${JSON.stringify(stats)}`);
            }, (outcome) => {
              lacOutcome = outcome;
              if (outcome.legacyTemplate) configWarnings.push('LAC_TEMPLATE_LEGACY');
            }),
            null,
            // Step key riêng `policy_checks`; chưa cấu hình thì dùng model của bước evaluate
            // để Profile cũ giữ nguyên hành vi.
            ctx.modelOverrides.policy_checks ?? ctx.modelOverrides.evaluate,
            ctx.reasoningEffortOverrides.policy_checks ?? ctx.reasoningEffortOverrides.evaluate,
          );
          promptSubOperationId = response.operation.id;
          const usedLac = lacOutcome as LacPromptOutcome | null;
          promptResults = parsePromptCheckResults(
            parseDeep(cleanLlmJson(response.content)), checkSet, evidence, undefined,
            usedLac?.used && usedLac.render && lac ? { render: usedLac.render, lac } : undefined,
          );
        } catch (error) {
          if (error instanceof WorkflowCancelledError) throw error;
          const message = error instanceof Error ? error.message : String(error);
          logger.warn(`[LOAN-APPRAISAL] Rule LLM không chạy được: ${message}`);
          promptResults = promptChecksNotRun(checkSet, message);
        }
      }

      const lacUsedRender = (lacOutcome as LacPromptOutcome | null)?.render ?? null;
      const lacRenderedStats = lacStats ?? lacUsedRender?.stats ?? null;
      if (lacRenderedStats) lacPromptUse = { used: Boolean((lacOutcome as LacPromptOutcome | null)?.used), facts_rendered: lacRenderedStats.facts_rendered };

      policy = pack.evaluatePolicy({ policy: productPolicy, checkSet, financial, promptResults });
      const passed = policy.rule_results.filter((rule) => rule.result === 'PASS').length;
      saveStep(ctx, stageResult(3, {
        stepName: 'Policy & Compliance Rules',
        processor: 'loan-rule-engine',
        ...(promptSubOperationId ? { sub_operation_id: promptSubOperationId } : {}),
        content_preview: {
          policy_id: policy.policy_id,
          policy_version: policy.policy_version,
          status: policy.status,
          passed_rules: passed,
          total_rules: policy.rule_results.length,
          deterministic_rules: policy.rule_results.filter((rule) => rule.check_kind !== 'PROMPT').length,
          prompt_rules: policy.rule_results.filter((rule) => rule.check_kind === 'PROMPT').length,
          check_set_source: checkSet.source,
          ...(promptEvidenceStats ? { prompt_evidence: promptEvidenceStats } : {}),
          // D-103: chỉ số đếm của LAC (không có giá trị dữ kiện — LAC-R19).
          ...(lacMode !== 'off' ? {
            lac: {
              mode: lacMode,
              used: (lacOutcome as LacPromptOutcome | null)?.used ?? false,
              ...(lacStats ?? (lacOutcome as LacPromptOutcome | null)?.render?.stats ?? {}),
            },
          } : {}),
          external_checks: policy.external_checks,
        },
        extracted_data: policy,
      }, policy.status === 'PASS' ? 'SUCCESS' : 'PARTIAL_SUCCESS'));
      await finishStage(ctx, 3, `Bước 4 hoàn tất. ${passed}/${policy.rule_results.length} rule đạt.`);
    }
    if (!policy) throw new Error('SYSTEM_ERROR: Missing policy artifact.');

    // ── Stage 4: khuyến nghị cuối cùng + kết quả V2 ─────────────────────────────────────────────────
    // Chạy SAU khi có chỉ số tài chính và kết quả mọi rule (engine + LLM); chỉ dựa trên hai thứ đó. Luôn dựng lại khi resume
    // để artifact cũ không lọt qua kết quả rule hiện tại.
    if (resumeFromStep <= 4) {
      await beginStage(ctx, 4, 'Đang tổng hợp khuyến nghị và tuyến rà soát...');
    }
    const decision = pack.recommend({ policy: productPolicy, financial, compliance: policy });
    const processingStatus = deriveProcessingStatus(policy.status, policy.rule_results);
    const finalResult: AppraisalResultV2 = {
      // Giai đoạn 2 chạy OCR (S2) và gom người & tài sản (S3). `checklist` / `cross_check` vẫn là khối rỗng mang mã DOSSIER_CHECKS_DISABLED,
      // giữ đủ khóa để giao diện và consumer cũ không vỡ. `documents.evidences` là kết quả trích xuất OCR.
      ...buildDeferredDossierOutput(product, classifyCheckpoint, extractCheckpoint.evidences, typeof loanFlow === 'string' ? loanFlow : null, DOSSIER_CHECKS_DISABLED),
      customer_360: mapOutcome.data,
      dossier_graph: dossierGraph ? toDossierGraphView(dossierGraph) : null,
      claims: storedClaims,
      profile_360: profile360,
      ...(lac && lacMode !== 'off' ? {
        loan_application_context_summary: {
          lac_version: lac.lac_version,
          mode: lacMode,
          used_in_prompt: lacPromptUse?.used ?? false,
          source_hash: lac.meta.source_hash,
          fact_count: lac.meta.fact_count,
          rendered_fact_count: lacPromptUse?.facts_rendered ?? null,
          conflicts: lac.conflicts.length,
          gaps: lac.gaps.map((g) => ({ code: g.code, count: g.count })),
        },
      } : {}),
      ...(mapOutcome.fs_shadow ? { s3_matcher_summary: { mode: 'shadow' as const, ...mapOutcome.fs_shadow } } : {}),
      risk_notes: [],
      system_notes: [
        'Các bước kiểm tra hồ sơ (checklist, đối chiếu chéo, master data, kiểm tra nháp) đang tạm tắt ở giai đoạn 2; kết quả gồm OCR, gom người & tài sản, chỉ số tài chính, bộ rule và khuyến nghị.',
        ...(mapOutcome.warning ? [mapOutcome.warning] : []),
        'AML/PEP/sanctions/adverse media chưa chạy vì chưa cấu hình provider.',
      ],
      output_version: LOAN_APPRAISAL_OUTPUT_VERSION,
      workflow_version: LOAN_APPRAISAL_WORKFLOW_VERSION,
      processing_status: processingStatus,
      config_snapshot: configWarnings.length && !configSnapshot.warnings ? { ...configSnapshot, warnings: configWarnings } : configSnapshot,
      dossier_precheck: classifyCheckpoint.precheck ?? null,
      flow: loanFlow,
      evidence: toStoredEvidence(evidence),
      financial_metrics: financial,
      policy_compliance: policy,
      recommendation: decision.recommendation,
      review: decision.review,
    };
    if (resumeFromStep <= 4) {
      saveStep(ctx, stageResult(4, {
        stepName: 'Khuyến nghị & định tuyến rà soát',
        processor: 'loan-decision-strategy',
        content_preview: {
          processing_status: finalResult.processing_status,
          recommendation: finalResult.recommendation.recommendation,
          suggested_amount_vnd: finalResult.recommendation.suggested_amount_vnd,
          review_route: finalResult.review.route,
          rules_total: policy.rule_results.length,
          rules_passed: policy.rule_results.filter((rule) => rule.result === 'PASS').length,
          flow: loanFlow,
        },
        // Kết quả chuẩn được completeWorkflow lưu bên dưới; không checkpoint lại ở đây để không nhân bản payload lớn.
      }, finalResult.processing_status === 'COMPLETE' ? 'SUCCESS' : 'PARTIAL_SUCCESS'));
      await finishStage(ctx, 4, 'Bước 5 hoàn tất. Đã tạo khuyến nghị có giới hạn và tuyến rà soát.');
    }

    // Webhook gửi cùng JSON tích hợp (schema 5.x) với GET /operations/{id}?view=integration. Kết quả lưu DB và
    // response poll mặc định giữ nguyên finalResult.
    ctx.webhookExtractedData = buildLoanAppraisalIntegrationPayload(finalResult, ctx.stepsResult, {
      operation_id: ctx.operationId,
      state: 'SUCCEEDED',
      created_at: null,
      completed_at: new Date().toISOString(),
    });

    await completeWorkflow(ctx, JSON.stringify({
      output_version: finalResult.output_version,
      product_code: product.code,
      processing_status: finalResult.processing_status,
      recommendation: finalResult.recommendation.recommendation,
      documents_processed: fileCount,
    }), finalResult, {}, dropSucceededStepArtifacts);
  } catch (error) {
    await dossierPorts.cleanup();
    await failWorkflow(ctx, error);
  }
}
