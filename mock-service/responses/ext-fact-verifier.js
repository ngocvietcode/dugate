// responses/ext-fact-verifier.js
// Connector: ext-fact-verifier — Fact Verifier / Cross-Check
// DU Cases: analyze:fact-check (step 2), workflows:disbursement (step 3)
// Returns: JSON.stringify { verdict, score, summary, checks[], discrepancies[] }

'use strict';

function buildResponse(fields, files, filename) {
  // input_content comes from ext-data-extractor step 1 (chained via pipeline)
  const inputContent = fields.input_content || '{}';
  const referenceData = fields.reference_data || '{}';

  // Try to detect if we have actual chained input
  let hasChainedInput = false;
  try {
    const parsed = JSON.parse(inputContent);
    hasChainedInput = Object.keys(parsed).length > 0;
  } catch {}

  // Detect if this is a disbursement workflow cross-check (richer response)
  let hasResolutionRef = false;
  try {
    const ref = JSON.parse(referenceData);
    hasResolutionRef = !!(ref.so_nq || ref.resolution_id || ref.han_muc);
  } catch {}

  let data;

  if (hasResolutionRef) {
    // ── Disbursement Cross-Check Response ──────────────────────────────────
    data = {
      verdict: 'WARNING',
      score: 72,
      summary: 'Phát hiện 1 vi phạm nghiêm trọng (vượt hạn mức) và 2 cảnh báo cần làm rõ. 9/12 hạng mục tuân thủ đầy đủ.',
      cross_check_report: {
        status: 'ISSUES_FOUND',
        total_checks: 12,
        passed: 9,
        warnings: 2,
        errors: 1,
      },
      checks: [
        {
          rule: 'Giá trị giải ngân',
          status: 'PASS',
          document_value: '2,500 triệu VND',
          reference_value: '2,500 triệu VND',
          explanation: 'Giá trị giải ngân khớp với Nghị quyết phê duyệt.',
        },
        {
          rule: 'Lãi suất áp dụng',
          status: 'PASS',
          document_value: '8.5%/năm',
          reference_value: '8.5%/năm (theo NQ)',
          explanation: 'Lãi suất khớp chính xác.',
        },
        {
          rule: 'Tài sản đảm bảo',
          status: 'PASS',
          document_value: 'QSDĐ tại 123 Láng Hạ, Đống Đa',
          reference_value: 'QSDĐ tại 123 Láng Hạ',
          explanation: 'Tài sản đảm bảo khớp (địa chỉ chi tiết hơn NQ).',
        },
        {
          rule: 'Thời hạn vay',
          status: 'WARNING',
          document_value: '18 tháng',
          reference_value: '12 tháng',
          explanation: 'Thời hạn thực tế dài hơn NQ quy định 6 tháng. Cần phê duyệt bổ sung.',
          severity: 'warning',
        },
        {
          rule: 'Mục đích sử dụng vốn',
          status: 'WARNING',
          document_value: 'Bổ sung VLĐ + Mua sắm TSCĐ',
          reference_value: 'Bổ sung vốn lưu động',
          explanation: 'Mục đích mở rộng hơn so với NQ phê duyệt. Cần làm rõ tỷ trọng phân bổ.',
          severity: 'warning',
        },
        {
          rule: 'Hạn mức tín dụng',
          status: 'FAIL',
          document_value: '3,500 triệu VND',
          reference_value: '3,000 triệu VND',
          explanation: 'Vượt hạn mức Nghị quyết 500 triệu VND (16.7%). Cần phê duyệt HĐTD cấp TW.',
          severity: 'error',
        },
        {
          rule: 'Phí quản lý khoản vay',
          status: 'PASS',
          document_value: '0.5%',
          reference_value: '0.5%',
          explanation: 'Phí quản lý khớp chính xác.',
        },
        {
          rule: 'Phương thức trả nợ',
          status: 'PASS',
          document_value: 'Trả gốc cuối kỳ',
          reference_value: 'Trả gốc cuối kỳ',
          explanation: 'Phương thức trả nợ khớp.',
        },
        {
          rule: 'Ngày giải ngân',
          status: 'PASS',
          document_value: '25/03/2024 (ngày 25)',
          reference_value: 'Trong vòng 30 ngày',
          explanation: 'Ngày giải ngân nằm trong khung cho phép.',
        },
      ],
      discrepancies: [
        'Hạn mức tín dụng vượt NQ: 3,500M vs 3,000M (chênh 500M = 16.7%)',
        'Thời hạn vay: 18 tháng vs 12 tháng theo NQ',
        'Mục đích SD vốn mở rộng thêm Mua sắm TSCĐ',
      ],
      resolution_ref: 'NQ-HĐQT-2024/015',
      checked_at: new Date().toISOString(),
      chained_input_detected: hasChainedInput,
      file_analyzed: filename,
      reference_data_provided: true,
    };
  } else {
    // ── Generic Fact-Check Response (backward-compatible) ──────────────────
    data = {
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
  }

  return {
    content: JSON.stringify(data),
    model: fields.model || 'gpt-4o',
    mock: true,
  };
}

module.exports = { buildResponse };
