// lib/pipelines/workflows/prompts/account-opening-prompts.ts
// Segment/Product config + Types + Prompt builders cho workflow Account Opening
// (Tiếp nhận, phân loại và đánh giá bộ hồ sơ mở tài khoản của khách hàng).
//
// Kiến trúc:
//   - ACCOUNT_SEGMENTS: phân khúc khách hàng (KHCN, HKD, SME, KHDN). Phân khúc
//     quyết định bộ chứng từ, trọng tâm đối chiếu và bộ rule áp dụng.
//   - ACCOUNT_PRODUCTS: sản phẩm tài khoản. MỖI sản phẩm thuộc đúng một phân
//     khúc và gắn:
//       + requiredDocs: checklist template (loại chứng từ cần có)
//       + evaluationPrompt: prompt LLM để dựng Customer Profile + chấm checklist
//         + đối chiếu chéo (cross-check)
//   - buildClassifyPrompt     : phân loại 1 file vào các loại chứng từ của sản phẩm
//   - buildMultiExtractPrompt : bóc tách gộp field theo preset của từng loại
//   - buildEvaluatePrompt     : dựng Customer Profile + checklist + cross-check (LLM)
//
// Mỗi builder trả về { _prompt: "..." } — bypass DB connector template.

import { EXTRACT_PRESETS } from '@/lib/endpoints/presets';
// Tiện ích nén JSON dùng chung giữa các workflow hồ sơ (không mang nghiệp vụ vay).
import { isEmptyValue, pruneEmptyDeep } from './loan-appraisal-prompts';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Types: cấu hình phân khúc & sản phẩm ──────────────────────────────────────

/** Phân khúc khách hàng mở tài khoản. */
export type CustomerSegmentKey = 'KHCN' | 'HKD' | 'SME' | 'KHDN';

/** Nhóm hiển thị trên Customer Profile (master data của hồ sơ mở tài khoản). */
export type ProfileGroup =
  | 'identity'
  | 'contact'
  | 'organization'
  | 'authorization'
  | 'ownership'
  | 'compliance'
  | 'account';

export interface DocRequirement {
  /** Khóa duy nhất của mục checklist (dùng cho classify + UI). */
  key: string;
  /** Nhãn hiển thị (VD "Giấy đề nghị mở tài khoản"). */
  label: string;
  /** Khóa preset trong EXTRACT_PRESETS để lấy field bóc tách. */
  presetKey: keyof typeof EXTRACT_PRESETS;
  /** Bắt buộc hay tùy chọn trong hồ sơ của sản phẩm này. */
  required: boolean;
  /** Nhóm Customer Profile mà chứng từ này bổ sung dữ liệu. */
  group: ProfileGroup;
  /** Mô tả ngắn — đưa vào prompt phân loại & đánh giá. */
  description: string;
  /**
   * Chứng từ định danh có thời hạn (CCCD, hộ chiếu, visa, thẻ tạm trú). Stage
   * đánh giá điều kiện dùng cờ này để tìm ngày hết hạn cần kiểm tra.
   */
  identityDocument?: boolean;
}

export interface AccountSegment {
  key: CustomerSegmentKey;
  name: string;
  description: string;
  /** Khách hàng là tổ chức (cần người đại diện, chủ sở hữu hưởng lợi). */
  isOrganization: boolean;
}

export interface AccountProduct {
  code: string;
  segmentKey: CustomerSegmentKey;
  name: string;
  description: string;
  /** Loại tài khoản đề xuất khi hồ sơ đủ điều kiện. */
  accountType: string;
  /** Checklist template — loại chứng từ yêu cầu cho sản phẩm. */
  requiredDocs: DocRequirement[];
  /**
   * Prompt LLM cho bước đánh giá (Customer Profile + checklist + cross-check).
   * Placeholder: {{segment_name}} {{product_name}} {{checklist}} {{classification}} {{extracted_data}}
   */
  evaluationPrompt: string;
}

// ─── Types: kết quả runtime ─────────────────────────────────────────────────────

/** Một loại chứng từ (mục checklist) được phát hiện trong 1 file. */
export interface DocMatch {
  key: string;
  label: string;
  confidence: number;
}

/**
 * Kết quả phân loại của MỘT file. Một file có thể chứa NHIỀU loại chứng từ
 * trong checklist (multi-label), nên matches là mảng.
 */
export interface ClassifiedDoc {
  file_name: string;
  matches: DocMatch[];
  status: 'classified' | 'unknown' | 'error';
  reason?: string;
}

export interface ExtractedDoc {
  file_name: string;
  doc_type_key: string;
  doc_type_label: string;
  status: 'success' | 'error';
  data?: unknown;
  error?: string;
}

export interface ChecklistItemResult {
  key: string;
  label: string;
  required: boolean;
  status: 'present' | 'missing' | 'review';
  found_in: string[];
  note?: string;
}

export interface CrossCheckFinding {
  severity: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  documents?: string[];
}

/** Master data hợp nhất của hồ sơ mở tài khoản. */
export interface CustomerProfile {
  identity?: Record<string, unknown>;
  contact?: Record<string, unknown>;
  organization?: Record<string, unknown>;
  authorization?: Record<string, unknown>;
  ownership?: Record<string, unknown>;
  compliance?: Record<string, unknown>;
  account?: Record<string, unknown>;
}

export interface OnboardingEvaluation {
  customer_profile: CustomerProfile;
  checklist: ChecklistItemResult[];
  completeness_percent: number;
  cross_check: CrossCheckFinding[];
  risk_notes: string[];
  overall_assessment: string;
}

/** Kết quả cơ bản trả về client (extracted_data của operation). */
export interface AccountOpeningResult extends OnboardingEvaluation {
  segment_key: CustomerSegmentKey;
  segment_name: string;
  product_code: string;
  product_name: string;
  documents: ClassifiedDoc[];
}

// ─── Phân khúc khách hàng ──────────────────────────────────────────────────────

export const ACCOUNT_SEGMENTS: Record<CustomerSegmentKey, AccountSegment> = {
  KHCN: {
    key: 'KHCN',
    name: 'Khách hàng cá nhân (KHCN)',
    description: 'Cá nhân mở tài khoản thanh toán cho mục đích tiêu dùng, nhận lương, tiết kiệm.',
    isOrganization: false,
  },
  HKD: {
    key: 'HKD',
    name: 'Hộ kinh doanh (HKD)',
    description: 'Hộ kinh doanh cá thể mở tài khoản phục vụ hoạt động kinh doanh của hộ.',
    isOrganization: false,
  },
  SME: {
    key: 'SME',
    name: 'Doanh nghiệp vừa và nhỏ (SME)',
    description: 'Doanh nghiệp SME mở tài khoản thanh toán, cần người đại diện hợp pháp và kê khai chủ sở hữu hưởng lợi.',
    isOrganization: true,
  },
  KHDN: {
    key: 'KHDN',
    name: 'Khách hàng doanh nghiệp lớn (KHDN)',
    description: 'Doanh nghiệp lớn/tổ chức có cấu trúc sở hữu nhiều tầng, bắt buộc rà soát tăng cường (EDD).',
    isOrganization: true,
  },
};

/** Chuẩn hoá giá trị thô từ pipelineVars: chỉ nhận chuỗi không rỗng. */
function cleanParam(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function getAccountSegment(key: unknown): AccountSegment | null {
  const cleaned = cleanParam(key);
  if (!cleaned) return null;
  return ACCOUNT_SEGMENTS[cleaned.toUpperCase() as CustomerSegmentKey] ?? null;
}

// ─── Catalog chứng từ (dùng lại giữa các sản phẩm) ─────────────────────────────
// Mỗi mục là một loại chứng từ độc lập. Sản phẩm chỉ chọn mục cần và đặt lại cờ
// required cho đúng chính sách của mình (VD FATCA/CRS là tùy chọn với KHCN cư
// trú nhưng bắt buộc với KHCN không cư trú và KHDN).

function requirement(base: DocRequirement, required: boolean): DocRequirement {
  return { ...base, required };
}

const DOC_ACCOUNT_FORM: DocRequirement = {
  key: 'account_form',
  label: 'Giấy đề nghị mở tài khoản / hồ sơ CIF',
  presetKey: 'account-form',
  required: true,
  group: 'account',
  description: 'Biểu mẫu đề nghị mở/đăng ký tài khoản thanh toán, hồ sơ CIF, các mẫu MB (MB03/04/07/08/09/10...) có thông tin khách hàng, người đại diện và dịch vụ đăng ký.',
};

const DOC_SIGNATURE_SPECIMEN: DocRequirement = {
  key: 'signature_specimen',
  label: 'Mẫu chữ ký / mẫu dấu',
  presetKey: 'account-form',
  required: false,
  group: 'account',
  description: 'Phiếu đăng ký mẫu chữ ký của chủ tài khoản, kế toán trưởng và mẫu dấu của tổ chức.',
};

const DOC_ID_DOCUMENT: DocRequirement = {
  key: 'id_document',
  label: 'Giấy tờ định danh chủ tài khoản',
  presetKey: 'id-card',
  required: true,
  group: 'identity',
  description: 'Giấy tờ tùy thân của người mở tài khoản: CCCD, Căn cước điện tử/VNeID, CMND hoặc Hộ chiếu.',
  identityDocument: true,
};

const DOC_PASSPORT: DocRequirement = {
  key: 'passport',
  label: 'Hộ chiếu khách hàng nước ngoài',
  presetKey: 'id-card',
  required: true,
  group: 'identity',
  description: 'Hộ chiếu (Passport) còn hiệu lực của khách hàng nước ngoài / người không cư trú.',
  identityDocument: true,
};

const DOC_ENTRY_PERMIT: DocRequirement = {
  key: 'entry_permit',
  label: 'Thị thực / thẻ tạm trú / thẻ thường trú',
  presetKey: 'id-card',
  required: true,
  group: 'identity',
  description: 'Giấy tờ chứng minh được phép nhập cảnh và thời hạn cư trú tại Việt Nam: visa, thẻ tạm trú, thẻ thường trú hoặc giấy miễn thị thực.',
  identityDocument: true,
};

const DOC_WORK_PERMIT: DocRequirement = {
  key: 'work_permit',
  label: 'Giấy phép lao động / xác nhận công tác',
  presetKey: 'civil-doc',
  required: false,
  group: 'organization',
  description: 'Giấy phép lao động, văn bản xác nhận không thuộc diện cấp giấy phép lao động hoặc xác nhận công tác tại Việt Nam.',
};

const DOC_RESIDENCE_PROOF: DocRequirement = {
  key: 'residence_proof',
  label: 'Xác nhận cư trú / địa chỉ liên hệ',
  presetKey: 'civil-doc',
  required: false,
  group: 'contact',
  description: 'Giấy xác nhận thông tin về cư trú (CT07/CT08), sổ hộ khẩu, hợp đồng thuê nhà hoặc giấy tờ chứng minh địa chỉ liên hệ.',
};

const DOC_LEGAL_REP_ID: DocRequirement = {
  key: 'legal_rep_id',
  label: 'Giấy tờ định danh người đại diện theo pháp luật',
  presetKey: 'id-card',
  required: true,
  group: 'identity',
  description: 'CCCD/CMND/Hộ chiếu của người đại diện theo pháp luật hoặc người được ủy quyền đứng tên tài khoản của tổ chức.',
  identityDocument: true,
};

const DOC_CHIEF_ACCOUNTANT_ID: DocRequirement = {
  key: 'chief_accountant_id',
  label: 'Giấy tờ định danh kế toán trưởng',
  presetKey: 'id-card',
  required: false,
  group: 'identity',
  description: 'CCCD/CMND/Hộ chiếu của kế toán trưởng hoặc người phụ trách kế toán được đăng ký trên tài khoản.',
  identityDocument: true,
};

const DOC_BUSINESS_REGISTRATION: DocRequirement = {
  key: 'business_registration',
  label: 'GCN đăng ký doanh nghiệp / hộ kinh doanh',
  presetKey: 'business-license',
  required: true,
  group: 'organization',
  description: 'Giấy chứng nhận đăng ký doanh nghiệp, đăng ký hộ kinh doanh, giấy phép thành lập hoặc giấy phép hoạt động của tổ chức.',
};

const DOC_TAX_REGISTRATION: DocRequirement = {
  key: 'tax_registration',
  label: 'Đăng ký mã số thuế',
  presetKey: 'business-license',
  required: false,
  group: 'organization',
  description: 'Giấy chứng nhận đăng ký mã số thuế hoặc thông báo mã số thuế của khách hàng tổ chức/hộ kinh doanh.',
};

const DOC_BUSINESS_LOCATION: DocRequirement = {
  key: 'business_location_proof',
  label: 'Xác nhận địa điểm kinh doanh',
  presetKey: 'business-license',
  required: false,
  group: 'organization',
  description: 'Ảnh/giấy xác nhận địa điểm kinh doanh thực tế: biển hiệu, mặt bằng, hợp đồng thuê địa điểm.',
};

const DOC_COMPANY_CHARTER: DocRequirement = {
  key: 'company_charter',
  label: 'Điều lệ tổ chức',
  presetKey: 'contract',
  required: true,
  group: 'organization',
  description: 'Điều lệ công ty/tổ chức, quy chế hoạt động thể hiện thẩm quyền của người đại diện và cơ chế quyết định.',
};

const DOC_APPOINTMENT_DECISION: DocRequirement = {
  key: 'appointment_decision',
  label: 'Quyết định bổ nhiệm người đại diện / kế toán trưởng',
  presetKey: 'approval',
  required: true,
  group: 'authorization',
  description: 'Quyết định bổ nhiệm người đại diện theo pháp luật, giám đốc, kế toán trưởng hoặc người phụ trách kế toán.',
};

const DOC_AUTHORIZATION: DocRequirement = {
  key: 'authorization_doc',
  label: 'Giấy ủy quyền sử dụng tài khoản',
  presetKey: 'approval',
  required: false,
  group: 'authorization',
  description: 'Giấy/văn bản ủy quyền cho người được ủy quyền giao dịch trên tài khoản, kèm phạm vi và thời hạn ủy quyền.',
};

const DOC_BOARD_RESOLUTION: DocRequirement = {
  key: 'board_resolution',
  label: 'Nghị quyết/biên bản họp về mở tài khoản',
  presetKey: 'approval',
  required: true,
  group: 'authorization',
  description: 'Nghị quyết HĐQT/HĐTV, biên bản họp hoặc quyết định của cấp có thẩm quyền về việc mở và sử dụng tài khoản tại ngân hàng.',
};

const DOC_BENEFICIAL_OWNER: DocRequirement = {
  key: 'beneficial_owner_declaration',
  label: 'Kê khai chủ sở hữu hưởng lợi',
  presetKey: 'account-form',
  required: true,
  group: 'ownership',
  description: 'Tờ khai/biểu mẫu kê khai chủ sở hữu hưởng lợi (beneficial owner) với tỷ lệ sở hữu và thông tin định danh từng người.',
};

const DOC_OWNERSHIP_STRUCTURE: DocRequirement = {
  key: 'ownership_structure',
  label: 'Sơ đồ cấu trúc sở hữu',
  presetKey: 'contract',
  required: true,
  group: 'ownership',
  description: 'Sơ đồ/văn bản mô tả cấu trúc sở hữu, công ty mẹ, cổ đông tổ chức và chuỗi sở hữu đến cá nhân cuối cùng.',
};

const DOC_FATCA_CRS: DocRequirement = {
  key: 'fatca_crs',
  label: 'Tờ khai FATCA / CRS',
  presetKey: 'account-form',
  required: false,
  group: 'compliance',
  description: 'Tờ khai tình trạng cư trú thuế theo FATCA/CRS, tự khai quốc gia cư trú thuế và mã số thuế nước ngoài.',
};

const DOC_SOURCE_OF_FUNDS: DocRequirement = {
  key: 'source_of_funds',
  label: 'Chứng minh nguồn tiền / thu nhập',
  presetKey: 'credit-report',
  required: false,
  group: 'compliance',
  description: 'Bảng kê thu nhập, hợp đồng lao động, sao kê, báo cáo tài chính hoặc tài liệu chứng minh nguồn tiền dự kiến giao dịch.',
};

const DOC_FINANCIAL_STATEMENT: DocRequirement = {
  key: 'financial_statement',
  label: 'Báo cáo tài chính / báo cáo thuế',
  presetKey: 'credit-report',
  required: false,
  group: 'compliance',
  description: 'Báo cáo tài chính, tờ khai thuế hoặc bảng kê doanh thu gần nhất của khách hàng tổ chức.',
};

/**
 * Cam kết chưa đăng ký chữ ký KTT/PTKT — chứng từ THAY THẾ hợp lệ cho
 * chief_accountant_id khi tổ chức chưa bổ nhiệm kế toán trưởng. Đối chiếu với
 * taxonomy đã chạy thật của workflow payment-account-management
 * (mã cam_ket_khong_co_ktt trong shared/documents.ts): chứng từ này phổ biến ở
 * SME nhỏ và KHÔNG đồng nghĩa hồ sơ thiếu sót — checklist/rule cần coi nó là
 * lựa chọn hợp lệ, không phải cờ cảnh báo.
 */
const DOC_CHIEF_ACCOUNTANT_COMMITMENT: DocRequirement = {
  key: 'chief_accountant_commitment',
  label: 'Cam kết chưa đăng ký chữ ký KTT/PTKT',
  presetKey: 'approval',
  required: false,
  group: 'authorization',
  description: 'Văn bản cam kết (văn thư hoặc biên bản họp) của tổ chức về việc chưa bổ nhiệm/chưa đăng ký chữ ký Kế toán trưởng hoặc người phụ trách kế toán, đồng thời miễn trừ trách nhiệm ngân hàng khi chứng từ giao dịch chỉ có chữ ký của người đại diện theo pháp luật/người được ủy quyền.',
};

/**
 * Biên bản giao nhận hồ sơ — chứng từ thủ tục nội bộ giữa khách hàng và ngân
 * hàng khi bàn giao hồ sơ mở/cập nhật tài khoản. Không ảnh hưởng rule đánh giá
 * điều kiện/CDD nào, chỉ dùng để hoàn thiện checklist tiếp nhận.
 */
const DOC_HANDOVER_RECORD: DocRequirement = {
  key: 'handover_record',
  label: 'Biên bản giao nhận hồ sơ',
  presetKey: 'civil-doc',
  required: false,
  group: 'account',
  description: 'Biên bản giao nhận hồ sơ mở/cập nhật tài khoản giữa khách hàng và ngân hàng, có bên giao, bên nhận và danh mục chứng từ bàn giao.',
};

// ─── Prompt đánh giá theo phân khúc ───────────────────────────────────────────
// Khung prompt giống nhau cho mọi phân khúc (để output schema ổn định), phần
// TRỌNG TÂM ĐỐI CHIẾU và nhóm Customer Profile thì khác nhau theo phân khúc.

interface EvaluationPromptSpec {
  segment: AccountSegment;
  /** Mô tả từng nhóm Customer Profile cần hợp nhất cho phân khúc này. */
  profileGuide: string[];
  /** Các câu hỏi đối chiếu chéo trọng tâm của phân khúc. */
  crossCheckFocus: string[];
  /** Skeleton JSON của customer_profile để model trả đúng nhóm field. */
  profileSchema: string;
}

function buildEvaluationPromptTemplate(spec: EvaluationPromptSpec): string {
  return `Bạn là chuyên viên tiếp nhận và kiểm soát hồ sơ mở tài khoản của ngân hàng, phụ trách phân khúc ${spec.segment.name}. Nhiệm vụ: hợp nhất Customer Profile, chấm checklist đủ/thiếu hồ sơ và đối chiếu chéo dữ liệu cho sản phẩm "{{product_name}}" (phân khúc {{segment_name}}).

DANH MỤC HỒ SƠ YÊU CẦU (checklist template):
{{checklist}}

KẾT QUẢ PHÂN LOẠI TÀI LIỆU (mỗi file → loại chứng từ):
{{classification}}

DỮ LIỆU ĐÃ BÓC TÁCH TỪ TỪNG TÀI LIỆU (JSON):
{{extracted_data}}

YÊU CẦU:
1. CUSTOMER PROFILE — hợp nhất thông tin từ mọi chứng từ vào các nhóm sau:
${spec.profileGuide.map((line) => `   - ${line}`).join('\n')}
   Nếu một trường xuất hiện ở nhiều chứng từ, chọn giá trị đầy đủ nhất và KHÔNG bịa. Trường không có dữ liệu thì bỏ qua, không điền "N/A".
2. CHECKLIST — với MỖI mục trong danh mục yêu cầu, xác định status:
   - "present": đã có chứng từ hợp lệ tương ứng.
   - "missing": chưa có chứng từ nào khớp.
   - "review": có chứng từ nhưng dữ liệu thiếu/mờ/hết hạn/cần kiểm tra thủ công.
   Ghi found_in = danh sách tên file khớp; note = giải thích ngắn nếu missing/review.
3. COMPLETENESS — completeness_percent = tỷ lệ % mục BẮT BUỘC có status "present" trên tổng số mục bắt buộc (làm tròn số nguyên).
4. CROSS-CHECK — đối chiếu chéo, phát hiện mâu thuẫn giữa các chứng từ.
   NGUYÊN TẮC QUAN TRỌNG khi so sánh: dữ liệu đến từ OCR nên có thể sai chính tả, thiếu/thừa dấu tiếng Việt, viết hoa/thường khác nhau, sai khoảng trắng, nhầm ký tự tương tự (O↔0, l↔1, S↔5), khác định dạng ngày/số. HÃY SO SÁNH THEO NGHĨA, BỎ QUA các khác biệt nhỏ do OCR/gõ nhầm — coi như KHỚP nếu về bản chất là cùng một giá trị (VD "Nguyen Van A" ≈ "Nguyễn Văn A"; "0123456789" ≈ "O123456789"). CHỈ báo mâu thuẫn khi khác biệt mang tính THỰC CHẤT (khác người, sai số giấy tờ thật sự, khác tên/địa chỉ tổ chức, sai thẩm quyền). TUYỆT ĐỐI không tạo cảnh báo chỉ vì lỗi chính tả/OCR.
   Trọng tâm kiểm tra của phân khúc này:
${spec.crossCheckFocus.map((line) => `   - ${line}`).join('\n')}
5. RISK_NOTES — ghi chú rủi ro tuân thủ/KYC cần lưu ý (mảng chuỗi ngắn), có thể rỗng.
6. OVERALL_ASSESSMENT — 1-2 câu kết luận về mức độ sẵn sàng mở tài khoản của hồ sơ.

CHỈ trả về JSON đúng schema sau, KHÔNG kèm lời dẫn/markdown:
{
  "customer_profile": ${spec.profileSchema},
  "checklist": [
    { "key": "account_form", "label": "Giấy đề nghị mở tài khoản / hồ sơ CIF", "required": true, "status": "present|missing|review", "found_in": ["file.pdf"], "note": "" }
  ],
  "completeness_percent": 0,
  "cross_check": [
    { "severity": "error|warning|info", "title": "...", "message": "...", "documents": ["file.pdf"] }
  ],
  "risk_notes": ["..."],
  "overall_assessment": "..."
}`;
}

const INDIVIDUAL_PROFILE_SCHEMA = `{
    "identity": { "full_name": "...", "id_number": "...", "id_type": "...", "id_issue_date": "...", "id_expiry_date": "...", "date_of_birth": "...", "gender": "...", "nationality": "...", "tax_id": "..." },
    "contact": { "permanent_address": "...", "current_address": "...", "phone_number": "...", "email": "..." },
    "compliance": { "residential_state": "...", "tax_residency": "...", "occupation": "...", "purpose_of_account": "...", "source_of_funds": "...", "expected_monthly_turnover": "..." },
    "account": { "form_code": "...", "account_currency": "...", "registered_services": "...", "signature_specimen": "..." }
  }`;

const HOUSEHOLD_PROFILE_SCHEMA = `{
    "identity": { "full_name": "...", "id_number": "...", "id_type": "...", "id_issue_date": "...", "id_expiry_date": "...", "date_of_birth": "...", "nationality": "..." },
    "contact": { "permanent_address": "...", "business_address": "...", "phone_number": "...", "email": "..." },
    "organization": { "business_name": "...", "household_business_number": "...", "tax_id": "...", "business_line": "...", "initial_registration_date": "...", "registration_address": "...", "business_status": "..." },
    "compliance": { "purpose_of_account": "...", "source_of_funds": "...", "expected_monthly_turnover": "..." },
    "account": { "form_code": "...", "account_currency": "...", "registered_services": "..." }
  }`;

const ORGANIZATION_PROFILE_SCHEMA = `{
    "organization": { "business_name": "...", "name_in_foreign_language": "...", "abbreviated_name": "...", "registration_number": "...", "tax_id": "...", "business_type": "...", "business_line": "...", "initial_registration_date": "...", "latest_amendment": "...", "charter_capital": "...", "registration_address": "...", "operation_address": "...", "business_status": "...", "enterprise_scale": "...", "previous_year_revenue_band": "...", "total_capital_band": "...", "social_insurance_employees_band": "...", "woman_owned_declaration": "..." },
    "contact": { "phone_number": "...", "email": "...", "website": "...", "transaction_address": "..." },
    "identity": { "legal_representative_name": "...", "legal_representative_position": "...", "legal_representative_id_number": "...", "legal_representative_id_expiry_date": "...", "chief_accountant_name": "...", "chief_accountant_id_number": "..." },
    "authorization": { "appointment_document": "...", "appointment_date": "...", "board_resolution": "...", "authorized_users": "...", "authorization_scope": "...", "authorization_expiry_date": "...", "chief_accountant_commitment_note": "..." },
    "ownership": { "beneficial_owners": "...", "ownership_percentages": "...", "parent_company": "...", "ownership_layers": "..." },
    "compliance": { "residency_status": "...", "tax_residency": "...", "purpose_of_account": "...", "source_of_funds": "...", "expected_monthly_turnover": "...", "last_year_revenue": "..." },
    "account": { "form_code": "...", "account_currency": "...", "registered_services": "...", "seal_specimen": "..." }
  }`;

// ─── Sản phẩm tài khoản theo phân khúc ─────────────────────────────────────────

const KHCN_STANDARD_DOCS: DocRequirement[] = [
  DOC_ID_DOCUMENT,
  DOC_ACCOUNT_FORM,
  requirement(DOC_RESIDENCE_PROOF, false),
  requirement(DOC_SIGNATURE_SPECIMEN, false),
  requirement(DOC_FATCA_CRS, false),
  requirement(DOC_SOURCE_OF_FUNDS, false),
];

const KHCN_NONRESIDENT_DOCS: DocRequirement[] = [
  DOC_PASSPORT,
  DOC_ENTRY_PERMIT,
  DOC_ACCOUNT_FORM,
  requirement(DOC_FATCA_CRS, true),
  requirement(DOC_SOURCE_OF_FUNDS, true),
  requirement(DOC_WORK_PERMIT, false),
  requirement(DOC_RESIDENCE_PROOF, false),
];

const HKD_DOCS: DocRequirement[] = [
  DOC_ID_DOCUMENT,
  DOC_BUSINESS_REGISTRATION,
  DOC_ACCOUNT_FORM,
  requirement(DOC_TAX_REGISTRATION, false),
  requirement(DOC_BUSINESS_LOCATION, false),
  requirement(DOC_AUTHORIZATION, false),
  requirement(DOC_SOURCE_OF_FUNDS, false),
];

const SME_DOCS: DocRequirement[] = [
  DOC_BUSINESS_REGISTRATION,
  DOC_COMPANY_CHARTER,
  DOC_LEGAL_REP_ID,
  DOC_APPOINTMENT_DECISION,
  DOC_BENEFICIAL_OWNER,
  DOC_ACCOUNT_FORM,
  requirement(DOC_CHIEF_ACCOUNTANT_ID, false),
  requirement(DOC_CHIEF_ACCOUNTANT_COMMITMENT, false),
  requirement(DOC_AUTHORIZATION, false),
  requirement(DOC_SIGNATURE_SPECIMEN, false),
  requirement(DOC_TAX_REGISTRATION, false),
  requirement(DOC_FINANCIAL_STATEMENT, false),
  requirement(DOC_HANDOVER_RECORD, false),
];

const KHDN_DOCS: DocRequirement[] = [
  DOC_BUSINESS_REGISTRATION,
  DOC_COMPANY_CHARTER,
  DOC_LEGAL_REP_ID,
  DOC_APPOINTMENT_DECISION,
  DOC_BOARD_RESOLUTION,
  DOC_BENEFICIAL_OWNER,
  DOC_OWNERSHIP_STRUCTURE,
  DOC_ACCOUNT_FORM,
  requirement(DOC_FATCA_CRS, true),
  requirement(DOC_FINANCIAL_STATEMENT, true),
  requirement(DOC_CHIEF_ACCOUNTANT_ID, false),
  requirement(DOC_CHIEF_ACCOUNTANT_COMMITMENT, false),
  requirement(DOC_AUTHORIZATION, false),
  requirement(DOC_SIGNATURE_SPECIMEN, false),
  requirement(DOC_TAX_REGISTRATION, false),
  requirement(DOC_HANDOVER_RECORD, false),
];

const KHCN_PROFILE_GUIDE = [
  'identity: họ tên, loại & số giấy tờ định danh, ngày cấp, ngày hết hạn, ngày sinh, giới tính, quốc tịch, mã số thuế cá nhân.',
  'contact: địa chỉ thường trú, địa chỉ hiện tại/liên hệ, số điện thoại, email.',
  'compliance: tình trạng cư trú (cư trú/không cư trú), quốc gia cư trú thuế, nghề nghiệp, mục đích mở tài khoản, nguồn tiền, doanh số giao dịch dự kiến.',
  'account: mã biểu mẫu, loại tiền tài khoản, dịch vụ đăng ký kèm, mẫu chữ ký.',
];

const KHCN_CROSS_CHECK = [
  'Họ tên, số giấy tờ, ngày sinh trên giấy tờ định danh có khớp với giấy đề nghị mở tài khoản không?',
  'Giấy tờ định danh còn hiệu lực tại thời điểm mở tài khoản không (ngày hết hạn)?',
  'Địa chỉ trên biểu mẫu có khớp với xác nhận cư trú / giấy tờ chứng minh địa chỉ không?',
  'Biểu mẫu có đủ chữ ký của chủ tài khoản và các mục bắt buộc (mục đích, dịch vụ, loại tiền) không?',
  'Mục đích mở tài khoản và nguồn tiền khai báo có mâu thuẫn với nghề nghiệp/thu nhập đã cung cấp không?',
];

const KHCN_NONRESIDENT_CROSS_CHECK = [
  'Họ tên và số hộ chiếu có khớp giữa hộ chiếu, thị thực/thẻ cư trú và giấy đề nghị mở tài khoản không?',
  'Hộ chiếu và thị thực/thẻ tạm trú còn hiệu lực không; thời hạn cư trú còn lại có ngắn hơn thời hạn tài khoản đăng ký không?',
  'Tờ khai FATCA/CRS có kê khai quốc gia cư trú thuế và mã số thuế nước ngoài đầy đủ, khớp với quốc tịch trên hộ chiếu không?',
  'Tài liệu chứng minh nguồn tiền có tương xứng với doanh số giao dịch dự kiến không?',
  'Có dấu hiệu khách hàng thuộc quốc gia bị hạn chế/cấm vận theo thông tin trên hồ sơ không?',
];

const HKD_PROFILE_GUIDE = [
  'identity: họ tên chủ hộ, loại & số giấy tờ định danh, ngày cấp/hết hạn, ngày sinh, quốc tịch.',
  'contact: địa chỉ thường trú chủ hộ, địa chỉ kinh doanh, điện thoại, email.',
  'organization: tên hộ kinh doanh, số GCN đăng ký hộ kinh doanh, mã số thuế, ngành nghề, ngày đăng ký lần đầu, địa chỉ đăng ký, tình trạng hoạt động.',
  'compliance: mục đích mở tài khoản, nguồn tiền, doanh số giao dịch dự kiến.',
  'account: mã biểu mẫu, loại tiền tài khoản, dịch vụ đăng ký kèm.',
];

const HKD_CROSS_CHECK = [
  'Họ tên và số giấy tờ chủ hộ có khớp giữa giấy tờ định danh, GCN đăng ký hộ kinh doanh và giấy đề nghị mở tài khoản không?',
  'Tên hộ kinh doanh và mã số thuế trên biểu mẫu có khớp GCN đăng ký hộ kinh doanh không?',
  'Địa chỉ kinh doanh trên GCN có khớp với xác nhận địa điểm kinh doanh không?',
  'GCN đăng ký hộ kinh doanh còn hiệu lực/đang hoạt động, không ở trạng thái tạm ngừng hay thu hồi?',
  'Ngành nghề đăng ký có phù hợp với mục đích sử dụng tài khoản khai báo không?',
  'Nếu có giấy ủy quyền: người được ủy quyền, phạm vi và thời hạn ủy quyền có rõ ràng và còn hiệu lực không?',
];

const ORGANIZATION_PROFILE_GUIDE = [
  'organization: tên tổ chức (tiếng Việt/nước ngoài/viết tắt), số đăng ký doanh nghiệp, mã số thuế, loại hình, ngành nghề chính, ngày đăng ký lần đầu, lần thay đổi gần nhất, vốn điều lệ, địa chỉ đăng ký, địa chỉ hoạt động, tình trạng hoạt động, phân loại quy mô doanh nghiệp SME (siêu nhỏ/nhỏ/vừa nếu biểu mẫu MB02/MB04 có khai báo mức doanh thu năm trước, tổng nguồn vốn, số lao động tham gia BHXH), tuyên bố doanh nghiệp do phụ nữ sở hữu (nếu có).',
  'contact: điện thoại, email, website, địa chỉ giao dịch.',
  'identity: người đại diện theo pháp luật (họ tên, chức danh, số giấy tờ, ngày hết hạn), kế toán trưởng/người phụ trách kế toán.',
  'authorization: văn bản bổ nhiệm và ngày bổ nhiệm, nghị quyết/biên bản về mở tài khoản, danh sách người được ủy quyền, phạm vi và thời hạn ủy quyền; nếu tổ chức chưa có kế toán trưởng thì ghi chú nội dung cam kết chưa đăng ký chữ ký KTT/PTKT.',
  'ownership: danh sách chủ sở hữu hưởng lợi kèm tỷ lệ sở hữu, công ty mẹ, số tầng sở hữu.',
  'compliance: tình trạng cư trú (cư trú/không cư trú), quốc gia cư trú thuế, mục đích mở tài khoản, nguồn tiền, doanh số giao dịch dự kiến, doanh thu năm gần nhất.',
  'account: mã biểu mẫu, loại tiền tài khoản, dịch vụ đăng ký kèm, mẫu dấu.',
];

const SME_CROSS_CHECK = [
  'Tên tổ chức, số đăng ký doanh nghiệp và mã số thuế có khớp giữa GCN đăng ký doanh nghiệp, điều lệ và giấy đề nghị mở tài khoản không?',
  'Người đại diện theo pháp luật trên biểu mẫu có đúng người ghi trên GCN đăng ký doanh nghiệp và quyết định bổ nhiệm không?',
  'Giấy tờ định danh của người đại diện và kế toán trưởng còn hiệu lực không?',
  'Thẩm quyền mở/sử dụng tài khoản của người đại diện có phù hợp điều lệ (giới hạn giá trị, yêu cầu đồng ký) không?',
  'Tờ khai chủ sở hữu hưởng lợi có kê khai đủ các cá nhân sở hữu từ ngưỡng quy định trở lên; tổng tỷ lệ kê khai có hợp lý không?',
  'Địa chỉ đăng ký và địa chỉ giao dịch trên biểu mẫu có khớp GCN đăng ký doanh nghiệp không?',
  'Ngành nghề kinh doanh có phù hợp mục đích sử dụng tài khoản và doanh số dự kiến không?',
  'Nếu có ủy quyền: phạm vi, thời hạn và chữ ký trên giấy ủy quyền có đầy đủ, khớp mẫu chữ ký không?',
];

const KHDN_CROSS_CHECK = [
  ...SME_CROSS_CHECK,
  'Nghị quyết/biên bản họp về mở tài khoản có do cấp có thẩm quyền theo điều lệ ban hành và còn hiệu lực không?',
  'Sơ đồ cấu trúc sở hữu có truy được đến cá nhân cuối cùng; có tầng sở hữu qua pháp nhân nước ngoài hay công ty vỏ bọc không?',
  'Tờ khai FATCA/CRS có khớp với quốc gia đăng ký và cấu trúc sở hữu không?',
  'Có dấu hiệu tổ chức/cá nhân liên quan thuộc quốc gia bị cấm vận hoặc ngành nghề rủi ro cao không?',
  'Báo cáo tài chính/doanh thu có tương xứng với doanh số giao dịch dự kiến trên tài khoản không?',
];

export const ACCOUNT_PRODUCTS: Record<string, AccountProduct> = {
  'casa-khcn-standard': {
    code: 'casa-khcn-standard',
    segmentKey: 'KHCN',
    name: 'Tài khoản thanh toán cá nhân (KHCN)',
    description: 'Tài khoản thanh toán VND cho khách hàng cá nhân cư trú.',
    accountType: 'CASA cá nhân',
    requiredDocs: KHCN_STANDARD_DOCS,
    evaluationPrompt: buildEvaluationPromptTemplate({
      segment: ACCOUNT_SEGMENTS.KHCN,
      profileGuide: KHCN_PROFILE_GUIDE,
      crossCheckFocus: KHCN_CROSS_CHECK,
      profileSchema: INDIVIDUAL_PROFILE_SCHEMA,
    }),
  },
  'casa-khcn-nonresident': {
    code: 'casa-khcn-nonresident',
    segmentKey: 'KHCN',
    name: 'Tài khoản thanh toán cá nhân người nước ngoài / không cư trú',
    description: 'Tài khoản thanh toán cho cá nhân nước ngoài hoặc người không cư trú; bắt buộc FATCA/CRS và chứng minh nguồn tiền.',
    accountType: 'CASA cá nhân không cư trú',
    requiredDocs: KHCN_NONRESIDENT_DOCS,
    evaluationPrompt: buildEvaluationPromptTemplate({
      segment: ACCOUNT_SEGMENTS.KHCN,
      profileGuide: KHCN_PROFILE_GUIDE,
      crossCheckFocus: KHCN_NONRESIDENT_CROSS_CHECK,
      profileSchema: INDIVIDUAL_PROFILE_SCHEMA,
    }),
  },
  'casa-hkd-standard': {
    code: 'casa-hkd-standard',
    segmentKey: 'HKD',
    name: 'Tài khoản thanh toán hộ kinh doanh',
    description: 'Tài khoản thanh toán phục vụ hoạt động kinh doanh của hộ kinh doanh cá thể.',
    accountType: 'CASA hộ kinh doanh',
    requiredDocs: HKD_DOCS,
    evaluationPrompt: buildEvaluationPromptTemplate({
      segment: ACCOUNT_SEGMENTS.HKD,
      profileGuide: HKD_PROFILE_GUIDE,
      crossCheckFocus: HKD_CROSS_CHECK,
      profileSchema: HOUSEHOLD_PROFILE_SCHEMA,
    }),
  },
  'casa-sme-standard': {
    code: 'casa-sme-standard',
    segmentKey: 'SME',
    name: 'Tài khoản thanh toán doanh nghiệp SME',
    description: 'Tài khoản thanh toán cho doanh nghiệp vừa và nhỏ; yêu cầu điều lệ, quyết định bổ nhiệm và kê khai chủ sở hữu hưởng lợi.',
    accountType: 'CASA doanh nghiệp',
    requiredDocs: SME_DOCS,
    evaluationPrompt: buildEvaluationPromptTemplate({
      segment: ACCOUNT_SEGMENTS.SME,
      profileGuide: ORGANIZATION_PROFILE_GUIDE,
      crossCheckFocus: SME_CROSS_CHECK,
      profileSchema: ORGANIZATION_PROFILE_SCHEMA,
    }),
  },
  'casa-khdn-standard': {
    code: 'casa-khdn-standard',
    segmentKey: 'KHDN',
    name: 'Tài khoản thanh toán khách hàng doanh nghiệp lớn',
    description: 'Tài khoản thanh toán cho doanh nghiệp lớn/tổ chức; bắt buộc nghị quyết mở tài khoản, sơ đồ sở hữu, FATCA/CRS và rà soát tăng cường.',
    accountType: 'CASA doanh nghiệp lớn',
    requiredDocs: KHDN_DOCS,
    evaluationPrompt: buildEvaluationPromptTemplate({
      segment: ACCOUNT_SEGMENTS.KHDN,
      profileGuide: ORGANIZATION_PROFILE_GUIDE,
      crossCheckFocus: KHDN_CROSS_CHECK,
      profileSchema: ORGANIZATION_PROFILE_SCHEMA,
    }),
  },
};

/** Sản phẩm mặc định khi caller không truyền product_code/segment. */
export const DEFAULT_ACCOUNT_PRODUCT_CODE = 'casa-khcn-standard';

/** Sản phẩm mặc định của từng phân khúc khi caller chỉ truyền segment. */
const DEFAULT_PRODUCT_BY_SEGMENT: Record<CustomerSegmentKey, string> = {
  KHCN: 'casa-khcn-standard',
  HKD: 'casa-hkd-standard',
  SME: 'casa-sme-standard',
  KHDN: 'casa-khdn-standard',
};

export function getSegmentProducts(segmentKey: CustomerSegmentKey): AccountProduct[] {
  return Object.values(ACCOUNT_PRODUCTS).filter((product) => product.segmentKey === segmentKey);
}

/**
 * Chọn sản phẩm cho lần chạy. Caller có thể truyền product_code (chính xác nhất)
 * hoặc chỉ segment (dùng sản phẩm mặc định của phân khúc). Mã sai bị reject để
 * không âm thầm chấm hồ sơ bằng checklist của phân khúc khác.
 */
export function resolveAccountProduct(
  productCodeRaw?: unknown,
  segmentKeyRaw?: unknown,
): { product: AccountProduct; segment: AccountSegment } {
  const requestedSegment = cleanParam(segmentKeyRaw);
  const segment = getAccountSegment(segmentKeyRaw);
  if (requestedSegment && !segment) {
    throw new Error(`INVALID_INPUT: Unsupported customer segment "${requestedSegment}".`);
  }

  const code = cleanParam(productCodeRaw);
  if (code) {
    const product = ACCOUNT_PRODUCTS[code];
    if (!product) throw new Error(`INVALID_INPUT: Unsupported account product_code "${code}".`);
    if (segment && product.segmentKey !== segment.key) {
      throw new Error(`INVALID_INPUT: Product "${code}" thuộc phân khúc ${product.segmentKey}, không phải ${segment.key}.`);
    }
    return { product, segment: ACCOUNT_SEGMENTS[product.segmentKey] };
  }

  const fallbackCode = segment ? DEFAULT_PRODUCT_BY_SEGMENT[segment.key] : DEFAULT_ACCOUNT_PRODUCT_CODE;
  const product = ACCOUNT_PRODUCTS[fallbackCode];
  return { product, segment: ACCOUNT_SEGMENTS[product.segmentKey] };
}

// ─── Step 0: Classify ──────────────────────────────────────────────────────────

/** Danh sách "key | label — description" của sản phẩm để nhét vào prompt phân loại. */
function buildDocTypeCatalog(product: AccountProduct): string {
  return product.requiredDocs
    .map((doc) => `- key="${doc.key}" | ${doc.label} — ${doc.description}`)
    .join('\n');
}

export function buildClassifyPrompt(
  fileName: string,
  product: AccountProduct,
  promptOverride?: string,
): Record<string, unknown> {
  const catalog = buildDocTypeCatalog(product);
  const segment = ACCOUNT_SEGMENTS[product.segmentKey];

  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        file_name: fileName,
        doc_types: catalog,
        product_name: product.name,
        segment_name: segment.name,
      }),
    };
  }

  return {
    _prompt: `Phân loại tài liệu trong file "${fileName}" cho hồ sơ mở tài khoản "${product.name}" (phân khúc ${segment.name}).

Một file CÓ THỂ chứa NHIỀU loại chứng từ khác nhau (VD hồ sơ tổ chức gộp cả GCN đăng ký doanh nghiệp lẫn quyết định bổ nhiệm; ảnh scan hai mặt CCCD là cùng một loại). Hãy liệt kê TẤT CẢ loại chứng từ trong danh mục dưới đây mà file này thực sự chứa (dựa vào nội dung/tiêu đề/cấu trúc, KHÔNG dựa vào tên file):
${catalog}

Nếu file KHÔNG khớp bất kỳ loại nào ở trên, trả về mảng doc_types rỗng.

CHỈ trả về JSON, không kèm lời dẫn:
{
  "doc_types": [
    { "key": "<key khớp trong danh mục>", "label": "<nhãn tương ứng>", "confidence": 0.0 }
  ],
  "reason": "<giải thích ngắn 1 câu>"
}`,
  };
}

/** Chuẩn hóa output classify của AI về ClassifiedDoc (multi-label). */
export function parseClassifyResult(
  parsed: unknown,
  fileName: string,
  product: AccountProduct,
): ClassifiedDoc {
  const obj = (parsed && typeof parsed === 'object') ? (parsed as Record<string, unknown>) : {};
  const reason = typeof obj.reason === 'string' ? obj.reason : undefined;

  // Chấp nhận cả schema mới (doc_types[]) lẫn schema cũ (doc_type_key) để phòng thủ.
  const rawList: any[] = Array.isArray(obj.doc_types)
    ? obj.doc_types
    : (typeof obj.doc_type_key === 'string' ? [{ key: obj.doc_type_key, confidence: obj.confidence }] : []);

  const seen = new Set<string>();
  const matches: DocMatch[] = [];
  for (const raw of rawList) {
    const key = typeof raw?.key === 'string' ? raw.key.trim() : '';
    const req = product.requiredDocs.find((doc) => doc.key === key);
    if (!req || seen.has(req.key)) continue;
    seen.add(req.key);
    const confidence = typeof raw?.confidence === 'number' ? raw.confidence : Number(raw?.confidence) || 0;
    matches.push({ key: req.key, label: req.label, confidence });
  }

  return {
    file_name: fileName,
    matches,
    status: matches.length > 0 ? 'classified' : 'unknown',
    reason,
  };
}

// ─── Step 1: Extract ───────────────────────────────────────────────────────────

const DEFAULT_EXTRACT_FIELDS = 'Tên tài liệu, Số hiệu, Ngày cấp, Ngày hết hạn, Bên liên quan';

/**
 * Prompt bóc tách GỘP: 1 lần đọc file → trích xuất field cho TẤT CẢ loại chứng từ
 * đã phân loại trong file đó (tiết kiệm token: file chỉ gửi model 1 lần).
 */
export function buildMultiExtractPrompt(
  fileName: string,
  docs: DocRequirement[],
  promptOverride?: string,
): Record<string, unknown> {
  const sections = docs.map((doc) => {
    const fields = EXTRACT_PRESETS[doc.presetKey]?.fields ?? DEFAULT_EXTRACT_FIELDS;
    return `### key="${doc.key}" — ${doc.label}\nFields: ${fields}`;
  }).join('\n\n');

  const keysHint = docs.map((doc) => `"${doc.key}"`).join(', ');

  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        file_name: fileName,
        doc_sections: sections,
        doc_keys: keysHint,
      }),
    };
  }

  return {
    _prompt: `File "${fileName}" chứa ${docs.length} loại chứng từ trong hồ sơ mở tài khoản. Trong CÙNG một lần đọc file, bóc tách dữ liệu cho TỪNG loại dưới đây.

Ký hiệu nén field: obj{a,b} là object lồng, arr[]{a,b} là mảng object.

${sections}

Quy tắc:
- Với mỗi loại, chỉ trích xuất từ đúng phần tài liệu thuộc loại đó trong file; KHÔNG trộn dữ liệu giữa các loại.
- Ghi ĐẦY ĐỦ các mốc thời gian có trên chứng từ (ngày cấp, ngày hết hạn, ngày hiệu lực, ngày bổ nhiệm) vì chúng dùng để kiểm tra hiệu lực giấy tờ.
- Giữ nguyên tỷ lệ sở hữu (%) và giá trị vốn đúng như trên chứng từ.
- Trường không tìm thấy → null. TUYỆT ĐỐI KHÔNG bịa.

CHỈ trả về JSON đúng schema sau, không kèm lời dẫn/markdown:
{
  "documents": [
    { "doc_type_key": <một trong ${keysHint}>, "fields": { ... } }
  ]
}`,
  };
}

/** Tách response bóc tách GỘP của 1 file thành nhiều ExtractedDoc (mỗi loại 1 phần tử). */
export function parseMultiExtractResult(
  parsed: unknown,
  fileName: string,
  docs: DocRequirement[],
): ExtractedDoc[] {
  const obj = (parsed && typeof parsed === 'object') ? (parsed as Record<string, unknown>) : {};
  const list: any[] = Array.isArray(obj.documents) ? obj.documents : [];
  const byKey = new Map<string, any>();
  for (const doc of list) {
    if (doc && typeof doc.doc_type_key === 'string') byKey.set(doc.doc_type_key.trim(), doc);
  }

  return docs.map((req): ExtractedDoc => {
    const entry = byKey.get(req.key);
    if (entry && entry.fields !== undefined && entry.fields !== null) {
      return { file_name: fileName, doc_type_key: req.key, doc_type_label: req.label, status: 'success', data: entry.fields };
    }
    // Fallback: chỉ 1 loại & model trả thẳng object field (không bọc trong documents[]).
    if (docs.length === 1 && list.length === 0 && !('documents' in obj) && Object.keys(obj).length > 0) {
      return { file_name: fileName, doc_type_key: req.key, doc_type_label: req.label, status: 'success', data: obj };
    }
    return { file_name: fileName, doc_type_key: req.key, doc_type_label: req.label, status: 'error', error: 'Model không trả dữ liệu cho loại này' };
  });
}

// ─── Step 2: Evaluate (Customer Profile + checklist + cross-check qua LLM) ─────

export function buildEvaluatePrompt(
  product: AccountProduct,
  classification: ClassifiedDoc[],
  extracted: ExtractedDoc[],
  promptOverride?: string,
): Record<string, unknown> {
  const segment = ACCOUNT_SEGMENTS[product.segmentKey];

  const checklistStr = product.requiredDocs
    .map((doc) => `- key="${doc.key}" | ${doc.label} | ${doc.required ? 'BẮT BUỘC' : 'tùy chọn'} — ${doc.description}`)
    .join('\n');

  const classificationStr = classification
    .map((item) => {
      const types = item.matches.length
        ? item.matches.map((match) => `${match.label} (key=${match.key})`).join(', ')
        : 'không nhận dạng được';
      return `- ${item.file_name} → ${types}`;
    })
    .join('\n') || '(không có)';

  // Loại field rỗng + nén JSON để tiết kiệm token ở bước đánh giá (hồ sơ thiếu
  // thường sinh rất nhiều field null).
  const extractedStr = JSON.stringify(
    extracted
      .filter((item) => item.status === 'success')
      .map((item) => ({ file: item.file_name, doc_type: item.doc_type_key, data: pruneEmptyDeep(item.data) }))
      .filter((item) => !isEmptyValue(item.data)),
  );

  // Prompt gắn theo sản phẩm; cho phép override ở tầng Profile (ctx.promptOverrides.evaluate).
  const template = promptOverride || product.evaluationPrompt;
  return {
    _prompt: interpolatePrompt(template, {
      segment_name: segment.name,
      product_name: product.name,
      checklist: checklistStr,
      classification: classificationStr,
      extracted_data: extractedStr,
    }),
  };
}

/** Bổ khuyết + chuẩn hóa output đánh giá của LLM (không tin tuyệt đối vào model). */
export function normalizeEvaluation(
  parsed: unknown,
  product: AccountProduct,
  classification: ClassifiedDoc[],
): OnboardingEvaluation {
  const obj = (parsed && typeof parsed === 'object') ? (parsed as Record<string, unknown>) : {};

  // Chấp nhận cả customer_profile (schema chuẩn) lẫn customer_360 (nhầm sang
  // schema của workflow thẩm định vay) để override prompt sai không làm mất data.
  const rawProfile = obj.customer_profile ?? obj.customer_360;
  const customer_profile = (rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile))
    ? (rawProfile as CustomerProfile)
    : {};

  // Chuẩn hóa checklist: đảm bảo mọi mục trong template đều xuất hiện.
  const rawChecklist = Array.isArray(obj.checklist) ? (obj.checklist as any[]) : [];
  const byKey = new Map<string, any>();
  for (const item of rawChecklist) {
    if (item && typeof item.key === 'string') byKey.set(item.key, item);
  }
  // File nào cung cấp cho mỗi mục checklist — suy ra từ classification (multi-label).
  const filesByKey = new Map<string, string[]>();
  for (const item of classification) {
    for (const match of item.matches) {
      const files = filesByKey.get(match.key) ?? [];
      if (!files.includes(item.file_name)) files.push(item.file_name);
      filesByKey.set(match.key, files);
    }
  }

  const checklist: ChecklistItemResult[] = product.requiredDocs.map((doc) => {
    const found = byKey.get(doc.key);
    const classifiedFiles = filesByKey.get(doc.key) ?? [];
    const llmFiles = Array.isArray(found?.found_in) ? found.found_in.filter((x: unknown) => typeof x === 'string') : [];
    const foundIn = Array.from(new Set<string>([...classifiedFiles, ...llmFiles]));

    let status: ChecklistItemResult['status'];
    if (found && typeof found.status === 'string' && ['present', 'missing', 'review'].includes(found.status)) {
      status = found.status;
    } else {
      status = classifiedFiles.length > 0 ? 'present' : 'missing';
    }
    // Có file cung cấp nhưng LLM bảo missing → hạ xuống review (mâu thuẫn cần soát).
    if (status === 'missing' && foundIn.length > 0) status = 'review';

    return {
      key: doc.key,
      label: doc.label,
      required: doc.required,
      status,
      found_in: foundIn,
      note: typeof found?.note === 'string' ? found.note : undefined,
    };
  });

  // Completeness là rule deterministic: chỉ tính mục BẮT BUỘC ở trạng thái present.
  const requiredItems = checklist.filter((item) => item.required);
  const presentRequired = requiredItems.filter((item) => item.status === 'present').length;
  const completeness_percent = requiredItems.length
    ? Math.round((presentRequired / requiredItems.length) * 100)
    : 100;

  const cross_check: CrossCheckFinding[] = Array.isArray(obj.cross_check)
    ? (obj.cross_check as any[])
        .filter((finding) => finding && typeof finding.message === 'string')
        .map((finding) => ({
          severity: ['error', 'warning', 'info'].includes(finding.severity) ? finding.severity : 'info',
          title: typeof finding.title === 'string' ? finding.title : 'Đối chiếu',
          message: finding.message,
          documents: Array.isArray(finding.documents) ? finding.documents : undefined,
        }))
    : [];

  const risk_notes = Array.isArray(obj.risk_notes)
    ? (obj.risk_notes as any[]).filter((note) => typeof note === 'string')
    : [];

  const overall_assessment = typeof obj.overall_assessment === 'string' ? obj.overall_assessment : '';

  return { customer_profile, checklist, completeness_percent, cross_check, risk_notes, overall_assessment };
}

// ─── Interpolation Helper ──────────────────────────────────────────────────────

function interpolatePrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
    key in vars ? vars[key] : match,
  );
}
