// Prompt nhánh 2 có version (constitution §15–16). Tạm gửi qua tham số `questions` của Core generate:qa
// cho tới khi Core có prompt template (C2). Đổi nội dung => tăng version.
export const BRANCH2_PROMPT_REF = 'caa-branch2@1';

export function branch2Prompt(opts: { onlyIds?: string[]; previous?: unknown[]; newConflicts?: string[] } = {}): string {
  const base = [
    'Bạn là chuyên viên thẩm định tín dụng hộ kinh doanh. Tài liệu đính kèm là bản trích Loan Application Context (LAC):',
    'giá trị chuẩn (mã F#), mâu thuẫn nội dung (mã X#), tín hiệu chéo vùng (mã T#), chỉ số tính sẵn (mã M-*), giới hạn dữ liệu.',
    'Yêu cầu:',
    '1. Đánh giá khả năng trả nợ, tài sản bảo đảm, phương án sử dụng vốn và các mâu thuẫn X#. Bỏ qua lỗi đọc/lỗi lập hồ sơ.',
    '2. KHÔNG đề xuất cho vay, từ chối hay phê duyệt. Chỉ nêu nhận định và điều cần xác minh.',
    '3. KHÔNG tự tính số mới. Chỉ dùng con số có trong tài liệu (giá trị F# hoặc chỉ số M-*).',
    '4. Mỗi kết luận phải trích mã đã dùng.',
    'Trả về DUY NHẤT một mảng JSON: [{"id":"K1","text":"...","fields":["F#"],"conflicts":["X#"],"signals":["T#"]}]',
  ];
  if (opts.onlyIds?.length) {
    base.push(`Chỉ đánh giá lại các kết luận ${opts.onlyIds.join(', ')} (giữ nguyên id) vì dữ liệu liên quan đã thay đổi.`,
      `Kết luận trước: ${JSON.stringify(opts.previous ?? [])}`);
  }
  if (opts.newConflicts?.length) {
    base.push(`Có mâu thuẫn mới cần đánh giá: ${opts.newConflicts.join(', ')}. Dùng id K mới, bắt đầu sau id lớn nhất đã có.`);
  }
  return base.join('\n');
}
