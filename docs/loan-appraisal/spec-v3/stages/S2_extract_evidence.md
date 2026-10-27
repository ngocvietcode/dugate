# S2 — `extract_evidence`: Trích xuất dữ liệu chứng từ

## 1. Mục đích

Với mỗi bản thể chứng từ, đọc nội dung thành dữ liệu có cấu trúc: 27 loại `extraction_level = FULL` theo schema đầy đủ của loại; 20 loại `extraction_level = LIGHT` (chỉ nhận diện ở checklist) theo bóc tách nhẹ — party chủ thể và vài trường (S2-R20, `03_catalogs/light_extraction.json`). **Chỉ phản ánh nội dung chính chứng từ**; không đối chiếu, không sửa chéo. S2 **không tự kết luận** còn/hết hiệu lực, nhưng **bắt buộc trích đủ các ngày** làm căn cứ hiệu lực (S2-R07). Việc tính hiệu lực dùng chung một hàm (T-S4-02): S3 dùng để xác định bản bị thay thế (S3-R27), S4 dùng để chấm checklist (S4-R15).

## 2. Input / Output

| Input | Nguồn |
|---|---|
| `matches[]` (mọi loại; `FULL` và `LIGHT`) | Output S1 (`file_id`, `doc_type_key`, `instances[]`) |
| Trang của file | Cùng file của request (stage 0 của workflow `loan-appraisal`, `cross_cutting/v2_integration.md`) | |

Bản vá của người dùng **không** dùng ở S2.

**1 phần tử `data.evidences[]` (EvidenceEnvelope):**

| Field | Kiểu | Mô tả |
|---|---|---|
| `evidence_id` | `ev-{12 hex}` | Tất định theo (file, `doc_type_key`, `instance_index`) — S2-R14 |
| `extraction_level` | `FULL` \| `LIGHT` | Theo `doc_types.json` (S2-R20) |
| `file_id`, `file_name` | string | `file_name` chỉ để hiển thị |
| `doc_type_key`, `doc_type_label` | string | |
| `instance_index` | int ≥ 1 | |
| `page_range` | `[from, to]` | |
| `status` | `SUCCESS` \| `ERROR` | |
| `reason_code`, `message` | string \| null | Bắt buộc khi `ERROR`; có thể có khi `SUCCESS` |
| `detected_form_name`, `form_variant` | string \| null | |
| `schema_version` | string | VD `3.0.0` |
| `data` | object \| null | Theo schema loại; `null` khi `ERROR` |
| `field_confidences` | `{tên field cấp 1: 0…1}` | `{}` khi `ERROR`. Mảng → min các phần tử |
| `source_pages` | `{tên field cấp 1: số trang}` | Bắt buộc với field khác null |
| `duplicate_group_id` | `dup-{n}` \| null | |
| `duplicate_status` | `DUPLICATE_CANDIDATE` \| `CONFIRMED_DUPLICATE` \| `CONFLICTING_DUPLICATES` \| null | |
| `differing_fields` | string[] | `field_path` khác nhau trong nhóm trùng |

Cấu trúc dùng chung `DocumentParty`, `AssetDescriptor`, `Address`, `LegalInfo`: [03_catalogs/doc_schemas/_common.schema.json](../03_catalogs/doc_schemas/_common.schema.json).

`content_preview`: `evidence_count`, `success_count`, `error_count`, `duplicate_group_count`.

## 3. Rule

| ID | Rule |
|---|---|
| **S2-R01** | Bóc tách đầy đủ chỉ 27 `ExtractableDocTypeKey` (`FULL`). 20 loại còn lại bóc tách nhẹ theo S2-R20, không dùng schema đầy đủ. Không tự sinh schema loại mới |
| **S2-R02** | 1 evidence = 1 tổ hợp (file, `doc_type_key`, `instance_index`). 1 file nhiều loại → nhiều evidence; 2 file cùng loại → 2 evidence. Không gộp xuyên file |
| **S2-R03** | Mọi work item `loan_application` được OCR **trước** các loại khác (là anchor của S3). Kết quả loại khác không phụ thuộc kết quả `loan_application` |
| **S2-R04** | Không thấy mẫu biểu của `doc_type_key` trong `page_range` → `ERROR` / `FORM_NOT_FOUND`, `data = null`. Không trích theo schema khác, không đổi `doc_type_key` |
| **S2-R05** | Các trang của cùng instance (mặt trước + sau CCCD, các trang GCN) cho ra **1** `data`; field mặt sau nằm cùng evidence |
| **S2-R06** | Thiếu field không làm `ERROR`: field null, confidence `0`, `status = SUCCESS`. Không suy đoán giá trị |
| **S2-R07** | Không tự kết luận hiệu lực (không có `is_expired`), nhưng **bắt buộc** trích các căn cứ hiệu lực in trên chứng từ: `legal_info.issue_date` (ngày cấp/ký xác nhận), `legal_info.valid_until` (chỉ khi in ngày hết hạn cụ thể) và nguyên văn thời hạn nếu schema có (`validity_period_raw`, `valid_until_raw`). Áp cho mọi loại; đặc biệt các loại có hạn: `marital_status_confirmation`, `residence_confirmation`, `cic`, `asset_quote`, `real_estate_valuation_report`, `movable_asset_valuation_report`, `external_valuation_certificate`, và ngày hết hạn của `id_card`. Ngày chỉ đọc được tháng/năm → giữ dạng `YYYY-MM`/`YYYY`, không tự thêm ngày |
| **S2-R08** | Không đối chiếu / sửa chéo. Không sửa số CCCD trên đơn vay theo CCCD gốc; không chọn số đúng khi 2 chứng từ lệch |
| **S2-R09** | Field định danh bắt buộc (VD `id_number` của CCCD) null → `status` vẫn `SUCCESS`, `reason_code = REQUIRED_FIELD_UNREADABLE`, `message` nêu field |
| **S2-R10** | Chuẩn hóa định dạng (ngày ISO, tiền số nguyên, số định danh, khoảng trắng) nhưng giữ nguyên chính tả tên riêng và địa danh. Không đổi địa danh cũ/mới |
| **S2-R11** | Mọi người/tổ chức trên chứng từ là phần tử `data.parties[]` với `party_role` chuẩn; nhãn gốc ở `party_role_raw`. Số CMND cũ in trên CCCD → `previous_id_numbers[]` của party đó, không tạo party mới. Ô ghép nhiều người ("A và B") giữ nguyên 1 party, S3 tách |
| **S2-R12** | Mọi tài sản là `data.assets[]` với `identifiers` chuẩn. `usage_context_hint` chỉ gán khi chính chứng từ nêu: `loan_application` mục TSBĐ → `collateral`; `income_statement` mục tài sản cho thuê → `rental_income`; còn lại null |
| **S2-R13** | Chủ sở hữu hiện tại (áp cho `land_use_certificate`, `apartment_ownership_certificate`, `land_use_cert_to_buy`, `vehicle_registration`): (1) chủ trang bìa → party `OWNER`, `COVER_PAGE`; (2) mỗi người nhận quyền ở trang biến động → party `OWNER`, `CHANGE_RECORD`, kèm ngày; (3) không có `CHANGE_RECORD` → mọi `COVER_PAGE` có `is_current_owner = true`; (4) có `CHANGE_RECORD` → chỉ party có ngày biến động lớn nhất là `true`. Có `CHANGE_RECORD` mà ngày null → áp trên các ngày khác null và `field_confidences.parties ≤ 0.5` |
| **S2-R14** | `evidence_id = "ev-" + sha256("{file_id}\|{doc_type_key}\|{instance_index}")[0:12]`. Cùng file, cùng loại, cùng bản thể → cùng `evidence_id` giữa các request, để bản vá do client giữ vẫn trỏ đúng sau khi gửi lại W1. Nhóm trùng tính trên toàn request |
| **S2-R15** | Phát hiện đọc nhầm trang: `source_pages` bắt buộc cho field cấp 1 khác null. Với loại có mục cố định (bắt buộc cho `loan_application`: Mục 2, 4.2/4.3, 5, và "PHẦN DÀNH CHO NGÂN HÀNG" Mục 3 dòng "Vốn vay tại VPBank"), nếu giá trị đọc từ trang **không chứa tiêu đề mục** → `field_confidences.<field> = min(hiện tại, 0.5)`. ≥ 2 field cùng bị hạ → hạ mọi field cấp 1 của evidence về tối đa `0.5` |
| **S2-R16** | `loan_application` **bắt buộc trích cả hai** số tiền, độc lập với nhau: (1) **Số tiền đề nghị vay** `loan_info.requested_amount` — số khách hàng ghi ở phần khách hàng đề nghị; (2) **Số tiền cho vay** `loan_info.bank_proposed_amount` — dòng "Vốn vay tại VPBank" ở "PHẦN DÀNH CHO NGÂN HÀNG", Mục 3. Mỗi số kèm trang nguồn (`requested_amount_page`, `bank_proposed_amount_page`). Không suy số này từ số kia; một bên trống → field đó `null`, bên còn lại vẫn trả. Hai số khác nhau là bình thường (ngân hàng duyệt khác đề nghị), không phải lỗi trích xuất. Khóa `loan_amount` "Số tiền cho vay" của catalog UAT (`uat-analysis/03-field-catalog.json`) tương ứng `bank_proposed_amount` |
| **S2-R17** | `dedup_key`: `loan_application` → hằng `"loan_application"`; evidence có `assets[]` → tập đã sắp khóa group tài sản (S3-R13), bỏ tài sản không có khóa; còn lại → tập đã sắp định danh các party `INDIVIDUAL` (ưu tiên `id_number`, không có thì tên chuẩn hóa: HOA, NFC, bỏ khoảng trắng thừa, giữ dấu). Tập rỗng → null. Trừ `loan_application`, khóa khác null được nối thêm `legal_info.issue_date` khi ngày này khác null: hai bản **khác ngày cấp** là hai lần cấp khác nhau (VD xác nhận tình trạng hôn nhân cũ và bản cấp lại), không phải bản trùng, nên không vào cùng nhóm và không thể thành `CONFLICTING_DUPLICATES`. Bản có `issue_date = null` chỉ nhóm với bản cũng `null`. Nhóm chỉ hình thành nhờ tên (không có số nào) → `key_by_name_only = true` |
| **S2-R18** | Trạng thái nhóm trùng: (a) so từng lá `data` của mọi cặp, bỏ lá mô tả phạm vi chụp (`has_front_side`, `has_back_side`, tên kết thúc `_page`, `party_details[].source_page`); lá khác nhau khi cả hai bên khác null và giá trị chuẩn hóa khác; (b) `CONFLICTING_DUPLICATES` nếu có lá khác nhau mà confidence field cấp 1 ≥ 0.80 ở **cả hai** — trừ lá mã/số (`identifiers.*`, `document_number`) mà ≥ 2 bản trong nhóm ghi giống nhau và đúng 1 bản lệch đúng 1 ký tự (độ dài ≥ 6, D-43): đó là lỗi đọc, không tính xung đột (lá vẫn ở `differing_fields`); (c) `DUPLICATE_CANDIDATE` nếu có lá khác (confidence thấp) hoặc nhóm chỉ nhờ tên; (d) còn lại `CONFIRMED_DUPLICATE`, `differing_fields = []` |
| **S2-R19** | `data.*` là PII: không log plaintext; không lưu ở đâu ngoài kết quả Operation (S-R06) |
| **S2-R20** | **Bóc tách nhẹ (`LIGHT`)** cho 20 loại `needs_extraction = false` — mọi chứng từ phải cho biết là của ai. `data = {parties, legal_info, fields}`: (1) `parties[]` có ≥ 1 party chủ thể với `party_role`/`party_type` theo `light_extraction.json` (`subject_party_role`, `subject_party_type`), đủ field `DocumentParty` (field không có trên giấy = null), kèm party khác nếu catalog ghi (VD thành viên ở biên bản HĐTV); (2) `legal_info` như loại `FULL` (ngày cấp phục vụ hiệu lực, S2-R07); (3) `fields` đúng các key của loại trong `light_extraction.json`, kiểu theo `value_type` (`DATE` ISO, `MONEY` số nguyên, `ADDRESS` object `Address`, `TEXT` chuỗi); không key nào khác. Chủ thể không đọc được tên → `status = SUCCESS`, `reason_code = REQUIRED_FIELD_UNREADABLE`. Evidence `LIGHT` tham gia S3 như mọi evidence (S3-R23); S4 vẫn tính trạng thái loại này theo S1 (S4-R13) nhưng ghi `evidence_id` của bản `LIGHT` vào `found_in` |
| **S2-R21** | **Kiểm schema mềm**: schema chặt (§7) là chuẩn của `data`, nhưng 1 field sai định dạng/kiểu **không** làm `ERROR` cả bản thể. Khi parse chặt lỗi, sửa cục bộ đúng chỗ lỗi rồi kiểm lại: field thiếu → `null` (như R06); key ngoài schema → bỏ; literal/enum chỉ 1 giá trị → giá trị schema cố định (nhãn gốc vẫn ở `party_role_raw`); `parties[i].party_index`/`assets[i].asset_index` → `i`; field sai → `null`, schema không cho null → `[]`/`{}`; vẫn sai → nâng lên field cha, cha là phần tử mảng → bỏ phần tử. Không bịa giá trị. Có field bị thay → `SUCCESS`, `reason_code = FIELD_FORMAT_INVALID` (R09 ưu tiên nếu cùng có), `message` nêu đường dẫn (không giá trị), `field_confidences` của field cấp 1 tương ứng ≤ 0.5. Chỉ `ERROR`/`UNREADABLE_CONTENT` khi phản hồi không phải JSON hoặc không cứu được ở cấp gốc (VD `parties` rỗng, không có party chủ thể). Metadata phụ (`field_confidences`, `source_pages`, `section_pages`) sai kiểu → bỏ mục đó |
| **S2-R22** | **Ô chọn (D-63).** Danh sách ô chọn (☐ / ☒ / ☑ / ✓ / dấu X) chỉ lấy ô ĐÃ đánh dấu; không chọn giùm ô mặc định khi không thấy dấu → `null`; đối chiếu dấu với đúng nhãn đứng ngay cạnh ô. Giấy đề nghị vay: tình trạng hôn nhân `party_details[].marital_status_raw` = nhãn ô đã đánh dấu; `marital_status`: Độc thân → `SINGLE`, Đã kết hôn → `MARRIED`, Ly hôn → `DIVORCED`, Góa → `WIDOWED`; Ly thân hoặc không có ô nào đánh dấu → `null`; không mặc định `MARRIED` chỉ vì có thông tin vợ / chồng (UAT: ô "Ly hôn" được đánh dấu nhưng bị đọc thành "Đã kết hôn") |

## 4. Trạng thái stage

| Điều kiện (theo thứ tự) | `status` | `status_code` |
|---|---|---|
| Không có match nào | `NOT_EVALUATED` | `NO_EXTRACTABLE_DOCUMENTS` |
| Có ≥ 1 evidence `ERROR` | `PARTIAL_SUCCESS` | `EXTRACTION_ERRORS_PRESENT` |
| Còn lại | `SUCCESS` | `COMPLETED` |

Dịch vụ OCR không phản hồi → `UNAVAILABLE` / `INTEGRATION_SERVICE_DOWN`.

## 5. Acceptance criteria

| ID | Given / When / Then | Rule |
|---|---|---|
| S2-AC01 | Given 1 file có CCCD + GCN / When extract / Then 2 evidence | R02 |
| S2-AC02 | Given file 2 CCCD / Then 2 evidence, `instance_index` 1 và 2 | R02 |
| S2-AC03 | Given S1 nhận nhầm, trang không có mẫu biểu / Then `ERROR`/`FORM_NOT_FOUND`, `data = null` | R04 |
| S2-AC04 | Given CCCD không đọc được số / Then `SUCCESS` + `REQUIRED_FIELD_UNREADABLE` | R09 |
| S2-AC05 | Given CCCD mặt sau in số CMND cũ / Then số đó nằm trong `previous_id_numbers`, `parties.length = 1` | R11 |
| S2-AC06 | Given GCN trang biến động có 2 ngày khác nhau / Then chỉ party ngày muộn nhất `is_current_owner = true` | R13 |
| S2-AC07 | Given `bank_proposed_amount` đọc từ trang không có tiêu đề mục 3 / Then confidence của field ≤ 0.5 | R15 |
| S2-AC08 | Given 2 `loan_application` giống hệt / Then cùng `duplicate_group_id`, `CONFIRMED_DUPLICATE` | R17, R18 |
| S2-AC09 | Given 2 `loan_application` khác ngày sinh, confidence 0.9 / Then `CONFLICTING_DUPLICATES`, `differing_fields` nêu đường dẫn | R18 |
| S2-AC10 | Given gửi lại W1 với cùng file / Then mọi `evidence_id` giống lần trước | R14 |
| S2-AC11 | Given 1 evidence `ERROR` / Then stage `PARTIAL_SUCCESS`, không `FAILED` | §4 |
| S2-AC12 | Given đơn vay ghi số tiền đề nghị 600 triệu, phần ngân hàng ghi "Vốn vay tại VPBank" 500 triệu / Then `requested_amount = 600000000`, `bank_proposed_amount = 500000000`, mỗi số có trang nguồn | R16 |
| S2-AC13 | Given 2 xác nhận tình trạng hôn nhân cùng người, ngày cấp 2026-01-05 và 2026-09-20, nội dung khác nhau / Then 2 evidence không cùng `duplicate_group_id`, không có `CONFLICTING_DUPLICATES`, cả hai có `legal_info.issue_date` | R07, R17 |
| S2-AC14 | Given GCN ĐKHKD / Then 1 evidence `LIGHT`: party `HOLDER` có tên + số CCCD người đại diện, `fields` có đúng `registration_number`, `business_name`, `business_address` (object `Address`), `business_line` | R20 |
| S2-AC15 | Given ảnh HKD không thể hiện tên / Then evidence `LIGHT` `SUCCESS`, party `full_name = null`, `reason_code = REQUIRED_FIELD_UNREADABLE` | R20 |
| S2-AC16 | Given CIC có `reports[0].report_datetime` không phải ngày giờ / Then evidence `SUCCESS`, `reason_code = FIELD_FORMAT_INVALID`, field đó `null`, các field khác giữ nguyên, `field_confidences.reports ≤ 0.5` | R21 |
| S2-AC17 | Given giấy đề nghị vay có dòng "☐ Độc thân ☐ Đã kết hôn ☐ Ly thân ☒ Ly hôn ☐ Góa" / Then prompt bóc tách có quy tắc ô chọn (chỉ lấy ô đã đánh dấu, đối chiếu dấu với nhãn ngay cạnh) và quy tắc riêng của giấy đề nghị vay: `marital_status_raw = "Ly hôn"`, `marital_status = DIVORCED`; không mặc định `MARRIED` | R22 |

## 6. Task cards

### T-S2-01 — Nạp schema chứng từ (registry zod)
- Depends: T-CAT-02
- Files: `lib/loan-dossier/s2/schema-registry.ts`, `tests/loan-dossier/s2-schema-registry.test.ts`
- Refs: S2-R01
- Làm: `getDocSchema(docTypeKey): ZodType` trả schema zod của 27 loại; loại `needs_extraction = false` hoặc không có trong catalog → ném `UNKNOWN_DOC_TYPE`. Mỗi schema nằm ở `lib/loan-dossier/s2/schemas/{doc_type_key}.ts` và được thêm bởi các task `T-DOC-*`; registry khai báo đủ 27 key, key chưa có schema trỏ tới `notImplemented`.
- DoD:
  - test: 27 key đều có entry
  - test: `deposit_certificate` → ném lỗi
  - test: key chưa có schema → `notImplemented` (liệt kê trong test để theo dõi tiến độ)
- Verify: `npx jest tests/loan-dossier/s2-schema-registry.test.ts`

### T-S2-02 — Schema zod dùng chung (Party, Asset, Address, LegalInfo, EvidenceEnvelope)
- Depends: T-CAT-02
- Files: `lib/loan-dossier/s2/common-schema.ts`, `tests/loan-dossier/s2-common-schema.test.ts`
- Refs: S2-R06, S2-R10, S2-R11, S2-R12
- Làm: Dịch `_common.schema.json` sang zod: `DocumentParty`, `AssetDescriptor`, `AssetIdentifiers`, `Address`, `LegalInfo`, `EvidenceEnvelope`. Số tiền là số nguyên, ngày là ISO, `IdNumber` theo regex `^\d{9}$|^\d{12}$|^[A-Z0-9]{6,15}$`.
- DoD:
  - test: Party hợp lệ qua; thiếu `party_role` bị từ chối
  - test: `MoneyVND` từ chối số thập phân và số âm
  - test: ngày `14/10/2026` bị từ chối, `2026-10-14` qua
  - test: field thừa bị từ chối (strict)
  - test: ví dụ envelope trong `_common.schema.json` qua
- Verify: `npx jest tests/loan-dossier/s2-common-schema.test.ts`

### T-S2-03 — Chuẩn hóa giá trị
- Depends: —
- Files: `lib/loan-dossier/common/normalize.ts`, `tests/loan-dossier/common-normalize.test.ts`
- Refs: S2-R10, S2-R17
- Làm: `normDate(s)` (dd/MM/yyyy, d/M/yyyy, có giờ → ISO), `normMoney(s)` ("120.000.000 đ", "120,000,000" → 120000000), `normIdNumber(s)` (chỉ chữ số, giữ 0 đầu), `normName(s)` (HOA, NFC, bỏ khoảng trắng thừa, **giữ dấu**), `normKey(s)` (HOA, bỏ khoảng trắng `.` `-`).
- DoD:
  - test: `5/3/2026` → `2026-03-05`; ngày không tồn tại (`31/02/2026`) → null
  - test: các dạng tiền → cùng một số; "abc" → null
  - test: `012345678901` giữ số 0 đầu
  - test: `nguyễn  văn a` → `NGUYỄN VĂN A` (giữ dấu)
  - test: `88C-276.60 (T)` qua `normKey` → `88C27660(T)` (bỏ hậu tố xử lý riêng ở S3-R13)
- Verify: `npx jest tests/loan-dossier/common-normalize.test.ts`

### T-S2-04 — Chủ sở hữu hiện tại trong 1 chứng từ
- Depends: T-S2-02
- Files: `lib/loan-dossier/s2/current-owner.ts`, `tests/loan-dossier/s2-current-owner.test.ts`
- Refs: S2-R13
- Làm: `markCurrentOwners(parties): parties` đặt `ownership.is_current_owner`, trả thêm cờ `confidenceCap` (0.5 khi có `CHANGE_RECORD` ngày null).
- DoD:
  - test: chỉ bìa → mọi party `true`
  - test: bìa + 2 biến động khác ngày → duy nhất bên ngày muộn là `true`
  - test: 2 biến động cùng ngày muộn nhất → cả hai `true`
  - test: 1 biến động ngày null + 1 có ngày → xét bên có ngày, `confidenceCap = 0.5`
  - test: party không có `ownership` không bị chạm
- Verify: `npx jest tests/loan-dossier/s2-current-owner.test.ts`

### T-S2-05 — Hạ confidence khi đọc nhầm trang
- Depends: T-S2-02
- Files: `lib/loan-dossier/s2/page-guard.ts`, `tests/loan-dossier/s2-page-guard.test.ts`
- Refs: S2-R15
- Làm: `applyPageGuard(env, sectionPages: Record<field, number|null>)`; `sectionPages[field]` là trang chứa tiêu đề mục, `null` = không có yêu cầu.
- DoD:
  - test: field đọc đúng trang → không đổi
  - test: 1 field sai trang → confidence = min(cũ, 0.5)
  - test: 2 field sai trang → mọi field cấp 1 ≤ 0.5
  - test: confidence thấp hơn 0.5 sẵn → không bị nâng
- Verify: `npx jest tests/loan-dossier/s2-page-guard.test.ts`

### T-S2-06 — Khóa trùng (`dedup_key`)
- Depends: T-S2-03
- Files: `lib/loan-dossier/s2/dedup-key.ts`, `tests/loan-dossier/s2-dedup-key.test.ts`
- Refs: S2-R17
- Làm: `dedupKey(env, assetKeyFn): {key: string|null, keyByNameOnly: boolean}`. `assetKeyFn` do S3 cung cấp (T-S3-07); ở đây truyền vào để tránh phụ thuộc vòng.
- DoD:
  - test: `loan_application` → `"loan_application"`
  - test: evidence có tài sản → tập khóa đã sắp, nối bằng `|`
  - test: party có `id_number` dùng số; không có thì dùng tên chuẩn hóa
  - test: không party nào có số → `keyByNameOnly = true`
  - test: tập rỗng → null
  - test: cùng người, khác `legal_info.issue_date` → hai khóa khác nhau; cùng ngày → cùng khóa; `issue_date = null` không trùng khóa với bản có ngày (S2-AC13)
  - test: `loan_application` không nối ngày cấp
- Verify: `npx jest tests/loan-dossier/s2-dedup-key.test.ts`

### T-S2-07 — Trạng thái nhóm trùng
- Depends: T-S2-06
- Files: `lib/loan-dossier/s2/duplicates.ts`, `tests/loan-dossier/s2-duplicates.test.ts`
- Refs: S2-R17, S2-R18
- Làm: `groupDuplicates(evidences, assetKeyFn): evidences` gán `duplicate_group_id` (`dup-1`… theo thứ tự xuất hiện), `duplicate_status`, `differing_fields`. So lá theo R18(a).
- DoD:
  - test: S2-AC08 và S2-AC09
  - test: lá `has_front_side` khác nhau không tính là khác
  - test: một bên null → không tính là khác
  - test: nhóm chỉ nhờ tên → `DUPLICATE_CANDIDATE`
  - test: `parties` sắp đặt khác thứ tự vẫn cùng kết quả
  - test: evidence `ERROR` không tham gia nhóm
- Verify: `npx jest tests/loan-dossier/s2-duplicates.test.ts`

### T-S2-08 — Cổng gọi model trích xuất
- Depends: T-S2-01
- Files: `lib/loan-dossier/s2/extractor-port.ts`, `tests/loan-dossier/s2-extractor-port.test.ts`
- Refs: S2-R04, S2-R06, S2-R09
- Làm: `ExtractorPort.extract(docTypeKey, pages): Promise<unknown>` và `validateExtraction(docTypeKey, raw): EvidenceResult` — parse bằng schema loại; lỗi schema → `ERROR` / `UNREADABLE_CONTENT`; không có mẫu biểu → `FORM_NOT_FOUND`; field định danh bắt buộc null → thêm `REQUIRED_FIELD_UNREADABLE`. Bản gọi thật dùng `enqueueSubStep` processor `ext-data-extractor` (OQ-03).
- DoD:
  - test: raw hợp lệ → `SUCCESS`
  - test: model báo không thấy mẫu → `FORM_NOT_FOUND`
  - test: thiếu field bắt buộc của schema → `ERROR`/`UNREADABLE_CONTENT`
  - test: `id_number` null ở `id_card` → `SUCCESS` + `REQUIRED_FIELD_UNREADABLE`
- Verify: `npx jest tests/loan-dossier/s2-extractor-port.test.ts`

### T-S2-09 — Lắp ráp stage S2
- Depends: T-S2-04, T-S2-05, T-S2-07, T-S2-08, T-S2-10
- Files: `lib/loan-dossier/s2/run.ts`, `tests/loan-dossier/s2-run.test.ts`
- Refs: S2-R02, S2-R03, S2-R14, S2-R20, §4
- Làm: `runExtract(input, ports): StageResult` — dựng work item từ `matches[]` (`FULL` và `LIGHT`), chạy `loan_application` trước, gán `evidence_id` theo S2-R14, nhóm trùng, tính `content_preview` và trạng thái §4.
- DoD:
  - test: S2-AC01, AC02, AC10, AC11
  - test: thứ tự gọi: mọi `loan_application` trước loại khác (port giả ghi lại thứ tự)
  - test: match `LIGHT` đi qua `extractLight`, không qua schema đầy đủ
  - test: không có match nào → `NOT_EVALUATED`
  - test: OCR down → `UNAVAILABLE`
- Verify: `npx jest tests/loan-dossier/s2-run.test.ts`

### T-S2-10 — Bóc tách nhẹ (`LIGHT`)
- Depends: T-S2-02
- Files: `lib/loan-dossier/s2/light.ts`, `tests/loan-dossier/s2-light.test.ts`
- Refs: S2-R20
- Làm: `lightSchema(docTypeKey): ZodType` dựng từ `light_extraction.json` (`parties` dùng `DocumentParty` chung, `legal_info` dùng `LegalInfo`, `fields` strict theo `value_type`); `validateLight(docTypeKey, raw): EvidenceResult`. Prompt bóc tách nhẹ liệt kê đúng key và vai trò chủ thể của loại.
- DoD:
  - test: S2-AC14, S2-AC15
  - test: 20 loại `LIGHT` đều dựng được schema; loại `FULL` → ném lỗi
  - test: `fields` có key lạ → `ERROR`/`UNREADABLE_CONTENT`
  - test: `business_address` dạng chuỗi bị từ chối (phải là object `Address`)
  - test: party chủ thể sai `party_role` → bị từ chối
- Verify: `npx jest tests/loan-dossier/s2-light.test.ts`

## 7. Task schema chứng từ (`T-DOC-*`)

Mỗi task viết **một** schema zod + test + fixture giả. Nguồn: **cả 27 loại đã có JSON Schema** trong `03_catalogs/doc_schemas/` — 10 loại chép từ bộ nguồn, 17 loại sinh bởi `tools/build_doc_schemas.py` (D-33; cột "Nguồn" ghi file mô tả nghiệp vụ gốc để tra thêm). Zod phải dịch **đúng** JSON Schema, không thêm/bớt field. Mọi schema **bắt buộc** dùng `DocumentParty`/`AssetDescriptor` chung, `.strict()`, và có test `parse(fixture)` qua.

Mẫu task (áp cho mọi dòng):

```text
### T-DOC-{nn} — Schema {doc_type_key}
- Depends: T-S2-02
- Files:   lib/loan-dossier/s2/schemas/{doc_type_key}.ts, tests/loan-dossier/s2-schema-{doc_type_key}.test.ts
- Làm:     Dịch nguồn sang zod; đăng ký vào registry (T-S2-01)
- DoD:     test fixture hợp lệ qua; thiếu parties/legal_info bị từ chối; field lạ bị từ chối;
           party_role chỉ trong tập cho phép của loại này
- Verify:  npx jest tests/loan-dossier/s2-schema-{doc_type_key}.test.ts
```

| Task | `doc_type_key` | Nguồn | `party_role` cho phép |
|---|---|---|---|
| T-DOC-01 | `id_card` | JSON Schema | HOLDER |
| T-DOC-02 | `vneid` | JSON Schema | HOLDER |
| T-DOC-03 | `qr_code_info` | JSON Schema | HOLDER |
| T-DOC-04 | `residence_confirmation` | JSON Schema | HOLDER, HOUSEHOLD_MEMBER |
| T-DOC-05 | `marital_status_confirmation` | JSON Schema | HOLDER |
| T-DOC-06 | `local_cmnd_confirmation` | JSON Schema | HOLDER |
| T-DOC-07 | `same_person_commitment` | JSON Schema | HOLDER |
| T-DOC-08 | `marriage_certificate` | JSON Schema | HUSBAND, WIFE |
| T-DOC-09 | `birth_certificate` | JSON Schema | CHILD, FATHER, MOTHER |
| T-DOC-10 | `loan_application` | JSON Schema | BORROWER, CO_BORROWER, SPOUSE, COLLATERAL_OWNER, REFERENCE_PERSON |
| T-DOC-11 | `purchase_list` | `bang_ke_mua_hang.md` | CUSTOMER, SELLER |
| T-DOC-12 | `goods_purchase_contract` | `hop_dong_mua_ban_hang_hoa.md` | SELLER, BUYER |
| T-DOC-13 | `vehicle_sale_contract` | `hop_dong_mua_ban_xe.md` | SELLER, BUYER |
| T-DOC-14 | `labor_contract` | `hop_dong_lao_dong.md` | EMPLOYER, EMPLOYEE |
| T-DOC-15 | `salary_confirmation` | `giay_xac_nhan_luong.md` | EMPLOYER, EMPLOYEE |
| T-DOC-16 | `income_statement` | `bang_ke_thu_nhap.md` | BORROWER, CO_BORROWER |
| T-DOC-17 | `land_use_certificate` | `gcn_qsdd_tsbd.md` | OWNER |
| T-DOC-18 | `apartment_ownership_certificate` | `gcn_qsdd_can_ho_chung_cu.md` | OWNER |
| T-DOC-19 | `land_use_cert_to_buy` | `gcn_qsdd_can_mua.md` | OWNER |
| T-DOC-20 | `vehicle_registration` | `chung_nhan_dang_ky_xe_oto.md` | OWNER |
| T-DOC-21 | `vehicle_inspection` | `dang_kiem_xe.md` | OWNER |
| T-DOC-22 | `real_estate_valuation_report` | `bao_cao_dinh_gia_bds_thinh_dien.md` | CUSTOMER, OWNER |
| T-DOC-23 | `movable_asset_valuation_report` | `bao_cao_dinh_gia_dong_san.md` | CUSTOMER, OWNER |
| T-DOC-24 | `asset_quote` | `bao_gia_tai_san.md` | CUSTOMER, OWNER |
| T-DOC-25 | `external_valuation_certificate` | `chung_thu_dinh_gia_cong_ty_ngoai.md` | CUSTOMER, OWNER |
| T-DOC-26 | `cic` | `bao_cao_cic.md` | HOLDER |
| T-DOC-27 | `credit_contract` | `hop_dong_tin_dung_tctd_khac.md` | BORROWER, CO_BORROWER, LENDER |

Mô tả nghiệp vụ gốc của 17 loại nằm ở `D:/WorkingFolder/Specs_Sprint_1-2_20261012/API Specs/01_metadata/pipeline_steps/step2_extract_evidence/`; tên field cũ đã được đổi sang cấu trúc chuẩn trong JSON Schema (người → `parties[]`, tài sản → `assets[]` + `asset_details[]` nối bằng `asset_index`, số tiền → số nguyên, ngày → ISO, địa chỉ → `Address`). Không dịch lại từ mô tả gốc. `check_spec.py` kiểm mọi `field_path` của `cross_check_matrix.json` và `sl_fields.json` có trong schema tương ứng. Task `T-DOC-10` (`loan_application`) lớn nhất: tách thành `T-DOC-10a` (parties, party_details), `T-DOC-10b` (assets, asset_details), `T-DOC-10c` (loan_info, business_info, financial_info, officer_info; DoD thêm: fixture có cả `requested_amount` và `bank_proposed_amount` khác nhau — S2-AC12; ô "Lãi suất" ghi `LC10` → `interest_rate_code = "LC10"`, `interest_rate = null`; `financial_info.has_existing_debt`, `existing_monthly_debt_payment` đọc từ mục nghĩa vụ nợ — D-32).
