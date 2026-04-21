// responses/ext-doc-compare.js
// Connector: ext-doc-compare — Document Structure Analyzer & Section Comparator
// DU Cases: workflows:doc-compare (step 1: toc, step 2: compare)
// Returns: JSON.stringify { TocExtractionResult | DocCompareResult }

'use strict';

function buildTocResponse(doc1Name, doc2Name) {
  return {
    doc1_name: doc1Name,
    doc1_toc: [
      {
        number: '1', title: 'Quy định chung', level: 1,
        children: [
          { number: '1.1', title: 'Phạm vi áp dụng', level: 2, children: [] },
          { number: '1.2', title: 'Đối tượng áp dụng', level: 2, children: [] },
          { number: '1.3', title: 'Giải thích từ ngữ', level: 2, children: [] },
        ],
      },
      {
        number: '2', title: 'Quy trình thực hiện', level: 1,
        children: [
          { number: '2.1', title: 'Tiếp nhận hồ sơ', level: 2, children: [] },
          {
            number: '2.2', title: 'Thẩm định hồ sơ', level: 2,
            children: [
              { number: '2.2.1', title: 'Thẩm định tính đầy đủ', level: 3, children: [] },
              { number: '2.2.2', title: 'Thẩm định tính hợp lệ', level: 3, children: [] },
            ],
          },
          { number: '2.3', title: 'Phê duyệt', level: 2, children: [] },
          { number: '2.4', title: 'Thực hiện và lưu hồ sơ', level: 2, children: [] },
        ],
      },
      {
        number: '3', title: 'Trách nhiệm các bên', level: 1,
        children: [
          { number: '3.1', title: 'Trách nhiệm của Cán bộ tiếp nhận', level: 2, children: [] },
          { number: '3.2', title: 'Trách nhiệm của Trưởng phòng', level: 2, children: [] },
        ],
      },
      {
        number: '4', title: 'Biểu mẫu', level: 1,
        children: [
          { number: '4.1', title: 'Biểu mẫu tiếp nhận (BM-01)', level: 2, children: [] },
          { number: '4.2', title: 'Biểu mẫu thẩm định (BM-02)', level: 2, children: [] },
        ],
      },
    ],
    doc2_name: doc2Name,
    doc2_toc: [
      {
        number: '1', title: 'Quy định chung', level: 1,
        children: [
          { number: '1.1', title: 'Phạm vi áp dụng', level: 2, children: [] },
          { number: '1.2', title: 'Đối tượng áp dụng', level: 2, children: [] },
          { number: '1.3', title: 'Giải thích từ ngữ và viết tắt', level: 2, children: [] },
          { number: '1.4', title: 'Nguyên tắc áp dụng', level: 2, children: [] },
        ],
      },
      {
        number: '2', title: 'Quy trình thực hiện', level: 1,
        children: [
          { number: '2.1', title: 'Tiếp nhận hồ sơ', level: 2, children: [] },
          {
            number: '2.2', title: 'Thẩm định hồ sơ', level: 2,
            children: [
              { number: '2.2.1', title: 'Thẩm định tính đầy đủ', level: 3, children: [] },
              { number: '2.2.2', title: 'Thẩm định tính hợp lệ', level: 3, children: [] },
              { number: '2.2.3', title: 'Thẩm định rủi ro', level: 3, children: [] },
            ],
          },
          { number: '2.3', title: 'Phê duyệt và ký duyệt', level: 2, children: [] },
          { number: '2.4', title: 'Thực hiện', level: 2, children: [] },
          { number: '2.5', title: 'Lưu hồ sơ và báo cáo', level: 2, children: [] },
        ],
      },
      {
        number: '3', title: 'Trách nhiệm và quyền hạn', level: 1,
        children: [
          { number: '3.1', title: 'Trách nhiệm của Cán bộ tiếp nhận', level: 2, children: [] },
          { number: '3.2', title: 'Trách nhiệm của Trưởng phòng', level: 2, children: [] },
          { number: '3.3', title: 'Trách nhiệm của Ban Giám đốc', level: 2, children: [] },
        ],
      },
      {
        number: '4', title: 'Biểu mẫu và tài liệu đính kèm', level: 1,
        children: [
          { number: '4.1', title: 'Biểu mẫu tiếp nhận (BM-01 v2)', level: 2, children: [] },
          { number: '4.2', title: 'Biểu mẫu thẩm định (BM-02 v2)', level: 2, children: [] },
          { number: '4.3', title: 'Biểu mẫu đánh giá rủi ro (BM-03)', level: 2, children: [] },
        ],
      },
    ],
  };
}

function buildCompareResponse(doc1Name, doc2Name) {
  return {
    doc1_name: doc1Name,
    doc2_name: doc2Name,
    summary: `Văn bản ${doc2Name} là phiên bản cập nhật của ${doc1Name}. Phát hiện 4 mục sửa đổi quan trọng, 5 mục thêm mới, và 1 mục bị xóa/gộp. Thay đổi lớn nhất là bổ sung bước Thẩm định rủi ro (2.2.3), tách Lưu hồ sơ thành mục riêng (2.5), và thêm trách nhiệm Ban Giám đốc (3.3).`,
    total_sections_doc1: 13,
    total_sections_doc2: 17,
    matched_count: 10,
    added_count: 5,
    removed_count: 1,
    modified_count: 4,
    unchanged_count: 6,
    sections: [
      {
        section_id: '1.1',
        type: 'unchanged',
        doc1_section: { number: '1.1', title: 'Phạm vi áp dụng', content_summary: 'Quy định phạm vi áp dụng trong toàn hệ thống.' },
        doc2_section: { number: '1.1', title: 'Phạm vi áp dụng', content_summary: 'Quy định phạm vi áp dụng trong toàn hệ thống.' },
        changes: [],
        significance: 'low',
      },
      {
        section_id: '1.3',
        type: 'modified',
        doc1_section: { number: '1.3', title: 'Giải thích từ ngữ', content_summary: 'Định nghĩa 8 thuật ngữ chuyên môn.' },
        doc2_section: { number: '1.3', title: 'Giải thích từ ngữ và viết tắt', content_summary: 'Định nghĩa 12 thuật ngữ và 6 chữ viết tắt.' },
        changes: [
          'Tiêu đề bổ sung "và viết tắt" — mở rộng phạm vi giải thích.',
          'Thêm 4 thuật ngữ mới: "Hồ sơ điện tử", "Chữ ký số", "Phê duyệt trực tuyến", "Kiểm soát rủi ro".',
          'Thêm bảng chữ viết tắt mới.',
        ],
        significance: 'medium',
      },
      {
        section_id: '1.4',
        type: 'added',
        doc1_section: undefined,
        doc2_section: { number: '1.4', title: 'Nguyên tắc áp dụng', content_summary: 'Quy định 5 nguyên tắc cơ bản: minh bạch, khách quan, đúng thẩm quyền, đúng thời hạn, và bảo mật thông tin.' },
        changes: ['Mục hoàn toàn mới, không có trong văn bản gốc. Bổ sung khung nguyên tắc rõ ràng hơn.'],
        significance: 'high',
      },
      {
        section_id: '2.1',
        type: 'modified',
        doc1_section: { number: '2.1', title: 'Tiếp nhận hồ sơ', content_summary: 'Hướng dẫn tiếp nhận hồ sơ giấy tại quầy. Thời hạn xử lý: 1 ngày làm việc.' },
        doc2_section: { number: '2.1', title: 'Tiếp nhận hồ sơ', content_summary: 'Hướng dẫn tiếp nhận hồ sơ cả giấy và điện tử. Thời hạn xử lý: 4 giờ làm việc.' },
        changes: [
          'Bổ sung kênh tiếp nhận hồ sơ điện tử qua cổng thông tin.',
          'Rút ngắn thời hạn xử lý từ "1 ngày làm việc" xuống còn "4 giờ làm việc".',
          'Thêm yêu cầu gửi xác nhận tiếp nhận tự động cho khách hàng.',
        ],
        significance: 'high',
      },
      {
        section_id: '2.2.3',
        type: 'added',
        doc1_section: undefined,
        doc2_section: { number: '2.2.3', title: 'Thẩm định rủi ro', content_summary: 'Bước thẩm định rủi ro bắt buộc mới: đánh giá theo 3 tiêu chí rủi ro tài chính, pháp lý và vận hành.' },
        changes: ['Tiểu mục hoàn toàn mới. Bổ sung bước kiểm soát rủi ro bắt buộc trước khi phê duyệt.'],
        significance: 'high',
      },
      {
        section_id: '2.3',
        type: 'modified',
        doc1_section: { number: '2.3', title: 'Phê duyệt', content_summary: 'Phê duyệt bởi Trưởng phòng. Hạn mức tối đa không quy định.' },
        doc2_section: { number: '2.3', title: 'Phê duyệt và ký duyệt', content_summary: 'Phê duyệt bởi Trưởng phòng hoặc Ban Giám đốc tùy hạn mức. Hạn mức dưới 500 triệu: Trưởng phòng. Trên 500 triệu: Ban Giám đốc.' },
        changes: [
          'Phân tầng thẩm quyền phê duyệt theo hạn mức giá trị: dưới 500tr → Trưởng phòng; trên 500tr → Ban Giám đốc.',
          'Bổ sung yêu cầu ký duyệt điện tử (chữ ký số).',
        ],
        significance: 'high',
      },
      {
        section_id: '2.4-merge',
        type: 'removed',
        doc1_section: { number: '2.4', title: 'Thực hiện và lưu hồ sơ', content_summary: 'Gộp cả bước thực hiện và lưu hồ sơ trong 1 mục.' },
        doc2_section: undefined,
        changes: ['Mục gốc 2.4 "Thực hiện và lưu hồ sơ" được tách thành 2 mục riêng: 2.4 "Thực hiện" và 2.5 "Lưu hồ sơ và báo cáo".'],
        significance: 'medium',
      },
      {
        section_id: '2.5',
        type: 'added',
        doc1_section: undefined,
        doc2_section: { number: '2.5', title: 'Lưu hồ sơ và báo cáo', content_summary: 'Tách riêng bước lưu hồ sơ. Bổ sung yêu cầu báo cáo định kỳ hàng tháng.' },
        changes: ['Tách từ mục 2.4 cũ. Bổ sung yêu cầu lập báo cáo tổng hợp hàng tháng gửi Ban Giám đốc.'],
        significance: 'medium',
      },
      {
        section_id: '3.3',
        type: 'added',
        doc1_section: undefined,
        doc2_section: { number: '3.3', title: 'Trách nhiệm của Ban Giám đốc', content_summary: 'Quy định rõ trách nhiệm của Ban Giám đốc trong phê duyệt hạn mức cao và giám sát tổng thể.' },
        changes: ['Mục mới bổ sung trách nhiệm cho cấp Ban Giám đốc, phù hợp với thay đổi phân tầng thẩm quyền tại mục 2.3.'],
        significance: 'high',
      },
      {
        section_id: '4.3',
        type: 'added',
        doc1_section: undefined,
        doc2_section: { number: '4.3', title: 'Biểu mẫu đánh giá rủi ro (BM-03)', content_summary: 'Biểu mẫu mới phục vụ bước thẩm định rủi ro 2.2.3.' },
        changes: ['Biểu mẫu mới BM-03 đi kèm với tiểu mục 2.2.3 "Thẩm định rủi ro".'],
        significance: 'medium',
      },
    ],
  };
}

function buildResponse(fields, files, filename) {
  let inputData = {};
  try {
    inputData = JSON.parse(fields.input_content || '{}');
  } catch {}

  const mode = inputData.mode || fields.mode || 'toc';
  const doc1Name = inputData.doc1_name || 'Văn bản 1.pdf';
  const doc2Name = inputData.doc2_name || 'Văn bản 2.pdf';

  let data;
  if (mode === 'toc') {
    data = buildTocResponse(doc1Name, doc2Name);
  } else {
    // mode === 'compare'
    const toc = inputData.toc || {};
    data = buildCompareResponse(
      toc.doc1_name || doc1Name,
      toc.doc2_name || doc2Name,
    );
  }

  return {
    content: JSON.stringify(data),
    model: fields.model || 'gemini-1.5-pro',
    mock: true,
  };
}

module.exports = { buildResponse };
