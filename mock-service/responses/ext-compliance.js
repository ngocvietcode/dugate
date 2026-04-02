// responses/ext-compliance.js
// Connector: ext-compliance — Compliance Checker
// DU Cases: analyze:compliance
// Returns: JSON.stringify { verdict, score, summary, checks[] }

'use strict';

function buildResponse(fields, files, filename) {
  const criteria = fields.criteria || 'Kiểm tra tính hợp lệ của tài liệu';
  const businessRules = fields.business_rules || '';

  const data = {
    verdict: 'WARNING',
    score: 72,
    summary: `Tài liệu "${filename}" đáp ứng phần lớn các tiêu chuẩn yêu cầu. Tuy nhiên còn 2 điểm cần khắc phục trước khi phê duyệt chính thức.`,
    criteria_evaluated: criteria,
    checks: [
      {
        rule: 'Chữ ký đầy đủ của các bên',
        status: 'PASS',
        explanation: 'Đã xác nhận chữ ký của tất cả các bên liên quan tại trang cuối tài liệu.',
      },
      {
        rule: 'Con dấu hợp lệ',
        status: 'FAIL',
        explanation: 'Thiếu con dấu đỏ của Bên B (đơn vị tiếp nhận). Yêu cầu bổ sung trước khi công chứng.',
      },
      {
        rule: 'Đầy đủ thông tin pháp nhân',
        status: 'PASS',
        explanation: 'Mã số thuế, địa chỉ đăng ký kinh doanh và người đại diện pháp luật đã được điền đầy đủ.',
      },
      {
        rule: 'Điều khoản phạt không vượt ngưỡng cho phép',
        status: 'WARNING',
        explanation: 'Điều khoản 8.3 quy định mức phạt 18%/năm — tiệm cận ngưỡng 20% theo quy định pháp luật hiện hành.',
      },
      {
        rule: 'Thời hạn hiệu lực rõ ràng',
        status: 'PASS',
        explanation: 'Hợp đồng có điều khoản hiệu lực từ ngày 01/01/2026 đến 31/12/2026.',
      },
      {
        rule: 'Cơ chế giải quyết tranh chấp',
        status: 'FAIL',
        explanation: 'Không có điều khoản chỉ định tòa án hoặc trọng tài thương mại có thẩm quyền.',
      },
    ],
    business_rules_applied: businessRules || 'Không có rule bổ sung từ Admin',
    file_analyzed: filename,
  };

  return {
    content: JSON.stringify(data),
    model: fields.model || 'gpt-4o',
    mock: true,
  };
}

module.exports = { buildResponse };
