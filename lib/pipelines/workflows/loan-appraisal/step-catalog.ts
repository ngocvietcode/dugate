// Danh mục các bước AI của workflow loan-appraisal để cấu hình prompt / model / reasoning theo SẢN PHẨM.
// Dùng chung cho trang cấu hình (/loan-appraisal-v2/config). Chỉ chứa metadata + template mặc định lấy từ code đang chạy,
// nên override luôn dựa trên đúng prompt thật.
import { POLICY_CHECKS_PROMPT_TEMPLATE } from '@/lib/pipelines/workflows/loan-appraisal/prompt-checks';
import { DOSSIER_PRECHECK_PROMPT_TEMPLATE } from '@/lib/pipelines/workflows/loan-appraisal/dossier-precheck-prompt';

export interface LoanStepMeta {
  key: string;
  label: string;
  icon: string;
  connector: string;
  description: string;
  variables: Array<{ name: string; desc: string }>;
  codePromptPreview: string;
  hasDynamicSections: boolean;
  dynamicWarning?: string;
  /** false: bước chạy theo schema cố định trong code, chỉ chọn được model / reasoning (không ghi đè prompt). Mặc định true. */
  promptEditable?: boolean;
}
const LOAN_GUARD_NOTE = 'Hệ thống luôn tự thêm đoạn [AN TOÀN DỮ LIỆU] ở đầu prompt và tự nối placeholder dữ liệu bắt buộc nếu override bỏ sót.';

export const LOAN_APPRAISAL_STEPS: LoanStepMeta[] = [
  {
    key: 'classify',
    label: 'AI · Phân loại chứng từ (S1)',
    icon: '🗂️',
    connector: 'ext-classifier',
    description: 'Giai đoạn 1: nhận dạng loại chứng từ, tóm tắt và key_facts của từng trang/file. Schema cố định trong code nên chỉ chọn được model và mức suy luận.',
    variables: [],
    codePromptPreview: 'Prompt và schema đầu ra cố định trong code (spec-v3 S1); không ghi đè được.',
    hasDynamicSections: false,
    promptEditable: false,
  },
  {
    key: 'extract',
    label: 'AI · Bóc tách chứng từ (S2)',
    icon: '🔍',
    connector: 'ext-data-extractor',
    description: 'Giai đoạn 2: OCR và bóc tách trường dữ liệu có nguồn theo schema từng loại chứng từ. Chỉ chọn được model và mức suy luận.',
    variables: [],
    codePromptPreview: 'Prompt và schema đầu ra cố định trong code (spec-v3 S2); không ghi đè được.',
    hasDynamicSections: false,
    promptEditable: false,
  },
  {
    key: 'evaluate',
    label: 'AI · Model mặc định cho các bước còn lại',
    icon: '🧠',
    connector: 'ext-fact-verifier',
    description: 'Không có prompt riêng. Là model và mức suy luận MẶC ĐỊNH của các bước dưới đây khi bước đó chưa cấu hình riêng (rule LLM, kiểm tra sơ bộ). Không áp cho Phân loại và Bóc tách.',
    variables: [],
    codePromptPreview: 'Không có prompt; chỉ dùng làm giá trị mặc định cho model / reasoning.',
    hasDynamicSections: false,
    promptEditable: false,
  },
  {
    key: 'policy_checks',
    label: 'AI · Rule LLM (policy)',
    icon: '⚖️',
    connector: 'ext-fact-verifier',
    description: 'Chạy mọi rule LLM đang bật trong bộ kiểm tra (một lần gọi). Kết quả PASS chỉ được chấp nhận khi evidence đã ACCEPTED; ngưỡng tin cậy chỉ áp ở hệ thống. Chưa cấu hình model/reasoning riêng thì dùng của bước Model mặc định (evaluate).',
    variables: [
      { name: '{{checks}}', desc: 'Danh sách rule LLM đang bật (id, tên, nguồn dữ liệu, yêu cầu) — bắt buộc' },
      { name: '{{context}}', desc: 'Loan Application Context: dữ kiện F<n> có trạng thái tin cậy, quan hệ, mâu thuẫn, khoảng trống, bọc trong <untrusted_loan_context> — bắt buộc. Template ghi đè kiểu cũ (không có {{context}}) được tự chuyển: {{master_data}} thành {{context}}' },
      { name: '{{financial}}', desc: 'Chỉ số tài chính đã tính deterministic' },
      { name: '{{evidence}}', desc: 'Phụ lục OCR thô (mã D<n>:<field>), chỉ gồm loại chứng từ mà rule khai ocr.<loại> trong nguồn dữ liệu; không rule nào khai thì để trống' },
      { name: '{{output_schema}}', desc: 'Schema JSON bắt buộc của kết quả — bắt buộc' },
    ],
    codePromptPreview: POLICY_CHECKS_PROMPT_TEMPLATE,
    hasDynamicSections: true,
    dynamicWarning: `Nội dung từng rule cấu hình ở khối "Bộ kiểm tra hồ sơ"; prompt này là khung chung. ${LOAN_GUARD_NOTE}`,
  },
  {
    key: 'dossier_precheck',
    label: 'AI · Kiểm tra sơ bộ checklist & quan hệ chứng từ',
    icon: '🔎',
    connector: 'ext-fact-verifier',
    description: 'Giai đoạn 1, ngay sau Phân loại (S1) và là bước AI cuối cùng trước khi dừng chờ giai đoạn 2: LLM đối chiếu checklist của chương trình/luồng với summary + key_facts của S1 (từng mục, từng người/tài sản) và đánh giá quan hệ giữa các chứng từ. Code chỉ giữ rào chắn hình thức (mục lạ, doc_ref sai, mục bắt buộc bị bỏ sót → UNCERTAIN). LLM lỗi thì status UNAVAILABLE. Tắt bằng param dossier_precheck=false. Bước chậm nhất giai đoạn 1 vì phải sinh một dòng cho mỗi mục: nên đặt reasoning thấp. Chưa cấu hình model/reasoning riêng thì dùng của bước Model mặc định (evaluate).',
    variables: [
      { name: '{{checklist}}', desc: 'Các mục checklist cần đánh giá (item_key, nhãn, phạm vi, mức yêu cầu, loại chứng từ chấp nhận), bọc trong <untrusted_checklist> — bắt buộc' },
      { name: '{{documents}}', desc: 'Danh sách chứng từ từ S1 (doc_ref, loại, summary, key_facts), bọc trong <untrusted_documents> — bắt buộc' },
      { name: '{{output_schema}}', desc: 'Schema JSON bắt buộc của kết quả — bắt buộc' },
    ],
    codePromptPreview: DOSSIER_PRECHECK_PROMPT_TEMPLATE,
    hasDynamicSections: true,
    dynamicWarning: `Override phải GIỮ schema output (checklist[] với item_key, subject, status, doc_refs, note; relations[]; overview; next_actions[]) và quy tắc doc_refs chỉ lấy từ mã D.. có sẵn; mục PROVIDED không có căn cứ hợp lệ sẽ bị hạ xuống UNCERTAIN. ${LOAN_GUARD_NOTE}`,
  },
];
