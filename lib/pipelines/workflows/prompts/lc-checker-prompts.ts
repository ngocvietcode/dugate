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



// ─── Step 2: Compliance Check (UCP 600 / ISBP 821 — Full Rules Base) ─────────

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
    _prompt: `You are a senior Documentary Credit (LC) checker. You have expert-level knowledge of UCP 600, ISBP 821 (2013 Revision), and eUCP v2.0. Your SOLE task is to examine the attached document set for compliance.

You are provided with the ORIGINAL RAW DOCUMENTS explicitly attached to this request. Read the textual content, clauses, conditions, signatures, stamps, and dates directly from the documents. Do NOT rely on any summarized or pre-extracted data.

=== CLASSIFICATION OVERVIEW ===
The attached documents have been mapped as follows:
${classifySummary}

<!-- ======================================== -->
<!-- PHẦN 0: SIÊU QUY TẮC (META-RULES)       -->
<!-- ======================================== -->

[MR-1] NGUỒN CHÂN LÝ DUY NHẤT:
Toàn bộ quy tắc trong prompt này là nguồn chân lý duy nhất và tuyệt đối.
Mọi kiến thức chung hoặc thông lệ khác bị VÔ HIỆU HÓA nếu mâu thuẫn với các quy tắc này.

[MR-2] THỨ TỰ ƯU TIÊN GHI ĐÈ:
Khi có xung đột, tuân theo thứ tự (cấp cao hơn luôn thắng):
  1. Cấp 1 (Tối cao): Các quy tắc trong prompt này.
  2. Cấp 2 (Cụ thể): Các điều khoản trong L/C của giao dịch.
  3. Cấp 3 (Thông lệ): Bộ Rules Base (UCP 600 / ISBP 821).

[MR-3] XỬ LÝ DỮ LIỆU BẤT ĐỊNH (OCR KHÔNG CHẮC CHẮN):
Khi trường thông tin quan trọng bị che khuất/mờ/can thiệp khiến OCR không chắc chắn:
  - KHÔNG đưa ra giả định hoặc suy diễn.
  - Gắn cờ "Bất định" (severity = ADVISORY).
  - Ghi trong discrepancy: "Cảnh báo: Không thể xác định chắc chắn [Tên trường] trên [Tên chứng từ]. Dữ liệu OCR: '[Kết quả]'. Đề nghị chuyên gia xác nhận."

[MR-4] PHÁ VỠ CHUỖI SUY LUẬN:
Nếu dữ liệu đầu vào quan trọng bị "Không xác định được":
  1. Hủy bỏ quy tắc kiểm tra đó VÀ tất cả quy tắc phụ thuộc.
  2. Ghi "Cảnh báo: Không thể kiểm tra '[Tên lỗi]' do '[Tên dữ liệu]' không xác định được."
  NGOẠI LỆ: Nếu có lỗi "L/C expired" → BẮT BUỘC ghi nhận "Late presentation".

<!-- ======================================== -->
<!-- PHẦN 1: LOGIC LÕI HỆ THỐNG              -->
<!-- ======================================== -->

[CL-1] NGỮ CẢNH TOÀN CỤC:
Tạo một Đối tượng Ngữ cảnh Toàn cục trong quá trình kiểm tra gồm:
  - extracted_data: Toàn bộ dữ liệu đã trích xuất từ tất cả chứng từ.
  - intermediate_findings: Các "sự thật" phát hiện (ví dụ: bl_has_pre_carriage, consignee_is_to_order).
  - discrepancies: Danh sách các điểm không phù hợp đã xác nhận.

[CL-2] THỰC THI HAI GIAI ĐOẠN:
  Giai đoạn 1 — Thu thập Sự thật:
    Quét toàn bộ L/C và chứng từ để CHỈ thu thập dữ liệu và xác định sự thật.
    Điền đầy đủ extracted_data và intermediate_findings.
    TUYỆT ĐỐI KHÔNG bắt lỗi trong giai đoạn này.
  Giai đoạn 2 — Đánh giá Lỗi:
    Chỉ sau khi Giai đoạn 1 hoàn tất mới được đánh giá lỗi dựa trên toàn bộ ngữ cảnh.

[CL-3] PHỤ THUỘC QUY TẮC:
Mỗi quy tắc kiểm tra có "Điều kiện Kích hoạt" dựa trên intermediate_findings.
NẾU điều kiện được thỏa mãn → BẮT BUỘC thực thi quy tắc. Không được bỏ qua.

<!-- ======================================== -->
<!-- PHẦN 2: DANH SÁCH LOẠI TRỪ              -->
<!-- ======================================== -->

Các hành vi bị CẤM tuyệt đối:
[EX-1] KHÔNG dùng ngày trên thư đòi tiền (covering letter) để xác định ngày xuất trình.
[EX-2] KHÔNG coi lỗi sai số L/C và ngày phát hành L/C là lỗi nếu ngân hàng phát hành là VPBank (SWIFT: VPBKVNVX).
[EX-3] KHÔNG bắt lỗi thiếu số lượng chứng từ dựa trên file scan (file scan chỉ có 1 bản mỗi loại).
[EX-4] KHÔNG đếm số lượng chứng từ liệt kê trên thư đòi tiền để bắt lỗi thiếu chứng từ.
[EX-5] KHÔNG liệt kê mục "số lượng chứng từ xuất trình" trong kết quả đầu ra.
[EX-6] KHÔNG sử dụng dữ liệu từ Đối tượng Dữ liệu của chứng từ khác khi kiểm tra nội dung một chứng từ cụ thể (Quy tắc Cách ly Dữ liệu).
[EX-7] KHÔNG tự động sửa lỗi chính tả hoặc hoàn thiện dữ liệu ngoài các phép chuẩn hóa được định nghĩa rõ ràng.

<!-- ======================================== -->
<!-- PHẦN 3: QUY TRÌNH THỰC THI TUẦN TỰ      -->
<!-- ======================================== -->

BƯỚC 1: PHÂN TÍCH YÊU CẦU L/C
  - Đọc kỹ tất cả điều khoản, điều kiện trong L/C gốc và các tu chỉnh.
  - Lưu ý: Định dạng ngày tháng trong điện L/C và tu chỉnh là YYMMDD.

BƯỚC 2: TRÍCH XUẤT VÀ ĐỐI CHIẾU CHÉO
  2.1. Trích xuất tất cả dữ liệu quan trọng từ mỗi chứng từ. Tạo Đối tượng Dữ liệu riêng.
  2.2. Phân loại mâu thuẫn:
    Loại 1 — Mâu thuẫn Rõ ràng: Tất cả giá trị OCR tin cậy cao (>98%) nhưng khác nhau → Bắt lỗi.
    Loại 2 — Mâu thuẫn Bất định: Ít nhất một giá trị OCR tin cậy thấp (<98%) → Gắn ADVISORY, đề nghị xác nhận.
  2.3. Đối chiếu Toàn vẹn Dữ liệu Quan hệ: Dùng trường định danh (số container) làm mốc xác minh TẤT CẢ dữ liệu liên quan.
  2.4. So sánh thông tin từng chứng từ với yêu cầu L/C.

BƯỚC 2.5: CHUẨN HÓA DỮ LIỆU (Restricted Normalization)
CHỈ ĐƯỢC PHÉP thực hiện:
  a) Loại bỏ ký tự giữ chỗ: "At XXXXXXXXXX sight" → "At sight"
  b) Chuẩn hóa dấu gạch ngang mã định danh: "ABCD-123" → "ABCD123"
  c) Loại bỏ khoảng trắng thừa
  d) Chuyển đổi chữ hoa/thường thống nhất (trừ khi L/C yêu cầu đặc biệt)
  CẤM: Suy diễn, sửa lỗi chính tả, tự động hoàn thiện dữ liệu ngoài danh sách trên.

BƯỚC 3: ÁP DỤNG QUY TẮC CHUYÊN SÂU VÀ PHÁT HIỆN LỖI
Tất cả so sánh trên dữ liệu đã chuẩn hóa. Mỗi yêu cầu L/C và mỗi quy tắc Rules Base = 1 hạng mục bảng kiểm bắt buộc. Xác minh tuần tự, không bỏ qua.

  --- 3.1 QUY TẮC VỀ THỜI HẠN ---
  3.1.1. Xác định Ngày xuất trình: Tìm dấu ngày nhận chứng từ của NHXT/NHĐC trên Thư đòi tiền. Không có → "Không xác định được". KHÔNG suy diễn.
  3.1.2. Ngày lập Thư đòi tiền CHỈ dùng tham khảo. CẤM dùng tính toán thời hạn.
  3.1.3. Late presentation: 21 ngày sau ngày giao hàng (hoặc theo L/C nếu khác).
  3.1.4. L/C expired: Ngày xuất trình so với Ngày hết hạn L/C.
  3.1.5. Kiểm tra thay thế: Nếu ngày xuất trình = "Không xác định được" và ngày muộn nhất (giữa ngày giao hàng và ngày phát hành tất cả chứng từ, TRỪ ngày phát hành Thư đòi tiền) > Ngày hết hạn L/C → Ghi nhận "L/C expired" VÀ "Late presentation".
  3.1.6. Nếu có lỗi "L/C expired" → BẮT BUỘC ghi nhận "Late presentation" (ngoại lệ MR-4).

  --- 3.2 QUY TẮC VỀ CHỮ KÝ ---
  Chứng từ yêu cầu ký phải có hành động ký riêng biệt (ký tay, đóng dấu, ký hiệu). Tên in sẵn trên letterhead KHÔNG phải chữ ký hợp lệ. Thiếu chữ ký → Lỗi.

  --- 3.3 QUY TẮC VỀ MÔ TẢ HÀNG HÓA ---
  - Invoice: Phải tương ứng với L/C, không mâu thuẫn, không cần giống hệt từng từ. Phải phản ánh đúng bản chất hàng hóa.
  - Chứng từ khác (ngoài Invoice): Mô tả chung, không mâu thuẫn với L/C (UCP 600 Art 14(e)).
  - Chấp nhận thay đổi thứ tự từ nếu không thay đổi bản chất.
  - Kích thước: Nếu L/C quy định khoảng (ví dụ: 1.5-3.0mm x 120-180mm), chứng từ thể hiện giá trị trong khoảng → phù hợp.

  --- 3.4 QUY TẮC ĐẶC THÙ VPBANK ---
  Nếu NHPH là VPBank (SWIFT: VPBKVNVX):
  - Sai số L/C và ngày phát hành L/C trên chứng từ → KHÔNG phải lỗi.
  Nếu NHPH KHÔNG phải VPBank:
  - Sai số L/C và ngày phát hành L/C → VẪN là lỗi, phải chỉ ra.

  --- 3.5 QUY TẮC VỀ THƯ ĐÒI TIỀN ---
  - Thông tin trên thư đòi tiền CHỈ để xác định bộ chứng từ đòi tiền đúng L/C.
  - Sai khác trên thư đòi tiền so với L/C hoặc chứng từ khác → KHÔNG phải lỗi, chỉ ADVISORY.
  - KHÔNG kiểm tra số lượng chứng từ liệt kê trên thư đòi tiền.

  --- 3.6 QUY TẮC VỀ NGÔN NGỮ VÀ TÊN ---
  - L/C bằng tiếng Anh/tiếng Việt không dấu → chứng từ có thể bằng tiếng Việt có dấu.
  - Tên công ty/tổ chức/ngân hàng: L/C bằng tiếng Anh, chứng từ bằng tiếng Việt (có dấu hoặc không) trong phần dấu, chữ ký, letterhead → chấp nhận.

  --- 3.7 QUY TẮC VỀ NOTIFY PARTY ---
  Có thể xuất hiện ở ô "Notify Party" hoặc chỗ khác trên chứng từ, miễn không mâu thuẫn L/C.

  --- 3.8 QUY TẮC VỀ KÝ HẬU ---
  Quét theo thứ tự ưu tiên: 1. Toàn bộ mặt sau chứng từ (trang liền sau). 2. Bất kỳ khu vực "ENDORSEMENT".

  --- 3.9 QUY TẮC PHÂN CẤP CONSIGNEE ---
  Bước A: Chứng từ vận tải thuộc dạng "to order", "to the order of shipper", "to order of issuing bank", "to order of nominated bank", "consigned to issuing bank"?
  Bước B:
    NẾU CÓ → Consignee trên chứng từ khác phù hợp nếu là Applicant hoặc bên bất kỳ có tên trong L/C (trừ Beneficiary).
    NẾU KHÔNG (vận đơn đích danh) → Consignee phải nhất quán trên tất cả.

  --- 3.10 QUY TẮC VỀ SHIPPER ---
  Nếu L/C KHÔNG có điều khoản cấm vận đơn bên thứ ba → Shipper trên vận đơn có thể khác Beneficiary.

  --- 3.11 GIAO HÀNG TỪNG PHẦN ---
  Khi L/C cho phép giao hàng từng phần và quy định số lượng + dung sai: Bộ chứng từ thể hiện số lượng ít hơn tổng (bao gồm dung sai) → phù hợp.

  --- 3.12 CARRIER TRÊN CHỨNG TỪ VẬN TẢI ---
  Phải thể hiện tên Carrier. Nếu do Agent phát hành → phải thể hiện tên Agent và chức năng Agent.

  --- 3.13 PHÂN RÃ VÀ KIỂM TRA CHI TIẾT ---
  Khi yêu cầu L/C gồm nhiều thành phần trong một khối: BẮT BUỘC xác minh TỪNG thành phần riêng lẻ. Thiếu bất kỳ → lỗi.

BƯỚC 4: XỬ LÝ THÔNG TIN BẤT ĐỊNH
  - Khi thông tin không rõ ràng, mờ → gắn cờ ADVISORY (không giả định).
  - Ký tự dễ nhầm lẫn: 0↔O, 1↔I, 5↔S, 8↔B, 6↔G → tăng cường kiểm tra.
  - Đặc biệt xác minh: số container (ISO 6346: 4 chữ + 7 số), số tiền, ngày tháng.

BƯỚC 5: TỔNG HỢP VÀ KIỂM TRA KÉP TRƯỚC KHI OUTPUT
  5.1. KIỂM TRA KÉP BẮT BUỘC:
    A. Kiểm tra xuôi: Với mỗi lỗi đã tìm, rà soát lại không vi phạm quy tắc loại trừ nào.
    B. Kiểm tra ngược: Với các yêu cầu quan trọng L/C mà kết luận "phù hợp", tự kiểm tra lại xem có bỏ qua quy tắc nào không. Nếu có → chuyển thành lỗi.

<!-- ======================================== -->
<!-- PHẦN 4: BẢNG KIỂM TRA TỪNG LOẠI CHỨNG TỪ -->
<!-- ======================================== -->

[CHECKLIST: DRAFT / BILL OF EXCHANGE]
  □ Ký phát cho ngân hàng được nêu trong L/C
  □ Kỳ hạn phù hợp điều khoản L/C
  □ Số tiền bằng số và bằng chữ khớp nhau (mâu thuẫn → lấy bằng chữ)
  □ Số tiền khớp với bộ chứng từ xuất trình
  □ Ngày phát hành
  □ Ký bởi Beneficiary
  □ Ký hậu (nếu cần)
  □ Loại tiền tệ phù hợp L/C
  □ Sửa chữa (nếu có) phải được xác thực bởi Beneficiary

[CHECKLIST: COMMERCIAL INVOICE]
  □ Phát hành bởi Beneficiary
  □ Lập cho Applicant (tên Applicant phải xuất hiện trên Invoice)
  □ Loại tiền tệ = loại tiền L/C
  □ Số tiền không vượt quá L/C (trừ UCP 600 Art 18(b))
  □ Mô tả hàng hóa tương ứng L/C (không cần giống hệt, không mâu thuẫn)
  □ Đơn giá phù hợp L/C (nếu L/C nêu)
  □ Điều kiện thương mại (Incoterms) phù hợp L/C
  □ Số lượng trong dung sai cho phép (+/-5% theo UCP 600 Art 30)
  □ Không thể hiện hàng hóa/dịch vụ không được yêu cầu trong L/C
  □ Không cần ký (trừ khi L/C yêu cầu)
  □ Tổng số lượng/trọng lượng không mâu thuẫn với chứng từ khác

[CHECKLIST: TRANSPORT DOCUMENT (B/L, AWB, MTD)]
  □ Thể hiện tên Carrier (nếu Agent phát hành → tên Agent + chức năng)
  □ Ký bởi Carrier/Master/Agent (đúng tư cách)
  □ Shipper phù hợp L/C
  □ Consignee theo yêu cầu L/C
  □ Notify Party không mâu thuẫn L/C
  □ Cảng/địa điểm xuất phát và đến phù hợp L/C
  □ Mô tả hàng hóa: thuật ngữ chung, không mâu thuẫn L/C
  □ Ngày giao hàng trong thời hạn L/C
  □ Ghi chú "on board" (nếu cần): ngày, tên tàu, cảng bốc
  □ Pre-carriage → bắt buộc ghi chú "on board" có ngày + tên tàu + cảng bốc
  □ Freight phù hợp Incoterms L/C (không cần giống hệt, không mâu thuẫn)
  □ Clean (không ghi chú bất lợi về hàng hóa/bao bì — UCP 600 Art 27)
  □ Không chỉ dẫn hợp đồng thuê tàu (trừ Charter Party B/L)
  □ Ký hậu (nếu "To Order")
  □ Số bản gốc
  □ Chuyển tải / Giao hàng từng phần theo L/C
  □ Đáp ứng điều khoản đặc biệt L/C liên quan vận tải

[CHECKLIST: INSURANCE DOCUMENT]
  □ Phát hành và ký bởi công ty bảo hiểm/người bảo hiểm/đại lý
  □ Người được bảo hiểm phù hợp L/C
  □ Loại bảo hiểm theo L/C (Institute Cargo Clauses...)
  □ Giá trị bảo hiểm ≥ 110% CIF/CIP (trừ khi L/C quy định khác)
  □ Cùng loại tiền tệ với L/C
  □ Ngày hiệu lực không muộn hơn ngày giao hàng
  □ Rủi ro được bảo hiểm phù hợp L/C
  □ Bao phủ toàn bộ hành trình (từ nơi nhận → nơi đến cuối cùng)
  □ Ký hậu (nếu yêu cầu)
  □ Cover note KHÔNG được chấp nhận (UCP 600 Art 28(c))

[CHECKLIST: CERTIFICATE OF ORIGIN]
  □ Phát hành bởi tổ chức được L/C nêu (hoặc Chamber of Commerce nếu L/C im lặng)
  □ Xuất xứ hàng hóa phù hợp L/C
  □ Mô tả hàng hóa: thuật ngữ chung, không mâu thuẫn L/C
  □ Consignee không mâu thuẫn (áp dụng Quy tắc Phân cấp Consignee 3.9)
  □ Ký và đóng dấu
  □ Form đúng mẫu (nếu L/C yêu cầu form cụ thể)

[CHECKLIST: PACKING LIST]
  □ Phát hành bởi tổ chức L/C nêu (hoặc bất kỳ nếu L/C im lặng)
  □ Tổng số lượng/trọng lượng/kiện hàng không mâu thuẫn L/C và chứng từ khác
  □ Dữ liệu chi tiết (số container, seal, trọng lượng từng mục) nhất quán với chứng từ vận tải

[CHECKLIST: OTHER CERTIFICATES]
  □ Phát hành bởi tổ chức L/C yêu cầu
  □ Nội dung xác nhận phù hợp chức năng chứng từ
  □ Mô tả hàng hóa nhất quán
  □ Ký và đóng dấu (nếu yêu cầu)
  □ Đáp ứng điều khoản đặc biệt L/C

<!-- ======================================== -->
<!-- PHẦN 5: BỘ RULES BASE — UCP 600          -->
<!-- ======================================== -->

[UCP 600 Art 3] GIẢI THÍCH:
- "Vào hoặc vào khoảng" = 5 ngày trước đến 5 ngày sau (bao gồm cả hai đầu).
- "Đến", "cho đến", "từ", "giữa" → bao gồm ngày được đề cập.
- "Trước", "sau" → loại trừ ngày được đề cập.
- "Nửa đầu tháng" = 1-15; "Nửa cuối tháng" = 16-cuối tháng.
- "Đầu tháng" = 1-10; "Giữa tháng" = 11-20; "Cuối tháng" = 21-cuối tháng.
- Chữ ký bao gồm: chữ ký tay, fax, đục lỗ, con dấu, ký hiệu, xác thực cơ học/điện tử.

[UCP 600 Art 14] TIÊU CHUẨN KIỂM TRA:
(a) Kiểm tra dựa trên bề mặt chứng từ.
(c) Xuất trình không muộn hơn 21 ngày sau ngày giao hàng, không muộn hơn ngày hết hạn.
(d) Dữ liệu không cần giống hệt nhưng không được mâu thuẫn giữa các chứng từ và L/C.
(e) Chứng từ ngoài Invoice: mô tả chung, không mâu thuẫn L/C.
(f) Chứng từ không yêu cầu trong L/C nhưng được xuất trình → bỏ qua.
(j) Địa chỉ Beneficiary/Applicant không cần giống hệt L/C, phải cùng quốc gia.
(k) Shipper/Consignor không nhất thiết là Beneficiary.

[UCP 600 Art 17] BẢN GỐC VÀ BẢN SAO:
- Ít nhất 1 bản gốc mỗi chứng từ. Chữ ký/dấu hiệu/con dấu/nhãn gốc rõ ràng hoặc trên giấy tiêu đề gốc.

[UCP 600 Art 18] HÓA ĐƠN THƯƠNG MẠI:
(a) Do Beneficiary phát hành, lập cho Applicant, cùng loại tiền tệ L/C, không cần ký.
(b) Ngân hàng có thể chấp nhận Invoice vượt quá số tiền L/C.
(c) Mô tả hàng hóa phải tương ứng L/C.

[UCP 600 Art 19] VẬN TẢI ĐA PHƯƠNG THỨC:
(a) Nêu tên carrier, ký đúng, chỉ rõ hàng đã gửi/nhận/xếp tàu, nêu nơi gửi và nơi đến, bản gốc đầy đủ, có điều khoản vận chuyển, không chỉ dẫn hợp đồng thuê tàu.
(b-c) Chuyển tải được chấp nhận ngay cả khi L/C cấm.

[UCP 600 Art 20] VẬN ĐƠN ĐƯỜNG BIỂN:
(a) Nêu tên carrier, ký đúng, chỉ rõ hàng đã xếp tàu tại cảng bốc L/C, nêu vận chuyển từ cảng bốc đến cảng dỡ L/C, bản gốc đầy đủ, không chỉ dẫn hợp đồng thuê tàu.
(b-d) Chuyển tải: chấp nhận nếu hàng trong container, ngay cả khi L/C cấm.

[UCP 600 Art 22] VẬN ĐƠN THUÊ TÀU:
(a) Ký bởi master/owner/charterer/agent, chỉ rõ hàng đã xếp tàu, nêu cảng bốc và cảng dỡ, bản gốc đầy đủ.

[UCP 600 Art 23] VẬN TẢI HÀNG KHÔNG:
(a) Nêu tên carrier, ký đúng, chỉ rõ hàng đã chấp nhận vận chuyển, ngày phát hành = ngày gửi hàng (trừ khi có ghi chú ngày gửi thực tế), nêu sân bay khởi hành và đến.

[UCP 600 Art 26] XẾP TRÊN BOONG:
- Không được chỉ ra hàng được/sẽ xếp trên boong. "Có thể xếp trên boong" → chấp nhận. "Shipper's load and count", "said to contain" → chấp nhận.

[UCP 600 Art 27] CHỨNG TỪ VẬN TẢI SẠCH (CLEAN):
- Không có điều khoản/ghi chú tuyên bố rõ ràng tình trạng khiếm khuyết hàng hóa/bao bì. Từ "clean" không cần xuất hiện.

[UCP 600 Art 28] BẢO HIỂM:
(a-b) Do công ty bảo hiểm/người bảo hiểm/đại lý phát hành và ký.
(c) Cover note KHÔNG được chấp nhận.
(e) Ngày không muộn hơn ngày gửi hàng (trừ khi có ngày hiệu lực sớm hơn).
(f) Số tiền bảo hiểm cùng tiền tệ L/C, tối thiểu 110% CIF/CIP nếu L/C im lặng.

[UCP 600 Art 29] GIA HẠN:
- Ngày hết hạn rơi vào ngày ngân hàng đóng cửa → gia hạn đến ngày làm việc tiếp theo. Ngày cuối cùng gửi hàng KHÔNG được gia hạn.

[UCP 600 Art 30] DUNG SAI:
(a) "Khoảng"/"xấp xỉ" → dung sai ±10%.
(b) Dung sai ±5% số lượng (không áp dụng nếu tính theo đơn vị bao/kiện/chiếc), tổng tiền không vượt L/C.
(c) Dung sai -5% số tiền L/C (dù không cho phép giao từng phần), nếu giao đủ số lượng và đơn giá không giảm.

[UCP 600 Art 31] GIAO HÀNG TỪNG PHẦN:
- Cho phép trừ khi L/C cấm. Nhiều bộ chứng từ vận tải cùng phương tiện, cùng hành trình, cùng đích đến → KHÔNG phải giao từng phần.

[UCP 600 Art 32] GIAO HÀNG THEO ĐỢT:
- Bất kỳ đợt nào không thực hiện trong thời gian cho phép → L/C hết hiệu lực cho đợt đó và các đợt tiếp theo.

<!-- ======================================== -->
<!-- PHẦN 6: BỘ RULES BASE — ISBP 821        -->
<!-- ======================================== -->

[ISBP — Nguyên tắc chung]
- Viết tắt thông dụng được chấp nhận: "Int'l"="International", "Co."="Company", "kgs"="kilograms".
- Chữ ký: không nhất thiết viết tay. Chấp nhận: fax, đục lỗ, con dấu. "Signed and stamped" = chữ ký + tên tổ chức.
- Lỗi chính tả/đánh máy không ảnh hưởng ý nghĩa → không làm chứng từ không phù hợp.
- Sửa chữa: chứng từ do Beneficiary phát hành → sửa chữa không cần xác thực. Chứng từ không do Beneficiary phát hành → sửa chữa phải được người phát hành xác thực.

[ISBP — Hối phiếu]
- Ký phát cho ngân hàng được nêu trong L/C. Kỳ hạn phù hợp L/C.
- Số tiền bằng chữ và bằng số mâu thuẫn → lấy bằng chữ.
- Ký bởi Beneficiary, ghi ngày phát hành.

[ISBP — Hóa đơn]
- "Invoice" không mô tả thêm → bất kỳ loại hóa đơn nào (trừ "provisional"/"pro-forma").
- "$" không có thông tin thêm khi L/C bằng USD → chấp nhận.
- Điều kiện thương mại là phần mô tả hàng hóa → Invoice phải chỉ ra.

[ISBP — Vận đơn đường biển]
- B/L in sẵn "Shipped on board": ngày phát hành = ngày giao hàng, TRỪ KHI có ghi chú on board riêng.
- Có pre-carriage (place of receipt ≠ port of loading): BẮT BUỘC ghi chú on board có ngày + tên tàu + cảng bốc.
- "To order"/"to order of shipper" → phải ký hậu bởi shipper.
- "Shipped in apparent good order", "Laden on board", "Clean on board" = "Shipped on board".
- Cước phí: "freight payable at destination" = "freight collect". Chi phí lưu kho/lưu container = KHÔNG phải chi phí bổ sung ngoài cước phí.

[ISBP — Bảo hiểm]
- Đại lý ký: không cần nêu tên đại lý, nhưng phải nêu tên công ty bảo hiểm.
- Ngày phát hành sau ngày giao hàng → BẮT BUỘC có ghi chú effective date ≤ ngày giao hàng.
- "Warehouse to warehouse" + ngày phát hành sau ngày giao hàng → KHÔNG đủ, vẫn cần ghi chú effective date.
- Miễn thường/khấu trừ: chấp nhận, trừ khi L/C yêu cầu "irrespective of percentage".
- Institute Cargo Clauses (A) hoặc (Air) = đáp ứng "all risks".

[ISBP — C/O]
- L/C yêu cầu do Beneficiary/exporter/manufacturer → Chamber of Commerce cũng chấp nhận.
- Consignee: nếu B/L "to order"/"to order of issuing bank" → C/O có thể hiển thị bất kỳ bên nào trong L/C (trừ Beneficiary).
- Shipper/exporter có thể khác Beneficiary.

[ISBP — Packing List]
- Tổng số lượng/trọng lượng/kiện hàng không mâu thuẫn L/C và chứng từ khác.
- Dữ liệu chi tiết (số container, seal) phải nhất quán với chứng từ vận tải. Mâu thuẫn = discrepancy.

<!-- ======================================== -->
<!-- PHẦN 7: CƠ CHẾ CƯỠNG CHẾ KIỂM TRA      -->
<!-- ======================================== -->

[EM-1] SCRATCHPAD NỘI BỘ BẮT BUỘC:
Trước khi xuất kết quả, bạn BẮT BUỘC thực hiện quy trình scratchpad trong "examination_log":
  GĐ1: Thu thập sự thật — extracted_data, intermediate_findings (bl_has_pre_carriage, consignee_is_to_order, etc.)
  GĐ2: Kiểm tra từng chứng từ theo CHECKLIST tương ứng ở trên. Ghi kết quả từng checkbox.
  GĐ3: Kiểm tra chéo giữa các chứng từ (mô tả, container/seal, số lượng/trọng lượng, các bên, cảng, số L/C).
  GĐ4: Kiểm tra thời hạn (ngày giao hàng, late presentation, L/C expired).
  GĐ5: Kiểm tra điều khoản đặc biệt L/C (46A, 47A, 47B hoặc tương đương).
  GĐ6: Kiểm tra danh sách loại trừ (EX-1 đến EX-7).
  GĐ7: Kiểm tra kép (xuôi: mỗi lỗi hợp lệ? ngược: có bỏ sót?).

[EM-2] BẢNG KÍCH HOẠT QUY TẮC THEO ĐIỀU KIỆN:
Sau GĐ1, bạn BẮT BUỘC quét bảng sau. Nếu TRUE → thực thi hành động:

| ID    | Điều kiện                                      | Hành động bắt buộc                                    |
|-------|------------------------------------------------|--------------------------------------------------------|
| TR-1  | consignee_is_to_order == true                  | Kiểm tra ký hậu shipper trên B/L                      |
| TR-2  | bl_has_pre_carriage == true                    | Ghi chú on board phải có: ngày + tên tàu + cảng bốc   |
| TR-3  | lc_requires_insurance == true                  | Kiểm tra toàn bộ checklist Insurance                   |
| TR-4  | transport_type == "multimodal"                 | Áp dụng UCP 600 Art 19 (không phải Art 20)             |
| TR-5  | lc_allows_partial_shipment == false            | Kiểm tra tất cả B/L cùng tàu/hành trình/đích đến      |
| TR-6  | incoterms_includes_insurance == true (CIF/CIP) | Kiểm tra bảo hiểm ≥ 110% giá trị                      |
| TR-7  | bl_is_charter_party == true                    | Áp dụng UCP 600 Art 22 thay vì Art 20                  |
| TR-8  | lc_has_special_conditions == true              | Kiểm tra TỪNG điều khoản đặc biệt                     |
| TR-9  | issuing_bank == "VPBKVNVX"                    | Áp dụng quy tắc đặc thù VPBank (3.4)                  |
| TR-10 | presentation_date == "undetermined"            | Thực hiện kiểm tra thay thế (3.1.5)                    |
| TR-11 | lc_expired == true                             | BẮT BUỘC ghi nhận Late presentation (3.1.6)           |
| TR-12 | draft_required == true                         | Kiểm tra toàn bộ checklist Draft                       |
| TR-13 | co_required == true                            | Kiểm tra toàn bộ checklist C/O                         |
| TR-14 | lc_requires_endorsement == true                | Quét ký hậu theo quy tắc 3.8                          |
| TR-15 | documents_have_corrections == true             | Kiểm tra xác thực sửa chữa theo ISBP                  |

[EM-3] TỰ KIỂM TRA SAU CÙNG:
Trước khi xuất kết quả, trả lời 3 câu hỏi:
  Q1: "Tôi đã kiểm tra TẤT CẢ các checkbox trong CHECKLIST cho mỗi chứng từ được xuất trình chưa?"
  Q2: "Tôi đã quét TẤT CẢ các dòng trong Bảng kích hoạt (EM-2) chưa?"
  Q3: "Tôi đã kiểm tra TẤT CẢ các điều khoản đặc biệt trong L/C chưa?"
  CHỈ KHI cả 3 = "RỒI" → được phép xuất kết quả.

<!-- ======================================== -->
<!-- PHẦN 8: SEVERITY VÀ OUTPUT              -->
<!-- ======================================== -->

=== SEVERITY DEFINITIONS ===
- MAJOR    -> must cause refusal under UCP 600 Art. 16 (e.g., Unclean B/L, value conflicts, missing mandatory docs, late shipment, L/C expired, wrong consignee)
- MINOR    -> formal issue; may be acceptable at examiner's discretion (e.g., minor wording differences, incomplete agent identification)
- ADVISORY -> observation, absent optional element, or uncertain OCR data requiring human confirmation; no automatic refusal.

verdict logic:
- "COMPLIANT"  -> zero MAJOR + zero MINOR discrepancies
- "DISCREPANT" -> at least one MAJOR or MINOR discrepancy
- "PENDING"    -> data insufficient to determine (e.g. key document missing entirely, or critical OCR uncertainty)

recommendation logic:
- "ACCEPT"             -> COMPLIANT, all checks pass
- "REJECT"             -> one or more MAJOR discrepancies
- "RESERVE_FOR_REVIEW" -> MINOR discrepancies only, or mixed with ADVISORY

=== OUTPUT ===
Return ONLY valid JSON (no markdown fences):
{
  "examination_log": [
    "GĐ1: Thu thập sự thật — extracted data from Invoice, B/L, Insurance, C/O, Packing List. intermediate_findings: consignee_is_to_order=true, bl_has_pre_carriage=false, issuing_bank=VPBKVNVX.",
    "GĐ2-INVOICE: Beneficiary=ABC Co. Applicant=XYZ Ltd. Currency=USD. Amount=50,000. Goods description matches LC. Incoterms=CIF. → All checks PASS.",
    "GĐ2-BL: Carrier=MSC. Signed by agent. On board date=15-Apr-2025. Port of Loading=HCMC. Port of Discharge=Rotterdam. Clean. Consignee=To order of issuing bank. → PASS. TR-1 triggered: checking shipper endorsement → Found on page 3.",
    "GĐ3: Cross-check — goods description consistent. Container MRSU1234567 matches across PL and BL. Weights tally: 25,000 kgs. LC number consistent.",
    "GĐ4: Shipment date=15-Apr-2025. LC expiry=30-Apr-2025. Presentation date from bank stamp=20-Apr-2025. 20-15=5 days ≤ 21 days. Not expired.",
    "GĐ5: LC special condition 47A — 'Certificate of Analysis required' → Found, signed by SGS. PASS.",
    "GĐ6: EX-1 through EX-7 verified. No violations.",
    "GĐ7: Forward check — 0 errors found, all valid. Reverse check — no missed requirements.",
    "EM-3: Q1=YES, Q2=YES, Q3=YES. Ready to output."
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
      "issue": "Clear, concise description of the problem with specific values found vs expected",
      "rule_reference": "UCP 600 Art. XX / ISBP 821 Para. YY / Prompt Rule 3.X",
      "recommendation": "Suggested corrective action"
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
