// lib/pipelines/workflows/brd-analyze.ts
// Workflow: Đánh giá chất lượng BRD theo 32 tiêu chí (Đầy đủ – Rõ ràng – Chi tiết).
//
// Luồng 1 bước: đính kèm file BRD thẳng vào fact-check (ext-fact-verifier),
// AI chấm từng câu (status + điểm + cơ sở + đề xuất) → JSON.
// Rule engine (code) tính điểm quy đổi, tổng /50, % và Đạt/Không đạt.
//
// Lưu ý: processor dùng chung TỰ parse & short-circuit nếu đính kèm DOCX/XLSX gốc.
// Do đó DOCX/DOC/XLSX/XLS được convert in-process sang .md (không bị intercept) rồi
// đính kèm; PDF/ảnh đính kèm file gốc.

import {
  type WorkflowContext,
  enqueueSubStep,
  updateProgress,
  completeWorkflow,
  parseDeep,
} from '@/lib/pipelines/workflow-engine';

import { buildAnalyzePrompt } from './prompts/brd-analyze-prompts';

import { computeScorecard, computeEvaluation } from '@/lib/brd/score';
import { docxBufferToMarkdown } from '@/lib/brd/docx-to-md';
import { ExcelParser } from '@/lib/parsers/excel-parser';
import { getStorageBackend } from '@/lib/storage';
import { Readable } from 'stream';
import type { BrdResult, CriteriaScores, RawQuestionEval } from '@/lib/brd/types';

/** Giới hạn ký tự BRD khi convert sang .md (tránh attachment quá lớn). */
const MAX_BRD_CHARS = 60_000;

/**
 * Parse output AI thành object một cách bền vững:
 * 1) parseDeep (bóc JSON lồng + strip ```fences```)
 * 2) nếu vẫn là string → tìm khối {...} đầu tiên và parse lại
 */
function asObject(content: string | null): Record<string, unknown> {
  const parsed = parseDeep(content);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  if (typeof content === 'string') {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const obj = parseDeep(JSON.parse(m[0]));
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          return obj as Record<string, unknown>;
        }
      } catch {
        /* bỏ qua */
      }
    }
  }
  return {};
}

/** Chuẩn hoá recommendations về string (AI có thể trả string hoặc mảng). */
function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v : typeof v === 'object' && v ? JSON.stringify(v) : String(v)))
      .filter(Boolean)
      .map((s) => `- ${s}`)
      .join('\n');
  }
  return '';
}

/**
 * Đọc nội dung file qua storage backend (local hoặc S3).
 * filesData[i].path là storage KEY tương đối — KHÔNG dùng fs.readFile trực tiếp.
 */
async function readFileBuffer(file: { path: string; s3Key?: string }): Promise<Buffer> {
  const backend = await getStorageBackend();
  const key = file.s3Key ?? file.path;
  const stream = await backend.download(key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

type Attachment = { name: string; path: string; s3Key?: string; mime: string; size: number };

export async function runBrdAnalyze(ctx: WorkflowContext): Promise<void> {
  const { logger, filesData, promptOverrides } = ctx;
  const fileCount = filesData.length;

  if (fileCount === 0) {
    throw new Error('INPUT_INVALID: Không có file BRD nào để phân tích.');
  }

  // ── Chuẩn bị file đính kèm cho fact-check ─────────────────────────────────
  await updateProgress(ctx, 15, `Đang chuẩn bị ${fileCount} file BRD...`);

  const backend = await getStorageBackend();
  const excelParser = new ExcelParser();
  const attachments: Attachment[] = [];
  const sources: Array<{ file: string; source: string }> = [];

  for (const file of filesData) {
    const f = file as Attachment;
    const ext = (f.name.split('.').pop() ?? '').toLowerCase();

    // DOCX/DOC/XLSX/XLS → convert in-process sang .md rồi đính kèm .md
    if (ext === 'docx' || ext === 'doc' || ext === 'xlsx' || ext === 'xls') {
      try {
        const buf = await readFileBuffer(f);
        const md = ext.startsWith('doc')
          ? await docxBufferToMarkdown(buf)
          : (await excelParser.parse(buf, f.name)).markdown;

        if (md.trim()) {
          const capped = md.length > MAX_BRD_CHARS ? md.slice(0, MAX_BRD_CHARS) : md;
          const mdBuffer = Buffer.from(capped, 'utf8');
          const mdKey = `${ctx.operationId}/_brd_${attachments.length}.md`;
          const up = await backend.upload(mdKey, Readable.from(mdBuffer), { contentType: 'text/markdown' });
          attachments.push({ name: `${f.name}.md`, path: up.s3Key, s3Key: up.s3Key, mime: 'text/markdown', size: mdBuffer.length });
          sources.push({ file: f.name, source: ext.startsWith('doc') ? 'docx->md' : 'xlsx->md' });
          logger.info(`[BRD-WORKFLOW] Convert ${f.name} -> .md (${mdBuffer.length} bytes) để đính kèm.`);
          continue;
        }
        logger.warn(`[BRD-WORKFLOW] Convert ${f.name} rỗng → đính kèm file gốc.`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`[BRD-WORKFLOW] Convert ${f.name} lỗi: ${msg} → đính kèm file gốc.`);
      }
    }

    // PDF/ảnh hoặc fallback: đính kèm file gốc (agent tự đọc)
    attachments.push({ name: f.name, path: f.path, s3Key: f.s3Key, mime: f.mime, size: f.size });
    sources.push({ file: f.name, source: 'original' });
  }

  // ── Fact-check: 1 lần gọi AI với file đính kèm ────────────────────────────
  logger.info(`[BRD-WORKFLOW] Đánh giá BRD (${attachments.length} file) qua ext-fact-verifier`);
  await updateProgress(ctx, 40, 'Đang đánh giá BRD theo 32 tiêu chí...');

  const analyzeStep = await enqueueSubStep(
    ctx,
    'ext-fact-verifier',
    buildAnalyzePrompt(promptOverrides.analyze),
    JSON.stringify(attachments),
    ctx.modelOverrides.analyze,
    ctx.reasoningEffortOverrides.analyze,
  );
  const raw = asObject(analyzeStep.content);

  const rawQuestions = Array.isArray(raw.questions) ? (raw.questions as RawQuestionEval[]) : [];
  const overallAssessment = toText(raw.overallAssessment);
  const recommendations = toText(raw.recommendations);

  // Rule engine: Phần 1 (scorecard) + Phần 2 (32 tiêu chí)
  const scorecardCriteria = (raw.scorecard ?? {}) as CriteriaScores;
  const scorecard = computeScorecard(scorecardCriteria);
  const evaluation = computeEvaluation(rawQuestions, overallAssessment, recommendations);
  const result: BrdResult = { scorecard, evaluation };

  ctx.stepsResult.push({
    step: 0,
    stepName: 'Đánh giá BRD (Scorecard + 32 tiêu chí)',
    processor: 'ext-fact-verifier',
    sub_operation_id: analyzeStep.operation.id,
    content_preview: {
      sources,
      finalScore: scorecard.finalScore,
      priority: scorecard.priority,
      totalScore: evaluation.totalScore,
      maxScore: evaluation.maxScore,
      percent: evaluation.percent,
      passed: evaluation.passed,
      groups: evaluation.groups,
    },
    extracted_data: result as unknown as Record<string, unknown>,
  });

  const summary = `Scorecard ${scorecard.finalScore}/10 (${scorecard.priority}) · BRD ${evaluation.percent}% (${evaluation.totalScore}/${evaluation.maxScore}) — ${evaluation.passed ? 'ĐẠT' : 'KHÔNG ĐẠT'}.`;
  await updateProgress(ctx, 96, summary);
  await completeWorkflow(ctx, overallAssessment || summary, result, {
    logicResult: evaluation.passed ? 'PASS' : 'FAIL',
  });
}
