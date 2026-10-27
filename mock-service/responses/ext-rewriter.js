// responses/ext-rewriter.js
// Connector: ext-rewriter — Content Rewriter
// DU Cases: transform:rewrite
// Returns: Markdown string (rewritten text)

'use strict';

const STYLE_DESCRIPTIONS = {
  academic:       'hàn lâm, trích dẫn rõ ràng, lập luận chặt chẽ',
  executive:      'điều hành, súc tích, tập trung vào kết quả và quyết định',
  simplified:     'đơn giản hóa, dễ hiểu, phù hợp người không chuyên',
  bullet_points:  'gạch đầu dòng, ngắn gọn, dễ scan nhanh',
  formal:         'trang trọng, chuẩn mực văn phong công sở',
  casual:         'thân thiện, gần gũi, không cứng nhắc',
};

function buildResponse(fields, files, filename) {
  const style = fields.style || 'formal';
  const tone = fields.tone || 'formal';
  const styleDesc = STYLE_DESCRIPTIONS[style] || style;

  const content = `# Tài Liệu Đã Được Viết Lại

> **Thông tin xử lý:**
> - File gốc: \`${filename}\`
> - Phong cách: **${style}** — ${styleDesc}
> - Giọng điệu: **${tone}**

---

## Tóm Tắt Điều Hành

Sau quá trình phân tích và tái cấu trúc theo phong cách **${style}**, tài liệu đã được viết lại với nội dung rõ ràng, mạch lạc và phù hợp với đối tượng người đọc mục tiêu.

## Các Điểm Chính

${style === 'bullet_points' || style === 'simplified' ? `
- **Mục tiêu chiến lược:** Tăng trưởng doanh thu 35% trong năm 2026
- **Phương thức thực hiện:** Mở rộng kênh phân phối B2B và digital marketing
- **Nguồn lực cần thiết:** Ngân sách 2.5 tỷ VND, nhân sự 15 người
- **Timeline:** Hoàn thành trước Q3/2026
- **KPI đo lường:** Doanh thu, tỷ lệ chuyển đổi khách hàng mới, NPS score
` : `
### 1. Định Hướng Chiến Lược

Tổ chức xác định mục tiêu tăng trưởng doanh thu 35% trong năm tài chính 2026 thông qua việc mở rộng hệ thống phân phối B2B kết hợp với các chiến dịch tiếp thị số hóa có chiều sâu.

### 2. Kế Hoạch Triển Khai

Để đạt được mục tiêu đề ra, ban lãnh đạo phê duyệt ngân sách đầu tư 2.5 tỷ đồng và bổ sung đội ngũ nhân sự chuyên trách gồm 15 vị trí. Dự kiến hoàn thành toàn bộ giai đoạn triển khai trước quý 3/2026.

### 3. Chỉ Tiêu Đánh Giá

Hiệu quả chiến lược được đo lường qua ba chỉ số cốt lõi: doanh thu tăng trưởng, tỷ lệ chuyển đổi khách hàng mới, và điểm hài lòng khách hàng (NPS).
`}

## Khuyến Nghị

> Ưu tiên triển khai kênh digital trước Q2/2026 để tối ưu ngân sách Marketing và đón đầu xu hướng thị trường.

---
*[MOCK] Rewritten by du-mock-service — ext-rewriter (gpt-4o)*`;

  return {
    content,
    model: fields.model || 'gpt-4o',
    mock: true,
  };
}

module.exports = { buildResponse };
