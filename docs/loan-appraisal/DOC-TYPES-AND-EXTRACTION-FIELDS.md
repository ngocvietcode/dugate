# Quản lý Danh mục Chứng từ, Trường trích xuất & Quy trình Thẩm định Hồ sơ (Loan Appraisal)

Tài liệu này tổng hợp cấu trúc lưu trữ danh mục chứng từ, quy cách trích xuất dữ liệu và quy trình xử lý hồ sơ vay vốn bằng AI trong hệ thống DUGate, đối chiếu với tài liệu Confluence [AI for Loan Appraisal (Page ID: 312491888)](https://confluence.vpbank.com.vn/spaces/BIC/pages/312491888/AI+for+Loan+Appraisal) và [[LA] Phân khúc SME (Page ID: 323614120)](https://confluence.vpbank.com.vn/spaces/BIC/pages/323614120/LA+Phan+khuc+SME).

---

## Phần A. Danh sách các loại chứng từ và trường trích xuất

Toàn bộ danh mục chứng từ và quy cách trích xuất trường dữ liệu trong hệ thống được quản lý tập trung tại các file và thư mục sau:

### 1. Danh sách các loại chứng từ (`doc_types`)
* **File định nghĩa gốc:** 
  `docs/loan-appraisal/spec-v3/03_catalogs/doc_types.json`
* **File runtime đồng bộ trong code:** 
  `lib/loan-dossier/catalog/data/doc_types.json` *(được kiểm tra SHA-256 qua lệnh `npm run sync:loan-catalogs`)*
* **Nội dung:** 
  * Khai báo toàn bộ 47 loại chứng từ chuẩn hóa của hệ thống (`id_card`, `vneid`, `real_estate_valuation_report`, `loan_application`, `financial_statement`,...).
  * Mỗi loại quy định: mã chứng từ (`doc_type_key`), tên hiển thị (`doc_type_label`), nhóm hồ sơ (`checklist_group`), mức độ trích xuất (`extraction_level`: `FULL` hoặc `LIGHT`), các trường tóm tắt nhanh (`summary_fields`) và dấu hiệu nhận diện (`recognition_hint`).

---

### 2. Danh sách trường trích xuất chi tiết (Mức `FULL`)
* **Thư mục schema gốc:** 
  `docs/loan-appraisal/spec-v3/03_catalogs/doc_schemas/`
* **Thư mục runtime đồng bộ trong code:** 
  `lib/loan-dossier/catalog/data/doc_schemas/`
* **Nội dung:** Chứa các file JSON Schema (`*.schema.json`) chi tiết cho từng loại chứng từ bóc tách sâu, quy định cấu trúc `parties` (chủ thể), `assets` (tài sản), `fields`, kiểu dữ liệu và validation. Ví dụ tiêu biểu:
  * `id_card.schema.json` / `vneid.schema.json`: Họ tên, số định danh, ngày sinh, nơi thường trú, ngày cấp...
  * `loan_application.schema.json`: Số tiền đề nghị, số tiền ngân hàng đề xuất, kỳ hạn, lãi suất, mục đích vay, thông tin người vay/đồng vay...
  * `real_estate_valuation_report.schema.json` / `external_valuation_certificate.schema.json`: Giá trị định giá, diện tích, địa chỉ, chủ sở hữu, ngày phát hành chứng thư...
  * `income_statement.schema.json`: Doanh thu, chi phí, lợi nhuận ròng hàng tháng/năm của HKD...
  * `cic.schema.json`: Lịch sử nợ, nhóm nợ cao nhất, dư nợ hiện tại...

---

### 3. Danh sách trường trích xuất rút gọn (Mức `LIGHT`)
* **File định nghĩa gốc:** 
  `docs/loan-appraisal/spec-v3/03_catalogs/light_extraction.json`
* **File runtime đồng bộ trong code:** 
  `lib/loan-dossier/catalog/data/light_extraction.json`
* **Nội dung:** Quy định danh mục các trường bóc tách nhẹ cho các chứng từ chỉ cần lấy thông tin cơ bản hoặc mã số (ví dụ: `household_business_license`, `payroll_bank_statement`, `vssid_social_insurance`...).

---

### 4. Tài liệu đối chiếu & phân tích theo mẫu biểu (UAT / Phân tích nghiệp vụ)
* `docs/loan-appraisal/uat-analysis/01-field-extraction-by-form.md`: Bảng mô tả chi tiết trường bóc tách theo từng mẫu biểu thực tế.
* `docs/loan-appraisal/uat-analysis/03-field-catalog.json`: Catalog tổng hợp toàn bộ các trường trích xuất phục vụ kiểm thử và chấm điểm UAT.
* `docs/loan-appraisal/spec-v3/03_catalogs/checklist_catalog.json`: Danh mục đối chiếu các mục checklist với các loại chứng từ được chấp nhận (`accepted_doc_type_keys`).
* **Riêng phân khúc SME:** Danh mục 27 loại chứng từ và các trường trích xuất (đặc biệt là vị trí trang lấy Mã số thuế) được quy định tại Confluence: [[LA] Phân khúc SME (Page ID: 323614120)](https://confluence.vpbank.com.vn/spaces/BIC/pages/323614120/LA+Phan+khuc+SME).

---

## Phần B. Tóm tắt Quy trình xử lý và thẩm định 2 giai đoạn

### 1. Xác định bộ hồ sơ và phân loại checklist
* **Sản phẩm & Luồng:**
  * `hkd-loan`: Luồng `FULL` / `FAST` / `SIMPLE` (danh mục 10 nhóm chứng từ chuẩn).
  * `sme`: Luồng `NEW_OR_RENEW` (Cấp mới / Tái cấp) và `AMEND_CONDITION` (Thay đổi điều kiện).
* **Phân loại mục checklist:**
  * `REQUIRED` (Bắt buộc): Luôn phải có (CCCD, CIC, Giấy đề nghị vay). Thiếu thì báo `MISSING_REQUIRED`, không được giải trình.
  * `CONDITIONAL` / `APPLY` (Có điều kiện): Áp dụng theo điều kiện dữ liệu (ví dụ: Sổ cổ đông cho Cty Cổ phần; Báo cáo tiến độ cho Cty Xây dựng; Phê duyệt GĐ Vùng khi vay $\ge 50$ tỷ).
  * `ALTERNATIVE` (Có thể thay thế): Phê duyệt TP Kinh doanh SME thay cho GĐ Khối; VNeID/Cam kết thay CCCD.
  * `SKIPPED` (Không áp dụng) và `UNDETERMINED_CONDITION` (Chưa đủ dữ liệu kết luận).

### 2. Giai đoạn 1: Phân loại & Kiểm tra sơ bộ (`DOSSIER_INTAKE`)
* **Mục tiêu:** Trả lời nhanh: có gì, thiếu gì, quan hệ giữa các chứng từ có hợp lý không. **Chưa bóc tách OCR chi tiết** để phản hồi nhanh (~40s cho 8 file).
* **Bước 1.1:** Tải checklist theo sản phẩm và luồng (`resolveChecklist`).
* **Bước 1.2:** Phân loại chứng từ song song (`classify` - `ext-classifier`).
* **Bước 1.3:** Kiểm tra sơ bộ bằng AI (`dossier_precheck` - `ext-fact-verifier`): suy luận quan hệ từ Giấy đề nghị vay $\rightarrow$ người vay, đồng vay, TSBĐ, người phối ngẫu. Phát hiện thiếu sót ẩn.
* **Bước 1.4:** Tạm dừng ở `WAITING_USER_INPUT` (Webhook `PAUSED`). Kết quả giai đoạn 1 (`result_phase = "DOSSIER_INTAKE"`, có `dossier_precheck`) là bản nháp cho Sale, lấy qua `GET /operations/{id}` (không có `view`); payload tích hợp 5.0 chỉ dành cho kết quả cuối nên không chứa nó.

### 3. Giai đoạn 2: Bóc tách, đối chiếu & Thẩm định (`CREDIT_APPRAISAL`)
* Kích hoạt qua `POST /api/v1/operations/{id}/resume`. Không phân loại lại.
* **Bước 2.1:** Bóc tách OCR (`extract_evidence` - `FULL` và `LIGHT`).
* **Bước 2.2:** Xác định hiệu lực chứng từ (SME FN-06): Gán `VALID`, `INVALID`, `INCOMPLETED_INFO`, `RECOGNITION_FAIL`... và trích xuất `additional_condition`.
* **Bước 2.3:** Kiểm tra checklist chi tiết (FN-07): Chỉ dùng file `VALID`. Kiểm tra đủ kỳ BCTC/VAT, tối thiểu 3 hợp đồng mua/bán khớp MST.
* **Bước 2.4:** Đánh giá tiếp nhận (`intake_assessment`): Chấm 4 tiêu chí, sinh mã `finding_code`. Hỗ trợ Sale giải trình (`acknowledgements`) khi chạy lại.
* **Bước 2.5:** Hợp nhất Customer 360: Định danh, Thu nhập, TSBĐ, Mối quan hệ.
* **Bước 2.6:** Đối chiếu chéo (Cross-check): So khớp ngữ nghĩa (`SEMANTIC`). HKD đối chiếu tên, CCCD, chủ TSBĐ, CIC. SME đối chiếu MST trên 9 loại chứng từ.
* **Bước 2.7:** Thẩm định tài chính, chính sách (`LOAN.*`, rule engine + rule LLM theo nhóm) và khuyến nghị (Stage 3–5).
* **Đầu ra:** Webhook `SUCCEEDED`, lấy kết quả qua `GET /api/v1/operations/{id}?view=integration` (schema 5.0, chỉ kết quả cuối).
