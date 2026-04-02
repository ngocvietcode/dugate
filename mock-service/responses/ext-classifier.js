// responses/ext-classifier.js
// Connector: ext-classifier — Document Classifier
// DU Cases: analyze:classify
// Returns: JSON.stringify { document_type, confidence, language, key_topics }

'use strict';

const DOCUMENT_TYPES = [
  { type: 'Hợp đồng kinh tế', topics: ['điều khoản thanh toán', 'trách nhiệm pháp lý', 'thời hạn hợp đồng', 'bồi thường thiệt hại'] },
  { type: 'Hóa đơn VAT', topics: ['thông tin người bán', 'danh sách hàng hóa', 'thuế GTGT', 'tổng tiền thanh toán'] },
  { type: 'Báo cáo tài chính', topics: ['doanh thu', 'chi phí vận hành', 'lợi nhuận ròng', 'dòng tiền'] },
  { type: 'Hồ sơ nhân sự / CV', topics: ['kinh nghiệm làm việc', 'trình độ học vấn', 'kỹ năng chuyên môn', 'mục tiêu nghề nghiệp'] },
];

function buildResponse(fields, files, filename) {
  const categories = fields.categories || '';

  // Pick a deterministic "type" based on filename for consistent mock results
  const idx = filename.charCodeAt(0) % DOCUMENT_TYPES.length;
  const picked = DOCUMENT_TYPES[idx];

  const data = {
    document_type: picked.type,
    confidence: parseFloat((0.82 + Math.random() * 0.15).toFixed(2)),
    language: 'vi',
    key_topics: picked.topics,
    candidate_categories: categories ? categories.split(',').map((c) => c.trim()) : [],
    file_analyzed: filename,
  };

  return {
    content: JSON.stringify(data),
    model: fields.model || 'gpt-4o-mini',
    mock: true,
  };
}

module.exports = { buildResponse };
