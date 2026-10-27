// Bản thật của các port S1/S2 cho workflow v2 (T-V2-01, T-V2-02).
//  - File gửi cho model luôn là BẢN SAO tên trung tính `{file_id}-p{from}-{to}.{ext}` trong thư mục tạm của
//    operation, nên tên file / đường dẫn gốc không bao giờ tới classifier/extractor (S1-R03). Tên gốc + dải trang
//    chỉ ghi ở `display_name` của filesJson sub-step để trang chi tiết operation hiển thị (connector chỉ đọc `name`).
//  - PDF được cắt đúng dải trang của batch (S1) hoặc bản thể (S2) bằng pdf-lib. PDF chỉ mở được bằng
//    pdf-parse (owner-password) không cắt được → gửi cả file.
//  - Gọi model qua sub-step `ext-classifier` / `ext-data-extractor` như v2, giới hạn số lời gọi đồng thời.
import { Readable } from 'stream';
import { PDFDocument } from 'pdf-lib';

import {
  type WorkflowContext,
  assertNotCancelled,
  enqueueSubStep,
  WorkflowCancelledError,
} from '@/lib/pipelines/workflow-engine';
import { getStorageBackend } from '@/lib/storage';
import type { ClassifyPagesInput } from '@/lib/loan-dossier/s1/classifier-port';
import { computeFileId, sniffMime } from '@/lib/loan-dossier/s1/file-id';
import { inspectFile } from '@/lib/loan-dossier/s1/inspect';
import type { ClassifyPorts } from '@/lib/loan-dossier/s1/run';
import type { ExtractPagesInput } from '@/lib/loan-dossier/s2/extractor-port';
import type { ExtractFileContent, ExtractPorts } from '@/lib/loan-dossier/s2/run';
import type { LlmClassifierPort } from '@/lib/loan-dossier/s4/conditions-llm';
import { semanticPrompt, type SemanticPort } from '@/lib/loan-dossier/s5/semantic';

import { extractJsonText } from '@/lib/loan-dossier/common/llm-json';
import { readWorkflowFile } from '../financial-report/pdf-utils';
import { INCOME_SOURCE_STEP, LOAN_PURPOSE_STEP, buildIncomeSourcePrompt, buildLoanPurposePrompt } from './condition-prompts';

/** Số sub-step model chạy đồng thời (v2 cũ giãn 1.5 s giữa các file; ở đây dùng hàng đợi). */
export const MAX_PARALLEL_MODEL_CALLS = 4;

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

function limiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
}

async function slicePdf(content: Uint8Array, from: number, to: number, pageCount: number): Promise<Uint8Array> {
  if (from === 1 && to === pageCount) return content;
  try {
    const src = await PDFDocument.load(content);
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i));
    pages.forEach((p) => out.addPage(p));
    return await out.save();
  } catch {
    return content; // PDF mã hoá owner-password: pdf-lib không mở được → gửi cả file
  }
}

export interface DossierPortsHandle {
  classifyPorts: ClassifyPorts;
  /** Port S2; `fileRefs` = `file_id` → đường dẫn storage (lưu ở checkpoint bước 0). */
  extractPorts(fileRefs: Readonly<Record<string, string>>): ExtractPorts;
  /** `file_id` → đường dẫn storage của các file đã đọc ở S1 (để lưu checkpoint). */
  fileRefs(): Record<string, string>;
  /** Xoá các bản sao tạm đã upload (best-effort). */
  cleanup(): Promise<void>;
}

export function createDossierPorts(ctx: WorkflowContext): DossierPortsHandle {
  const run = limiter(MAX_PARALLEL_MODEL_CALLS);
  const uploaded: string[] = [];
  const refsById: Record<string, string> = {};
  const contentByPath = new Map<string, Uint8Array>();
  const isPassThroughError = (err: unknown) => err instanceof WorkflowCancelledError;

  async function read(path: string): Promise<Uint8Array> {
    await assertNotCancelled(ctx);
    const cached = contentByPath.get(path);
    if (cached) return cached;
    const buf = await readWorkflowFile(path, ctx.operationId);
    contentByPath.set(path, buf);
    return buf;
  }

  /** Tên file gốc người dùng tải lên — CHỈ để hiển thị ở bảng bước con, không gửi model (S1-R03). */
  function originalName(fileRef: string, extraRefs: Readonly<Record<string, string>> = {}): string | null {
    const path = refsById[fileRef] ?? extraRefs[fileRef] ?? fileRef;
    return ctx.filesData.find((f) => f.path === path || f.file_id === fileRef)?.name ?? null;
  }

  async function uploadSlice(
    input: { file_ref: string; mime: string; page_range: [number, number]; page_count: number; content: Uint8Array },
    extraRefs?: Readonly<Record<string, string>>,
  ): Promise<{ filesJson: string }> {
    const [from, to] = input.page_range;
    const body = input.mime === 'application/pdf' ? await slicePdf(input.content, from, to, input.page_count) : input.content;
    const name = `${input.file_ref}-p${from}-${to}.${EXT[input.mime] ?? 'bin'}`;
    const key = `${ctx.operationId}/loan-dossier/${name}`;
    if (!uploaded.includes(key)) {
      const backend = await getStorageBackend();
      await backend.upload(key, Readable.from(Buffer.from(body)), { contentType: input.mime });
      uploaded.push(key);
    }
    const orig = originalName(input.file_ref, extraRefs);
    const whole = from === 1 && to === input.page_count;
    // `display_name` chỉ đọc bởi trang chi tiết operation; connector chỉ dùng `name` (trung tính).
    const display_name = orig ? (whole ? orig : `${orig} (tr. ${from === to ? from : `${from}-${to}`})`) : undefined;
    return { filesJson: JSON.stringify([{ name, display_name, path: key, mime: input.mime, size: body.length }]) };
  }

  async function callModel(
    processor: 'ext-classifier' | 'ext-data-extractor', step: 'classify' | 'extract', input: ClassifyPagesInput | ExtractPagesInput,
    extraRefs?: Readonly<Record<string, string>>,
  ): Promise<unknown> {
    return run(async () => {
      await assertNotCancelled(ctx);
      const { filesJson } = await uploadSlice(input, extraRefs);
      const response = await enqueueSubStep(
        ctx, processor, { _prompt: input.prompt }, filesJson, ctx.modelOverrides[step], ctx.reasoningEffortOverrides[step],
      );
      return response.content;
    });
  }

  const classifyPorts: ClassifyPorts = {
    // Ghi lại file_id → path ngay khi đọc để S2 (cùng lần chạy hoặc resume) tìm lại được file.
    readFile: async (ref) => {
      const buf = await read(ref);
      refsById[computeFileId(buf)] ??= ref;
      return buf;
    },
    inspect: inspectFile,
    classifier: { classifyPages: (input) => callModel('ext-classifier', 'classify', input) },
    isPassThroughError,
  };

  return {
    classifyPorts,
    extractPorts(fileRefs) {
      const meta = new Map<string, ExtractFileContent>();
      return {
        readFile: async (fileId) => {
          const hit = meta.get(fileId);
          if (hit) return hit;
          const path = fileRefs[fileId];
          if (!path) throw new Error(`Thiếu đường dẫn của ${fileId}`);
          const content = await read(path);
          const mime = sniffMime(content);
          const inspected = mime ? await inspectFile(content, mime) : null;
          if (!mime || !inspected?.ok) throw new Error(`File ${fileId} không đọc được ở bước bóc tách`);
          const value = { content, mime, page_count: inspected.page_count };
          meta.set(fileId, value);
          return value;
        },
        extractor: { extract: (input) => callModel('ext-data-extractor', 'extract', input, fileRefs) },
        isPassThroughError,
      };
    },
    fileRefs: () => ({ ...refsById }),
    async cleanup() {
      if (uploaded.length === 0) return;
      try {
        const backend = await getStorageBackend();
        await backend.deleteMany(uploaded.splice(0));
      } catch (err) {
        ctx.logger.warn(`[LOAN-APPRAISAL] Không xoá được file tạm: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

/**
 * Port LLM cho S4 (điều kiện ngữ nghĩa) và S5 (so SEMANTIC): sub-step `ext-fact-verifier`, chỉ gửi chuỗi field, không file.
 * S4 có step key riêng (`income_source_classify`, `loan_purpose_classify`) cho prompt / model / reasoning; chưa cấu hình thì dùng của `evaluate`.
 * S5 (so ngữ nghĩa) vẫn dùng `evaluate`.
 */
export function createCheckPorts(ctx: WorkflowContext): { llm: LlmClassifierPort; semantic: SemanticPort } {
  const run = limiter(MAX_PARALLEL_MODEL_CALLS);
  const ask = (prompt: string, step?: string) => run(async () => {
    await assertNotCancelled(ctx);
    const response = await enqueueSubStep(
      ctx, 'ext-fact-verifier', { _prompt: prompt }, null,
      (step ? ctx.modelOverrides[step] : undefined) ?? ctx.modelOverrides.evaluate,
      (step ? ctx.reasoningEffortOverrides[step] : undefined) ?? ctx.reasoningEffortOverrides.evaluate,
    );
    // Nhãn đơn (S5 SAME/DIFFERENT/UNSURE) không phải JSON → giữ nguyên chuỗi; JSON bọc ```json… thì bóc ra.
    const text = extractJsonText(response.content ?? '');
    try { return JSON.parse(text) as unknown; } catch { return text; }
  });
  return {
    llm: {
      classifyIncomeSource: async (texts) => {
        const r = await ask(buildIncomeSourcePrompt(texts, ctx.promptOverrides), INCOME_SOURCE_STEP);
        const labels = (r as { labels?: unknown })?.labels;
        if (!Array.isArray(labels)) throw new Error('phản hồi phân loại nguồn thu không đúng định dạng');
        return labels.map(String);
      },
      classifyLoanPurpose: async (texts) => {
        const r = (await ask(buildLoanPurposePrompt(texts, ctx.promptOverrides), LOAN_PURPOSE_STEP)) as { vehicle_purchase?: unknown; factory_purchase?: unknown };
        return { vehicle_purchase: String(r?.vehicle_purchase ?? ''), factory_purchase: String(r?.factory_purchase ?? '') };
      },
    },
    semantic: {
      judge: async (a, b) => {
        const r = await ask(semanticPrompt(a, b));
        const label = typeof r === 'string' ? r : (r as { label?: unknown })?.label;
        return String(label ?? '').trim().toUpperCase();
      },
    },
  };
}
