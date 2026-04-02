// responses/ext-redactor.js
// Connector: ext-redactor — PII Redactor & Template Filler
// DU Cases: transform:redact, transform:template
// Returns: Markdown string (PII masked OR template filled)

'use strict';

function buildResponse(fields, files, filename) {
  const redactPatterns = fields.redact_patterns || '';
  const template = fields.template || '';

  // Detect which sub-task based on available fields
  const isTemplate = !!template;

  let content;

  if (isTemplate) {
    // transform:template — Mail Merge
    content = `# Tài Liệu Xuất Từ Template

> **Thông tin xử lý:** Template đã được áp dụng với dữ liệu từ file \`${filename}\`

---

**Kính gửi:** [Tên Khách Hàng: Nguyễn Văn An]

Căn cứ theo yêu cầu dịch vụ số **[Mã Hợp Đồng: HĐ-2026-0042]** ngày **[Ngày Ký: 01/04/2026]**,

Chúng tôi trân trọng thông báo:

1. Dịch vụ **[Tên Dịch Vụ: Tư vấn chiến lược kinh doanh]** đã được kích hoạt thành công.
2. Thời hạn sử dụng: từ **[Ngày Bắt Đầu: 01/04/2026]** đến **[Ngày Kết Thúc: 31/03/2027]**
3. Phí dịch vụ: **[Giá Trị HĐ: 360,000,000 VND]** (Đã VAT)

Mọi thắc mắc xin liên hệ:
- Email: support@company.vn
- Hotline: 1800-xxxx (miễn phí)

Trân trọng,
**[Tên Người Ký: Phòng Dịch Vụ Khách Hàng]**

---
*[MOCK] Template applied by du-mock-service — ext-redactor*`;
  } else {
    // transform:redact — PII Masking
    content = `# Tài Liệu Đã Ẩn Thông Tin Nhạy Cảm

> **Thông tin xử lý:**
> - File gốc: \`${filename}\`
> - Patterns đã áp dụng: ${redactPatterns || 'Mặc định (CCCD, SĐT, email, STK ngân hàng, địa chỉ)'}
> - Tổng số trường đã che: **8 trường**

---

## Thông Tin Hợp Đồng

**Bên A:** Công ty TNHH [REDACTED]
**Đại diện:** [REDACTED] — Chức vụ: Giám đốc
**Địa chỉ Bên A:** [REDACTED]
**Mã số thuế:** [REDACTED]

**Bên B:** Tập đoàn [REDACTED]
**Đại diện:** [REDACTED] — Chức vụ: Tổng Giám Đốc
**Địa chỉ Bên B:** [REDACTED]

---

## Điều Khoản Thanh Toán

- Số tài khoản Bên A: [REDACTED]
- Số tài khoản Bên B: [REDACTED]
- Giá trị hợp đồng: 360,000,000 VND *(Số tiền không bị che - không phải PII)*

---

## Thông Tin Liên Hệ

- Email liên hệ Bên A: [REDACTED]
- Số điện thoại Bên A: [REDACTED]
- CCCD người đại diện Bên A: [REDACTED]

---

*Ghi chú: Tài liệu đã được xử lý ẩn danh hóa. Các trường [REDACTED] đã bị che theo chính sách bảo mật.*
*[MOCK] Redacted by du-mock-service — ext-redactor*`;
  }

  return {
    content,
    model: fields.model || 'gpt-4o',
    redacted_fields: isTemplate ? 0 : 8,
    task: isTemplate ? 'template' : 'redact',
    mock: true,
  };
}

module.exports = { buildResponse };
