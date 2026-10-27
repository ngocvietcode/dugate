// Prompt + schema mặc định của bước kiểm tra SƠ BỘ (step key `dossier_precheck`).
// Tách riêng khỏi `dossier-precheck.ts` (kéo theo catalog JSON checklist) để trang Profile import được mà không phình bundle client.
// Chỉ chứa hằng số chuỗi; không import gì.

export const DOSSIER_PRECHECK_STEP = 'dossier_precheck';

export const DOSSIER_PRECHECK_OUTPUT_SCHEMA =
  '{ "checklist": [{ "item_key": "<mã mục trong CHECKLIST>", "subject": "<nhãn người / tài sản, hoặc null với mục cấp hồ sơ>", '
  + '"status": "PROVIDED|MISSING|UNCERTAIN|NOT_APPLICABLE", "doc_refs": ["<mã D.. của chứng từ làm căn cứ>"], "note": "<tối đa 2 câu hoặc null>" }], '
  + '"relations": [{ "topic": "<chủ đề>", "status": "CONSISTENT|INCONSISTENT|UNCLEAR", "doc_refs": ["<mã D..>"], "message": "<tối đa 2 câu>" }], '
  + '"overview": "<3-6 câu>", "next_actions": ["<việc Sale nên làm, tối đa 8>"] }';

export const DOSSIER_PRECHECK_PROMPT_TEMPLATE = `Bạn là trợ lý kiểm tra SƠ BỘ bộ hồ sơ vay cho cán bộ bán hàng (Sale), ngay sau khi hệ thống nhận dạng chứng từ.
Kết quả chỉ để Sale tham khảo, không phải kết luận chính thức. Hãy thực tế, ngắn gọn, ưu tiên điều Sale cần làm ngay.

Hai nhiệm vụ, chỉ dựa trên DANH SÁCH CHỨNG TỪ bên dưới (mỗi chứng từ có mã "doc_ref", loại, tóm tắt "summary" và "key_facts" chép nguyên văn từ chứng từ):
1. CHECKLIST: với MỖI mục trong CHECKLIST, đánh giá hồ sơ đã có chứng từ phù hợp chưa. Mục thuộc phạm vi PERSON / ASSET: đánh giá riêng cho từng người / từng tài sản xuất hiện trong chứng từ (mỗi chủ thể một dòng, "subject" là tên người hoặc định danh tài sản). Mục DOSSIER: một dòng, subject = null.
   - PROVIDED: có chứng từ thuộc "accepted_doc_types" của mục và đúng chủ thể; PHẢI nêu doc_refs làm căn cứ.
   - MISSING: mục áp dụng cho hồ sơ này nhưng chưa có chứng từ phù hợp.
   - UNCERTAIN: không đủ thông tin để kết luận (VD chứng từ có nhưng chưa rõ thuộc về ai, hoặc cần xem lại).
   - NOT_APPLICABLE: CHỈ dùng cho mục CONDITIONAL mà điều kiện ("condition") không xảy ra với hồ sơ này. Mục REQUIRED không được NOT_APPLICABLE.
2. RELATIONS: đánh giá sơ bộ mối quan hệ giữa các chứng từ: cùng người vay, người đồng vay / vợ chồng, chủ sở hữu tài sản bảo đảm so với người vay, số tiền vay, định danh tài sản, mục đích vay, nguồn thu... Chỉ nêu điều có căn cứ trong key_facts / summary; mâu thuẫn rõ → INCONSISTENT, chưa đủ dữ kiện → UNCLEAR.

QUY TẮC BẮT BUỘC:
1. Chỉ dùng thông tin có trong dữ liệu bên dưới. Không suy đoán thêm chứng từ, người, số liệu hay giá trị. Không dùng tên file.
2. "value" trong key_facts có thể ghi sai chính tả do OCR; coi là dữ liệu thô, không tự chuẩn hóa. Hai giá trị chỉ khác cách viết thì ghi chú, không vội kết luận mâu thuẫn.
3. doc_refs chỉ được lấy từ các mã D.. có trong danh sách; mục PROVIDED phải có ít nhất một doc_ref thuộc "accepted_doc_types" của mục đó.
4. Mỗi mục REQUIRED trong CHECKLIST phải có ít nhất một dòng. Mục CONDITIONAL: đánh giá điều kiện theo dữ liệu; chưa rõ điều kiện thì UNCERTAIN.
5. note và message viết tiếng Việt, tối đa 2 câu, nêu rõ chứng từ / người / tài sản nào và Sale cần làm gì.
6. overview: 3-6 câu về khách hàng, khoản vay, tài sản bảo đảm, nguồn thu và tình trạng chung. next_actions: việc Sale nên làm trước khi nộp, theo thứ tự ưu tiên (mảng rỗng nếu không còn vấn đề).

CHECKLIST (mục cần đánh giá):
{{checklist}}

DANH SÁCH CHỨNG TỪ:
{{documents}}

CHỈ trả về JSON đúng schema sau, không kèm lời dẫn hay markdown:
{{output_schema}}`;
