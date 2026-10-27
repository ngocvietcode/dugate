# 📚 Document Understanding (DU) API — Tài Liệu Tích Hợp & Vận Hành

Tài liệu này cung cấp hướng dẫn toàn diện về hệ thống API Document Understanding (DU), bao gồm cách tích hợp dành cho nhà phát triển (Client/Developer) và hướng dẫn cấu hình dành cho quản trị viên (Admin).

---

## Phần 1: Hướng Dẫn Tích Hợp Cho Client (Developer Guide)

Hệ thống DU API được thiết kế theo kiến trúc tối giản số lượng endpoint nhưng bao trùm tối đa các nghiệp vụ thông qua việc thay đổi **tham số hành động**.

### 1. Thông Tin Chung

- **Base URL:** `https://api.dugate.vn/api/v1`
- **Xác thực:** Sử dụng API Key truyền qua Header `x-api-key: dg_xxxxxxxxxxxx`.
- **Định dạng Request:** `multipart/form-data` (hỗ trợ upload file).

> [!TIP]
> Việc giảm thiểu số lượng Endpoint giúp đơn giản hoá Logic gọi API từ phía Client SDK, bằng cách thay đổi giá trị của một biến (VD: `type`, `task`, `action`) ứng với một Document Service.

### 1.1. Định Dạng File Hỗ Trợ

Hệ thống xác định danh sách định dạng được phép **theo từng Endpoint** (không có một "mặc định doc + pdf" chung gây hiểu nhầm). Thứ tự ưu tiên áp dụng:

1. **Profile override** — Admin cấu hình `allowedFileExtensions` riêng cho từng API Key.
2. **Chính sách Endpoint** — định nghĩa sẵn trong hệ thống (vd: `ingest:ocr` nhận PDF + ảnh).
3. **Mặc định toàn cục** — chỉ gồm **PDF + ảnh** (`.pdf, .jpg, .jpeg, .png, .tiff, .tif, .webp, .bmp, .gif`).

| Nhóm | Định dạng | Ghi chú |
|------|-----------|---------|
| **PDF** | `.pdf` | Đọc được bởi mọi connector và engine. |
| **Ảnh** | `.jpg, .jpeg, .png, .webp, .heic, .heif` | Định dạng ảnh mà Gemini 2.5 vision đọc được. Dùng cho OCR, vision, số hoá form, trích xuất CCCD/biên lai. TIFF/BMP/GIF **không** hỗ trợ (model AI không decode được). |
| **Word** | `.docx` | **Không phải mặc định.** Chỉ parse được nội bộ (multipart) — các connector AIHub/vision **không đọc được** file Office. Phải bật riêng theo Endpoint hoặc Profile. |
| **Bảng tính** | `.xlsx, .xls, .csv` | Tương tự Word — parse nội bộ, bật riêng theo Endpoint (vd: `extract:credit-report`, `extract:custom`, workflow `payroll-verify`). |

> [!IMPORTANT]
> `.docx`/`.xlsx` **không** nằm trong danh sách mặc định vì AIHub và các vision/LLM connector không đọc được định dạng Office nhị phân. Các Endpoint xử lý tài liệu số (vd: `ingest:parse`, `transform:convert`, `extract:credit-report`) đã được cấu hình cho phép Office sẵn; với các Endpoint khác, Admin cần thêm vào `allowedFileExtensions` của Profile.
>
> Giới hạn dung lượng: tối đa **300MB**/file.

### 2. Luồng Xử Lý Bất Đồng Bộ (Async Pattern)
Các tác vụ xử lý tài liệu thường mất nhiều thời gian. Do đó, DU API sử dụng pattern bất đồng bộ (Polling hoặc Webhook).

**Bước 1: Gửi yêu cầu bài toán**
```bash
curl -X POST https://api.dugate.vn/api/v1/extract \
  -H "x-api-key: dg_xxx" \
  -F "file=@invoice.pdf" \
  -F "type=invoice"
```
**Phản hồi (202 Accepted):**
```json
{
  "name": "operations/op-abc123",
  "done": false,
  "metadata": {
    "state": "RUNNING",
    "created_at": "2026-03-31T14:00:00Z"
  }
}
```

**Bước 2: Kiểm tra trạng thái (Polling)**
```bash
curl -X GET https://api.dugate.vn/api/v1/operations/op-abc123 \
  -H "x-api-key: dg_xxx"
```
**Phản hồi (Khi hoàn thành):**
```json
{
  "name": "operations/op-abc123",
  "done": true,
  "result": { ... kết quả xử lý ... }
}
```

### 2.1. Headers Hỗ Trợ Troubleshooting (Khuyến nghị)

Ngoài header `x-api-key` bắt buộc, DU hỗ trợ thêm 2 header tùy chọn giúp hệ thống tích hợp và team vận hành DU troubleshoot nhanh hơn:

| Header | Bắt buộc | Mô tả |
|--------|----------|-------|
| `x-api-key` | ✅ Bắt buộc | API Key xác thực (liên hệ Admin để nhận) |
| `x-correlation-id` | ❌ Optional | Mã trace do hệ thống bạn tự tạo. DU lưu lại để tìm kiếm operation khi cần troubleshoot. Nếu không gửi, DU tự sinh UUID. |
| `idempotency-key` | ❌ Optional | Mã unique cho mỗi request. Nếu gửi lại request với cùng key, DU trả lại kết quả cũ mà không xử lý lại (retry-safe). |

**Ví dụ đầy đủ:**
```bash
curl -X POST https://api.dugate.vn/api/v1/docs/extract \
  -H "x-api-key: dg_xxxxxxxxxxxx" \
  -H "x-correlation-id: SYSTEM-20260709-143500-001" \
  -H "idempotency-key: system-deal-fx001-extract" \
  -F "file=@invoice.pdf" \
  -F "type=invoice"
```

> [!IMPORTANT]
> **Response luôn chứa Operation ID** trong field `name` (body) và header `X-Operation-ID`.
> Hệ thống tích hợp **NÊN LOG** giá trị này để hỗ trợ troubleshooting khi cần.
>
> Khi cần hỗ trợ, cung cấp cho team vận hành DU một trong các thông tin sau (theo thứ tự ưu tiên):
> 1. Operation ID (field `name` trong response hoặc header `X-Operation-ID`)
> 2. `x-correlation-id` đã gửi
> 3. Thời gian gửi request + tên API Key

---

### 3. Danh Sách Các Chức Năng (Use Cases)

Dưới đây là 6 tính năng cốt lõi của hệ thống:

#### 3.1. Nhập & Tiền Xử Lý Tài Liệu (`POST /ingest`)
Tiền xử lý tài liệu thô trước khi đưa vào các bước chuyên sâu. Kết quả trả về là text thuần túy (raw text) hoặc metadata thô bảo toàn cấu trúc chuẩn của file.
- **`mode=parse`**: Đọc cấu trúc file số như PDF/DOCX nguyên bản, sử dụng các công cụ parse layout chuyên dụng để giữ chặt các box văn bản, Header, Footer, cấu trúc bảng biểu và danh sách (list). Dùng cực tốt khi file là native PDF.
- **`mode=ocr`**: Áp dụng công nghệ Nhận dạng Ký tự Quang học (Optical Character Recognition) để chuyển đổi ảnh chụp, bản scan tài liệu (PNG/JPG/PDF Scan) thành text. Có khả năng khai báo ngôn ngữ (VD: `language=vie,eng`) để tăng cường độ chính xác.
- **`mode=digitize`**: Chuyên dụng xử lý các biểu mẫu (form) điền tay bị méo mó, chữ viết tay nghiêng ngả, form bị scan lệch. Mô hình sẽ nắn chỉnh góc và số hóa chính xác các ô checkbox/text field.
- **`mode=split`**: Chỉ cắt ghép/tách rời (split/merge) các trang từ tài liệu gốc. VD: Dùng tham số `pages=1-5` để trích xuất 5 trang đầu tiên của cuốn báo cáo thành PDF mới, giảm dung lượng cho các xử lý LLM.

#### 3.2. Trích Xuất Dữ Liệu (`POST /extract`)
Lấy thông tin có cấu trúc (JSON object/array) từ các loại giấy tờ hành chính hoặc chứng từ thương mại. LLM được trực tiếp sử dụng để mapping thông tin lên Schema được định nghĩa.
- **`type=invoice`**: Chuyên biệt trích xuất hóa đơn VAT, invoice quốc tế. Dữ liệu trả về luôn có các trường cố định: tên/MST nhà cung cấp, thông tin người mua, mã HĐ, tổng tiền cấn trừ thuế, thuế VAT, và mảng `line_items` (chi tiết mặt hàng).
- **`type=contract`**: Trích xuất meta-data từ hợp đồng kinh tế/lao động (bên A/bên B tên gì, điều khoản phạt vi phạm, thời hạn hiệu lực, chữ ký và giá trị ròng của hợp đồng).
- **`type=id-card`**: Trích xuất chính xác Chứng minh thư/CCCD/Passport theo trường (Số CCCD, Họ tên, Ngày Sinh, Quê quán, Địa chỉ thường trú) chống giả mạo OCR và làm sạch dữ liệu.
- **`type=receipt`**: Tương tự invoice nhưng tối ưu riêng cho biên lai siêu thị, vé xe, hóa đơn bán lẻ qua máy POS (in nhiệt, mờ chữ) giúp hệ thống quản lý chi phí (Expense Management) nhập liệu tự động.
- **`type=table`**: Dò tìm và bóc tách TẤT CẢ các bảng biểu có trong file PDF thành list mảng 2 chiều JSON hoặc định dạng CSV, loại bỏ đi các phần text văn xuôi thừa.
- **`type=custom`**: Trích xuất siêu linh hoạt theo chuẩn động (Dynamic schema). Client truyền cấu trúc mình muốn (JSON schema) qua tham biến `schema` hoặc chuỗi `fields="[tên_khách, sdt, dia_chi_giao_hang]"`.

#### 3.3. Phân Tích & Đánh Giá (`POST /analyze`)
Hiểu sâu văn bản (NLU), đối chiếu với các bộ luật, tiêu chuẩn ngành hay quy định kinh doanh tĩnh/động để đưa ra nhận định, đánh giá và quyết định phân tích logic.
- **`task=classify`**: Tự động phân loại tài liệu vào các Taxonomy cho trước. (VD: Đưa một đống hồ sơ tự động phân vào thư mục 'Hợp đồng', 'Hóa đơn', 'Báo cáo', 'CV'). Hữu ích cho phân luồng Routing nội bộ hệ thống.
- **`task=sentiment`**: Phân tích thái độ/cảm xúc nội dung (Tích cực/Tiêu cực/Trung tính/Cáu giận) kèm theo giải thích nguyên nhân do đâu. Rất phù hợp nếu feed vào dữ liệu là các bài Review của khách hàng.
- **`task=compliance`**: Cực kỳ mạnh mẽ trong mảng Pháp lý. Hệ thống quét qua tài liệu dựa theo tham số `criteria` (VD: "Phải có chữ ký hai bên; phải có mộc đỏ"). Nếu thoả mãn trả về `PASS`, vi phạm trả về mảng `FAIL` kèm chỉ mục lỗi trong văn bản.
- **`task=fact-check`**: Kiểm chứng chéo thông tin. *(Client truyền JSON dữ liệu mẫu (Sự thật) vào `reference_data`. Hệ thống đọc file và dò tìm xem trong tài liệu có chi tiết nào sai lệch, bịa đặt số liệu so với sự thật đó hay không)*.
- **`task=quality`**: Chấm điểm chất lượng văn phong (chuẩn ngữ pháp tiếng Việt, câu cú gãy gọn, logic lập luận chặt chẽ). Dùng chấm điểm bài luận hoặc duyệt lại báo cáo trước khi trình sếp.
- **`task=risk`**: Đánh giá sự rủi ro. Mô hình đọc và phát hiện rủi ro (VD: điều khoản phạt quá 20% là bất hợp pháp, hoặc thiệt hại rủi ro bồi thường vô hạn trong hợp đồng).
- **`task=summarize-eval`**: Phân tích kép: vừa đưa ra 1 tóm lược 3-4 câu chốt tổng quát, vừa kèm đánh giá sâu của một "chuyên gia" về quan điểm của người viết bài.

#### 3.4. Chuyển Đổi Nội Dung (`POST /transform`)
Biến đổi định dạng (Format) hoặc thay đổi nội hàm ngôn ngữ/văn phong (Content) nhưng luôn giữ nguyên vẹn thông điệp chính yếu của văn bản gốc.
- **`action=convert`**: Đổi định dạng thô của file (VD: Chuyển file DOCX có nhiều định dạng phức tạp sang cấu trúc Markdown dọn dẹp sạch sẽ, hoặc HTML chuẩn web).
- **`action=translate`**: Dịch thuật tài liệu nguyên bản (VD: `target_language=vi`). Điểm mạnh là vừa dịch vừa có thể điều chỉnh âm hưởng ngữ điệu `tone` (VD: dịch sang tiếng Việt cổ, hoặc giọng marketing sôi động).
- **`action=rewrite`**: Viết lại nội dung bằng câu chữ khác (Paraphrasing) nhằm tránh đạo văn, tóm gọn ý hoặc ép văn bản theo một phong cách cụ thể bằng tham số `style=academic, formal, casual`.
- **`action=redact`**: Tự động dò tìm và bôi đen (ẩn đi - Masking) tự động các thông tin nhạy cảm (PII: số thẻ tín dụng, CCCD, địa chỉ cư trú, số ĐT) trên file nhằm tuân thủ luật bảo mật. Trả về file text đã được thay thế mảng đó bằng chữ `[REDACTED]`.
- **`action=template`**: Cơ chế Mail Merge tự động. Client nạp một JSON data và hệ thống tự động điền các trường biến số đó vào một form/template mẫu thiết kế trước để sinh ra file final.

#### 3.5. Tạo Nội Dung Phái Sinh (`POST /generate`)
Sinh ra các văn bản / nội dung MỚI HOÀN TOÀN có giá trị ứng dụng cao, dựa vào (grounding) ngữ cảnh tài liệu gốc được truyền làm đầu vào cốt lõi.
- **`task=summary`**: Tóm tắt nội dung tài liệu với tỷ lệ nén cao, có khả năng format lại đầu ra rất phong phú: định dạng đoạn văn (paragraph), gạch đầu dòng (bullets), đánh số ưu tiên (numbered), dạng bảng (table), hoặc mô tả dưới cấu trúc sơ đồ (mind_map).
- **`task=qa`**: Nạp tài liệu lên bộ nhớ và cho phép hỏi đáp tức thì (tương tự như RAG) ngay trên tài liệu đó (`questions=["tổng hạn mức tín dụng là bao nhiêu?", "ai có trách nhiệm đền bù khi hàng hỏng?"]`).
- **`task=outline`**: Trích xuất tự động mục lục/dàn bài (Table of Contents) chuyên sâu với các đề mục phân cấp H1, H2, H3 nhằm tóm gọn nhanh cấu trúc một file PDF dài 100 trang.
- **`task=report`**: Từ các con số thô/bảng biểu khô khan trong file, sinh ra một bài báo cáo phân tích bằng ngôn ngữ tự nhiên, được "kể lại" dưới tư duy của một chuyên gia tài chính hoặc nhân sự.
- **`task=email`**: Tác vụ tuyệt vời cho Sales/CS: Trích xuất nội dung từ một yêu cầu khiếu nại của khách -> Tự động nháp (Draft) một email phản hồi xin lỗi / follow-up đúng chuẩn mực giao tiếp sự nghiệp.
- **`task=minutes`**: Xuất nội dung biên bản cuộc họp chuyên nghiệp từ 1 file Transcript Audio nguyên bản chứa toàn các câu thoại lộn xộn, nhận diện được ai nói ý chính gì và rà soát/lập bảng Action Items (công việc cần làm tiếp theo).

#### 3.6. So Sánh Tài Liệu (`POST /compare`)
So sánh sự khác biệt (Delta) giữa tài liệu thứ nhất `source_file` và tài liệu thứ hai `target_file`.
- **`mode=diff`**: So sánh thay đổi Text chặt chẽ từng dòng, từng ký tự (cơ chế tương tự lệnh `git diff`). Đánh dấu kiểm soát phiên bản tĩnh rõ ràng dòng nào được thêm [NEW], dòng nào bị xóa [DEL] chính xác đến từng dấu câu.
- **`mode=semantic`**: So sánh ngữ nghĩa (Semantic diff). Vượt qua các lỗi dính chữ hoặc sai khoảng trắng định dạng vô nghĩa. Khả năng trí tuệ tập trung tìm những khác biệt có thay đổi "về mặt ý nghĩa/pháp lý" giữa 2 bản. Đi kèm khả năng dùng tham số `focus` để bó hẹp chỉ quyét vùng tranh chấp (VD: "chỉ đối chiếu phần liên đới trách nhiệm hai bên").
- **`mode=version`**: Được tối ưu chuyên biệt cho việc tạo Changelog tóm lược (Lịch sử Sửa đổi). Đọc 2 phiên bản của một tập quy định/chính sách và tự sinh ra lời tổng kết ở đầu trang: "Ở version này quy định đã Update việc thêm quyền lợi phép năm, Xóa bỏ phụ cấp thưởng ngoài".

#### 3.7. Thẩm Định Hồ Sơ Vay — JSON Tích Hợp (`process=loan-appraisal`)
Gửi hồ sơ qua `POST /docs/workflows` với `process=loan-appraisal`, `product_code=hkd-loan`, `files[]`. Hệ thống ngoài nhận kết quả theo JSON `schema = "dugate.loan-appraisal.integration"` (`schema_version = "5.1"`) — **chỉ kết quả cuối** của bộ hồ sơ, không có tiến trình xử lý và không có evidence. Đặc tả đầy đủ và quy tắc phiên bản: `docs/loan-appraisal/INTEGRATION-CONTRACT.md`.

Giai đoạn 2 hiện **tạm tắt các bước kiểm tra hồ sơ** (Customer 360, checklist, đối chiếu chéo, master data): kết quả chỉ có OCR, chỉ số tài chính, bộ rule (rule engine + rule LLM) và khuyến nghị. Các khối đánh dấu *tuỳ chọn* dưới đây vắng mặt cho tới khi các bước đó được bật lại; consumer phải xử lý trường hợp vắng.

| Khóa | Nội dung |
|---|---|
| `case` | `id`, `completed_at`, `profile` (`segment`, `product`, `flow`, `catalog`) |
| `decision` | `status`, `recommendation` (`CONSIDER` / `REFER` / `INSUFFICIENT_DATA`), hạn mức / kỳ hạn đề xuất, `route`, `review_required`, `reason_codes`, `conditions`, `covenants` |
| `extractions[]` | Kết quả OCR theo chứng từ: `doc`, `file`, `status`, `data` (theo schema của loại chứng từ, đã bỏ trường rỗng) |
| `parties[]`, `assets[]` *(tuỳ chọn)* | Người / tổ chức và tài sản, mỗi phần tử có khóa `party-n` / `asset-n`; họ tên, định danh và trường đã hợp nhất |
| `documents` *(tuỳ chọn)* | `readiness`, tiến độ, `by_group[]`, `items[]` (chỉ mục bắt buộc hoặc có vấn đề), `records[]` (dữ liệu đã hợp nhất theo chứng từ), `issues[]` |
| `findings[]` *(tuỳ chọn)* | Điểm lệch khi đối chiếu chéo và vi phạm logic (không kèm nguồn) |
| `financials[]` | Mảng `{ metric, value, unit, status }` |
| `checks[]` | Kết quả rule engine, rule LLM và rule Agent cùng MỘT hình dạng: `id`, `ver`, `kind`, `group`, `outcome`, `severity`, `code`, `measure`, `confidence`, `message` |
| `checks_summary`, `exceptions`, `notes` | Tổng hợp, ngoại lệ policy, ghi chú |
| `extensions` | Phần riêng theo phân khúc (SME, doanh nghiệp lớn...), có version riêng |

Tham số `include` (phân tách bằng dấu phẩy): `narrative` thêm `assessment` (4 tiêu chí tiếp nhận, văn bản diễn giải); `labels` thêm nhãn hiển thị. Mặc định không có hai phần này. Kết quả đầy đủ (kèm evidence, tiến trình, giai đoạn 1) vẫn lấy qua `GET /operations/{id}` không có `view`.

Ba kênh nhận cùng cấu trúc:
- **Poll:** `GET /operations/{id}?view=integration[&include=narrative,labels]` — JSON nằm trong `result.extracted_data`.
- **Tải file:** `GET /operations/{id}/download?view=integration`.
- **Webhook:** body `{ operation_id, state, done, extracted_data }`, trong đó `extracted_data` là JSON tích hợp.

Mã hoá (bật trên Profile): ở chế độ `selective`, path cụ thể không tồn tại trong cấu trúc tích hợp bị từ chối (poll trả 422, webhook không gửi) thay vì gửi plaintext. Dùng `**.<ten_field>` (VD `**.id_number`) hoặc `encryption_mode=full`.

---

## Phần 2: Hướng Dẫn Thiết Lập Cho Admin (Quản Trị Viên)

Hệ thống DU được thiết kế theo cơ chế **Profile-Endpoint Configuration**, cho phép Admin kiểm soát mạnh mẽ hành vi của API đối với từng Client (Khách hàng/Đối tác) mà không cần can thiệp mã nguồn.

### 1. Quản Lý Client Profile
Mỗi client khi đăng ký sử dụng hệ thống sẽ được cấp một **Profile**. Profile gắn với 1 hoặc nhiều API Key và lưu trữ cấu hình mặc định.

**Quy trình Onboarding 1 Client mới:**
1. Đăng nhập vào Admin Dashboard.
2. Tại mục **Clients/Profiles**, chọn "Tạo Profile Mới".
3. Nhập tên Client và cấp phát API Key tương ứng.
4. Điều hướng tới trang **Overrides** để tùy chỉnh từng Module dịch vụ nhỏ riêng biệt cho Client đó.

### 2. Thiết Lập Custom Rules & Overrides (ProfileEndpoint)
Các thiết lập phân quyền và thay đổi Prompt (Override) được setup theo từng Endpoint. Những tham số định dạng từ Admin **hoàn toàn ẩn đối với Client**, đảm bảo an toàn nghiệp vụ và tránh lộ Business Logic ra bên ngoài.

Khi Client gửi Request, hệ thống (`Parameter Merger`) sẽ gộp tham số request với tham số Override từ Admin. Admin được quyền thiết lập các Parameters độc quyền sau:
- **`business_rules`**: (*Dùng cho /analyze, /extract*) - Quy tắc nghiệp vụ bắt buộc.
  > Ví dụ trong `/analyze?task=compliance`: *"Phải kiểm tra theo đúng Luật Doanh Nghiệp 2020. Tự động trả về ERROR nếu không có con dấu hợp lệ."*
- **`glossary`**: (*Dùng cho /transform*) - Bộ từ điển dịch thuật thuật ngữ chuyên ngành công ty (Glossary).
- **`redact_patterns`**: (*Dùng cho /transform*) - Mã Regex dùng cho việc bôi đen tự động các dữ liệu mật.
- **`focus_areas`**: (*Dùng cho /generate*) - Định hướng Agent khi tạo văn bản theo ý tổ chức.
- **`model_override`**: Ép buộc dùng LLM cụ thể (VD: đổi `gpt-4o` bản cao cấp sang `claude-3-haiku` cho các client đăng ký gói rẻ).
- **`max_tokens`**: Giới hạn độ dài văn bản đầu ra nhằm tránh tốn kém chi phí thừa.

### 3. Tích Hợp Kết Nối Ngoại Bộ (External API Connectors)
Khi các AI Backend mặc định của hệ thống không đủ so với yêu cầu Custom siêu sâu của Client, Admin có thể định nghĩa **Kết Nối Ngoại (External Connection)**.
1. Vào mục tab **External API Connections**.
2. Thêm mới cấu hình, dán cURL của hệ thống đích (VD: API OCR nội hạt hay Local LLM riêng của đối tác).
3. Đặt Prompt hướng dẫn cụ thể (`system_prompt` & `user_prompt`) vào Payload Request Body.
4. Gán Connector này làm Backend cho Endpoint của Profile Client. Kể từ lúc này, mọi Request của Client thay vì gọi nội bộ, sẽ đi qua API tuỳ biến này với các Rule & System Prompt ngầm.

---

### 🌟 4. Các Kịch Bản Sử Dụng Điển Hình (Real-World Use Cases)

Dưới đây là các ví dụ thực tế cho thấy sức mạnh của việc kết hợp tham số giữa Client và thiết lập ngầm từ Admin.

#### Use Case 1: Trích Xuất & Kiểm Tra Rủi Ro Tín Dụng

**Bài toán:** Client "Ngân Hàng V" muốn dùng API `/extract?type=contract` nhưng... chỉ muốn trích xuất  *thời hạn* và *lãi suất*, format JSON trả về phải là một cấu trúc nội bộ, đồng thời tự động kiểm tra *rủi ro lãi trần* cùng lúc xử lý.

**Hành động của Admin (Tại Overrides Dashboard):**
1. Mở Profile "Ngân Hàng V".
2. Vào Endpoint `/extract`, chuyển Trạng thái thành **Enabled**.
3. Điền vào **System Prompt / Business Rules Override**:
   > *"Bạn là chuyên viên tài chính. Chỉ bóc tách thời hạn vay và phần trăm lãi suất. Phải kiểm tra nếu rủi ro lãi suất cao hơn 20% / năm, thì thêm cờ 'WARNING' vào 'is_risky'. Chuẩn JSON format bắt buộc: { duration_months: number, interest_rate: number, is_risky: boolean }."*
4. Bấm Lưu.

**Hành động của Client Bank V:** 
```bash
curl -X POST https://api.dugate.vn/api/v1/extract \
  -H "x-api-key: dg_bank_v_xxx" \
  -F "file=@hop_dong_tin_dung.pdf" \
  -F "type=contract"
```
*Kết quả:* Client sẽ nhận được chính xác cấu trúc JSON và hệ thống tự động kiểm tra rủi ro như Admin đã gài cắm, không cần vất vả lập trình lại bất kỳ luồng Logic LLM nào.

---

#### Use Case 2: So Sánh 2 Phiên Bản Tài Liệu Ngữ Nghĩa

**Bài toán:** Phòng Pháp chế muốn tìm ra sửa đổi thực sự của đối tác trên bản Hợp đồng (Bản v2) so với bản gốc của công ty (Bản v1). Họ không muốn nhận về lỗi "thừa khoảng trắng" hay "xuống dòng" vô nghĩa, mà cần tìm những câu từ bị thay đổi **ý nghĩa pháp lý**.

**Hành động của Admin (Không Bắt Buộc):**
Có thể gài cắm vào **Business Rules** cho `/compare`:
> *"Chỉ tập trung vào các điều khoản thanh toán, trách nhiệm bồi thường và chấm dứt hợp đồng. Bỏ qua các sai sót chính tả nhỏ."*

**Hành động của Client Pháp Chế:**
```bash
curl -X POST https://api.dugate.vn/api/v1/compare \
  -H "x-api-key: dg_legal_xxx" \
  -F "source_file=@contract_v1.pdf" \
  -F "target_file=@contract_v2.docx" \
  -F "mode=semantic" \
  -F "focus=Trách nhiệm bồi thường"
```
*Kết quả:* Hệ thống sẽ trả về một JSON Diff trong đó chỉ ra đoạn văn bị sửa nghĩa. *(Ví dụ: "Bản V2 đã sửa mức đền bù từ 100% xuống còn 50% trong trường hợp đơn phương hủy hợp đồng.")*

---

#### Use Case 3: Đối Chiếu Nội Dung File Với Quy Định (Compliance)

**Bài toán:** Phòng Nhân sự nhận hàng ngàn Hồ sơ ứng tuyển và muốn tự động loại những CV/Bằng cấp không đáp ứng tiêu chuẩn.

**Hành động của Admin (Tại Overrides Dashboard):**
1. Mở Profile "HR Department".
2. Vào Endpoint `/analyze`, cấu hình **Business Rules**:
   > *"Kiểm tra CV và Bằng cấp. Ứng viên bắt buộc phải có chứng chỉ IELTS từ 6.5 trở lên, hoặc TOEIC trên 700, tốt nghiệp bằng Khá trở lên từ các trường Đại học công lập. Trả về WARNING nếu có khoảng thời gian trống (Gap year) dài hơn 6 tháng."*

**Hành động của Client HR:**
```bash
curl -X POST https://api.dugate.vn/api/v1/analyze \
  -H "x-api-key: dg_hr_xxx" \
  -F "file=@cv_nguyen_van_a.pdf" \
  -F "task=compliance"
```
*Kết quả:* JSON trả về sẽ có thuộc tính `"verdict": "FAIL"`, cùng mảng `"issues"` liệt kê rõ lý do rớt *(Ví dụ: "Chứng chỉ TOEIC 600 không đạt mốc 700 yêu cầu")*.
