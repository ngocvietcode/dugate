// Thu gọn response `GET /operations/{id}?view=compact` của loan-appraisal (giao diện poll 2 giây một lần).
//
// Nguyên tắc: CHỈ bỏ thứ giao diện không đọc, hoặc đọc được từ chỗ khác. Không đổi giá trị nào mà giao diện hiển thị.
// Hàm thuần, không mutate đầu vào, chịu được dữ liệu thiếu (kết quả cũ, kết quả giai đoạn 1).
//
//  1. pipeline_steps: `extracted_data` của mọi bước đều là bản sao của dữ liệu đã nằm trong kết quả cuối (checklist 36 KB ở bước
//     consolidate lặp lại ở `result.checklist`...). Giao diện chỉ cần `classify` (danh sách file + kiểm tra sơ bộ) và
//     `extract_evidence` (bóc tách từng file) để hiện tiến trình trung gian; bỏ phần còn lại.
//  2. Kết quả cuối. Kết quả MỚI đã không còn `intake`, `audit`, `evidence.by_file/by_document_type` và bản ghi evidence
//     `CHECKLIST_STATUS` (workflow không ghi nữa, xem `toStoredEvidence`). Các bước dọn đó vẫn giữ để thu gọn KẾT QUẢ CŨ đã lưu
//     trong DB còn các trường này:
//       - `intake`: giao diện không đọc; `missing_required_keys` đã có ở `dossier_readiness`, checklist đã có ở `checklist`.
//       - `audit`: giao diện không đọc; `audit.config_snapshot` trùng hệt `config_snapshot`.
//       - `evidence.by_file`, `evidence.by_document_type`: chỉ là chỉ mục ngược của `records`.
//       - `checklist.items` NOT_APPLICABLE: giao diện ẩn chúng (D-65); số lượng giữ ở `checklist.not_applicable_count`.
//       - `master_dossier.documents`: bỏ chứng từ "không áp dụng" không có bản nộp, và trường MISSING (giao diện đều ẩn).
//       - `evidence.records`: chỉ giữ bản ghi có ai tham chiếu (giao diện tra theo evidence_id), rút còn các trường giao diện đọc.

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Stage còn giữ `extracted_data` khi chưa hoàn tất: giao diện reveal kết quả trung gian từ đây. */
const REVEALED_STAGES = new Set(['classify', 'extract_evidence']);

/** Bước cũ chưa có `stage_key`: suy từ chỉ số (0 = classify, 1 = extract_evidence). */
function stageOf(step: Json): string | undefined {
  if (typeof step.stage_key === 'string') return step.stage_key;
  return step.step === 0 ? 'classify' : step.step === 1 ? 'extract_evidence' : undefined;
}

/** Bỏ `extracted_data` của các bước mà giao diện không reveal. Dùng khi operation chưa SUCCEEDED. */
export function compactLoanSteps(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return steps.map((step) => {
    const stage = isRecord(step) ? stageOf(step) : undefined;
    if (!isRecord(step) || (stage && REVEALED_STAGES.has(stage))) return step;
    const { extracted_data: _omit, ...rest } = step;
    return rest;
  });
}

// ─── kết quả cuối ────────────────────────────────────────────────────────────

function compactChecklist(checklist: unknown): unknown {
  if (!isRecord(checklist) || !Array.isArray(checklist.items)) return checklist;
  const items = checklist.items;
  const kept = items.filter((item) => !(isRecord(item) && item.status === 'NOT_APPLICABLE'));
  if (kept.length === items.length) return checklist;
  return { ...checklist, items: kept, not_applicable_count: items.length - kept.length };
}

/** Chứng từ master mà giao diện hiển thị: có bản nộp, hoặc không phải "không áp dụng". */
function hasUsedCopy(doc: Json): boolean {
  return Array.isArray(doc.copies) && doc.copies.some((c) => isRecord(c) && (c.role === 'PRIMARY' || c.role === 'DUPLICATE'));
}

function compactMaster(master: unknown): unknown {
  if (!isRecord(master) || !Array.isArray(master.documents)) return master;
  const documents = master.documents
    .filter((doc) => !(isRecord(doc) && doc.checklist_status === 'NOT_APPLICABLE' && !hasUsedCopy(doc)))
    .map((doc) => {
      if (!isRecord(doc) || !Array.isArray(doc.fields)) return doc;
      return { ...doc, fields: doc.fields.filter((f) => !(isRecord(f) && f.status === 'MISSING')) };
    });
  return { ...master, documents };
}

/** Mọi chuỗi trong cây (id nằm ở `evidence_id`, `evidence_ids[]`, `sources[]`...). Một lượt duyệt, tra cứu O(1). */
function collectStrings(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') { if (value.length <= 200) into.add(value); return; }
  if (Array.isArray(value)) { for (const v of value) collectStrings(v, into); return; }
  if (isRecord(value)) for (const v of Object.values(value)) collectStrings(v, into);
}

/** Các trường của bản ghi evidence mà giao diện đọc (`sourceDocumentsOf`, `EvidenceChips`). */
function slimRecord(record: Json): Json {
  const out: Json = { evidence_id: record.evidence_id, evidence_kind: record.evidence_kind, file_name: record.file_name, doc_type_label: record.doc_type_label };
  if (record.doc_type_key !== undefined) out.doc_type_key = record.doc_type_key;
  if (Array.isArray(record.source_evidence_ids) && record.source_evidence_ids.length > 0) out.source_evidence_ids = record.source_evidence_ids;
  return out;
}

function compactEvidence(evidence: unknown, referenced: Set<string>): unknown {
  if (!isRecord(evidence) || !Array.isArray(evidence.records)) return evidence;
  const records = evidence.records.filter(isRecord);
  const byId = new Map(records.map((r) => [String(r.evidence_id), r]));
  // Bản ghi được tham chiếu, và nguồn của chúng (bản ghi trạng thái checklist trỏ về bản ghi bóc tách gốc).
  const keep = new Set<string>();
  const visit = (id: string) => {
    if (keep.has(id) || !byId.has(id)) return;
    keep.add(id);
    const sources = byId.get(id)!.source_evidence_ids;
    if (Array.isArray(sources)) for (const s of sources) if (typeof s === 'string') visit(s);
  };
  for (const id of byId.keys()) if (referenced.has(id)) visit(id);
  return { records: records.filter((r) => keep.has(String(r.evidence_id))).map(slimRecord) };
}

/** Thu gọn `AppraisalResultV2` (hoặc kết quả giai đoạn 1) cho view=compact. Giá trị không nhận ra được trả nguyên. */
export function compactAppraisalResult(result: unknown): unknown {
  if (!isRecord(result)) return result;
  const { intake: _intake, audit: _audit, ...rest } = result;
  const out: Json = { ...rest };
  if ('checklist' in out) out.checklist = compactChecklist(out.checklist);
  if ('master_dossier' in out) out.master_dossier = compactMaster(out.master_dossier);
  if ('evidence' in out) {
    const { evidence, ...others } = out;
    const referenced = new Set<string>();
    collectStrings(others, referenced);
    out.evidence = compactEvidence(evidence, referenced);
  }
  return out;
}

// ─── bản LƯU khi SUCCEEDED ───────────────────────────────────────────────────

/** Khóa đánh dấu bước đã được bỏ `extracted_data` vì dữ liệu nằm ở kết quả cuối. */
export const STEP_ARTIFACT_IN_RESULT = 'result.extracted_data';

/**
 * Thu gọn `stepsResultJson` của loan-appraisal khi SUCCEEDED. `extracted_data` của các stage (classify, extract_evidence, consolidate,
 * financials, policy) là checkpoint để resume giữa chừng; khi đã xong chúng là bản sao của kết quả cuối (đo: 88% trùng từng byte).
 * Resume chỉ chấp nhận WAITING_USER_INPUT nên không ai đọc lại, và trang quản trị / view=compact / view=integration đều đã bỏ chúng.
 *
 * Giữ nguyên mọi khóa khác của bước (`status`, `stage_key`, `processor`, `content_preview`, và đặc biệt `sub_operation_id` để
 * `purgeWorkflowSubSteps` còn tìm ra bước con cần xoá). Bước webhook (không có `extracted_data`) đi qua nguyên vẹn.
 * Thuần, không mutate đầu vào. Bước bị bỏ được đánh dấu `artifact_in` để người đọc biết dữ liệu ở đâu.
 */
export function dropSucceededStepArtifacts<T extends object>(steps: T[]): T[] {
  return steps.map((step) => {
    if (!isRecord(step) || !('extracted_data' in step) || step.extracted_data === undefined) return step;
    const { extracted_data: _omit, ...rest } = step as Json;
    return { ...rest, artifact_in: STEP_ARTIFACT_IN_RESULT } as unknown as T;
  });
}
