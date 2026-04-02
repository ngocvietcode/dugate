// responses/ext-data-extractor.js
// Connector: ext-data-extractor — Structured Data Extractor
// DU Cases: extract:invoice|contract|id-card|receipt|table|custom|po|payslip
//           analyze:fact-check (step 1)
// Returns: JSON.stringify of object matching the requested type/fields

'use strict';

// ─── Mock data per extraction type ───────────────────────────────────────────

const MOCK_DATA = {
  invoice: {
    vendor_name: 'Công ty TNHH Mock Technology Solutions',
    vendor_address: '45 Nguyễn Thị Minh Khai, Phường 6, Quận 3, TP.HCM',
    invoice_number: 'INV-2026-04-0042',
    invoice_date: '2026-04-01',
    due_date: '2026-05-01',
    line_items: [
      { description: 'Dịch vụ phát triển phần mềm tháng 3/2026', quantity: 1, unit_price: 50000000, amount: 50000000 },
      { description: 'Bản quyền phần mềm Document AI', quantity: 3, unit_price: 5000000, amount: 15000000 },
      { description: 'Chi phí hạ tầng cloud (AWS)', quantity: 1, unit_price: 8500000, amount: 8500000 },
    ],
    subtotal: 73500000,
    tax_amount: 7350000,
    total_amount: 80850000,
    currency: 'VND',
    payment_method: 'Chuyển khoản ngân hàng',
    bank_account: '0123456789 - Ngân hàng Vietcombank - CN TP.HCM',
  },

  contract: {
    parties: [
      { name: 'Công ty Cổ phần ABC Technology', role: 'Bên A (Bên Cung Cấp)', address: '10 Phạm Ngọc Thạch, Q.3, TP.HCM' },
      { name: 'Tập đoàn XYZ Holdings', role: 'Bên B (Bên Sử Dụng)', address: '100 Lý Thường Kiệt, Hoàn Kiếm, Hà Nội' },
    ],
    effective_date: '2026-01-01',
    expiry_date: '2026-12-31',
    contract_value: 360000000,
    payment_terms: 'Thanh toán hàng tháng vào ngày 15, trong vòng 15 ngày kể từ ngày xuất hóa đơn',
    terms: [
      'Bên A cam kết cung cấp dịch vụ 24/7 với uptime tối thiểu 99.5%',
      'Bên B thanh toán đúng hạn, chậm thanh toán bị phạt 0.1%/ngày',
      'Hai bên cam kết bảo mật thông tin và không tiết lộ cho bên thứ ba',
    ],
    obligations: [
      'Bên A: Cung cấp dịch vụ đúng SLA, báo cáo hàng tháng',
      'Bên B: Cung cấp dữ liệu đầu vào đúng định dạng, thanh toán đúng hạn',
    ],
    penalties: [
      'Chậm thanh toán: phạt 0.1%/ngày trên số tiền chậm',
      'Vi phạm bảo mật: bồi thường tối đa 200% giá trị hợp đồng',
    ],
    signatures: [
      { name: 'Nguyễn Văn Minh', title: 'Tổng Giám Đốc - Bên A', date: '2025-12-28' },
      { name: 'Trần Thị Lan', title: 'Giám Đốc Tài Chính - Bên B', date: '2025-12-29' },
    ],
    governing_law: 'Pháp luật nước Cộng hòa Xã hội Chủ nghĩa Việt Nam',
  },

  'id-card': {
    full_name: 'NGUYỄN VĂN AN',
    id_number: '079188001234',
    date_of_birth: '15/08/1988',
    gender: 'Nam',
    nationality: 'Việt Nam',
    place_of_origin: 'Hà Nội',
    place_of_residence: '123 Đường Lê Văn Lương, Phường Tân Hưng, Quận 7, TP.HCM',
    issue_date: '20/03/2019',
    expiry_date: '20/03/2029',
    issued_by: 'Cục Cảnh sát quản lý hành chính về trật tự xã hội',
  },

  receipt: {
    merchant_name: 'Siêu thị Co.opmart Quận 7',
    merchant_address: '168 Nguyễn Thị Thập, Phường Tân Phú, Quận 7, TP.HCM',
    receipt_number: 'R-20260401-00789',
    receipt_date: '2026-04-01',
    items: [
      { name: 'Nước suối Aquafina 1.5L (lốc 6)', quantity: 2, price: 48000 },
      { name: 'Bánh mì sandwich KINH ĐÔ', quantity: 3, price: 25000 },
      { name: 'Sữa tươi Vinamilk 1L', quantity: 1, price: 32000 },
      { name: 'Kẹo cao su Orbit (hộp 14V)', quantity: 2, price: 18000 },
    ],
    subtotal: 197000,
    tax: 19700,
    total: 216700,
    payment_method: 'Thẻ ATM Vietcombank',
  },

  table: [
    ['STT', 'Tên sản phẩm', 'Mã SP', 'Đơn vị', 'Tồn kho', 'Đơn giá (VND)', 'Giá trị (VND)'],
    ['1', 'Laptop Dell XPS 15 9530', 'DELL-XPS15', 'Cái', '12', '45,000,000', '540,000,000'],
    ['2', 'Màn hình LG 27UK850-W', 'LG-27UK850', 'Cái', '25', '12,500,000', '312,500,000'],
    ['3', 'Bàn phím cơ Keychron K2', 'KEY-K2-V2', 'Cái', '50', '1,800,000', '90,000,000'],
    ['4', 'Chuột Logitech MX Master 3', 'LOGI-MXM3', 'Cái', '40', '2,200,000', '88,000,000'],
    ['5', 'Tai nghe Sony WH-1000XM5', 'SONY-WH5', 'Cái', '15', '8,900,000', '133,500,000'],
    ['TỔNG', '', '', '', '142', '', '1,164,000,000'],
  ],

  po: {
    po_number: 'PO-2026-04-001',
    po_date: '2026-04-01',
    buyer: { name: 'Công ty ABC', address: 'TP.HCM' },
    supplier: { name: 'Công ty XYZ Supply', address: 'Hà Nội' },
    delivery_date: '2026-04-30',
    items: [
      { sku: 'IT-001', description: 'Laptop Dell XPS', quantity: 5, unit_price: 35000000, total: 175000000 },
      { sku: 'IT-002', description: 'Màn hình 27"', quantity: 10, unit_price: 8000000, total: 80000000 },
    ],
    subtotal: 255000000,
    tax: 25500000,
    grand_total: 280500000,
    payment_terms: 'Net 30',
    delivery_terms: 'DAP kho bên mua',
  },

  payslip: {
    employee_name: 'Nguyễn Thị Bích Lan',
    employee_id: 'EMP-2024-0156',
    department: 'Phòng Công nghệ thông tin',
    period: 'Tháng 3/2026',
    basic_salary: 25000000,
    allowances: [
      { name: 'Phụ cấp ăn trưa', amount: 730000 },
      { name: 'Phụ cấp xăng xe', amount: 500000 },
      { name: 'Phụ cấp điện thoại', amount: 300000 },
    ],
    deductions: [
      { name: 'BHXH (8%)', amount: 2000000 },
      { name: 'BHYT (1.5%)', amount: 375000 },
      { name: 'BHTN (1%)', amount: 250000 },
      { name: 'Thuế TNCN', amount: 1200000 },
    ],
    gross_salary: 26530000,
    net_salary: 22705000,
    bank_account: '0987654321 - Techcombank',
  },

  custom: {
    ten_khach: 'Trần Văn Bình',
    sdt: '0912 345 678',
    dia_chi_giao_hang: '789 Đường Võ Văn Tần, Phường 6, Quận 3, TP.HCM',
    ghi_chu: 'Giao giờ hành chính từ 8h-17h, gọi trước 30 phút',
    tong_tien: '1,250,000 VND',
    trang_thai: 'Chờ xác nhận',
  },
};

// ─── Main ─────────────────────────────────────────────────────────────────────

function buildResponse(fields, files, filename) {
  // Detect extraction type from form fields
  // 'type' field used by extract endpoint
  // 'task' used by analyze:fact-check step 1
  const type = fields.type || fields.task || 'invoice';

  let data = MOCK_DATA[type];

  if (!data) {
    // Fallback: generic custom response
    data = {
      extracted_fields: fields.fields || 'không xác định',
      note: `Không có template mẫu cho type="${type}". Trả về dữ liệu generic.`,
      items: [
        { field: 'Trường 1', value: 'Giá trị mẫu 1' },
        { field: 'Trường 2', value: 'Giá trị mẫu 2' },
      ],
    };
  }

  // content must be a JSON string (not an object)
  const content = JSON.stringify(data, null, 0);

  return {
    content,
    model: fields.model || 'gpt-4o',
    mock: true,
  };
}

module.exports = { buildResponse };
