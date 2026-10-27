// responses/ext-classifier.js
// Connector: ext-classifier — Document Classifier
// DU Cases: analyze:classify, workflows:disbursement (step 1)
// Returns: JSON.stringify { document_type, confidence, language, key_topics, logical_documents? }

'use strict';

const DOCUMENT_TYPES = [
  { type: 'Hợp đồng kinh tế', topics: ['điều khoản thanh toán', 'trách nhiệm pháp lý', 'thời hạn hợp đồng', 'bồi thường thiệt hại'] },
  { type: 'Hóa đơn VAT', topics: ['thông tin người bán', 'danh sách hàng hóa', 'thuế GTGT', 'tổng tiền thanh toán'] },
  { type: 'Báo cáo tài chính', topics: ['doanh thu', 'chi phí vận hành', 'lợi nhuận ròng', 'dòng tiền'] },
  { type: 'Hồ sơ nhân sự / CV', topics: ['kinh nghiệm làm việc', 'trình độ học vấn', 'kỹ năng chuyên môn', 'mục tiêu nghề nghiệp'] },
];

// Logical document templates for multi-doc files (workflow: disbursement)
const LOGICAL_DOC_SETS = [
  // Set A: Bộ chứng từ đầy đủ (3 loại)
  [
    { label: 'Hợp đồng tín dụng', pages: '1-5', confidence: 0.96 },
    { label: 'Hóa đơn GTGT', pages: '6', confidence: 0.91 },
    { label: 'Đề nghị giải ngân', pages: '7-8', confidence: 0.94 },
  ],
  // Set B: Bộ 2 loại
  [
    { label: 'Hợp đồng tín dụng', pages: '1-4', confidence: 0.97 },
    { label: 'Ủy nhiệm chi', pages: '5-6', confidence: 0.89 },
  ],
  // Set C: Đơn giản 1 loại 
  [
    { label: 'Hóa đơn GTGT', pages: '1-2', confidence: 0.98 },
  ],
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

  // ── Workflow extension: logical document splitting ──────────────────────
  // When the file looks like a multi-doc bundle, return logical_documents[]
  // Client can use page ranges to split the file if needed.
  const fileCount = files.length || 1;
  const setIdx = filename.length % LOGICAL_DOC_SETS.length;
  const logicalSet = LOGICAL_DOC_SETS[setIdx];

  data.logical_documents = logicalSet.map((doc, i) => ({
    id: `ld-${filename.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8)}-${i + 1}`,
    label: doc.label,
    pages: doc.pages,
    confidence: doc.confidence,
    source_file: filename,
  }));

  return {
    content: JSON.stringify(data),
    model: fields.model || 'gpt-4o-mini',
    mock: true,
  };
}

module.exports = { buildResponse };
