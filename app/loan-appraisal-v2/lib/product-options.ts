// Lựa chọn sản phẩm và luồng cho giao diện thẩm định, đọc thẳng từ loan_products.json + checklist_programs.json.
// Đọc JSON trực tiếp (không qua bộ kiểm zod của catalog) để không kéo zod vào bundle trình duyệt. Hàm thuần, test bằng dữ liệu truyền vào.
import loanProducts from '@/lib/loan-dossier/catalog/data/loan_products.json';
import checklistPrograms from '@/lib/loan-dossier/catalog/data/checklist_programs.json';

export interface ProductOption { value: string; label: string }
export interface FlowOption { value: string; label: string }

interface ProductsFile { default_product_code: string; products: Array<{ product_code: string; name: string }> }
interface ProgramsFile { programs: Array<{ product_codes: string[]; flows: Array<{ flow_key: string; flow_label: string }> }> }

export function productOptions(file: ProductsFile = loanProducts): ProductOption[] {
  return file.products.map((p) => ({ value: p.product_code, label: p.name }));
}

export function defaultProductCode(file: ProductsFile = loanProducts): string {
  return file.default_product_code;
}

/** Các luồng của chương trình checklist của sản phẩm; sản phẩm lạ hoặc chưa có chương trình → danh sách rỗng. */
export function flowOptionsFor(productCode: string, file: ProgramsFile = checklistPrograms): FlowOption[] {
  const program = file.programs.find((p) => p.product_codes.includes(productCode));
  return program ? program.flows.map((f) => ({ value: f.flow_key, label: f.flow_label })) : [];
}

/** Luồng mặc định = luồng đầu của chương trình (cùng quy tắc với `defaultFlow` ở server). */
export function defaultFlowFor(productCode: string, file: ProgramsFile = checklistPrograms): string | undefined {
  return flowOptionsFor(productCode, file)[0]?.value;
}

/** Giữ luồng hiện tại nếu còn hợp lệ cho sản phẩm; ngược lại về luồng mặc định của sản phẩm. */
export function coerceFlow(productCode: string, flow: string | undefined, file: ProgramsFile = checklistPrograms): string | undefined {
  const options = flowOptionsFor(productCode, file);
  return options.some((o) => o.value === flow) ? flow : options[0]?.value;
}

export const PRODUCT_OPTIONS: ReadonlyArray<ProductOption> = productOptions();
export const DEFAULT_PRODUCT_CODE: string = defaultProductCode();
