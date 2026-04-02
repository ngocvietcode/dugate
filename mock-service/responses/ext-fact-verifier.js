// responses/ext-fact-verifier.js
// Connector: ext-fact-verifier — Fact Verifier
// DU Cases: analyze:fact-check (step 2 — receives input_content from step 1)
// Returns: JSON.stringify { verdict, score, summary, checks[], discrepancies[] }

'use strict';

function buildResponse(fields, files, filename) {
  // input_content comes from ext-data-extractor step 1 (chained via pipeline)
  const inputContent = fields.input_content || '{}';
  const referenceData = fields.reference_data || '{}';

  // Try to detect if we have actual chained content
  let hasChainedInput = false;
  try {
    const parsed = JSON.parse(inputContent);
    hasChainedInput = Object.keys(parsed).length > 0;
  } catch {}

  const data = {
    verdict: 'WARNING',
    score: 78,
    summary: 'Phần lớn thông tin trong tài liệu trùng khớp với dữ liệu tham chiếu. Phát hiện 1 sai lệch số liệu quan trọng và 1 thông tin chưa thể xác minh.',
    chained_input_detected: hasChainedInput,
    checks: [
      {
        rule: 'Giá trị hợp đồng',
        status: 'FAIL',
        document_value: '120,000,000 VND',
        reference_value: '150,000,000 VND',
        explanation: 'Số liệu trong tài liệu thấp hơn 30 triệu so với dữ liệu gốc đã ký. Cần xác minh phiên bản hợp đồng đang dùng.',
      },
      {
        rule: 'Ngày hiệu lực hợp đồng',
        status: 'PASS',
        document_value: '01/01/2026',
        reference_value: '01/01/2026',
        explanation: 'Ngày hiệu lực khớp chính xác giữa tài liệu và dữ liệu tham chiếu.',
      },
      {
        rule: 'Tên các bên ký kết',
        status: 'PASS',
        document_value: 'Công ty ABC & Tập đoàn XYZ',
        reference_value: 'Công ty ABC & Tập đoàn XYZ',
        explanation: 'Tên hai bên khớp hoàn toàn.',
      },
      {
        rule: 'Mức lãi suất phạt chậm thanh toán',
        status: 'WARNING',
        document_value: '0.1%/ngày',
        reference_value: 'không xác định trong reference_data',
        explanation: 'Không có dữ liệu tham chiếu để đối chiếu. Cần bổ sung vào reference_data.',
      },
    ],
    discrepancies: [
      'Giá trị hợp đồng lệch 30,000,000 VND (tài liệu: 120M, tham chiếu: 150M)',
    ],
    file_analyzed: filename,
    reference_data_provided: referenceData !== '{}',
  };

  return {
    content: JSON.stringify(data),
    model: fields.model || 'gpt-4o',
    mock: true,
  };
}

module.exports = { buildResponse };
