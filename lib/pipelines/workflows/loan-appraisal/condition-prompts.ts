// Prompt của 2 điều kiện ngữ nghĩa bằng LLM ở S4 (`check_checklist`; T-S4-04, S4-R10).
// Mỗi prompt có step key riêng để Profile chọn được prompt / model / reasoning; chưa cấu hình thì dùng model của `evaluate`.
//   - `income_source_classify`: phân loại nguồn thu vào tập đóng {salary, rental, household_business, enterprise}.
//   - `loan_purpose_classify`: trả lời YES/NO cho 2 câu hỏi về mục đích vay (mua xe ô tô, mua đất / nhà xưởng).
// Chuỗi nguồn thu / mục đích vay lấy từ OCR giấy đề nghị vay nên được bọc trong thẻ <untrusted_*>.
import { untrustedBlock } from '../prompts/loan-appraisal-prompts';
import { renderPrompt } from './intake-review';

export const INCOME_SOURCE_STEP = 'income_source_classify';
export const LOAN_PURPOSE_STEP = 'loan_purpose_classify';

/** Số ký tự tối đa của khối dữ liệu đưa vào một prompt. */
const TEXT_CHAR_BUDGET = 4_000;

export const INCOME_SOURCE_OUTPUT_SCHEMA = '{ "labels": ["salary|rental|household_business|enterprise", ...] }';
export const LOAN_PURPOSE_OUTPUT_SCHEMA = '{ "vehicle_purchase": "YES|NO", "factory_purchase": "YES|NO" }';

export const INCOME_SOURCE_PROMPT_TEMPLATE = `Phân loại từng nguồn thu nhập sau vào tập đóng {salary, rental, household_business, enterprise}.
salary = lương/tiền công; rental = cho thuê tài sản; household_business = hộ kinh doanh/buôn bán cá thể; enterprise = doanh nghiệp/công ty do khách hàng làm chủ.
Trả DUY NHẤT JSON đúng schema sau, gồm các nhãn xuất hiện (không lặp). Không có nhãn nào phù hợp → "labels": []:
{{output_schema}}

Nguồn thu:
{{sources}}`;

export const LOAN_PURPOSE_PROMPT_TEMPLATE = `Trả lời YES/NO cho 2 câu hỏi về các mục đích vay sau:
vehicle_purchase: có mục đích nào là mua xe ô tô?
factory_purchase: có mục đích nào là mua hoặc bù đắp chi phí mua đất/nhà xưởng?
Trả DUY NHẤT JSON đúng schema sau:
{{output_schema}}

Mục đích vay:
{{purposes}}`;

function numbered(texts: readonly string[]): string {
  const body = texts.map((t, i) => `${i + 1}. ${t}`).join('\n');
  return body.length <= TEXT_CHAR_BUDGET ? body : `${body.slice(0, TEXT_CHAR_BUDGET)}…(đã cắt bớt)`;
}

type Overrides = Readonly<Record<string, string | undefined>>;

export function buildIncomeSourcePrompt(texts: readonly string[], overrides: Overrides = {}): string {
  return renderPrompt(overrides[INCOME_SOURCE_STEP] || INCOME_SOURCE_PROMPT_TEMPLATE, ['sources', 'output_schema'], {
    sources: untrustedBlock('untrusted_income_sources', numbered(texts)),
    output_schema: INCOME_SOURCE_OUTPUT_SCHEMA,
  });
}

export function buildLoanPurposePrompt(texts: readonly string[], overrides: Overrides = {}): string {
  return renderPrompt(overrides[LOAN_PURPOSE_STEP] || LOAN_PURPOSE_PROMPT_TEMPLATE, ['purposes', 'output_schema'], {
    purposes: untrustedBlock('untrusted_loan_purposes', numbered(texts)),
    output_schema: LOAN_PURPOSE_OUTPUT_SCHEMA,
  });
}
