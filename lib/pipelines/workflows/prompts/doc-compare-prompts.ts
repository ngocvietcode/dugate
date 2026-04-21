// lib/pipelines/workflows/prompts/doc-compare-prompts.ts
// Prompt builders for the doc-compare workflow.

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TocSection {
  number: string;
  title: string;
  level: number;
  children: TocSection[];
}

export interface TocExtractionResult {
  doc1_name: string;
  doc1_toc: TocSection[];
  doc2_name: string;
  doc2_toc: TocSection[];
}

export type SectionChangeType = 'unchanged' | 'modified' | 'added' | 'removed';

export interface SectionComparison {
  section_id: string;
  type: SectionChangeType;
  doc1_section?: { number: string; title: string; content_summary: string };
  doc2_section?: { number: string; title: string; content_summary: string };
  changes: string[];
  significance: 'high' | 'medium' | 'low';
}

export interface DocCompareResult {
  doc1_name: string;
  doc2_name: string;
  summary: string;
  total_sections_doc1: number;
  total_sections_doc2: number;
  matched_count: number;
  added_count: number;
  removed_count: number;
  modified_count: number;
  unchanged_count: number;
  sections: SectionComparison[];
}

// ─── Prompt Builders ────────────────────────────────────────────────────────

export function buildOcrPrompt(
  fileName: string,
  promptOverride?: string,
): { _prompt: string } {
  if (promptOverride) {
    return { _prompt: promptOverride };
  }
  return {
    _prompt: `Bạn là hệ thống OCR chuyên nghiệp. Nhiệm vụ: chuyển đổi toàn bộ nội dung tài liệu "${fileName}" thành văn bản Markdown.

YÊU CẦU:
- Giữ nguyên cấu trúc: tiêu đề, bảng, danh sách, đánh số mục
- Bảng: dùng cú pháp Markdown table (|---|)
- Tiêu đề: dùng # ## ### theo cấp độ
- Đánh số mục: giữ nguyên (1. / 1.1 / 1.1.1 v.v.)
- Không bỏ sót nội dung, kể cả chú thích và phụ lục
- Không thêm nhận xét hay diễn giải

Trả về toàn bộ nội dung dạng Markdown.`,
  };
}

export function buildTocExtractionPrompt(
  doc1Name: string,
  doc2Name: string,
  doc1OcrText: string,
  doc2OcrText: string,
  promptOverride?: string,
): { _prompt: string } {
  if (promptOverride) {
    return { _prompt: promptOverride };
  }

  return {
    _prompt: `Bạn là chuyên gia phân tích cấu trúc tài liệu. Nhiệm vụ: trích xuất Mục lục (Table of Contents) có cấu trúc cây từ 2 văn bản dưới đây.

---
VĂN BẢN 1: "${doc1Name}"
${doc1OcrText}

---
VĂN BẢN 2: "${doc2Name}"
${doc2OcrText}
---

HƯỚNG DẪN:
1. Xác định tất cả các mục/tiêu đề trong mỗi văn bản theo thứ tự xuất hiện.
2. Phân cấp theo mức độ (level 1: chương/phần lớn, level 2: mục, level 3: tiểu mục...).
3. Nếu văn bản có đánh số (1, 1.1, 1.1.1) thì dùng số đó làm "number".
4. Nếu không có đánh số, tự gán số thứ tự theo thứ tự xuất hiện.
5. Giữ nguyên tên tiêu đề gốc trong "title".

OUTPUT JSON (bắt buộc):
\`\`\`json
{
  "doc1_name": "${doc1Name}",
  "doc1_toc": [
    {
      "number": "1",
      "title": "Tên mục cấp 1",
      "level": 1,
      "children": [
        {
          "number": "1.1",
          "title": "Tên tiểu mục",
          "level": 2,
          "children": []
        }
      ]
    }
  ],
  "doc2_name": "${doc2Name}",
  "doc2_toc": [...]
}
\`\`\`

Chỉ trả về JSON, không giải thích thêm.`,
  };
}

export function buildSectionComparePrompt(
  tocResult: TocExtractionResult,
  doc1OcrText: string,
  doc2OcrText: string,
  promptOverride?: string,
): { _prompt: string } {
  if (promptOverride) {
    return { _prompt: promptOverride };
  }

  const tocJson = JSON.stringify(tocResult, null, 2);

  return {
    _prompt: `Bạn là chuyên gia so sánh và đối chiếu tài liệu quy trình/quy định. Nhiệm vụ: so sánh chi tiết từng mục giữa 2 văn bản dựa trên Mục lục đã trích xuất.

MỤC LỤC HAI VĂN BẢN:
${tocJson}

NỘI DUNG ĐẦY ĐỦ VĂN BẢN 1 ("${tocResult.doc1_name}"):
${doc1OcrText}

NỘI DUNG ĐẦY ĐỦ VĂN BẢN 2 ("${tocResult.doc2_name}"):
${doc2OcrText}

QUY TẮC SO SÁNH:
1. **Đối chiếu mục**: Ghép nối các mục tương ứng giữa 2 văn bản dựa trên số mục và tiêu đề. Mục có cùng số (ví dụ 3.1) hoặc tiêu đề tương đồng được coi là "matched".
2. **Phát hiện thêm/xóa mục**: Nếu mục tồn tại trong VB1 nhưng không có trong VB2 → type="removed". Ngược lại → type="added". Cần xử lý đúng trường hợp chèn mục vào giữa (không nhầm mục bị đánh số lại là mục khác).
3. **Phân loại thay đổi**:
   - type="unchanged": nội dung không đổi hoặc chỉ thay đổi định dạng
   - type="modified": nội dung bị chỉnh sửa (thêm từ, sửa câu, đổi số liệu, v.v.)
   - type="added": mục chỉ có trong VB2
   - type="removed": mục chỉ có trong VB1
4. **significance**:
   - high: thay đổi về nghĩa pháp lý, số liệu quan trọng, trách nhiệm các bên
   - medium: bổ sung/sửa nội dung ảnh hưởng đến quy trình
   - low: thay đổi nhỏ về từ ngữ, định dạng, chính tả
5. **changes**: Mô tả ngắn gọn (1-3 câu) nội dung thay đổi. Với type="unchanged", để mảng rỗng [].
6. **content_summary**: Tóm tắt 1-2 câu nội dung chính của mục đó.

OUTPUT JSON (bắt buộc):
\`\`\`json
{
  "doc1_name": "${tocResult.doc1_name}",
  "doc2_name": "${tocResult.doc2_name}",
  "summary": "Tổng quan kết quả so sánh...",
  "total_sections_doc1": 0,
  "total_sections_doc2": 0,
  "matched_count": 0,
  "added_count": 0,
  "removed_count": 0,
  "modified_count": 0,
  "unchanged_count": 0,
  "sections": [
    {
      "section_id": "1.1",
      "type": "modified",
      "doc1_section": {
        "number": "1.1",
        "title": "Tên mục trong VB1",
        "content_summary": "Tóm tắt nội dung VB1..."
      },
      "doc2_section": {
        "number": "1.1",
        "title": "Tên mục trong VB2",
        "content_summary": "Tóm tắt nội dung VB2..."
      },
      "changes": ["Mô tả thay đổi 1", "Mô tả thay đổi 2"],
      "significance": "high"
    }
  ]
}
\`\`\`

Chỉ trả về JSON, không giải thích thêm.`,
  };
}

export function buildReportPrompt(
  compareResult: DocCompareResult,
  promptOverride?: string,
): { _prompt: string } {
  if (promptOverride) {
    return { _prompt: promptOverride };
  }

  const resultJson = JSON.stringify(compareResult, null, 2);

  return {
    _prompt: `Bạn là chuyên gia soạn thảo báo cáo phân tích văn bản. Nhiệm vụ: soạn Báo cáo So sánh Văn bản chuyên nghiệp bằng tiếng Việt dựa trên kết quả phân tích sau.

KẾT QUẢ SO SÁNH:
${resultJson}

YÊU CẦU BÁO CÁO:
- Ngôn ngữ: tiếng Việt, chuyên nghiệp
- Định dạng: Markdown với đầy đủ tiêu đề, bảng, danh sách
- Cấu trúc bắt buộc:

## BÁO CÁO SO SÁNH VĂN BẢN
**Tài liệu gốc**: [tên VB1]
**Tài liệu so sánh**: [tên VB2]
**Ngày thực hiện**: [ngày hôm nay]

### I. TỔNG QUAN
[Tổng kết: số mục, % thay đổi, nhận xét chung]

### II. THỐNG KÊ THAY ĐỔI
[Bảng thống kê: Mục không đổi / Mục sửa đổi / Mục thêm mới / Mục bị xóa]

### III. CHI TIẾT THAY ĐỔI QUAN TRỌNG
[Liệt kê các mục có significance=high và medium, nêu rõ nội dung thay đổi]

### IV. MỤC THÊM MỚI (chỉ có trong ${compareResult.doc2_name})
[Liệt kê các mục type=added]

### V. MỤC BỊ XÓA (chỉ có trong ${compareResult.doc1_name})
[Liệt kê các mục type=removed]

### VI. BẢNG TỔNG HỢP TẤT CẢ MỤC
[Bảng đầy đủ: Số mục | Tiêu đề VB1 | Tiêu đề VB2 | Trạng thái | Mức độ]

### VII. KẾT LUẬN VÀ KHUYẾN NGHỊ
[Nhận xét tổng thể, các điểm cần lưu ý, khuyến nghị xem xét]

Trả về toàn bộ báo cáo dạng Markdown.`,
  };
}
