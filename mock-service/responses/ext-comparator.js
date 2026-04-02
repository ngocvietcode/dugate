// responses/ext-comparator.js
// Connector: ext-comparator — Document Comparator
// DU Cases: compare:diff, compare:semantic, compare:version
// Returns: JSON.stringify { similarity_score, summary, total_changes, differences[] }

'use strict';

function buildResponse(fields, files, filename) {
  const mode = fields.mode || 'semantic'; // diff, semantic, version
  const focus = fields.focus || '';
  
  // Note: For compare, engine typically sends 2 files (source_file and target_file)
  // in the files array. `files` will have length 2.
  const sourceFile = files[0] ? files[0].originalname : 'bản_gốc.docx';
  const targetFile = files[1] ? files[1].originalname : 'bản_sửa_đổi.pdf';

  let summary = `Đã so sánh ${sourceFile} và ${targetFile}. `;
  let differences = [];
  
  if (mode === 'version') {
    summary += `Phiên bản V2 có cập nhật quan trọng về quy trình phê duyệt tài chính, bổ sung các định mức chi tiêu mới và thay thế phụ lục năng lực phòng ban.`;
    differences = [
      {
         type: 'added',
         section: 'Quy trình phê duyệt (Chương 3)',
         original_text: '',
         changed_text: 'Mọi khoản chi trên 50 triệu phải có chữ ký của Kế toán trưởng và Giám đốc tài chính.',
         significance: 'high',
         explanation: 'Tăng cường kiểm soát nội bộ cho các chi phí lớn.',
      },
      {
         type: 'modified',
         section: 'Định mức tiếp khách (Phần 2.1)',
         original_text: 'Định mức 500.000đ/người đối với cấp trưởng phòng.',
         changed_text: 'Định mức 800.000đ/người đối với cấp trưởng phòng.',
         significance: 'medium',
         explanation: 'Điều chỉnh trần chi phí tiếp khách tăng do lạm phát.',
      },
      {
         type: 'removed',
         section: 'Phụ đính 1 - Báo cáo tháng',
         original_text: 'Phải nộp báo cáo giấy vào ngày 5 hàng tháng.',
         changed_text: '',
         significance: 'low',
         explanation: 'Bỏ yêu cầu nộp báo cáo bản cứng.',
      }
    ];
  } else if (mode === 'diff') {
     summary += `Chế độ Diff Text phát hiện 5 thay đổi ở mức độ ký tự.`;
     differences = [
       { type: 'modified', section: 'Mở bài', original_text: 'Công ty Cổ phần ABC', changed_text: 'CTCP ABC (Việt Nam)', significance: 'low', explanation: 'Thay đổi cách xưng hô của pháp nhân.' },
       { type: 'removed', section: 'Điều khoản bảo mật', original_text: 'Hiệu lực 3 năm.', changed_text: '', significance: 'medium', explanation: 'Xóa bớt quy định về thời hạn bảo mật.' },
     ];
  } else {
     // semantic
     summary += `Chế độ Semantic Compare cho thấy có 3 thay đổi làm thay đổi ý nghĩa/ngữ cảnh. Focus: ${focus || 'Mặc định'}.`;
     differences = [
       {
         type: 'modified',
         section: 'Điều 7.2 - Trách nhiệm bồi thường',
         original_text: 'Bên A bồi thường 100% giá trị thiệt hại',
         changed_text: 'Bên A bồi thường tối đa 50% giá trị hợp đồng khi có sự cố bất khả kháng',
         significance: 'high',
         explanation: 'Mức bồi thường đã được giảm xuống và bổ sung thêm điều kiện sự cố bất khả kháng.',
       },
       {
         type: 'added',
         section: 'Điều 12 - Điều khoản mới',
         original_text: '',
         changed_text: 'Bên B không được chuyển nhượng hợp đồng cho bên thứ ba dưới mọi hình thức',
         significance: 'high',
         explanation: 'Bổ sung quyền hạn chế người thụ hưởng. Thay đổi lớn về quyền định đoạt hợp đồng.',
       }
     ];
  }
  
  const total_changes = differences.length;
  // Calculate a fake similarity score
  const similarity_score = total_changes > 0 ? parseFloat((0.95 - (total_changes * 0.05)).toFixed(2)) : 1.0;

  const data = {
    similarity_score,
    summary,
    total_changes,
    differences,
    mode_applied: mode,
    focus_applied: focus,
  };

  return {
    content: JSON.stringify(data),
    model: fields.model || 'gpt-4o',
    mock: true,
  };
}

module.exports = { buildResponse };
