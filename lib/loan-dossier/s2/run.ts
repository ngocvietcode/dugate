// Lắp ráp stage S2 `extract_evidence` (T-S2-09; S2-R02, R03, R13, R14, R15, R20, S2 §4).
// Hàm thuần theo ports. Không log `data` (PII — S2-R19).
import { createHash } from 'crypto';

import { docTypeByKey } from '../catalog';
import type { ClassifyData, ExtractStageResult } from '../contracts/stage-result';
import { assetKeys } from '../s3/asset-key';
import type { AssetDescriptor, DocumentParty, EvidenceEnvelope } from './common-schema';
import { CURRENT_OWNER_DOC_TYPES, markCurrentOwners } from './current-owner';
import { groupDuplicates } from './duplicates';
import type { AssetKeyFn } from './dedup-key';
import {
  buildExtractPrompt, ExtractorParseError, parseExtractorResponse, validateExtraction, type ExtractorPort, type ExtractorResponse,
} from './extractor-port';
import { applyPageGuard, loanApplicationChecks } from './page-guard';

export interface ExtractFileContent {
  content: Uint8Array;
  mime: 'application/pdf' | 'image/jpeg' | 'image/png';
  page_count: number;
}

export interface ExtractPorts {
  /** Nội dung file theo `file_id` của S1. Ném lỗi = storage lỗi → UNAVAILABLE. */
  readFile(fileId: string): Promise<ExtractFileContent>;
  extractor: ExtractorPort;
  isPassThroughError?(err: unknown): boolean;
  now?(): Date;
}

/** Confidence mặc định cho field cấp 1 khác null mà model không chấm: dưới ngưỡng nhận (→ cần rà soát). */
export const DEFAULT_FIELD_CONFIDENCE = 0.5;

/** Trần confidence cho field cấp 1 có giá trị sai định dạng bị bỏ (S2-R21). */
export const INVALID_FIELD_CONFIDENCE_CAP = 0.5;

/** S2-R14: `ev-` + sha256("{file_id}|{doc_type_key}|{instance_index}")[0:12]. */
export function evidenceId(fileId: string, docTypeKey: string, instanceIndex: number): string {
  return `ev-${createHash('sha256').update(`${fileId}|${docTypeKey}|${instanceIndex}`).digest('hex').slice(0, 12)}`;
}

interface WorkItem {
  file_id: string;
  file_name: string;
  doc_type_key: string;
  instance_index: number;
  page_range: [number, number];
}

class ServiceDown extends Error {}

const SCHEMA_VERSION = '3.0.0';
const defaultAssetKeyFn: AssetKeyFn = (a) => assetKeys(a as unknown as AssetDescriptor);

function pagesOf(range: [number, number]): number[] {
  const out: number[] = [];
  for (let p = range[0]; p <= range[1]; p++) out.push(p);
  return out;
}

/** Chuẩn hóa confidence và trang nguồn về đúng các field cấp 1 của `data`. */
function fieldMeta(data: Record<string, unknown>, response: ExtractorResponse, item: WorkItem, pageCount: number) {
  const field_confidences: Record<string, number> = {};
  const source_pages: Record<string, number[]> = {};
  for (const [field, value] of Object.entries(data)) {
    const empty = value === null || (Array.isArray(value) && value.length === 0);
    const given = response.field_confidences[field];
    field_confidences[field] = empty ? 0 : Math.max(0, Math.min(1, given ?? DEFAULT_FIELD_CONFIDENCE));
    if (empty) continue;
    const pages = (response.source_pages[field] ?? []).filter((p) => p >= 1 && p <= pageCount);
    // Bắt buộc có trang nguồn cho field khác null (S2-R15): model không báo → cả dải trang của bản thể.
    source_pages[field] = pages.length > 0 ? pages : pagesOf(item.page_range);
  }
  return { field_confidences, source_pages };
}

function envelope(item: WorkItem, extra: Partial<EvidenceEnvelope> & Pick<EvidenceEnvelope, 'status'>): EvidenceEnvelope {
  const docType = docTypeByKey(item.doc_type_key)!;
  return {
    evidence_id: evidenceId(item.file_id, item.doc_type_key, item.instance_index),
    extraction_level: docType.extraction_level,
    file_id: item.file_id,
    file_name: item.file_name,
    doc_type_key: item.doc_type_key,
    doc_type_label: docType.doc_type_label,
    instance_index: item.instance_index,
    page_range: item.page_range,
    reason_code: null,
    message: null,
    detected_form_name: null,
    form_variant: null,
    schema_version: SCHEMA_VERSION,
    data: null,
    field_confidences: {},
    source_pages: {},
    duplicate_group_id: null,
    duplicate_status: null,
    differing_fields: [],
    ...extra,
  };
}

async function extractOne(item: WorkItem, ports: ExtractPorts): Promise<EvidenceEnvelope> {
  let file: ExtractFileContent;
  try {
    file = await ports.readFile(item.file_id);
  } catch (err) {
    if (ports.isPassThroughError?.(err)) throw err;
    throw new ServiceDown('Không tải được file từ kho lưu trữ.');
  }
  const docType = docTypeByKey(item.doc_type_key)!;
  let raw: unknown;
  try {
    raw = await ports.extractor.extract({
      file_ref: item.file_id,
      mime: file.mime,
      doc_type_key: item.doc_type_key,
      extraction_level: docType.extraction_level,
      page_range: item.page_range,
      page_count: file.page_count,
      prompt: buildExtractPrompt(item.doc_type_key, item.page_range),
      content: file.content,
    });
  } catch (err) {
    if (ports.isPassThroughError?.(err)) throw err;
    throw new ServiceDown('Dịch vụ bóc tách không phản hồi.');
  }

  let response: ExtractorResponse;
  try {
    response = parseExtractorResponse(raw);
  } catch (err) {
    if (err instanceof ExtractorParseError) return envelope(item, { status: 'ERROR', reason_code: 'UNREADABLE_CONTENT', message: err.message });
    throw err;
  }
  const result = validateExtraction(item.doc_type_key, response);
  const formMeta = { detected_form_name: response.detected_form_name, form_variant: response.form_variant };
  if (result.status === 'ERROR' || !result.data) {
    return envelope(item, { status: 'ERROR', reason_code: result.reason_code, message: result.message, ...formMeta });
  }

  const data = { ...result.data };
  let { field_confidences, source_pages } = fieldMeta(data, response, item, file.page_count);
  if (CURRENT_OWNER_DOC_TYPES.has(item.doc_type_key) && Array.isArray(data.parties)) {
    const owners = markCurrentOwners(data.parties as DocumentParty[]);
    data.parties = owners.parties;
    if (owners.confidenceCap !== null && 'parties' in field_confidences) {
      field_confidences.parties = Math.min(field_confidences.parties, owners.confidenceCap);
    }
  }
  if (item.doc_type_key === 'loan_application') {
    field_confidences = applyPageGuard(field_confidences, loanApplicationChecks(data, source_pages, response.section_pages)).field_confidences;
  }
  // S2-R21: field cấp 1 chứa giá trị sai định dạng đã bị bỏ → tối đa 0.5 (cần rà soát).
  for (const path of result.invalid_fields ?? []) {
    const top = path.split('.')[0];
    if (top in field_confidences) field_confidences[top] = Math.min(field_confidences[top], INVALID_FIELD_CONFIDENCE_CAP);
  }
  return envelope(item, {
    status: 'SUCCESS', reason_code: result.reason_code, message: result.message, ...formMeta, data, field_confidences, source_pages,
  });
}

/**
 * Chạy S2 trên `matches[]` của S1 (FULL và LIGHT). 1 evidence = (file, loại, bản thể). Mọi bản thể
 * `loan_application` chạy xong trước các loại khác (S2-R03). Nhóm trùng tính trên toàn request.
 */
export async function runExtract(
  classify: ClassifyData,
  ports: ExtractPorts,
  assetKeyFn: AssetKeyFn = defaultAssetKeyFn,
): Promise<ExtractStageResult> {
  const now = () => (ports.now ? ports.now() : new Date()).toISOString();
  const started_at = now();
  const items: WorkItem[] = classify.files
    .filter((f) => f.status === 'CLASSIFIED')
    .flatMap((f) => f.matches.flatMap((m) => m.instances.map((i) => ({
      file_id: f.file_id, file_name: f.file_name, doc_type_key: m.doc_type_key, instance_index: i.instance_index,
      page_range: [i.page_range[0], i.page_range[1]] as [number, number],
    }))));

  if (items.length === 0) {
    return {
      stage_key: 'extract_evidence', status: 'NOT_EVALUATED', status_code: 'NO_EXTRACTABLE_DOCUMENTS', message: null,
      started_at, finished_at: now(),
      content_preview: { evidence_count: 0, success_count: 0, error_count: 0, duplicate_group_count: 0 },
      data: { evidences: [] }, blocking_inputs: [],
    };
  }

  try {
    const anchors = items.filter((i) => i.doc_type_key === 'loan_application');
    const others = items.filter((i) => i.doc_type_key !== 'loan_application');
    const first = await Promise.all(anchors.map((i) => extractOne(i, ports)));
    const rest = await Promise.all(others.map((i) => extractOne(i, ports)));
    // Giữ thứ tự xuất hiện trong S1 cho output (ổn định giữa các lần chạy).
    const byId = new Map([...first, ...rest].map((e) => [e.evidence_id, e]));
    const ordered = items.map((i) => byId.get(evidenceId(i.file_id, i.doc_type_key, i.instance_index))!);
    const evidences = groupDuplicates(ordered, assetKeyFn);
    const errorCount = evidences.filter((e) => e.status === 'ERROR').length;
    return {
      stage_key: 'extract_evidence',
      status: errorCount > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
      status_code: errorCount > 0 ? 'EXTRACTION_ERRORS_PRESENT' : 'COMPLETED',
      message: null,
      started_at,
      finished_at: now(),
      content_preview: {
        evidence_count: evidences.length,
        success_count: evidences.length - errorCount,
        error_count: errorCount,
        duplicate_group_count: new Set(evidences.map((e) => e.duplicate_group_id).filter(Boolean)).size,
      },
      data: { evidences },
      blocking_inputs: [],
    };
  } catch (err) {
    if (ports.isPassThroughError?.(err)) throw err;
    const message = err instanceof ServiceDown ? err.message : 'Dịch vụ bóc tách không phản hồi.';
    return {
      stage_key: 'extract_evidence', status: 'UNAVAILABLE', status_code: 'INTEGRATION_SERVICE_DOWN', message,
      started_at, finished_at: now(), content_preview: null, data: null,
      blocking_inputs: [{ type: 'INTEGRATION', key: 'ocr_service', message }],
    };
  }
}
