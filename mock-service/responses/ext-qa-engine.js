// responses/ext-qa-engine.js
// Connector: ext-qa-engine — Document QA Engine
// DU Cases: generate:qa
// Returns: JSON.stringify { answers[] }

'use strict';

function buildResponse(fields, files, filename) {
  const questionsParam = fields.questions || '';
  
  let questions = [];
  try {
    // Attempt to parse if it's sent as a JSON array string
    questions = JSON.parse(questionsParam);
  } catch {
    // If not valid JSON, split by comma or newline
    questions = questionsParam.split(/[,\n]/).map(q => q.trim()).filter(q => q);
  }

  if (questions.length === 0) {
    questions = ['Nội dung chính của tài liệu là gì?']; // Fallback question
  }

  const answers = questions.map((q, idx) => {
    // Mock different confidence levels and answers based on index
    if (idx === 0) {
      return {
        question: q,
        answer: 'Tài liệu đề cập đến các tiêu chuẩn kỹ thuật số hóa tài liệu và quy trình bảo mật dữ liệu khách hàng theo tiêu chuẩn ISO.',
        confidence: 0.95,
        source_quote: 'Chương 2: Áp dụng quy trình chuẩn theo bộ tiêu chuẩn ISO/IEC 27001 cho toàn bộ dữ liệu hệ thống.',
      };
    } else if (idx === 1) {
       return {
        question: q,
        answer: 'Trách nhiệm bồi thường thuộc về Bên cung cấp dịch vụ trong trường hợp xảy ra sự cố do lỗi chủ quan.',
        confidence: 0.88,
        source_quote: 'Điều 5.2: Bên A có trách nhiệm bồi thường mọi thiệt hại trực tiếp phát sinh do lỗi chủ quan của mình.',
      };
    } else {
       return {
        question: q,
        answer: 'Không tìm thấy thông tin cụ thể trả lời cho câu hỏi này trong tài liệu đính kèm.',
        confidence: 0.15,
        source_quote: null,
      };
    }
  });

  const data = {
    answers,
    file_analyzed: filename,
    total_questions: questions.length
  };

  return {
    content: JSON.stringify(data),
    model: fields.model || 'gpt-4o',
    mock: true,
  };
}

module.exports = { buildResponse };
