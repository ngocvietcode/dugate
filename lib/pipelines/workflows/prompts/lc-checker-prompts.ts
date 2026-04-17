// lib/pipelines/workflows/prompts/lc-checker-prompts.ts
// Prompt builders for the LC Document Checker workflow.
//
// Each function returns { _prompt: "complete prompt text" }.
// The _prompt variable bypasses the DB connector template entirely.
// Connector still provides: API URL, auth, model, timeout, response parsing.
//
// Compliance check (Step 3) is SELF-CONTAINED — all UCP 600 / ISBP 821 rules
// are embedded directly into the prompt. No external reference data needed.

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



export interface LCDiscrepancy {
  id: string;
  severity: 'MAJOR' | 'MINOR' | 'ADVISORY';
  document: string;
  field: string;
  issue: string;
  rule_reference: string;
  recommendation: string;
}

export interface LCCheckResult {
  verdict: 'COMPLIANT' | 'DISCREPANT' | 'PENDING';
  total_discrepancies: number;
  major_discrepancies: number;
  minor_discrepancies: number;
  advisory_count: number;
  documents_present: string[];
  documents_missing: string[];
  discrepancies: LCDiscrepancy[];
  summary: string;
  recommendation: 'ACCEPT' | 'REJECT' | 'RESERVE_FOR_REVIEW';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LC_DOCUMENT_CATEGORIES = [
  'Letter of Credit',
  'Bill of Lading',
  'Commercial Invoice',
  'Packing List',
  'Bill of Exchange',
  'Certificate of Origin',
  'Insurance Certificate',
  'Inspection Certificate',
  'Phytosanitary Certificate',
  'Customs Declaration',
  'Airway Bill',
  'Draft',
  'Khác',
] as const;



// ─── Step 1: Classify ─────────────────────────────────────────────────────────

export function buildClassifyPrompt(
  fileName: string,
  promptOverride?: string,
): Record<string, unknown> {
  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        file_name: fileName,
        categories: LC_DOCUMENT_CATEGORIES.join(', '),
      }),
    };
  }

  return {
    _prompt: `You are an expert in international trade finance and documentary credits (LC).
Task: identify and classify ALL document types present in the file "${fileName}".

For EACH logical document detected, return:
- id: unique key, e.g. "ld-1", "ld-2"
- label: EXACT name from the allowed categories below
- pages: page range, e.g. "1-3", "4", "all"
- confidence: 0.0–1.0

ALLOWED CATEGORIES (use EXACTLY these labels):
${LC_DOCUMENT_CATEGORIES.join('\n')}

CLASSIFICATION RULES:
- "Letter of Credit" = the L/C instrument itself (MT700, L/C form, Swift)
- "Bill of Lading" = ocean B/L; use "Airway Bill" for air transport AWB
- "Bill of Exchange" and "Draft" are both hối phiếu — use "Bill of Exchange"
- A single PDF may contain MULTIPLE document types on different pages — list each separately
- Use "Khác" only if no category matches
- Do NOT merge separate documents into one entry

Return ONLY valid JSON (no markdown fences):
{
  "document_type": "Primary document type in this file",
  "confidence": 0.95,
  "logical_documents": [
    { "id": "ld-1", "label": "Commercial Invoice", "pages": "1-2", "confidence": 0.97 },
    { "id": "ld-2", "label": "Packing List", "pages": "3", "confidence": 0.95 }
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
      let cleanContent = content.trim();
      const match = cleanContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (match && match[1]) {
        cleanContent = match[1].trim();
      }
      classifyData = JSON.parse(cleanContent) as ClassifyData;
    } catch (err) {
      console.warn(`[parseClassifyResult] Failed to parse JSON for ${sourceFileName}:`, err);
      console.warn(`RAW CONTENT:`, content);
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
        label: classifyData.document_type || 'Chứng từ LC',
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



// ─── Step 3: Compliance Check (UCP 600 / ISBP 821 — Self-contained) ──────────

export function buildComplianceCheckPrompt(
  mergedClassifyData: MergedClassifyData,
  promptOverride?: string,
): Record<string, unknown> {
  const classifySummary = JSON.stringify(mergedClassifyData.logical_documents, null, 2);

  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        classify_summary: classifySummary,
      }),
    };
  }

  return {
    _prompt: `You are a senior Documentary Credit (LC) checker with expertise in UCP 600, ISBP 821 (2013 Revision) and eUCP v2.0.

TASK: Examine the presented LC document set for compliance with international standards and internal cross-document consistency.
You are provided with the ORIGINAL RAW DOCUMENTS explicitly attached to this request. Do NOT rely on summarized data — read the textual content, clauses, conditions, and dates directly from the documents yourself to ensure zero information divergence.

=== CLASSIFICATION OVERVIEW ===
The attached documents have been mapped as follows:
${classifySummary}

=== NGHIỆP VỤ LC CHUYÊN SÂU (UCP 600 / ISBP 821) ===

<!-- ======================================== -->
<!-- PHẦN 0: SIÊU QUY TẮC (META-RULES)        -->
<!-- ======================================== -->

<META_RULES>

<RULE id="MR-1" name="Nguồn chân lý duy nhất">
Toàn bộ quy tắc trong Bộ Rules Base và prompt này là nguồn chân lý duy nhất và tuyệt đối.
Mọi kiến thức chung hoặc thông lệ khác bị VÔ HIỆU HÓA nếu mâu thuẫn với các quy tắc này.
</RULE>

<RULE id="MR-2" name="Thứ tự ưu tiên ghi đè">
Khi có xung đột, tuân theo thứ tự (cấp cao hơn luôn thắng):
  1. Cấp 1 (Tối cao): Các quy tắc trong prompt này.
  2. Cấp 2 (Cụ thể): Các điều khoản trong L/C của giao dịch.
  3. Cấp 3 (Thông lệ): Bộ Rules Base (UCP 600 / ISBP 821).
</RULE>

<RULE id="MR-3" name="Xử lý dữ liệu bất định (OCR không chắc chắn)">
Khi trường thông tin quan trọng bị che khuất/mờ/can thiệp khiến OCR không chắc chắn:
  - KHÔNG đưa ra giả định hoặc suy diễn.
  - Gắn cờ "Bất định", kích hoạt Bước 4.
  - Báo cáo: "Cảnh báo: Không thể xác định chắc chắn [Tên trường] trên [Tên chứng từ].
    Dữ liệu OCR: '[Kết quả]'. Đề nghị chuyên gia xác nhận."
</RULE>

<RULE id="MR-4" name="Phá vỡ chuỗi suy luận">
Nếu dữ liệu đầu vào quan trọng bị "Không xác định được":
  1. Hủy bỏ quy tắc kiểm tra đó VÀ tất cả quy tắc phụ thuộc.
  2. Ghi "Cảnh báo: Không thể kiểm tra '[Tên lỗi]' do '[Tên dữ liệu]' không xác định được."
  NGOẠI LỆ: Nếu có lỗi "L/C expired" -> BẮT BUỘC ghi nhận "Late presentation".
</RULE>

<RULE id="MR-5" name="Học hỏi từ phản hồi chuyên gia">
Khi chuyên gia giải quyết "Thông tin Bất định":
  1. Ghi cặp (Dữ liệu bất định -> Dữ liệu xác nhận) vào cơ sở tri thức.
  2. Tự động áp dụng ở Bước 2.5 trong các lần kiểm tra sau.
  3. Ghi chú: "Lưu ý: '[X]' đã được tự động chuẩn hóa thành '[Y]' dựa trên xác nhận trước đó."
</RULE>

</META_RULES>

<!-- ======================================== -->
<!-- PHẦN 1: LOGIC LÕI HỆ THỐNG              -->
<!-- ======================================== -->

<CORE_LOGIC>

<RULE id="CL-1" name="Ngữ cảnh Toàn cục">
Khi bắt đầu phiên kiểm tra, tạo một Đối tượng Ngữ cảnh Toàn cục duy nhất gồm:
  - extracted_data: Toàn bộ dữ liệu đã trích xuất và chuẩn hóa từ tất cả chứng từ.
  - intermediate_findings: Các "sự thật" phát hiện trong quá trình kiểm tra
    (ví dụ: bl_has_pre_carriage: true, consignee_is_to_order: true).
  - discrepancies: Danh sách các điểm không phù hợp đã xác nhận.
Đối tượng này được cập nhật liên tục và là nguồn chân lý duy nhất cho trạng thái phiên.
</RULE>

<RULE id="CL-2" name="Thực thi Hai Giai đoạn">
  Giai đoạn 1 — Thu thập Sự thật:
    Quét toàn bộ L/C và chứng từ để CHỈ thu thập dữ liệu và xác định sự thật.
    Điền đầy đủ extracted_data và intermediate_findings.
    TUYỆT ĐỐI KHÔNG bắt lỗi trong giai đoạn này.
  Giai đoạn 2 — Đánh giá Lỗi:
    Chỉ sau khi Giai đoạn 1 hoàn tất mới được đánh giá lỗi
    dựa trên toàn bộ ngữ cảnh đã thu thập.
</RULE>

<RULE id="CL-3" name="Phụ thuộc Quy tắc">
Mỗi quy tắc kiểm tra có "Điều kiện Kích hoạt" dựa trên intermediate_findings.
NẾU điều kiện được thỏa mãn -> BẮT BUỘC thực thi quy tắc. Không được bỏ qua.
Ví dụ:
  - Check_Shipper_Endorsement:
    Kích hoạt khi: consignee_is_to_order == true
    Hành động: Quét chứng từ vận tải tìm chữ ký hậu shipper. Không có -> ghi lỗi.
  - Validate_OnBoard_Notation:
    Kích hoạt khi: bl_has_pre_carriage == true
    Hành động: Ghi chú "on board" phải chứa đồng thời: ngày, tên tàu, cảng bốc.
    Thiếu bất kỳ -> ghi lỗi.
</RULE>

</CORE_LOGIC>

<!-- ======================================== -->
<!-- PHẦN 2: DANH SÁCH LOẠI TRỪ              -->
<!-- ======================================== -->

<EXCLUSION_LIST>
Các hành vi bị CẤM tuyệt đối:

[EX-1] KHÔNG dùng ngày trên thư đòi tiền (covering letter) để xác định ngày xuất trình.
[EX-2] KHÔNG coi lỗi sai số L/C và ngày phát hành L/C là lỗi nếu ngân hàng phát hành là VPBank.
[EX-3] KHÔNG bắt lỗi thiếu số lượng chứng từ dựa trên file scan
       (file scan chỉ có 1 bản mỗi loại, không phản ánh số lượng thực tế).
[EX-4] KHÔNG đếm số lượng chứng từ liệt kê trên thư đòi tiền để bắt lỗi thiếu chứng từ.
[EX-5] KHÔNG liệt kê mục "số lượng chứng từ xuất trình" trong kết quả đầu ra.
[EX-6] KHÔNG sử dụng dữ liệu từ Đối tượng Dữ liệu của chứng từ khác khi kiểm tra
       nội dung một chứng từ cụ thể (Quy tắc Cách ly Dữ liệu).
       Ví dụ: Khi kiểm tra B/L với yêu cầu "NOT SHOW SIZE", chỉ tìm "size" trong bl_data.
       Dữ liệu "size" trong invoice_data hoàn toàn không liên quan.
[EX-7] KHÔNG tự động sửa lỗi chính tả hoặc hoàn thiện dữ liệu ngoài các phép chuẩn hóa
       được định nghĩa rõ ràng ở Bước 2.5.
</EXCLUSION_LIST>

<!-- ======================================== -->
<!-- PHẦN 3: QUY TRÌNH THỰC THI TUẦN TỰ      -->
<!-- ======================================== -->

<EXECUTION_PIPELINE>

<STEP id="1" name="Phân tích yêu cầu L/C">
  - Đọc kỹ và hệ thống hóa tất cả điều khoản trong L/C gốc và các tu chỉnh.
  - Lưu ý: Định dạng ngày tháng trong điện L/C và tu chỉnh là YYMMDD.
</STEP>

<STEP id="2" name="Trích xuất và Đối chiếu chéo">
  2.1. Trích xuất dữ liệu tạo Đối tượng Dữ liệu riêng biệt cho từng chứng từ.
  2.2. Phân loại mâu thuẫn rõ ràng (>98% tin cậy) và mâu thuẫn bất định.
  2.3. Đối chiếu Toàn vẹn Dữ liệu Quan hệ (vd: số container với seal).
</STEP>

<STEP id="2.5" name="Tiền xử lý và Chuẩn hóa Dữ liệu">
  CHỈ ĐƯỢC PHÉP chuẩn hóa: Loại bỏ ký tự giữ chỗ, ký tự thừa, in hoa/thường.
</STEP>

<STEP id="3" name="Áp dụng Quy tắc Chuyên sâu và Phát hiện Lỗi">
  NGUYÊN TẮC CHUNG: So sánh trên dữ liệu đã chuẩn hóa. Đi qua toàn bộ quy tắc.

  3.1. Xác định Ngày xuất trình (thuật toán bắt buộc):
    a) Tìm dấu ngày nhận chứng từ của NH. KHÔNG suy diễn từ ngày lập thư đòi tiền.
  3.2. Late presentation: Ngày xuất trình > 21 ngày sau ngày giao hàng.
  3.3. L/C expired: Ngày xuất trình > Ngày hết hạn L/C. Nếu L/C EXPIRED thì phải ghi LATE PRESENTATION.
  3.4. Mô tả hàng hóa: Invoice phải tương ứng L/C. B/L có thể mô tả chung.
  3.5. VPBank (VPBKVNVX): Sai số/ngày L/C không tính lỗi. Báo cáo bằng Tiếng Anh.
  3.6. B/L Consignee/Notify...
</STEP>

<STEP id="4" name="Xử lý Thông tin Bất định">
  Tự động gắn cờ PENDING nếu độ tin cậy < 90%. Nếu sai định dạng mã ISO container, cảnh báo.
</STEP>

<STEP id="5" name="Tổng hợp JSON (Đã cấu hình hệ thống)">
  5.1. KIỂM TRA KÉP BẮT BUỘC trước khi xuất kết quả:
    A. Kiểm tra xuôi: Với mỗi lỗi đã tìm, rà soát lại quy tắc.
    B. Kiểm tra ngược: Có bỏ qua quy tắc L/C nào không?
  5.2. Chuyển đổi báo cáo thành định dạng JSON hợp lệ theo Schema do hệ thống chỉ định ở bên dưới.
</STEP>
</EXECUTION_PIPELINE>

<!-- ============================================================ -->
<!-- PHẦN 5, 6, 7: RULES BASE (UCP 600 / ISBP 821)                -->
<!-- ============================================================ -->
(Áp dụng toàn bộ kiến thức chuyên ngành tiêu chuẩn quốc tế về UCP 600 Art 1-39 và ISBP 821 cho Draft, Invoice, B/L, Insurance, C/O, Packing List...)

<!-- ============================================================ -->
<!-- PHẦN 8: CƠ CHẾ CƯỠNG CHẾ KIỂM TRA TOÀN DIỆN                  -->
<!-- ============================================================ -->

<ENFORCEMENT_MECHANISMS>

<MECHANISM id="EM-1" name="Scratchpad nội bộ">
Trước khi xuất kết quả JSON, bạn BẮT BUỘC phải tạo một SCRATCHPAD nội bộ (Chain of Thought).
Bạn phải ĐƯA TOÀN BỘ Scratchpad này vào trường mảng "examination_log" trong JSON schema. Mỗi dòng suy luận là 1 phần tử của mảng. Dòng suy nghĩ phải thể hiện rõ:
1. Bạn đã đi qua Giai đoạn 1 (Thu thập Sự thật) như thế nào.
2. Kiểm tra từng chứng từ (Draft, Invoice, B/L...).
3. Kiểm tra chéo (GĐ3) và Thời hạn (GĐ4).
4. Xác nhận bạn đã làm Kiểm tra Kép (GĐ7) xong.
</MECHANISM>

<MECHANISM id="EM-2" name="Bảng kích hoạt quy tắc theo điều kiện">
- NẾU B/L có On Board: CẦN check pre-carriage requirements.
- NẾU Issuing Bank = VPBKVNVX: Output lỗi tiếng Anh. Khác: Lỗi tiếng Việt + BẮT BUỘC điền cách sửa lỗi vào trường "suggested_fix" nếu có.
</MECHANISM>

</ENFORCEMENT_MECHANISMS>


=== OUTPUT ===
Return ONLY valid JSON (no markdown fences):
{
  "examination_log": [
    "Step 1: Analyzed Invoice. Value is USD 50,000. Description matches.",
    "Step 2: Analyzed B/L. Clean on board. Date is 15-Apr-2025.",
    "Step 3: Cross-check - B/L date is after Invoice date (Pass). Weights match between B/L and PL."
  ],
  "verdict": "COMPLIANT | DISCREPANT | PENDING",
  "total_discrepancies": 0,
  "major_discrepancies": 0,
  "minor_discrepancies": 0,
  "advisory_count": 0,
  "documents_present": ["Commercial Invoice", "Bill of Lading"],
  "documents_missing": [],
  "discrepancies": [
    {
      "id": "D001",
      "severity": "MAJOR | MINOR | ADVISORY",
      "document": "Exact document type label",
      "field": "Specific field name",
      "issue": "Clear, concise description of the problem",
      "rule_reference": "UCP 600 Art. XX / ISBP 821 Para. YY",
      "recommendation": "Suggested corrective action or handling"
    }
  ],
  "summary": "2-3 sentence objective summary of the examination result",
  "recommendation": "ACCEPT | REJECT | RESERVE_FOR_REVIEW"
}`,
  };
}

// ─── Step 4: Report ───────────────────────────────────────────────────────────

export function buildReportPrompt(
  mergedClassifyData: MergedClassifyData,
  checkResult: LCCheckResult,
  promptOverride?: string,
): Record<string, unknown> {
  const majorIssues = (checkResult.discrepancies ?? []).filter(d => d.severity === 'MAJOR');
  const minorIssues = (checkResult.discrepancies ?? []).filter(d => d.severity === 'MINOR');
  const advisoryIssues = (checkResult.discrepancies ?? []).filter(d => d.severity === 'ADVISORY');

  const discrepancyTable = checkResult.discrepancies?.length > 0
    ? checkResult.discrepancies.map(d =>
        `| ${d.id} | ${d.severity} | ${d.document} | ${d.field} | ${d.issue} | ${d.rule_reference} |`
      ).join('\n')
    : '*(No discrepancies found)*';

  const classifySummary = `${mergedClassifyData.files_analyzed} file(s), ${mergedClassifyData.total_logical_documents} document type(s)`;

  const verdictLabel = {
    COMPLIANT: 'HOP LE (COMPLIANT)',
    DISCREPANT: 'CO SAI LECH (DISCREPANT)',
    PENDING: 'CAN XEM XET (PENDING)',
  }[checkResult.verdict] || checkResult.verdict;

  const recommendationLabel = {
    ACCEPT: 'DE XUAT CHAP NHAN THANH TOAN',
    REJECT: 'DE XUAT TU CHOI THANH TOAN',
    RESERVE_FOR_REVIEW: 'DE XUAT DE DUYET - XEM XET THEM',
  }[checkResult.recommendation] || checkResult.recommendation;

  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        classify_summary: classifySummary,
        verdict: verdictLabel,
        recommendation: recommendationLabel,
        major_count: String(majorIssues.length),
        minor_count: String(minorIssues.length),
        advisory_count: String(advisoryIssues.length),
        discrepancy_table: discrepancyTable,
        check_summary: checkResult.summary || '',
        documents_present: (checkResult.documents_present ?? []).join(', '),
        documents_missing: (checkResult.documents_missing ?? []).join(', '),
      }),
    };
  }

  return {
    _prompt: `You are a senior Trade Finance Officer. Produce a professional LC CHECKING REPORT (Bao cao Kiem tra Chung tu LC) in Vietnamese.

=== INPUT DATA ===

Document set: ${classifySummary}
Documents present: ${(checkResult.documents_present ?? []).join(', ')}
${checkResult.documents_missing?.length > 0 ? `Documents not presented: ${checkResult.documents_missing.join(', ')}` : 'All expected documents accounted for.'}



Examination result: ${verdictLabel}
Recommendation: ${recommendationLabel}
Discrepancy count: ${checkResult.total_discrepancies} total (MAJOR: ${majorIssues.length}, MINOR: ${minorIssues.length}, ADVISORY: ${advisoryIssues.length})
Examination summary: ${checkResult.summary}

Discrepancy table:
| ID | Severity | Document | Field | Issue | Rule Reference |
|----|----------|----------|-------|-------|----------------|
${discrepancyTable}

=== REPORT STRUCTURE ===

Write a complete, formal LC Checking Report in Vietnamese using EXACTLY these sections:

## I. THONG TIN BO CHUNG TU
- List each document received: type, reference number, date, issuing party
- Note any documents not presented

## II. DANH SACH CHUNG TU
- Review the attached files and list their identifiers clearly.

## III. KET QUA KIEM TRA TUAN THU
- State overall verdict clearly (HOP LE / CO SAI LECH / CAN XEM XET)
- Full discrepancy table with UCP 600 / ISBP 821 references
- Group: MAJOR first, then MINOR, then ADVISORY
- For each MAJOR: explain why it triggers Art. 16 refusal

## IV. NHAN XET VA DE XUAT XU LY
- Professional assessment from examiner's perspective
- If COMPLIANT: recommend acceptance, note any advisory items
- If DISCREPANT: for each MAJOR — state whether correctable (request amendment) or non-correctable (recommend rejection or waiver)
- If RESERVE_FOR_REVIEW: list items requiring senior approval

## V. KET LUAN
- One unambiguous final recommendation in formal banking language
- Examiner signature line placeholder

FORMATTING:
- Language: Vietnamese (professional banking register)
- Audience: Trade Finance Operations Head, Compliance Officer
- Cite UCP 600 articles and ISBP 821 paragraphs explicitly
- Maximum 2,000 words
- Output in Markdown`,
  };
}

// ─── Interpolation Helper ─────────────────────────────────────────────────────

/**
 * Replace {{variable_name}} placeholders in a prompt template.
 */
function interpolatePrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return key in vars ? vars[key] : match;
  });
}
