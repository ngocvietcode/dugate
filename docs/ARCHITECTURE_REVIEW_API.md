# Đánh Giá Kiến Trúc Bộ API Document Understanding

**Version:** 1.0
**Ngày đánh giá:** Tháng 4, 2026
**Vai trò thực hiện:** Solution Architect

---

## I. Tổng Quan Hệ Thống

Hệ thống API Document Understanding (DU) hiện tại được cấu trúc theo 6 Service chính (Ingest, Extract, Analyze, Transform, Generate, Compare), mở rộng ra thành hơn 30 sub-case nghiệp vụ, và định tuyến xử lý thông qua 15 External API Connectors (kết hợp với Mock Service nỗ bộ).

Kiến trúc cốt lõi sử dụng mô hình **Centralized Engine** (`runner.ts`), **Chaining Pipeline** (`engine.ts`), và cơ chế **Discriminator Routing** (`registry.ts` cấp phép).

## II. Bản Đồ Năng Lực Giải Quyết Bài Toán (Capability Matrix)

Dưới đây là mapping chi tiết giữa nhu cầu thực tế của người dùng và các API Endpoint hiện tại.

### A. Phân Hệ: Xử Lý Văn Bản Gốc (Document Processing)

| Nhu Cầu Thực Tế | API Endpoint Tương Ứng | Đánh Giá Mức Độ Trưởng Thành |
| :--- | :--- | :--- |
| **Đọc nội dung Text từ file số (PDF/DOCX)** | `/ingest?mode=parse` | ✅ **Tốt Level 2:** Đã tích hợp Parser cục bộ (hệ thống tự lấy Markdown bằng thư viện nội bộ) giảm tải API ngoài. |
| **Bóc tách văn bản từ Ảnh chụp / Scan** | `/ingest?mode=ocr` | ✅ **Tốt Level 1:** Call qua external vision layout reader. |
| **Số hóa form điền tay/chữ ký** | `/ingest?mode=digitize` | ✅ **Tốt Level 1:** Hỗ trợ mô hình `ext-vision-reader` tối ưu nét chữ mờ. |
| **Cắt ghép file PDF lớn** | `/ingest?mode=split` | ✅ **Tốt Level 1:** Đủ chức năng chia tách theo tham số `pages=1-5`. |
| **Chuyển đổi File sang HTML/Markdown** | `/transform?action=convert` | ✅ **Tốt Level 1:** Thích hợp parse file docx sang Raw Markdown để phục vụ quy trình sau này. |
| **Chuyển Excel/CSV thành Bảng MD/Text** | (Internal ExcelParser bypass) | ✅ **Tốt Level 2:** Parse toàn bộ sheet file excel cực nhanh mà không tốn Token API. |

### B. Phân Hệ: Trích Xuất Dữ Liệu (Extraction)

| Nhu Cầu Thực Tế | API Endpoint Tương Ứng | Đánh Giá Mức Độ Trưởng Thành |
| :--- | :--- | :--- |
| **Dò Hóa đơn đỏ / Invoice nội địa** | `/extract?type=invoice` | ✅ **Tốt Level 2:** Có Preset cứng rõ ràng các trường cần lấy. |
| **Đọc Hợp đồng thương mại / Điều khoản** | `/extract?type=contract` | ✅ **Tốt Level 2:** Có Preset lấy parties, trị giá, chữ ký... |
| **Nhận dạng CCCD / Passport (e-KYC)** | `/extract?type=id-card` | ✅ **Tốt Level 2:** Preset trả đủ các trường thông tin chuẩn VN. |
| **Đọc Biên lai quầy / POS mờ** | `/extract?type=receipt` | ✅ **Tốt Level 2:** Thích ứng để làm quản lý chi phí (Expense app). |
| **Nhổ mọi Bảng Biểu (Tables) ra Json** | `/extract?type=table` | ✅ **Tốt Level 1:** Trích xuất mảng 2 chiều, phù hợp parsing raw data. |
| **Đơn đặt hàng (Purchase Order)** | `/extract?type=po` | ✅ **Tốt Level 1:** Preset chuẩn hóa chuỗi cung ứng. |
| **Phiếu lương / Payslip báo cáo** | `/extract?type=payslip` | ✅ **Tốt Level 1:** Phục vụ phòng HR. |
| **Tráp form tùy biến 100% (Dynamic rules)**| `/extract?type=custom` | ✅ **Tốt Level 3:** Cực mạnh dựa theo việc truyền JSON Schema/mảng Fields riêng. |
| **Xử lý lô hàng chục Hóa đơn 1 lần** | (Chưa có Endpoint Batching) | ⚠️ **Chưa Có:** Admin phải lặp request lẻ tẻ với `/extract`. |

### C. Phân Hệ: Đối Chiếu & So Sánh (Verification)

| Nhu Cầu Thực Tế | API Endpoint Tương Ứng | Đánh Giá Mức Độ Trưởng Thành |
| :--- | :--- | :--- |
| **So sánh Text Delta (So khớp rà đổi chữ)** | `/compare?mode=diff` | ✅ **Tốt Level 1:** Nhận biết được dòng thêm, sửa xóa tĩnh. |
| **So sánh Ngữ Nghĩa tranh chấp (Hợp Đồng)** | `/compare?mode=semantic` | ✅ **Tốt Level 3:** Cho phép truyền tham số `focus` nhúng vào Prompt để chỉ soi một luồng điều khoản nhất định. |
| **Tự động sinh Release Note/Changelog** | `/compare?mode=version` | ✅ **Tốt Level 2:** Tóm lược sự khác biệt từ Văn bản chính sách v1 → v2. |
| **Check đối chiếu Sự thật (Fact-Checking)** | `/analyze?task=fact-check`| ✅ **Tốt Level 3:** Workflow gộp 2 chain xuất sắc (Vừa read data → Check ngay với Reference DB). |
| **Soi tuân thủ (Ký đủ chưa? Form đúng chưa?)**| `/analyze?task=compliance` | ✅ **Tốt Level 3:** Admin có thể ghi đè `business_rules` cứng cho toàn user mà client không can thiệp được. |
| **Đánh giá rủi ro điều khoản Phạt 1 chiều** | `/analyze?task=risk` | ✅ **Tốt Level 1:** Evaluator model chấm rủi ro (Hợp pháp/Không). |
| **So sánh đa ngôn ngữ (Bản tiếng Anh-Việt)** | (Chưa có Workflow tích hợp) | ❌ **Chưa Có:** System thiếu Connector Pipeline nối `translate` → `compare`. |
| **Ghép 3-5 phiên bản xem ai sửa** | `/compare` (Chỉ scale tốt 2 file) | ⚠️ **Hạn chế:** Hệ thống chưa tối ưu hóa Multi-doc merge conflict resolution. |

### D. Phân Hệ: Phân Tích Tổng Hợp & Sinh Nội Dung (Analysis & Gen)

| Nhu Cầu Thực Tế | API Endpoint Tương Ứng | Đánh Giá Mức Độ Trưởng Thành |
| :--- | :--- | :--- |
| **Routing tự động Hợp đồng/Hóa đơn vào folder**| `/analyze?task=classify` | ✅ **Tốt Level 1:** Auto routing theo `categories`. |
| **Hiểu Review Của Khách tức giận hay vui** | `/analyze?task=sentiment` | ✅ **Tốt Level 1:** Chấm điểm Positive/Negative và nêu Aspect. |
| **Duyệt Báo cáo và Sửa lỗi chính tả/Chất lượng** | `/analyze?task=quality` | ✅ **Tốt Level 1:** Quality score A,B,C,D. |
| **Tóm Tắt sách siêu nhanh (4 Định dạng)** | `/generate?task=summary` | ✅ **Tốt Level 2:** Đa dạng output (Bảng, Paragraph, Bullets). |
| **Tự đọc file và lên Slide Mục Lục** | `/generate?task=outline` | ✅ **Tốt Level 1:** Generator. |
| **Hỏi xoáy Đáp Xoay (RAG Local)** | `/generate?task=qa` | ✅ **Tốt Level 1:** Nhận array mảng `questions` theo doc. |
| **Dịch Thuật bảo toàn Định Dạng** | `/transform?action=translate`| ✅ **Tốt Level 2:** Biến hóa Target Language và Tone văn. Hỗ trợ ghi đè `glossary` từ Admin Profile. |
| **Rewrite lại nội dung (Né đạo văn)** | `/transform?action=rewrite` | ✅ **Tốt Level 1:** Change style `academic, formal, casual`. |
| **Bôi đen PII bảo mật (Che Số Thẻ, CCCD)** | `/transform?action=redact` | ✅ **Tốt Level 2:** An toàn tuân thủ ISO27001 bằng Regex rules ngầm. |
| **Draft mail chửi hoặc Xin Lỗi KH** | `/generate?task=email` | ✅ **Tốt Level 1:** Áp dụng cho team CS. |
| **Sinh biên bản họp (Minutes)** | `/generate?task=minutes` | ✅ **Tốt Level 1:** Tách action items từ transcript tạp âm. |

---

## III. Điểm Kiến Trúc Sáng Tạo Đáng Ghi Nhận (Strengths)

1. **Write Once, Route Everywhere Model:** Việc quy tụ mọi đường API thông qua config tĩnh tại `registry.ts` loại bỏ hoàn toàn việc maintain các file `route.ts`. Scale logic 30 endpoints trong 1 codebase gọn.
2. **Profile-based Tenancy (Bypass/Override Access Control):** Khả năng tiêm ngầm Prompt (Tham số `profileOnlyParams`) mà Client gửi Request không hề hay biết tính năng này. System phân luồng hoàn hảo cho B2B.
3. **Pipeline Engine 2 Buồng Đốt (Chaining Mechanics):** Chế độ Auto-pipe từ Model này qua Model khác (như bài Fact Check) giúp mở rộng luồng xử lý không giới hạn, không phải viết lại logic Frontend.
4. **Internal Parser Gateway:** Module Tự xử lý Word/Excel/JSON mới được Update đã ngắt được sự phí phạm vào Token AI của External Service. 
5. **Universal ID/Idempotency:** Request lặp lại không bị xửng lại, tiết kiệm tiền nhờ vào `IdempotencyKey`.

---

## IV. Rủi Ro Hệ Thống (Technical Debt & Risks) 

Dù đạt được ~85% sự hài lòng, hệ thống nếu Scale chịu tải Production thật sẽ gãy ở 3 điểm nhức nhối:

### 🔴 Critical (Phải Sửa)
1. **Thiếu cơ chế Rate-Limit ở Middleware & Runner:** Hacker hoặc Bot có thể thọc vào POST API và làm cháy túi API Key ngầm vì không có Rate Limiting `(Max 10 calls/phút/user)` nào kìm hãm lại.
2. **Bottleneck File qua Payload Serverless:** Đọc File to thông qua đường API HTTP bằng Next.js Edge Runtime. Limit 4.5MB Payload của Vercel sẽ làm Timeout toàn hệ thống khi đẩy PDF 100MB. Cần triển khai *Presigned URL S3 Upload/Multipart Chunk*.
3. **Async Job Thiếu Retry Flow:** Fire-and-forget Job chạy ở nền với `catch`. Nếu DB lock hay mạng External Error (502 Timeout), Job đứng yên mãi mãi (Zombie state). Phải tích hợp Message Queue (RabbitMQ / BullMQ) có chế độ Backoff Retry tự động.

### 🟡 High (Nên Sửa Để Tốt Hơn)
1. **Handlebars Parser Chết Logic Điều Kiện:** File prompt `.js` hoặc ở `Submit` dùng chuẩn Regex thay thế `{field}` nhưng lại khai báo code `{{#if schema}}` trong DB → Engine không map được và in ra nguyên cụm if này cho LLM đọc.
2. **OpenAPI/Swagger Generation Tệ:** Các Sub-cases API được gom chung làm API Swagger tự render ra Payload rối như mạng nhện. Nên viết một script build-time tự map cái array config bung bét ra thành Flat URL ảo cho Docs.
3. **Multi-file Scaling In Comparisons:** API So sánh `compare` gãy nếu nạp 3 file. Prompt Mock và Thực tế chỉ đang chẻ mảng `files[0]` vs `files[1]`.

---

## V. Hành Động Tiếp Theo (Next Steps)

Lộ trình khuyến nghị nâng cấp hệ thống:
*   [P0] Bổ sung thư viện Rate Limiter vào Pipeline.
*   [P0] Triển khai BullMQ/Upstash làm Job Scheduler cho Pipeline.
*   [P1] Cấu hình lại Regex parser cho Handlebars trong API.
*   [P2] Tạo Endpoint lấy `Upload-Link S3` cho front-end.
*   [P2] Khai giảng Module API Batching (Xử lý 100 Files/Request).
