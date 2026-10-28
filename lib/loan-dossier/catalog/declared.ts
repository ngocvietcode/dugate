// Chứng từ do chính khách hàng lập (lời khai): giá trị chỉ có trên các chứng từ này là `DECLARED`, không phải xác nhận độc lập (D-114).
// Dùng chung cho sổ Claim, LAC và hồ sơ 360 để ba nơi không tự định nghĩa khác nhau.
export const DECLARED_DOC_TYPES: ReadonlySet<string> = new Set([
  'loan_application', // Giấy đề nghị vay vốn kiêm phương án vay
  'income_statement', // Bảng kê thu nhập (mẫu MB01, khách hàng tự kê)
  'purchase_list', // Bảng kê mua hàng do khách hàng lập
]);

export const isDeclaredDocType = (docTypeKey: string): boolean => DECLARED_DOC_TYPES.has(docTypeKey);
