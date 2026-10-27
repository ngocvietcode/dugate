// responses/ext-doc-layout.js
// Connector: ext-doc-layout — Document Layout Parser
// DU Cases: ingest:parse, ingest:ocr, transform:convert
// Returns: Markdown text string

'use strict';

/**
 * @param {Record<string,string>} fields  — multipart text fields (prompt, model, output_format, language...)
 * @param {Array}                 files   — file metadata array
 * @param {string}                filename — primary file name
 * @returns {{ content: string, model: string, mock: boolean }}
 */
function buildResponse(fields, files, filename) {
  const outputFormat = fields.output_format || 'md';
  const language = fields.language || 'vi';
  const model = fields.model || 'doc-layout-v1';

  const content = `# Tài Liệu: ${filename}

## 1. Thông Tin Chung

| Thuộc tính | Giá trị |
|-----------|---------|
| Tên file | \`${filename}\` |
| Ngôn ngữ phát hiện | ${language === 'vi' ? 'Tiếng Việt' : language === 'en' ? 'English' : language} |
| Số trang | 4 |
| Định dạng | ${outputFormat.toUpperCase()} |

## 2. Nội Dung Chính

### 2.1 Giới Thiệu

Đây là nội dung được parse từ tài liệu \`${filename}\`. Hệ thống đã nhận diện thành công cấu trúc bố cục với đầy đủ heading, bảng biểu và danh sách.

### 2.2 Bảng Dữ Liệu Mẫu

| STT | Hạng mục | Đơn vị | Số lượng | Đơn giá (VND) | Thành tiền (VND) |
|-----|---------|--------|---------|--------------|-----------------|
| 1   | Dịch vụ tư vấn chiến lược | Tháng | 3 | 15,000,000 | 45,000,000 |
| 2   | Triển khai hệ thống | Lần | 1 | 80,000,000 | 80,000,000 |
| 3   | Bảo trì & hỗ trợ | Tháng | 12 | 5,000,000 | 60,000,000 |
| | | | | **Tổng cộng** | **185,000,000** |

### 2.3 Danh Sách Điều Khoản

1. **Điều khoản thanh toán:** Thanh toán trong vòng 30 ngày kể từ ngày nhận hóa đơn
2. **Điều khoản bảo hành:** Bảo hành 12 tháng kể từ ngày nghiệm thu
3. **Điều khoản bảo mật:** Cam kết bảo mật thông tin theo PDPA/GDPR

## 3. Footer

> Tài liệu được xử lý bởi model \`${model}\`.
> Parse thành công — 0 lỗi nhận dạng.

---
*[MOCK] Parsed by du-mock-service — ext-doc-layout*`;

  return { content, model, pages_processed: 4, mock: true };
}

module.exports = { buildResponse };
