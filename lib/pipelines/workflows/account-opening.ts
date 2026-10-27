// lib/pipelines/workflows/account-opening.ts
// Account Opening V1 — tiếp nhận, phân loại và đánh giá bộ hồ sơ mở tài khoản
// theo phân khúc khách hàng (KHCN, HKD, SME, KHDN) và sản phẩm tài khoản.
//
// Stable DAG:
//   0 classify                    AI fan-out theo file, multi-label ClassifiedDoc[]
//   1 extract_evidence            AI fan-out, bóc tách gộp mỗi file 1 lần
//   2 consolidate_profile         AI Customer Profile/checklist/cross-check
//   3 evaluate_eligibility        deterministic Strategy (tuổi, hiệu lực GT, CIF...)
//   4 assess_cdd_risk             deterministic Strategy (R1..R5 → risk rating)
//   5 evaluate_policy_compliance  rule engine theo phân khúc + rule LLM
//   6 screen_watchlists           ranh giới sàng lọc (NOT_RUN tới khi có provider)
//   7 synthesize_decision         kết luận có giới hạn + AccountOpeningResultV1
//
// Quyền quyết định cuối cùng KHÔNG thuộc workflow: kết quả là khuyến nghị kèm
// tuyến rà soát, hệ thống onboarding mới là nơi phê duyệt mở tài khoản.

import {
  type WorkflowContext,
  type WorkflowStepResult,
  enqueueSubStep,
  updateProgress,
  completeWorkflow,
  failWorkflow,
  parseDeep,
} from '@/lib/pipelines/workflow-engine';

import {
  type ClassifiedDoc,
  type DocRequirement,
  type ExtractedDoc,
  type OnboardingEvaluation,
  buildClassifyPrompt,
  buildEvaluatePrompt,
  buildMultiExtractPrompt,
  normalizeEvaluation,
  parseClassifyResult,
  parseMultiExtractResult,
  resolveAccountProduct,
} from './prompts/account-opening-prompts';
import { parseCheckSet, parsePolicyOverrides } from './account-opening/check-set';
import { resolveDocumentRequirements } from './account-opening/document-catalog';
import { buildProfileProvenance } from './account-opening/master-data';
import {
  buildPromptCheckVars,
  enabledPromptChecks,
  parsePromptCheckResults,
  promptChecksNotRun,
} from './account-opening/prompt-checks';
import { resolveAccountOpeningPolicy, snapshotPolicy } from './account-opening/segment-policy';
import {
  CddRiskStrategy,
  DecisionStrategy,
  DossierReadinessStrategy,
  EligibilityStrategy,
  IntakeEvidenceStrategy,
  PolicyStrategy,
  ScreeningStrategy,
} from './account-opening/strategies';
import { ACCOUNT_STAGE_DEFINITIONS, deriveProcessingStatus } from './account-opening/state-machine';
import {
  ACCOUNT_OPENING_OUTPUT_VERSION,
  ACCOUNT_OPENING_WORKFLOW_VERSION,
  type AccountOpeningResultV1,
  type CddAssessment,
  type EligibilityMetrics,
  type PolicyComplianceResult,
  type RuleResult,
  type ScreeningResult,
} from './account-opening/types';

const TOTAL_STEPS = ACCOUNT_STAGE_DEFINITIONS.length;
const STAGGER_DELAY_MS = 1500;

const STEP_PROGRESS: Record<number, [number, number]> = {
  0: [5, 18],
  1: [20, 38],
  2: [40, 55],
  3: [57, 67],
  4: [69, 77],
  5: [79, 86],
  6: [88, 92],
  7: [94, 98],
};

function stepProgress(step: number, phase: 'start' | 'end'): number {
  const range = STEP_PROGRESS[step] ?? [5, 95];
  return phase === 'start' ? range[0] : range[1];
}

function getStep(ctx: WorkflowContext, step: number): WorkflowStepResult | undefined {
  const stageKey = ACCOUNT_STAGE_DEFINITIONS[step]?.key;
  return ctx.stepsResult.find((item) => item.stage_key === stageKey)
    ?? ctx.stepsResult.find((item) => item.step === step && item.processor !== 'webhook');
}

function saveStep(ctx: WorkflowContext, stepResult: WorkflowStepResult): void {
  const existing = ctx.stepsResult.findIndex((item) =>
    (stepResult.stage_key && item.stage_key === stepResult.stage_key)
    || (!item.stage_key && item.step === stepResult.step && item.processor !== 'webhook'),
  );
  if (existing >= 0) ctx.stepsResult[existing] = stepResult;
  else ctx.stepsResult.push(stepResult);
  ctx.stepsResult.sort((a, b) => a.step - b.step);
}

async function beginStage(ctx: WorkflowContext, step: number, message: string): Promise<void> {
  ctx.currentStep = step;
  await updateProgress(ctx, stepProgress(step, 'start'), `Bước ${step + 1}/${TOTAL_STEPS}: ${message}`);
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
    stage_key: ACCOUNT_STAGE_DEFINITIONS[step].key,
    artifact_version: '1.0',
    status,
    ...values,
  };
}

export async function runAccountOpening(ctx: WorkflowContext): Promise<void> {
  const { logger, filesData, pipelineVars } = ctx;
  const resumeFromStep = ctx.currentStep;

  // Phân khúc + sản phẩm quyết định checklist, ngưỡng policy và bộ rule. Caller
  // có thể truyền `product_code` (chính xác nhất) hoặc chỉ `segment`.
  const resolved = resolveAccountProduct(pipelineVars.product_code, pipelineVars.segment);
  const { segment } = resolved;

  // Danh mục chứng từ (checklist) đọc từ Profile (param `account_document_catalog`).
  // Chỉ có thể bớt/bật-tắt/đổi nhãn các document key đã cài trong code — không
  // thể đổi presetKey (schema OCR) hay tạo key mới, vì nhiều rule ở strategies.ts
  // tham chiếu field theo pattern cố định trên các key đó. Cấu hình sai chỉ tạo
  // warning và fallback về checklist mặc định của sản phẩm.
  const documentCatalogParse = resolveDocumentRequirements(pipelineVars.account_document_catalog, resolved.product);
  const product = { ...resolved.product, requiredDocs: documentCatalogParse.requiredDocs };

  // Bộ kiểm tra và ngưỡng policy đọc từ Profile (param `account_check_set`,
  // `account_policy`). Cấu hình sai chỉ tạo warning và fallback về mặc định.
  const policyOverrides = parsePolicyOverrides(pipelineVars.account_policy);
  const checkSetParse = parseCheckSet(pipelineVars.account_check_set, segment.key, product.code);
  const checkSet = checkSetParse.checkSet;
  for (const warning of [...policyOverrides.warnings, ...checkSetParse.warnings, ...documentCatalogParse.warnings]) {
    logger.warn(`[ACCOUNT-OPENING] Cấu hình bộ kiểm tra: ${warning}`);
  }
  const accountPolicy = resolveAccountOpeningPolicy(product.code, policyOverrides.overrides);
  const configSnapshot = snapshotPolicy(accountPolicy, checkSet);
  const fileCount = filesData.length;

  // Mốc thời gian đánh giá: chốt một lần cho cả run để các chỉ tiêu theo ngày
  // (hiệu lực giấy tờ, tuổi) không lệch giữa các stage hay giữa các lần resume.
  const asOf = new Date();

  let classification = (getStep(ctx, 0)?.extracted_data as ClassifiedDoc[] | undefined) ?? [];
  let extraction = (getStep(ctx, 1)?.extracted_data as ExtractedDoc[] | undefined) ?? [];
  let consolidated = getStep(ctx, 2)?.extracted_data as OnboardingEvaluation | undefined;

  try {
    if (fileCount === 0) throw new Error('INVALID_INPUT: Account opening requires at least one document.');

    // ── Stage 0: classify ──────────────────────────────────────────────────
    if (resumeFromStep <= 0) {
      await beginStage(ctx, 0, `Đang phân loại ${fileCount} tài liệu theo phân khúc ${segment.key}...`);
      classification = await Promise.all(
        filesData.map(async (file, index): Promise<ClassifiedDoc> => {
          if (index > 0) await new Promise((resolve) => setTimeout(resolve, index * STAGGER_DELAY_MS));
          try {
            const response = await enqueueSubStep(
              ctx,
              'ext-classifier',
              buildClassifyPrompt(file.name, product, ctx.promptOverrides.classify),
              JSON.stringify([file]),
              ctx.modelOverrides.classify,
              ctx.reasoningEffortOverrides.classify,
            );
            return parseClassifyResult(parseDeep(response.content), file.name, product);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`[ACCOUNT-OPENING] Classify failed for ${file.name}: ${message}`);
            return { file_name: file.name, matches: [], status: 'error', reason: message.substring(0, 120) };
          }
        }),
      );
      const classifiedCount = classification.filter((item) => item.status === 'classified').length;
      if (classifiedCount === 0) throw new Error('INPUT_INVALID: Không nhận dạng được chứng từ nào trong bộ hồ sơ.');
      saveStep(ctx, stageResult(0, {
        stepName: `Phân loại tài liệu (${fileCount} file)`,
        processor: 'ext-classifier',
        content_preview: {
          segment: segment.key,
          product_code: product.code,
          document_catalog_source: pipelineVars.account_document_catalog ? 'PROFILE' : 'DEFAULT',
          files: fileCount,
          classified: classifiedCount,
          unknown: classification.filter((item) => item.status !== 'classified').length,
          mapping: classification.map((item) => ({ file: item.file_name, types: item.matches.map((match) => match.label) })),
        },
        extracted_data: classification,
      }, classifiedCount === fileCount ? 'SUCCESS' : 'PARTIAL_SUCCESS'));
      await finishStage(ctx, 0, `Bước 1 hoàn tất. ${classifiedCount}/${fileCount} file được nhận dạng.`);
    }

    // ── Stage 1: extract evidence ──────────────────────────────────────────
    if (resumeFromStep <= 1) {
      await beginStage(ctx, 1, 'Đang bóc tách dữ liệu và lập nguồn chứng cứ...');
      const fileByName = new Map(filesData.map((file) => [file.name, file]));
      const requirementByKey = new Map<string, DocRequirement>(product.requiredDocs.map((item) => [item.key, item]));
      const units = classification
        .filter((item) => item.status === 'classified')
        .map((item) => ({
          fileName: item.file_name,
          requirements: item.matches
            .map((match) => requirementByKey.get(match.key))
            .filter((requirement): requirement is DocRequirement => !!requirement),
        }))
        .filter((unit) => unit.requirements.length > 0);

      const nested = await Promise.all(
        units.map(async ({ fileName, requirements }, index): Promise<ExtractedDoc[]> => {
          const file = fileByName.get(fileName);
          if (!file) return requirements.map((requirement) => ({
            file_name: fileName,
            doc_type_key: requirement.key,
            doc_type_label: requirement.label,
            status: 'error',
            error: 'Thiếu file gốc',
          }));
          if (index > 0) await new Promise((resolve) => setTimeout(resolve, index * STAGGER_DELAY_MS));
          try {
            const response = await enqueueSubStep(
              ctx,
              'ext-data-extractor',
              buildMultiExtractPrompt(fileName, requirements, ctx.promptOverrides.extract),
              JSON.stringify([file]),
              ctx.modelOverrides.extract,
              ctx.reasoningEffortOverrides.extract,
            );
            return parseMultiExtractResult(parseDeep(response.content), fileName, requirements);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`[ACCOUNT-OPENING] Extract failed for ${fileName}: ${message}`);
            return requirements.map((requirement) => ({
              file_name: fileName,
              doc_type_key: requirement.key,
              doc_type_label: requirement.label,
              status: 'error',
              error: message.substring(0, 120),
            }));
          }
        }),
      );
      extraction = nested.flat();
      const successCount = extraction.filter((item) => item.status === 'success').length;
      if (successCount === 0) throw new Error('INPUT_INVALID: Không bóc tách được dữ liệu từ bất kỳ chứng từ nào.');
      saveStep(ctx, stageResult(1, {
        stepName: `Bóc tách dữ liệu (${successCount}/${extraction.length} chứng từ)`,
        processor: 'ext-data-extractor',
        content_preview: {
          extracted: successCount,
          file_reads: units.length,
          per_doc: extraction.map((item) => ({ file: item.file_name, type: item.doc_type_label, status: item.status })),
        },
        extracted_data: extraction,
      }, successCount === extraction.length ? 'SUCCESS' : 'PARTIAL_SUCCESS'));
      await finishStage(ctx, 1, `Bước 2 hoàn tất. Bóc tách ${successCount}/${extraction.length} chứng từ.`);
    }

    // ── Stage 2: consolidate Customer Profile ──────────────────────────────
    if (resumeFromStep <= 2) {
      await beginStage(ctx, 2, 'Đang dựng Customer Profile, checklist và đối chiếu chéo...');
      const response = await enqueueSubStep(
        ctx,
        'ext-fact-verifier',
        buildEvaluatePrompt(product, classification, extraction, ctx.promptOverrides.evaluate),
        null,
        ctx.modelOverrides.evaluate,
        ctx.reasoningEffortOverrides.evaluate,
      );
      consolidated = normalizeEvaluation(parseDeep(response.content), product, classification);
      saveStep(ctx, stageResult(2, {
        stepName: 'Customer Profile + Checklist + Cross-check',
        processor: 'ext-fact-verifier',
        sub_operation_id: response.operation.id,
        content_preview: {
          completeness_percent: consolidated.completeness_percent,
          checklist_present: consolidated.checklist.filter((item) => item.status === 'present').length,
          checklist_missing: consolidated.checklist.filter((item) => item.status === 'missing').length,
          cross_check_findings: consolidated.cross_check.length,
        },
        extracted_data: consolidated,
      }));
      await finishStage(ctx, 2, 'Bước 3 hoàn tất. Giai đoạn tiếp nhận hồ sơ đã có kết quả hợp nhất.');
    }
    if (!consolidated) throw new Error('SYSTEM_ERROR: Missing consolidated profile artifact.');

    // Evidence/intake là thuần tính toán nên dựng lại mỗi lần resume.
    const { evidence, intake } = new IntakeEvidenceStrategy().execute({
      classification,
      extraction,
      evaluation: consolidated,
    });

    // Provenance Customer Profile: truy nguồn từng trường về evidence và tính độ
    // phủ trường CIF bắt buộc của phân khúc.
    const provenance = buildProfileProvenance(
      consolidated.customer_profile,
      evidence,
      accountPolicy.mandatoryProfileFields,
    );

    // Kết quả giai đoạn 1. Chỉ là khuyến cáo: hồ sơ chưa đầy đủ vẫn chạy hết các
    // stage đánh giá vì chứng từ có thể bổ sung sau.
    const readiness = new DossierReadinessStrategy().execute({
      classification,
      extraction,
      evaluation: consolidated,
      intake,
      evidence,
    });
    if (readiness.assessment_conditional) {
      logger.info(`[ACCOUNT-OPENING] Dossier readiness ${readiness.status}; tiếp tục đánh giá với kết quả tạm.`);
    }

    // ── Stage 3: điều kiện mở tài khoản (deterministic) ─────────────────────
    let eligibility = getStep(ctx, 3)?.extracted_data as EligibilityMetrics | undefined;
    if (resumeFromStep <= 3) {
      await beginStage(ctx, 3, 'Đang kiểm tra tuổi, hiệu lực giấy tờ, sở hữu và độ phủ trường CIF...');
      eligibility = new EligibilityStrategy(product, segment, accountPolicy).execute({
        evidence,
        intake,
        provenance,
        asOf,
      });
      const metrics = Object.values(eligibility);
      const calculated = metrics.filter((metric) => metric.status === 'CALCULATED').length;
      const notApplicable = metrics.filter((metric) => metric.status === 'NOT_APPLICABLE').length;
      saveStep(ctx, stageResult(3, {
        stepName: 'Chỉ tiêu điều kiện mở tài khoản',
        processor: 'account-eligibility-strategy',
        content_preview: {
          calculated_metrics: calculated,
          not_applicable_metrics: notApplicable,
          applicant_age: eligibility.applicant_age.value,
          primary_id_validity_days: eligibility.primary_id_validity_days.value,
          mandatory_profile_coverage_percent: eligibility.mandatory_profile_coverage_percent.value,
          beneficial_owner_coverage_percent: eligibility.beneficial_owner_coverage_percent.value,
          warnings: metrics.flatMap((metric) => metric.warnings),
        },
        extracted_data: eligibility,
      }, calculated + notApplicable === metrics.length ? 'SUCCESS' : 'PARTIAL_SUCCESS'));
      await finishStage(ctx, 3, `Bước 4 hoàn tất. Tính được ${calculated}/${metrics.length} chỉ tiêu (${notApplicable} không áp dụng).`);
    }
    if (!eligibility) throw new Error('SYSTEM_ERROR: Missing eligibility artifact.');

    // ── Stage 4: rà soát khách hàng (CDD) ──────────────────────────────────
    // Luôn tính lại artifact thuần này để checkpoint cũ không lách được rào
    // provenance đang áp dụng.
    if (resumeFromStep <= 4) {
      await beginStage(ctx, 4, 'Đang đánh giá định danh, địa bàn, cấu trúc sở hữu, mục đích và thẩm quyền...');
    }
    const cdd: CddAssessment = new CddRiskStrategy(product, segment, accountPolicy).execute({
      evidence,
      eligibility,
      checklist: intake.checklist,
      customerProfile: consolidated.customer_profile,
    });
    if (resumeFromStep <= 4) {
      saveStep(ctx, stageResult(4, {
        stepName: 'Rà soát khách hàng (CDD)',
        processor: 'account-cdd-strategy',
        content_preview: {
          overall_status: cdd.overall_status,
          risk_rating: cdd.risk_rating,
          due_diligence_level: cdd.due_diligence_level,
          factors: cdd.factors.map((factor) => ({ code: factor.code, status: factor.status, risk: factor.risk_level })),
          escalation_reasons: cdd.escalation_reasons,
        },
        extracted_data: cdd,
      }, cdd.overall_status === 'PASS' ? 'SUCCESS' : 'PARTIAL_SUCCESS'));
      await finishStage(ctx, 4, `Bước 5 hoàn tất. Mức rủi ro ${cdd.risk_rating}, mức rà soát ${cdd.due_diligence_level}.`);
    }

    // ── Stage 5: policy rule theo phân khúc + rule LLM ─────────────────────
    let policy = getStep(ctx, 5)?.extracted_data as PolicyComplianceResult | undefined;
    if (resumeFromStep <= 5) {
      await beginStage(ctx, 5, `Đang chạy bộ rule phân khúc ${segment.key} và kiểm tra tuân thủ...`);

      // Rule LLM: gộp toàn bộ kiểm tra dạng prompt vào một lần gọi connector.
      // Lỗi gọi model không làm đổ stage, chỉ hạ kết quả xuống NOT_RUN.
      let promptResults: RuleResult[] = [];
      const promptChecks = enabledPromptChecks(checkSet);
      let promptSubOperationId: string | null = null;
      if (promptChecks.length > 0) {
        try {
          const response = await enqueueSubStep(
            ctx,
            'ext-fact-verifier',
            buildPromptCheckVars({
              checkSet,
              evidence,
              customerProfile: consolidated.customer_profile,
              eligibility,
              segmentKey: segment.key,
              segmentName: segment.name,
              productName: product.name,
            }),
            null,
            ctx.modelOverrides.evaluate,
            ctx.reasoningEffortOverrides.evaluate,
          );
          promptSubOperationId = response.operation.id;
          promptResults = parsePromptCheckResults(parseDeep(response.content), checkSet, evidence);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn(`[ACCOUNT-OPENING] Rule LLM không chạy được: ${message}`);
          promptResults = promptChecksNotRun(checkSet, message);
        }
      }

      policy = new PolicyStrategy(accountPolicy, checkSet).execute({
        facts: { checklist: intake.checklist, eligibility, cdd },
        promptResults,
      });
      const passed = policy.rule_results.filter((rule) => rule.result === 'PASS').length;
      saveStep(ctx, stageResult(5, {
        stepName: 'Policy & Compliance Rules',
        processor: 'account-rule-engine',
        ...(promptSubOperationId ? { sub_operation_id: promptSubOperationId } : {}),
        content_preview: {
          segment: segment.key,
          product_code: product.code,
          policy_id: policy.policy_id,
          policy_version: policy.policy_version,
          status: policy.status,
          passed_rules: passed,
          total_rules: policy.rule_results.length,
          deterministic_rules: policy.rule_results.filter((rule) => rule.check_kind !== 'PROMPT').length,
          prompt_rules: policy.rule_results.filter((rule) => rule.check_kind === 'PROMPT').length,
          not_applicable_rules: policy.rule_results.filter((rule) => rule.result === 'NOT_APPLICABLE').length,
          check_set_source: checkSet.source,
        },
        extracted_data: policy,
      }, policy.status === 'PASS' ? 'SUCCESS' : 'PARTIAL_SUCCESS'));
      await finishStage(ctx, 5, `Bước 6 hoàn tất. ${passed}/${policy.rule_results.length} rule đạt.`);
    }
    if (!policy) throw new Error('SYSTEM_ERROR: Missing policy artifact.');

    // ── Stage 6: ranh giới sàng lọc danh sách cảnh báo ─────────────────────
    let screening = getStep(ctx, 6)?.extracted_data as ScreeningResult | undefined;
    if (resumeFromStep <= 6) {
      await beginStage(ctx, 6, 'Đang kiểm tra cấu hình sàng lọc AML/PEP/sanctions và đối chiếu CIF...');
      screening = new ScreeningStrategy(accountPolicy).execute({
        customerProfile: consolidated.customer_profile,
        cdd,
      });
      saveStep(ctx, stageResult(6, {
        stepName: 'Sàng lọc danh sách cảnh báo',
        processor: 'account-screening-strategy',
        content_preview: {
          status: screening.status,
          provider_id: screening.provider_id,
          checks: screening.checks.map((check) => ({ check: check.check, status: check.status })),
          reason_codes: screening.reason_codes,
        },
        extracted_data: screening,
      }, screening.status === 'COMPLETED' ? 'SUCCESS' : 'PARTIAL_SUCCESS'));
      await finishStage(ctx, 6, 'Bước 7 hoàn tất. Provider sàng lọc chưa cấu hình nên trả NOT_RUN, không sinh kết quả sạch giả.');
    }
    if (!screening) throw new Error('SYSTEM_ERROR: Missing screening artifact.');

    // ── Stage 7: kết luận có giới hạn + kết quả V1 ─────────────────────────
    // Kết luận cũng được dựng lại khi resume để checkpoint cũ không mang theo
    // kết quả ELIGIBLE_TO_OPEN đã lỗi thời so với rào CDD hiện tại.
    if (resumeFromStep <= 7) {
      await beginStage(ctx, 7, 'Đang tổng hợp kết luận và tuyến rà soát...');
    }
    const decision = new DecisionStrategy(product, accountPolicy).execute({
      eligibility,
      policy,
      intake,
      cdd,
      readiness,
      screening,
    });
    const processingStatus = deriveProcessingStatus(policy.status, policy.rule_results, cdd.overall_status, readiness);
    const auditStages = ACCOUNT_STAGE_DEFINITIONS.map((definition, index) => ({
      stage_key: definition.key,
      phase: definition.phase,
      status: (index === 7
        ? processingStatus === 'COMPLETE' ? 'SUCCESS' : 'PARTIAL_SUCCESS'
        : getStep(ctx, index)?.status === 'PARTIAL_SUCCESS' ? 'PARTIAL_SUCCESS' : 'SUCCESS') as 'SUCCESS' | 'PARTIAL_SUCCESS',
    }));

    const finalResult: AccountOpeningResultV1 = {
      segment_key: segment.key,
      segment_name: segment.name,
      product_code: product.code,
      product_name: product.name,
      documents: classification,
      customer_profile: consolidated.customer_profile,
      checklist: intake.checklist,
      completeness_percent: intake.completeness_percent,
      cross_check: consolidated.cross_check,
      risk_notes: [...new Set([
        ...consolidated.risk_notes,
        ...(readiness.assessment_conditional
          ? ['Kết quả đánh giá là tạm vì hồ sơ chưa đầy đủ; có thể bổ sung chứng từ và chạy lại.']
          : []),
        'AML/PEP/sanctions/adverse media và đối chiếu CIF trùng chưa chạy vì chưa cấu hình provider.',
        'Quyết định mở tài khoản thuộc hệ thống onboarding; workflow chỉ đưa ra khuyến nghị kèm tuyến rà soát.',
      ])],
      overall_assessment: consolidated.overall_assessment,
      output_version: ACCOUNT_OPENING_OUTPUT_VERSION,
      workflow_version: ACCOUNT_OPENING_WORKFLOW_VERSION,
      processing_status: processingStatus,
      config_snapshot: configSnapshot,
      profile_provenance: provenance,
      intake,
      dossier_readiness: readiness,
      evidence,
      eligibility_metrics: eligibility,
      cdd_assessment: cdd,
      policy_compliance: policy,
      screening,
      recommendation: decision.recommendation,
      review: decision.review,
      audit: {
        workflow_version: ACCOUNT_OPENING_WORKFLOW_VERSION,
        generated_at: asOf.toISOString(),
        stages: auditStages,
        config_snapshot: configSnapshot,
        deterministic_calculations: true,
        final_authority: 'EXTERNAL_ONBOARDING_SYSTEM',
      },
    };

    if (resumeFromStep <= 7) {
      saveStep(ctx, stageResult(7, {
        stepName: 'Kết luận & định tuyến rà soát',
        processor: 'account-decision-strategy',
        content_preview: {
          processing_status: finalResult.processing_status,
          dossier_readiness: readiness.status,
          assessment_conditional: readiness.assessment_conditional,
          recommendation: finalResult.recommendation.recommendation,
          risk_rating: finalResult.recommendation.risk_rating,
          due_diligence_level: finalResult.recommendation.due_diligence_level,
          review_route: finalResult.review.route,
        },
        extracted_data: finalResult,
      }, finalResult.processing_status === 'COMPLETE' ? 'SUCCESS' : 'PARTIAL_SUCCESS'));
      await finishStage(ctx, 7, 'Bước 8 hoàn tất. Đã tạo khuyến nghị có giới hạn và tuyến rà soát.');
    }

    await completeWorkflow(ctx, JSON.stringify({
      output_version: finalResult.output_version,
      segment_key: segment.key,
      product_code: product.code,
      completeness_percent: finalResult.completeness_percent,
      dossier_readiness: readiness.status,
      processing_status: finalResult.processing_status,
      recommendation: finalResult.recommendation.recommendation,
      risk_rating: finalResult.recommendation.risk_rating,
      due_diligence_level: finalResult.recommendation.due_diligence_level,
      documents_processed: fileCount,
    }), finalResult);
  } catch (error) {
    await failWorkflow(ctx, error);
  }
}
