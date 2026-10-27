// Lắp ráp stage S1 `classify` (T-S1-07; S1-R12, R13, R15, R17, S1 §5).
// Hàm thuần theo ports: đọc file, kiểm file, gọi classifier — test dùng bản giả.
import type { ClassifyStageResult } from '../contracts/stage-result';
import { mergeSegments, planBatches, type RawSegment } from './batching';
import { buildClassifyPrompt, ClassifierParseError, parseClassifierResponse, type ClassifierPort } from './classifier-port';
import { computeFileId, sniffMime, type SupportedMime } from './file-id';
import { fileExtension, fileOutcome, type FileStatus } from './file-status';
import { postprocess, type ClassifyMatch, type PageQuality, type RawClassification } from './postprocess';
import { repeatedDocTypes } from './repeated';

export interface ClassifyInputFile {
  /** Chỉ để hiển thị trong output; không bao giờ tới classifier (S1-R03). */
  file_name: string;
  /** Khóa để `reader` đọc file (VD đường dẫn storage); không tới classifier. */
  ref: string;
  /** Nhóm checklist người dùng chọn khi tải lên (nếu có) — chỉ để đặt `hint_mismatch`. */
  upload_hint?: string | null;
}

export type InspectResult =
  | { ok: true; page_count: number }
  | { ok: false; kind: 'PASSWORD_PROTECTED' | 'CORRUPTED_FILE' | 'EMPTY_OR_UNREADABLE' };

export interface ClassifyPorts {
  /** Đọc nội dung file. Ném lỗi = storage lỗi → stage UNAVAILABLE (S1-R15). */
  readFile(ref: string): Promise<Uint8Array>;
  /** Mở file đã biết định dạng: số trang, có mật khẩu, có hỏng. Ảnh luôn 1 trang. */
  inspect(content: Uint8Array, mime: SupportedMime): Promise<InspectResult>;
  classifier: ClassifierPort;
  /** Lỗi phải ném xuyên qua (VD huỷ workflow) thay vì đổi thành trạng thái stage. */
  isPassThroughError?(err: unknown): boolean;
  now?(): Date;
}

export interface ClassifyFileRecord {
  file_id: string;
  file_name: string;
  status: FileStatus;
  reason_code: string | null;
  next_action: string | null;
  message: string | null;
  page_count: number | null;
  matches: ClassifyMatch[];
}

class StorageError extends Error {}

function qualityOf(all: PageQuality[]): PageQuality {
  if (all.includes('OK')) return 'OK';
  if (all.includes('LOW_QUALITY')) return 'LOW_QUALITY';
  return 'EMPTY';
}

/** Gọi classifier cho từng batch rồi ghép segment giữa các batch (S1-R09). */
async function classifyContent(
  content: Uint8Array,
  fileId: string,
  mime: SupportedMime,
  pageCount: number,
  classifier: ClassifierPort,
): Promise<RawClassification> {
  const batches = planBatches(pageCount);
  const qualities: PageQuality[] = [];
  const segmentsPerBatch: RawSegment[][] = [];
  for (const range of batches) {
    const raw = await classifier.classifyPages({
      file_ref: fileId, mime, page_range: range, page_count: pageCount, prompt: buildClassifyPrompt(range, pageCount), content,
    });
    const parsed = parseClassifierResponse(raw);
    qualities.push(parsed.page_quality);
    segmentsPerBatch.push(parsed.matches.flatMap((m) => m.instances
      // Trang ngoài batch là lỗi đánh số của model: kẹp về trong batch.
      .map((i) => ({
        doc_type_key: m.doc_type_key,
        page_range: [Math.max(range[0], Math.min(i.page_range[0], range[1])), Math.max(range[0], Math.min(i.page_range[1], range[1]))] as [number, number],
        confidence: i.confidence,
        starts_new_document: i.starts_new_document ?? true,
        summary: i.summary ?? '',
        key_facts: i.key_facts ?? [],
      }))));
  }
  const merged = batches.length > 1 ? mergeSegments(segmentsPerBatch) : segmentsPerBatch.flat();
  const byKey = new Map<string, RawSegment[]>();
  for (const s of merged) byKey.set(s.doc_type_key, [...(byKey.get(s.doc_type_key) ?? []), s]);
  return {
    page_quality: qualityOf(qualities),
    matches: [...byKey.entries()].map(([doc_type_key, segs]) => ({
      doc_type_key,
      confidence: Math.min(...segs.map((s) => s.confidence)),
      instances: segs.map((s) => ({ page_range: s.page_range, confidence: s.confidence, summary: s.summary, key_facts: s.key_facts })),
    })),
  };
}

async function classifyOne(file: ClassifyInputFile, content: Uint8Array, fileId: string, ports: ClassifyPorts): Promise<ClassifyFileRecord> {
  const base = { file_id: fileId, file_name: file.file_name };
  const mime = sniffMime(content);
  if (!mime) {
    return { ...base, ...fileOutcome('UNSUPPORTED_FORMAT', { ext: fileExtension(file.file_name) }), page_count: null, matches: [] };
  }
  const inspected = await ports.inspect(content, mime);
  if (!inspected.ok) return { ...base, ...fileOutcome(inspected.kind), page_count: null, matches: [] };
  if (inspected.page_count === 0) return { ...base, ...fileOutcome('EMPTY_OR_UNREADABLE'), page_count: 0, matches: [] };
  const raw = await classifyContent(content, fileId, mime, inspected.page_count, ports.classifier);
  const { matches, ...outcome } = postprocess(raw, file.upload_hint);
  return { ...base, ...outcome, page_count: inspected.page_count, matches };
}

const BLOCKED: ReadonlySet<FileStatus> = new Set(['UNSUPPORTED_FILE', 'PASSWORD_PROTECTED', 'CORRUPTED_FILE']);

/** Trạng thái stage theo bảng §5 (bỏ dòng UNAVAILABLE, xử lý riêng). */
function stageStatus(files: ClassifyFileRecord[]): { status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'INSUFFICIENT_DATA'; code: string } {
  if (!files.some((f) => f.status === 'CLASSIFIED')) return { status: 'INSUFFICIENT_DATA', code: 'NO_PROCESSABLE_FILES' };
  if (files.some((f) => BLOCKED.has(f.status))) return { status: 'PARTIAL_SUCCESS', code: 'UNSUPPORTED_FILES_PRESENT' };
  if (files.some((f) => f.status === 'UNKNOWN')) return { status: 'PARTIAL_SUCCESS', code: 'UNKNOWN_FILES_PRESENT' };
  return { status: 'SUCCESS', code: 'COMPLETED' };
}

/**
 * Chạy S1 cho mọi file của request (S1-R12: không dùng kết quả lần trước). File trùng `file_id` chỉ giữ
 * bản đứng trước, không gọi model cho bản sau (S1-R13). Kết quả nghiệp vụ không bao giờ làm `FAILED`
 * (S1-R17); chỉ phản hồi model hỏng mới là `FAILED`/`JSON_PARSE_ERROR`.
 */
export async function runClassify(files: ReadonlyArray<ClassifyInputFile>, ports: ClassifyPorts): Promise<ClassifyStageResult> {
  const now = () => (ports.now ? ports.now() : new Date()).toISOString();
  const started_at = now();
  const fail = (status: 'UNAVAILABLE' | 'FAILED', code: string, message: string, blocking = false): ClassifyStageResult => ({
    stage_key: 'classify', status, status_code: code, message, started_at, finished_at: now(),
    content_preview: null, data: null,
    blocking_inputs: blocking ? [{ type: 'INTEGRATION', key: 'file_storage', message }] : [],
  });

  try {
    // Đọc tuần tự để tính file_id và bỏ trùng trước khi gọi model.
    const unique: Array<{ file: ClassifyInputFile; content: Uint8Array; fileId: string }> = [];
    const seen = new Set<string>();
    for (const file of files) {
      let content: Uint8Array;
      try {
        content = await ports.readFile(file.ref);
      } catch (err) {
        if (ports.isPassThroughError?.(err)) throw err;
        throw new StorageError('Không tải được file từ kho lưu trữ.');
      }
      const fileId = computeFileId(content);
      if (seen.has(fileId)) continue;
      seen.add(fileId);
      unique.push({ file, content, fileId });
    }

    const records = await Promise.all(unique.map(({ file, content, fileId }) => classifyOne(file, content, fileId, ports)));
    const { status, code } = stageStatus(records);
    const count = (pred: (f: ClassifyFileRecord) => boolean) => records.filter(pred).length;
    return {
      stage_key: 'classify',
      status,
      status_code: code,
      message: null,
      started_at,
      finished_at: now(),
      content_preview: {
        file_count: records.length,
        classified_count: count((f) => f.status === 'CLASSIFIED'),
        unknown_count: count((f) => f.status === 'UNKNOWN'),
        blocked_count: count((f) => BLOCKED.has(f.status)),
        match_count: records.reduce((n, f) => n + f.matches.length, 0),
      },
      data: { files: records, repeated_doc_types: repeatedDocTypes(records) },
      blocking_inputs: [],
    };
  } catch (err) {
    if (ports.isPassThroughError?.(err)) throw err;
    if (err instanceof StorageError) return fail('UNAVAILABLE', 'INTEGRATION_SERVICE_DOWN', err.message, true);
    if (err instanceof ClassifierParseError) return fail('FAILED', 'JSON_PARSE_ERROR', 'Phản hồi của dịch vụ phân loại không đúng định dạng.');
    return fail('UNAVAILABLE', 'INTEGRATION_SERVICE_DOWN', 'Dịch vụ phân loại không phản hồi.', true);
  }
}
