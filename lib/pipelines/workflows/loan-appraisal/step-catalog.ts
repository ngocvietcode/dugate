// Danh mục các bước AI của workflow loan-appraisal để cấu hình prompt / model / reasoning theo SẢN PHẨM.
// Dùng chung cho trang cấu hình (/loan-appraisal-v2/config). Chỉ chứa metadata + template mặc định lấy từ code đang chạy,
// nên override luôn dựa trên đúng prompt thật.
import { POLICY_CHECKS_PROMPT_TEMPLATE } from '@/lib/pipelines/workflows/loan-appraisal/prompt-checks';
import { DOSSIER_SUMMARY_PROMPT_TEMPLATE } from '@/lib/pipelines/workflows/loan-appraisal/intake-review';
import { DOSSIER_PRECHECK_PROMPT_TEMPLATE } from '@/lib/pipelines/workflows/loan-appraisal/dossier-precheck-prompt';
import { MASTER_CORRECTION_PROMPT_TEMPLATE } from '@/lib/pipelines/workflows/loan-appraisal/master-correction';
import { INCOME_SOURCE_PROMPT_TEMPLATE, LOAN_PURPOSE_PROMPT_TEMPLATE } from '@/lib/pipelines/workflows/loan-appraisal/condition-prompts';

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
    description: 'Không có prompt riêng. Là model và mức suy luận MẶC ĐỊNH của mọi bước dưới đây khi bước đó chưa cấu hình riêng (kiểm tra sơ bộ, tổng kết hồ sơ, phân loại điều kiện checklist, so ngữ nghĩa đối chiếu chéo, hiệu chỉnh master, rule LLM).',
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
    description: 'Chạy mọi rule LLM đang bật trong bộ kiểm tra (một lần gọi). Kết quả PASS chỉ được chấp nhận khi evidence đã ACCEPTED; ngưỡng tin cậy chỉ áp ở hệ thống. Chưa cấu hình model/reasoning riêng thì dùng của bước Hợp nhất.',
    variables: [
      { name: '{{checks}}', desc: 'Danh sách rule LLM đang bật (id, tên, nguồn dữ liệu, yêu cầu) — bắt buộc' },
      { name: '{{evidence}}', desc: 'Bảng evidence (ưu tiên loại chứng từ rule khai báo, tối đa 400 dòng), bọc trong <untrusted_evidence> — bắt buộc' },
      { name: '{{financial}}', desc: 'Chỉ số tài chính đã tính deterministic' },
      { name: '{{master_data}}', desc: 'Customer 360 do AI tổng hợp (chưa xác minh), bọc trong <untrusted_master_data>' },
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
    description: 'Giai đoạn 1, ngay sau Phân loại (S1) và là bước AI cuối cùng trước khi dừng chờ giai đoạn 2: LLM đối chiếu checklist của chương trình/luồng với summary + key_facts của S1 (từng mục, từng người/tài sản) và đánh giá quan hệ giữa các chứng từ. Code chỉ giữ rào chắn hình thức (mục lạ, doc_ref sai, mục bắt buộc bị bỏ sót → UNCERTAIN). LLM lỗi thì status UNAVAILABLE. Tắt bằng param dossier_precheck=false. Bước chậm nhất giai đoạn 1 vì phải sinh một dòng cho mỗi mục: nên đặt reasoning thấp. Chưa cấu hình model/reasoning riêng thì dùng của bước Hợp nhất.',
    variables: [
      { name: '{{checklist}}', desc: 'Các mục checklist cần đánh giá (item_key, nhãn, phạm vi, mức yêu cầu, loại chứng từ chấp nhận), bọc trong <untrusted_checklist> — bắt buộc' },
      { name: '{{documents}}', desc: 'Danh sách chứng từ từ S1 (doc_ref, loại, summary, key_facts), bọc trong <untrusted_documents> — bắt buộc' },
      { name: '{{output_schema}}', desc: 'Schema JSON bắt buộc của kết quả — bắt buộc' },
    ],
    codePromptPreview: DOSSIER_PRECHECK_PROMPT_TEMPLATE,
    hasDynamicSections: true,
    dynamicWarning: `Override phải GIỮ schema output (checklist[] với item_key, subject, status, doc_refs, note; relations[]; overview; next_actions[]) và quy tắc doc_refs chỉ lấy từ mã D.. có sẵn; mục PROVIDED không có căn cứ hợp lệ sẽ bị hạ xuống UNCERTAIN. ${LOAN_GUARD_NOTE}`,
  },
  {
    key: 'dossier_summary',
    label: 'AI · Tổng kết tóm tắt hồ sơ',
    icon: '🧾',
    connector: 'ext-fact-verifier',
    description: 'Giai đoạn 2, ngay sau Bóc tách (S2): LLM viết tổng kết tóm tắt bộ hồ sơ (overview, highlights, next_actions) từ thông tin hồ sơ và 4 tiêu chí tiếp nhận. 4 tiêu chí do quy tắc dựng từ kết quả kiểm tra sơ bộ ở giai đoạn 1 (dossier_precheck) nên KHÔNG có lời gọi LLM chấm lại tiêu chí. Đây là lời gọi LLM duy nhất của bước tiếp nhận ở giai đoạn 2. Lỗi hoặc sai định dạng thì tổng kết bằng quy tắc. Tắt bằng param intake_llm_review=false. Chưa cấu hình model/reasoning riêng thì dùng của bước Hợp nhất.',
    variables: [
      { name: '{{dossier}}', desc: 'Thông tin bộ hồ sơ, bọc trong <untrusted_dossier_facts> — bắt buộc' },
      { name: '{{review}}', desc: 'Kết quả 3 tiêu chí tiếp nhận (dựng từ kiểm tra sơ bộ), bọc trong <untrusted_review>' },
      { name: '{{output_schema}}', desc: 'Schema JSON bắt buộc của kết quả — bắt buộc' },
    ],
    codePromptPreview: DOSSIER_SUMMARY_PROMPT_TEMPLATE,
    hasDynamicSections: true,
    dynamicWarning: `Override phải GIỮ schema output (overview, highlights[], next_actions[]). ${LOAN_GUARD_NOTE}`,
  },
  {
    key: 'master_correction',
    label: 'AI · Hiệu chỉnh trường xung đột của master',
    icon: '🛠️',
    connector: 'ext-fact-verifier',
    description: 'Giai đoạn 2, sau khi dựng master_dossier (S3–S5): một lần gọi LLM chọn giá trị đúng trong các giá trị đã đọc cho trường định danh / tên / ngày bị xung đột khi các giá trị chỉ là biến thể đọc sai của nhau (lệch tối đa 2 ký tự; họ tên được nới theo độ dài; tối đa 4 giá trị). Hai bản ngang số lượng (1 đối 1) vẫn được gửi: LLM dựa vào chứng từ gốc của trường, hợp lệ định dạng (CCCD 9/12 số, ngày có thật), số nguồn và độ tin cậy; không có căn cứ nghiêng hẳn về một phía thì giữ xung đột. LLM chỉ trả option_id, không tạo giá trị mới; trường được chọn luôn ở mức cần rà soát. Lỗi hoặc sai định dạng thì không hiệu chỉnh trường nào. Model/reasoning mặc định lấy của evaluate.',
    variables: [
      { name: '{{proposals}}', desc: 'Các trường cần chọn: proposal_id, trường, lựa chọn (option_id, giá trị đã đọc, số nguồn, độ tin cậy, la_chung_tu_chuan, dung_dinh_dang, nguồn), bọc trong <untrusted_correction_facts> — bắt buộc' },
      { name: '{{output_schema}}', desc: 'Schema JSON bắt buộc của kết quả — bắt buộc' },
    ],
    codePromptPreview: MASTER_CORRECTION_PROMPT_TEMPLATE,
    hasDynamicSections: true,
    dynamicWarning: `Override phải GIỮ schema output (decisions[] với proposal_id, action, option_id, reason) và quy tắc chỉ chọn option_id có sẵn. ${LOAN_GUARD_NOTE}`,
  },
  {
    key: 'income_source_classify',
    label: 'AI · Phân loại nguồn thu (điều kiện checklist)',
    icon: '💼',
    connector: 'ext-fact-verifier',
    description: 'Giai đoạn 2, bước Checklist (S4): một lần gọi LLM phân loại các nguồn thu trong giấy đề nghị vay vào tập đóng {salary, rental, household_business, enterprise} để xác định nhóm chứng từ thu nhập bắt buộc (4 điều kiện income_source_* và household_business_license_required). Chỉ gọi khi checklist có dòng cần và hồ sơ có nội dung nguồn thu. Lỗi hoặc nhãn lạ thì điều kiện về INPUT_NOT_PROVIDED (theo on_input_missing của từng điều kiện). Bài toán chỉ trả nhãn đóng: nên chọn model nhỏ và reasoning thấp. Chưa cấu hình model/reasoning riêng thì dùng của bước Hợp nhất.',
    variables: [
      { name: '{{sources}}', desc: 'Danh sách nguồn thu đánh số (income_details[].source + repayment_source), bọc trong <untrusted_income_sources> — bắt buộc' },
      { name: '{{output_schema}}', desc: 'Schema JSON bắt buộc của kết quả — bắt buộc' },
    ],
    codePromptPreview: INCOME_SOURCE_PROMPT_TEMPLATE,
    hasDynamicSections: true,
    dynamicWarning: `Override phải GIỮ schema output { labels: [...] } và chỉ dùng 4 nhãn salary | rental | household_business | enterprise; nhãn khác bị bỏ cả lượt. ${LOAN_GUARD_NOTE}`,
  },
  {
    key: 'loan_purpose_classify',
    label: 'AI · Phân loại mục đích vay (điều kiện checklist)',
    icon: '🎯',
    connector: 'ext-fact-verifier',
    description: 'Giai đoạn 2, bước Checklist (S4): một lần gọi LLM trả lời YES/NO cho 2 câu hỏi về mục đích vay (mua xe ô tô, mua hoặc bù đắp chi phí mua đất/nhà xưởng) để xác định hợp đồng mua xe và GCN QSDĐ nhà xưởng có bắt buộc không. Chỉ gọi khi checklist có dòng cần và hồ sơ có mục đích vay. Lỗi hoặc trả lời lạ thì điều kiện về INPUT_NOT_PROVIDED. Nên chọn model nhỏ và reasoning thấp. Chưa cấu hình model/reasoning riêng thì dùng của bước Hợp nhất.',
    variables: [
      { name: '{{purposes}}', desc: 'Danh sách mục đích vay đánh số (loan_info.loan_purposes), bọc trong <untrusted_loan_purposes> — bắt buộc' },
      { name: '{{output_schema}}', desc: 'Schema JSON bắt buộc của kết quả — bắt buộc' },
    ],
    codePromptPreview: LOAN_PURPOSE_PROMPT_TEMPLATE,
    hasDynamicSections: true,
    dynamicWarning: `Override phải GIỮ schema output { vehicle_purchase, factory_purchase } với giá trị YES hoặc NO. ${LOAN_GUARD_NOTE}`,
  },
];
