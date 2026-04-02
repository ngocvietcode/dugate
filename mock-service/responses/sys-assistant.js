// mock-service/responses/sys-assistant.js
module.exports = {
  buildResponse: (fields) => {
    const prompt = (fields.query || '').toLowerCase();
    
    // We try to extract user message directly or just search the whole prompt
    let responseContent = "Chào bạn! Tôi là trợ lý hệ thống DUGate. Bạn hãy cho tôi biết bạn đang cần xử lý tài liệu như thế nào để tôi có thể tư vấn tính năng phù hợp nhất nhé.";

    if (prompt.includes('so sánh') || prompt.includes('compare') || prompt.includes('đối chiếu')) {
      responseContent = "Để so sánh tài liệu, bạn có thể sử dụng tính năng **So sánh Tài liệu** tại Endpoint `/compare`. DUGate hỗ trợ phân tích sự khác biệt từng dòng, kiểm tra sai lệch ngữ nghĩa (semantic diff) rất hiệu quả.";
    } else if (prompt.includes('trích xuất') || prompt.includes('extract') || prompt.includes('bóc tách') || prompt.includes('lấy dữ liệu')) {
      responseContent = "Để bóc tách thông tin cấu trúc, bạn vui lòng sử dụng tính năng **Trích xuất Dữ liệu** tại Endpoint `/extract` nhé. Hệ thống hỗ trợ lấy dữ liệu từ Hóa đơn, Hợp đồng, CCCD ra thẳng định dạng JSON.";
    } else if (prompt.includes('phân loại') || prompt.includes('đánh giá') || prompt.includes('classify') || prompt.includes('tuân thủ')) {
      responseContent = "Với bài toán này, bạn dùng tính năng **Phân tích & Đánh giá** tại Endpoint `/analyze` là chuẩn nhất. Nó hỗ trợ phân loại (classify), kiểm tra rủi ro (risk), và audit pháp lý (compliance).";
    } else if (prompt.includes('bôi đen') || prompt.includes('redact') || prompt.includes('ảo hóa') || prompt.includes('ẩn thông tin')) {
      responseContent = "Với yêu cầu che thông tin nhạy cảm, bạn hãy dùng Endpoint `/transform` và chọn mode `redact`. DUGate sẽ tự động dò tìm và bôi đen (mask) các dữ liệu PII liên quan.";
    } else if (prompt.includes('dịch') || prompt.includes('translate') || prompt.includes('viết lại') || prompt.includes('rewrite') || prompt.includes('chuyển tệp')) {
      responseContent = "Bạn hãy dùng Endpoint `/transform` nhé. Tại đây có đầy đủ chức năng chuyển định dạng tài liệu, dịch thuật đa ngôn ngữ và viết lại (rewrite) câu từ mượt mà hơn.";
    } else if (prompt.includes('tạo') || prompt.includes('sinh') || prompt.includes('generate') || prompt.includes('tóm tắt') || prompt.includes('hỏi đáp') || prompt.includes('qa')) {
      responseContent = "Bạn muốn AI tự động sinh nội dung (tóm tắt, trả lời Q&A, viết báo cáo) từ tài liệu đúng không? Hãy dùng ngay Endpoint `/generate` nhé.";
    } else if (prompt.includes('ocr') || prompt.includes('parse') || prompt.includes('scan') || prompt.includes('nhập')) {
      responseContent = "Để tiền xử lý file PDF/scan hoặc bóc tách Layout chuẩn Markdown, Endpoint `/ingest` chính là điểm khởi đầu cho mọi pipeline của DUGate.";
    }

    return {
      response: responseContent,
      usage: { prompt_tokens: 210, completion_tokens: 55, total_tokens: 265 },
      mock: true
    };
  }
};
