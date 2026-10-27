// responses/ext-quality-eval.js
// Connector: ext-quality-eval — Quality & Risk Evaluator
// DU Cases: analyze:quality, analyze:risk
// Returns: JSON.stringify { score, grade, summary, findings[] }

'use strict';

function buildResponse(fields, files, filename) {
  const criteria = fields.criteria || '';
  const businessRules = fields.business_rules || '';

  const data = {
    score: 81,
    grade: 'B',
    summary: `Tài liệu "${filename}" đạt mức chất lượng khá tốt (81/100). Cấu trúc rõ ràng, lập luận logic nhưng còn tồn tại một số điểm rủi ro pháp lý và kỹ thuật cần được xem xét trước khi ký kết chính thức.`,
    evaluation_criteria: criteria || 'Đánh giá tổng quát chất lượng và rủi ro tài liệu',
    findings: [
      {
        category: 'Ngữ pháp & Văn phong',
        severity: 'LOW',
        description: 'Phát hiện 3 lỗi chính tả nhỏ tại mục 2.1 (trang 2) và mục 4.3 (trang 4). Câu văn ở một số đoạn còn dài và phức tạp.',
        recommendation: 'Kiểm tra lại chính tả và rút gọn các câu dài hơn 50 từ.',
      },
      {
        category: 'Rủi ro pháp lý',
        severity: 'HIGH',
        description: 'Điều khoản 7.2 quy định bồi thường "không giới hạn giá trị" — đây là điều khoản tiềm ẩn rủi ro pháp lý và tài chính rất lớn.',
        recommendation: 'Cần thêm điều khoản giới hạn trần bồi thường, đề xuất tối đa 200% giá trị hợp đồng.',
      },
      {
        category: 'Tính đầy đủ',
        severity: 'MEDIUM',
        description: 'Thiếu Phụ Lục C về Tiêu Chuẩn Chất Lượng Dịch Vụ (SLA). Hợp đồng đề cập đến SLA nhưng không có phụ lục đính kèm.',
        recommendation: 'Bổ sung Phụ lục C với các chỉ số KPI cụ thể: uptime ≥ 99.5%, thời gian phản hồi sự cố ≤ 4 giờ.',
      },
      {
        category: 'Tính nhất quán nội dung',
        severity: 'LOW',
        description: 'Điều 3.2 và Điều 9.1 có số liệu thanh toán không khớp nhau (500 triệu vs 520 triệu).',
        recommendation: 'Cần thống nhất con số thanh toán giữa điều 3.2 và điều 9.1.',
      },
    ],
    risk_level: 'MEDIUM',
    business_rules_applied: businessRules || 'Không có rule bổ sung',
    file_analyzed: filename,
  };

  return {
    content: JSON.stringify(data),
    model: fields.model || 'gpt-4o',
    mock: true,
  };
}

module.exports = { buildResponse };
