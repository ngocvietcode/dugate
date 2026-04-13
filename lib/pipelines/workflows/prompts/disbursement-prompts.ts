// lib/pipelines/workflows/prompts/disbursement-prompts.ts
// Prompt builders for the Disbursement workflow.
//
// Each function returns { _prompt: "complete prompt text" }.
// The _prompt variable bypasses the DB connector template entirely.
// Connector still provides: API URL, auth, model, timeout, response parsing.
//
// All prompt builders accept an optional `promptOverride` string.
// When provided, it replaces the code-generated prompt, with {{variable}} interpolation.

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LogicalDocument {
  id: string;
  label: string;
  pages: string;
  confidence: number;
  source_file: string;
}

export interface ClassifyData {
  document_type?: string;
  confidence?: number;
  logical_documents?: LogicalDocument[];
}

export interface ClassifyFileResult {
  fileName: string;
  classifyData: ClassifyData;
  logicalDocs: LogicalDocument[];
  subOperationId: string;
  status: 'success';
}

export interface ClassifyFileError {
  fileName: string;
  classifyData: Record<string, never>;
  logicalDocs: never[];
  subOperationId: string;
  status: 'error';
  error: string;
}

export type ClassifyResult = ClassifyFileResult | ClassifyFileError;

export interface MergedClassifyData {
  files_analyzed: number;
  total_logical_documents: number;
  per_file: Array<{
    file: string;
    document_type: string | undefined;
    logical_documents_count: number;
  }>;
  logical_documents: LogicalDocument[];
}

export interface ExtractFileResult {
  file_name: string;
  logical_docs: string[];
  status: 'success';
  sub_operation_id: string;
  content: any;
  extracted_data: unknown;
}

export interface ExtractFileError {
  file_name: string;
  logical_docs: string[];
  status: 'error';
  error: string;
}

export type ExtractResult = ExtractFileResult | ExtractFileError;

export interface CrosscheckItem {
  rule: string;
  status: 'PASS' | 'FAIL' | 'WARNING';
  document_value?: string;
  reference_value?: string;
  explanation?: string;
}

export interface CrosscheckResult {
  verdict?: 'PASS' | 'FAIL' | 'WARNING';
  score?: number;
  summary?: string;
  checks?: CrosscheckItem[];
  discrepancies?: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_CATEGORIES = [
  'Hợp đồng tín dụng',
  'Giấy nhận nợ',
  'Hóa đơn GTGT',
  'Phiếu xuất kho',
  'Đề nghị giải ngân',
  'Bảng kê chứng từ',
  'Nghị quyết HĐQT',
  'Giấy ủy quyền',
  'Hợp đồng kinh tế',
  'Biên bản nghiệm thu',
  'Giấy đề nghị thanh toán',
  'Khác',
] as const;

/** Map document label → extraction fields */
const EXTRACT_FIELD_MAP: Record<string, string> = {
  'Hợp đồng tín dụng': 'Số hợp đồng, Bên vay, Bên cho vay, Số tiền, Lãi suất, Thời hạn, Ngày ký',
  'Hóa đơn GTGT': 'Số hóa đơn, Ngày, Người bán, Người mua, Tổng tiền, Thuế VAT, Thành tiền',
  'Đề nghị giải ngân': 'Số đề nghị, Ngày, Khách hàng, Số tiền, Mục đích sử dụng, Tài khoản nhận',
  'Nghị quyết HĐQT': 'Số nghị quyết, Ngày, Nội dung quyết định, Hạn mức, Lãi suất, Điều kiện',
  'Giấy nhận nợ': 'Số giấy, Bên nợ, Số tiền nợ, Lãi suất, Ngày bắt đầu, Ngày đáo hạn',
};

const DEFAULT_EXTRACT_FIELDS = 'Tên tài liệu, Số hiệu, Ngày, Giá trị, Bên liên quan';

// ─── Step 1: Classify ─────────────────────────────────────────────────────────

export function buildClassifyPrompt(
  fileName: string,
  promptOverride?: string,
): Record<string, unknown> {
  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        file_name: fileName,
        categories: ALLOWED_CATEGORIES.join(', '),
      }),
    };
  }

  return {
    _prompt: `Phân loại tài liệu "${fileName}" vào các nhóm.

Với mỗi nhóm tài liệu phát hiện được trong file, trả về:
- id: mã định danh duy nhất
- label: tên loại tài liệu
- pages: phạm vi trang (ví dụ: "1-5", "6", "all")
- confidence: độ tin cậy (0.0 - 1.0)

Danh mục cho phép:
${ALLOWED_CATEGORIES.join(', ')}

Return JSON:
{
  "document_type": "Tên loại chính",
  "confidence": 0.95,
  "logical_documents": [
    { "id": "ld-1", "label": "Hợp đồng tín dụng", "pages": "1-5", "confidence": 0.96 }
  ]
}`,
  };
}

export function parseClassifyResult(
  content: string | null,
  sourceFileName: string,
): { classifyData: ClassifyData; logicalDocs: LogicalDocument[] } {
  let classifyData: ClassifyData = {};

  if (content) {
    try {
      classifyData = JSON.parse(content) as ClassifyData;
    } catch (err) {
      console.warn(`[parseClassifyResult] Failed to parse JSON for ${sourceFileName}:`, err);
      classifyData = {};
    }
  }

  const rawDocs = classifyData.logical_documents ?? [];

  const logicalDocs: LogicalDocument[] = rawDocs.length > 0
    ? rawDocs.map((doc) => ({
        ...doc,
        source_file: doc.source_file || sourceFileName,
      }))
    : [{
        id: `auto-${sourceFileName.replace(/\W/g, '_')}`,
        label: classifyData.document_type || 'Tài liệu',
        pages: 'all',
        confidence: classifyData.confidence || 1.0,
        source_file: sourceFileName,
      }];

  return { classifyData, logicalDocs };
}

export function mergeClassifyResults(
  results: ClassifyFileResult[],
): { allLogicalDocs: LogicalDocument[]; mergedClassifyData: MergedClassifyData } {
  const allLogicalDocs = results.flatMap(r => r.logicalDocs);
  const mergedClassifyData: MergedClassifyData = {
    files_analyzed: results.length,
    total_logical_documents: allLogicalDocs.length,
    per_file: results.map(r => ({
      file: r.fileName,
      document_type: r.classifyData.document_type,
      logical_documents_count: r.logicalDocs.length,
    })),
    logical_documents: allLogicalDocs,
  };
  return { allLogicalDocs, mergedClassifyData };
}

// ─── Step 2: Extract ──────────────────────────────────────────────────────────

export function buildExtractPrompt(
  docsInFile: LogicalDocument[],
  fileName: string,
  promptOverride?: string,
): Record<string, unknown> {
  const docSections = docsInFile.map((doc) => {
    const fields = EXTRACT_FIELD_MAP[doc.label] || DEFAULT_EXTRACT_FIELDS;
    return `- "${doc.label}" (trang ${doc.pages}): extract [${fields}]`;
  }).join('\n');

  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        file_name: fileName,
        doc_sections: docSections,
      }),
    };
  }

  return {
    _prompt: `Bóc tách dữ liệu từ file "${fileName}".

Tài liệu chứa ${docsInFile.length} phần:
${docSections}

Đọc toàn bộ file, tìm và trích xuất các trường yêu cầu cho từng phần.
Nếu không tìm thấy giá trị, ghi null.

Return JSON:
{
  "file": "${fileName}",
  "documents": [
    {
      "label": "Tên loại",
      "pages": "1-5",
      "fields": { "Số hợp đồng": "...", "Bên vay": "...", ... }
    }
  ]
}`,
  };
}

// ─── Step 3: Cross-Check ──────────────────────────────────────────────────────

export function buildCrosscheckPrompt(
  extractionResults: ExtractResult[],
  referenceData?: string,
  promptOverride?: string,
): Record<string, unknown> {
  const successResults = extractionResults.filter(
    (r): r is ExtractFileResult => r.status === 'success',
  );

  const extractionSummary = successResults.map(r =>
    `File "${r.file_name}": ${r.logical_docs?.join(', ') || 'N/A'}`
  ).join('\n');

  const extractionDetail = JSON.stringify(
    successResults.map(r => ({ file: r.file_name, data: r.extracted_data })), null, 2,
  );

  const refSection = referenceData
    ? `Nghị quyết tham chiếu:\n${referenceData}`
    : 'Không có Nghị quyết tham chiếu. Đối chiếu tính nhất quán nội bộ giữa các tài liệu.';

  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        extraction_summary: extractionSummary,
        extraction_detail: extractionDetail,
        reference_data: referenceData || '',
      }),
    };
  }

  return {
    _prompt: `Đối chiếu chéo dữ liệu đã bóc tách với Nghị quyết.

Dữ liệu bóc tách từ ${successResults.length} file:
${extractionSummary}

Chi tiết:
${extractionDetail}

${refSection}

Kiểm tra:
1. Số tiền giải ngân có vượt hạn mức không?
2. Lãi suất có đúng theo NQ không?
3. Thời hạn có phù hợp không?
4. Mục đích SDV có đúng không?
5. Thông tin khách hàng có nhất quán giữa các tài liệu không?
6. Chữ ký, con dấu đầy đủ không?

Return JSON:
{
  "verdict": "PASS|FAIL|WARNING",
  "score": 85,
  "summary": "Tóm tắt 1-2 câu",
  "checks": [
    { "rule": "Tên check", "status": "PASS|FAIL|WARNING", "document_value": "...", "reference_value": "...", "explanation": "..." }
  ],
  "discrepancies": ["Mô tả sai lệch"]
}`,
  };
}

// ─── Step 4: Report ───────────────────────────────────────────────────────────

export function buildReportPrompt(
  mergedClassifyData: MergedClassifyData,
  extractionResults: ExtractResult[],
  crosscheckData: CrosscheckResult,
  promptOverride?: string,
): Record<string, unknown> {
  const failedChecks = (crosscheckData.checks ?? [])
    .filter((c) => c.status === 'FAIL' || c.status === 'WARNING');

  const checksSummary = failedChecks.length > 0
    ? `⚠️ Phát hiện ${failedChecks.length} vấn đề:\n${failedChecks.map((c) => `- ${c.rule}: ${c.explanation}`).join('\n')}`
    : '✅ Tất cả kiểm tra đều PASS.';

  const successExtracts = extractionResults.filter(
    (r): r is ExtractFileResult => r.status === 'success',
  );

  const classifySummary = `${mergedClassifyData.files_analyzed} file, ${mergedClassifyData.total_logical_documents} loại tài liệu`;
  const extractionData = JSON.stringify(
    successExtracts.map(r => ({ file: r.file_name, data: r.extracted_data })), null, 2,
  );
  const crosscheckVerdict = `${crosscheckData.verdict || 'N/A'}, điểm: ${crosscheckData.score || 'N/A'}/100`;

  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        classify_summary: classifySummary,
        extraction_data: extractionData,
        crosscheck_verdict: crosscheckVerdict,
        checks_summary: checksSummary,
      }),
    };
  }

  return {
    _prompt: `Soạn Tờ trình thẩm định hồ sơ giải ngân cho Ban Giám đốc.

Kết quả phân loại:
- ${classifySummary}

Kết quả bóc tách:
${extractionData}

Kết quả đối chiếu (${crosscheckVerdict}):
${checksSummary}

Yêu cầu:
- Văn phong: Trang trọng, nghiệp vụ ngân hàng
- Đối tượng: Ban Giám đốc / Hội đồng Tín dụng
- Bao gồm: Tóm tắt hồ sơ, Kết quả đối chiếu, Đề xuất, Lưu ý (nếu có)
- Tối đa 1500 từ

Viết Tờ trình bằng Markdown.`,
  };
}

// ─── Interpolation Helper ─────────────────────────────────────────────────────

/**
 * Replace {{variable_name}} placeholders in a prompt template.
 * Supports all workflow step variables.
 */
function interpolatePrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return key in vars ? vars[key] : match;
  });
}
