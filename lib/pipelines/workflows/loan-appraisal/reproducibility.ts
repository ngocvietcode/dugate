// Bản ghi tái lập (ARCHITECTURE E1): một kết quả phải trả lời được "sinh ra từ danh mục nào, prompt nào, model nào".
// Hàm thuần, tất định; chỉ băm TEMPLATE prompt (không chứa dữ liệu hồ sơ), không ghi nội dung prompt. Model THỰC DÙNG
// không ghi ở đây: connector trả về và đã nằm trong `result.usage.breakdown[].model`.
import { createHash } from 'crypto';

import checklistCatalog from '@/lib/loan-dossier/catalog/data/checklist_catalog.json';
import checklistPrograms from '@/lib/loan-dossier/catalog/data/checklist_programs.json';
import docTypes from '@/lib/loan-dossier/catalog/data/doc_types.json';
import lightExtraction from '@/lib/loan-dossier/catalog/data/light_extraction.json';
import loanProducts from '@/lib/loan-dossier/catalog/data/loan_products.json';
import reasonCodes from '@/lib/loan-dossier/catalog/data/reason_codes.json';
import { buildClassifyPrompt } from '@/lib/loan-dossier/s1/classifier-port';
import { buildExtractPrompt } from '@/lib/loan-dossier/s2/extractor-port';

import { DOSSIER_PRECHECK_PROMPT_TEMPLATE, DOSSIER_PRECHECK_STEP } from './dossier-precheck-prompt';
import { POLICY_CHECKS_PROMPT_TEMPLATE } from './prompt-checks';
import { LOAN_APPRAISAL_WORKFLOW_VERSION } from './types';

/**
 * - `BUILT_IN`: prompt dựng trong code theo dải trang / loại chứng từ, không ghi đè được (V2-R08).
 * - `DEFAULT`: template mặc định trong code.
 * - `PROFILE`: template ghi đè trong `loan_product_config` của Profile.
 */
export type PromptSource = 'BUILT_IN' | 'DEFAULT' | 'PROFILE';

export interface AiStepSnapshot {
  prompt_source: PromptSource;
  /** sha256 của template (BUILT_IN: của output hàm dựng prompt trên đầu vào chuẩn). */
  prompt_sha256: string;
  /** Model / reasoning ghi đè đã áp (sau fallback về `evaluate`); null = dùng cấu hình của connector. */
  model_override: string | null;
  reasoning_override: string | null;
}

export interface ReproducibilitySnapshot {
  workflow_version: string;
  catalog_versions: Record<string, string>;
  ai_steps: Record<string, AiStepSnapshot>;
}

export interface ReproducibilityInput {
  promptOverrides: Readonly<Record<string, string | undefined>>;
  modelOverrides: Readonly<Record<string, string | null | undefined>>;
  reasoningEffortOverrides: Readonly<Record<string, string | null | undefined>>;
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const versionOf = (file: unknown): string => {
  const v = (file as { version?: unknown; catalog_version?: unknown }).version ?? (file as { catalog_version?: unknown }).catalog_version;
  return typeof v === 'string' ? v : 'unknown';
};

/** Phiên bản danh mục đang nạp. Danh mục là JSON trong bundle nên không đổi trong một tiến trình. */
export const CATALOG_VERSIONS: Readonly<Record<string, string>> = Object.freeze({
  loan_products: versionOf(loanProducts),
  checklist_programs: versionOf(checklistPrograms),
  checklist_catalog: versionOf(checklistCatalog),
  doc_types: versionOf(docTypes),
  light_extraction: versionOf(lightExtraction),
  reason_codes: versionOf(reasonCodes),
});

let builtInFingerprints: { classify: string; extract: string } | null = null;

/** Dấu vân tay prompt dựng sẵn của S1 / S2: đổi khi và chỉ khi logic dựng prompt đổi. Tính một lần mỗi tiến trình. */
function builtInPromptFingerprints(): { classify: string; extract: string } {
  if (!builtInFingerprints) {
    const keys = (docTypes as { doc_types: Array<{ doc_type_key: string }> }).doc_types.map((d) => d.doc_type_key).sort();
    builtInFingerprints = {
      classify: sha256(buildClassifyPrompt([1, 1], 1)),
      extract: sha256(keys.map((k) => `${k}\n${buildExtractPrompt(k, [1, 1])}`).join('\n\u0000\n')),
    };
  }
  return builtInFingerprints;
}

const orNull = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Mirror đúng fallback của workflow: bước chưa có model / reasoning riêng thì dùng của `evaluate`. */
function overridesFor(input: ReproducibilityInput, step: string, fallbackToEvaluate: boolean): Pick<AiStepSnapshot, 'model_override' | 'reasoning_override'> {
  const model = orNull(input.modelOverrides[step]) ?? (fallbackToEvaluate ? orNull(input.modelOverrides.evaluate) : null);
  const reasoning = orNull(input.reasoningEffortOverrides[step]) ?? (fallbackToEvaluate ? orNull(input.reasoningEffortOverrides.evaluate) : null);
  return { model_override: model, reasoning_override: reasoning };
}

function templateStep(input: ReproducibilityInput, step: string, defaultTemplate: string): AiStepSnapshot {
  const override = input.promptOverrides[step];
  const fromProfile = typeof override === 'string' && override.length > 0;
  return {
    prompt_source: fromProfile ? 'PROFILE' : 'DEFAULT',
    prompt_sha256: sha256(fromProfile ? override : defaultTemplate),
    ...overridesFor(input, step, true),
  };
}

/** Các bước AI mà workflow hiện gọi (giai đoạn 1 + 2). Bước đang tắt (intake_review, master_correction…) không ghi. */
export function buildReproducibilitySnapshot(input: ReproducibilityInput): ReproducibilitySnapshot {
  const builtIn = builtInPromptFingerprints();
  return {
    workflow_version: LOAN_APPRAISAL_WORKFLOW_VERSION,
    catalog_versions: { ...CATALOG_VERSIONS },
    ai_steps: {
      classify: { prompt_source: 'BUILT_IN', prompt_sha256: builtIn.classify, ...overridesFor(input, 'classify', false) },
      [DOSSIER_PRECHECK_STEP]: templateStep(input, DOSSIER_PRECHECK_STEP, DOSSIER_PRECHECK_PROMPT_TEMPLATE),
      extract: { prompt_source: 'BUILT_IN', prompt_sha256: builtIn.extract, ...overridesFor(input, 'extract', false) },
      policy_checks: templateStep(input, 'policy_checks', POLICY_CHECKS_PROMPT_TEMPLATE),
    },
  };
}
