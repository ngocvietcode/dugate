// responses/ext-sentiment.js
// Connector: ext-sentiment — Sentiment Analyzer
// DU Cases: analyze:sentiment
// Returns: JSON.stringify { overall_sentiment, confidence, aspects }

'use strict';

function buildResponse(fields, files, filename) {
  const data = {
    overall_sentiment: 'POSITIVE',
    confidence: 0.87,
    tone: 'Chuyên nghiệp, tích cực',
    aspects: [
      { aspect: 'Chất lượng dịch vụ', sentiment: 'POSITIVE', score: 0.92, evidence: 'Khách hàng đánh giá cao sự chuyên nghiệp và nhanh chóng' },
      { aspect: 'Giá cả / Chi phí', sentiment: 'NEUTRAL', score: 0.55, evidence: 'Không có nhận xét rõ ràng về giá cả' },
      { aspect: 'Thời gian xử lý', sentiment: 'POSITIVE', score: 0.78, evidence: 'Phản hồi nhanh trong vòng 2 giờ làm việc' },
      { aspect: 'Hỗ trợ sau bán hàng', sentiment: 'NEGATIVE', score: 0.33, evidence: 'Cần cải thiện quy trình xử lý khiếu nại' },
    ],
    summary: `Tài liệu "${filename}" thể hiện thái độ tích cực tổng thể. Điểm nổi bật là chất lượng dịch vụ được đánh giá cao, nhưng cần cải thiện mảng hỗ trợ khách hàng sau bán hàng.`,
    file_analyzed: filename,
  };

  return {
    content: JSON.stringify(data),
    model: fields.model || 'gpt-4o-mini',
    mock: true,
  };
}

module.exports = { buildResponse };
