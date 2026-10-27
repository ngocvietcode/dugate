// Nhãn tiếng Việt của khóa trường trong `data` của chứng từ spec-v3 (D-103, LAC-R07). `doc_schemas` không có nhãn từng
// trường nên bảng nằm ở đây; giao diện (`app/loan-appraisal-v2/lib/dossier-view.ts`) và Loan Application Context dùng chung.
// Không chứa giá trị, chỉ nhãn.

export const FIELD_LABELS: Record<string, string> = {
  full_name: 'Họ và tên', id_number: 'Số định danh', id_type: 'Loại giấy tờ', id_issue_date: 'Ngày cấp giấy tờ', id_issue_place: 'Nơi cấp giấy tờ',
  previous_id_numbers: 'Số định danh cũ', date_of_birth: 'Ngày sinh', gender: 'Giới tính', nationality: 'Quốc tịch',
  permanent_address: 'Địa chỉ thường trú', current_address: 'Địa chỉ hiện tại', phone_number: 'Số điện thoại', tax_id: 'Mã số thuế',
  party_role: 'Vai trò', party_role_raw: 'Vai trò (nguyên văn)', representative_name: 'Người đại diện', representative_position: 'Chức vụ người đại diện',
  certificate_number: 'Số GCN', certificate_book_number: 'Số vào sổ', land_parcel_number: 'Số thửa', map_sheet_number: 'Số tờ bản đồ',
  apartment_number: 'Số căn hộ', building_name: 'Tòa nhà', project_name: 'Dự án', license_plate: 'Biển số', chassis_number: 'Số khung',
  engine_number: 'Số máy', registration_number: 'Số đăng ký', address: 'Địa chỉ', description: 'Mô tả', asset_type: 'Loại tài sản',
  usage_context_hint: 'Mục đích sử dụng', issue_date: 'Ngày cấp', valid_until: 'Hiệu lực đến', document_number: 'Số văn bản',
  issuing_authority: 'Cơ quan cấp', issue_place: 'Nơi cấp', document_title: 'Tên văn bản', requested_amount: 'Số tiền đề nghị vay',
  bank_proposed_amount: 'Số tiền cho vay', loan_term_months: 'Thời hạn vay (tháng)', interest_rate: 'Lãi suất (%/năm)', interest_rate_code: 'Mã biểu lãi suất',
  business_name: 'Tên hộ/doanh nghiệp', business_line: 'Ngành nghề', business_address: 'Địa chỉ kinh doanh', valuation_value: 'Giá trị định giá',
  marital_status: 'Tình trạng hôn nhân', has_existing_debt: 'Có nợ hiện hữu', existing_monthly_debt_payment: 'Trả nợ hiện hữu hàng tháng',
  usage_contexts: 'Mục đích sử dụng',
};

export const GROUP_LABELS: Record<string, string> = {
  parties: 'Người/tổ chức', assets: 'Tài sản', asset_details: 'Chi tiết tài sản', legal_info: 'Thông tin văn bản', fields: 'Thông tin',
  loan_info: 'Khoản vay', financial_info: 'Tài chính', business_info: 'Kinh doanh', income_sources: 'Nguồn thu', party_details: 'Chi tiết người',
};

/** Nhãn của đường dẫn: `parties[0].full_name` → "Người/tổ chức #1 · Họ và tên". */
export function labelOf(path: string): string {
  const parts = path.split('.');
  const out: string[] = [];
  for (const part of parts) {
    const m = part.match(/^([a-z0-9_]+)(?:\[(\d+)\])?$/i);
    if (!m) { out.push(part); continue; }
    const [, key, idx] = m;
    const base = GROUP_LABELS[key] ?? FIELD_LABELS[key] ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    out.push(idx !== undefined ? `${base} #${Number(idx) + 1}` : base);
  }
  return out.join(' · ');
}

/** Nhãn ngắn của trường chung (`parties[].full_name` → "Họ và tên"): chỉ giữ đoạn cuối, bỏ chỉ số mảng. */
export function fieldLabel(field: string): string {
  const full = labelOf(field.replace(/\[\]/g, '[0]'));
  return (full.split(' · ').pop() ?? full).replace(/ #\d+$/, '');
}
