# S3 — `map_dossier_roles`: Gom người và tài sản

## 1. Mục đích

Từ evidence của S2, dựng:

- **Danh sách người** (`role_registry`): ai là `borrower`, `co_borrower`, `collateral_owner`, `other`; mỗi người một `person_id`.
- **Danh sách tài sản** (`asset_registry`): gom các mô tả tài sản rải trong nhiều chứng từ về một `asset_id`.
- Quan hệ nhân thân chủ TSBĐ ↔ khách vay và `customer_360`.

Toàn bộ rule-based, tất định, **không gọi LLM**.

## 2. Input / Output

| Input | Ghi chú |
|---|---|
| `E` = evidence `SUCCESS` trong `CheckInput.evidences`, **đã áp bản vá** (T-EDIT-01, `04_data_model §5`) | Evidence `ERROR` không tham gia |
| `evidences[].data.parties[]`, `.assets[]`, `field_confidences`, `legal_info.issue_date` | |
| Anchor: `loan_application.data.party_details[]` | Quan hệ với khách vay, tình trạng hôn nhân khai báo |
| `dossier_submitted_at`, `validity_days`/`ignore_printed_expiry` theo loại chứng từ (`checklist_catalog.json`) | Chỉ để xác định bản bị thay thế (S3-R27) |

Ký hiệu: `ID_DOC_TYPES = {id_card, vneid, qr_code_info}`; `COUNTERPARTY_ROLES = {SELLER, EMPLOYER, LENDER}`; `N(s)` = chuẩn hóa tên (S3-R07); `K(p)` = tập số định danh đã biết của người `p`.

**Output `data`** (mọi field có mặt, mảng rỗng là `[]`):

| Field | Mô tả |
|---|---|
| `role_registry[]` | Mỗi người: `person_id`, `roles[]`, `primary_role`, `other_role_detail`, `full_name`, `declared_id_number`, `current_id_number`, `historical_id_numbers[]`, `observed_id_numbers[]`, `id_number_check{status,severity,requires_review,reason_code}`, `id_number_sources[]`, `role_conflict`, `role_conflict_details[]`, `mapped_evidences[]` |
| `unmapped_evidences[]` | Party không gán được: `evidence_id`, `file_id`, `file_name`, `doc_type_key`, `party_index`, `full_name`, `id_number`, `reason_code`, `message` |
| `asset_registry[]` | Mỗi tài sản: `asset_id`, `asset_type`, `identifiers`, `owner_person_ids[]`, `current_owner_person_ids[]`, `usage_contexts[]`, `context_status`, `context_reason_code`, `sources[]`, `identifier_conflicts[]` |
| `relationship_verifications[]` | `subject_person_id`, `collateral_owner_person_id`, `relationship_type`, `relationship_raw`, `required_count`, `verified_count`, `verified_documents[]` |
| `customer_360[]` | Mỗi người: `person_id`, `roles`, `identity{…}`, `marital_status`, `spouse_person_id`, `business`, `owned_asset_ids[]` |
| `superseded_evidences[]` | Bản cũ hết hiệu lực đã có bản mới thay (S3-R27): `evidence_id`, `doc_type_key`, `person_id`, `asset_id`, `issue_date`, `superseded_by_evidence_ids[]`, `reason_code = DOCUMENT_EXPIRED` |

`content_preview`: `person_count`, `mapped_evidence_count`, `unmapped_party_count`, `role_conflict_count`, `id_review_count`, `asset_count`, `unconfirmed_asset_count`, `relationship_verification_count`.

Ràng buộc nhất quán (engine tự kiểm, có test T-S3-14): mọi `person_id`/`asset_id` tham chiếu phải tồn tại; `verified_count = verified_documents.length`; `observed_id_numbers ⊇ historical ∪ {current}`; mỗi (evidence, party) xuất hiện tối đa 1 lần trong `mapped_evidences ∪ unmapped_evidences`; `customer_360[i].person_id = role_registry[i].person_id`; mỗi `superseded_evidences[].evidence_id` là evidence `SUCCESS` và không nằm trong `superseded_by_evidence_ids` của chính nó hay của phần tử nào khác.

## 3. Rule

### 3.1 Anchor và người

| ID | Rule |
|---|---|
| **S3-R01** | `loan_application` là anchor duy nhất. Ứng viên = evidence `loan_application` có ≥ 1 party `BORROWER` với `full_name` hoặc `id_number`. Chọn ứng viên có `field_confidences.parties` cao nhất; hòa → đứng trước. Vai trò chỉ đọc từ anchor. Không có anchor → `INSUFFICIENT_DATA` / `LOAN_APPLICATION_MISSING`; vẫn dựng `asset_registry`, còn lại rỗng. Các `loan_application` khác xử lý như evidence thường |
| **S3-R02** | Ánh xạ `party_role` → `Role`: `BORROWER`→`borrower`; `CO_BORROWER`→`co_borrower`; `COLLATERAL_OWNER`→`collateral_owner`; `SPOUSE`→`other`/`spouse`; `REFERENCE_PERSON`→`other`/`reference_person`; khác→`other`/`unspecified`. Người có ≥ 1 vai trò chính thì **không** giữ `other` |
| **S3-R03** | Gộp vai trò trong anchor (chạy **trước** khi ghép chứng từ khác). Party `x` là cùng người `p` khi: (1) cả hai có số, bằng nhau sau chuẩn hóa; (2) cả hai có số, khác nhau và **không** phải cặp 9/12 số → khác người; (3) còn lại (thiếu số, hoặc cặp 9/12): tên `EXACT`/`REORDERED` → cùng; `SPELLING_DIFFERENCE` → khác, cả hai nhận cảnh báo `NAME_SPELLING_DIFFERENCE`; (4) `COLLATERAL_OWNER` không tên, không số mà `relationship_raw` nghĩa "chính khách hàng" ("Khách hàng vay", "Chính chủ", "Bản thân") → cùng `borrower`; (5) khớp ≥ 2 người → gộp vào người tạo sớm nhất. 1 người thật = 1 `person_id`, `roles[]` đủ mọi vai trò |
| **S3-R04** | Tách chủ sở hữu ghép: `full_name` chứa ` VÀ `, ` & `, `,`, `;`, ` CÙNG ` và mỗi đoạn ≥ 2 từ → tách thành party con theo thứ tự, mỗi con chạy S3-R03 độc lập; con giữ `party_index`, `party_role`, `party_role_raw` của party gốc, `id_number = null` |
| **S3-R05** | `person_id` chỉ sinh từ party anchor (`person-1`, `person-2`… theo thứ tự tạo). Party chứng từ khác không khớp ai → `unmapped_evidences[]`, không tự tạo người. Thứ tự duyệt anchor: `BORROWER`, `CO_BORROWER`, `COLLATERAL_OWNER`, `SPOUSE`, `REFERENCE_PERSON`, còn lại; cùng vai trò theo `party_index` |

### 3.2 Ghép party của chứng từ khác

> D-109: chấm điểm Fellegi-Sunter thay S3-R06…R09 cho cá nhân — đề xuất, chưa cài đặt; xem
> [s3_fellegi_sunter.md](../cross_cutting/s3_fellegi_sunter.md). **Đã cài** vá FS-R01 cho S3-R07: party có số và ngày sinh cùng khác lời
> khai trên anchor (không phải cặp 9 ↔ 12 số) thì không ghép theo tên.

| ID | Rule |
|---|---|
| **S3-R06** | Ưu tiên số định danh (khớp tuyệt đối). Chuẩn hóa: chỉ giữ chữ số, giữ số 0 đầu. So với `K(p)` = số khai báo + mọi `id_number`, `previous_id_numbers` của party đã ghép vào `p`. Chỉ dùng số khi `field_confidences.parties ≥ 0.50`. Khớp đúng 1 người → ghép (`matched_by = ID_NUMBER`); khớp ≥ 2 → `AMBIGUOUS_IDENTITY_MATCH`. Lặp tới điểm bất động (tối đa 5 vòng) vì ghép mới có thể mở rộng `K(p)`. Khớp số thì dừng, không xét tên (tên khác chính tả → thêm cảnh báo, không đổi kết quả) |
| **S3-R07** | Dự phòng theo tên, chỉ khi party không có số / số confidence thấp / số không thuộc `K()` của ai. `N(s)`: NFC, HOA, bỏ danh xưng (`ÔNG`, `BÀ`, `ANH`, `CHỊ`, `MR`, `MRS`, `MS`), ký tự không phải chữ/khoảng trắng → khoảng trắng, gộp khoảng trắng, trim. Mức: `EXACT` (`N(a)=N(b)`), `REORDERED` (cùng tập từ khác thứ tự) → **khớp**; `SPELLING_DIFFERENCE` (bỏ dấu, kể cả `Đ`→`D`, thì bằng; hoặc cùng số từ và Levenshtein ≤ 2) và `NO_MATCH` → **không khớp**. Tên khớp nhiều người → lọc theo `date_of_birth` (cả hai khác null, bằng nhau); còn ≠ 1 → `AMBIGUOUS_IDENTITY_MATCH`. Ghép theo tên → `matched_by = FULL_NAME` |
| **S3-R08** | Khác chính tả không tự gộp: "NGUYỄN THỊ HẰNG" vs "NGUYỄN THI HẰNG" → party `unmapped` với `NAME_SPELLING_DIFFERENCE` (hoặc chỉ cảnh báo nếu đã ghép theo số) |
| **S3-R09** | `match_confidence`: `ANCHOR`, `ID_NUMBER` → `field_confidences.parties` của evidence; `FULL_NAME` → `min(conf, 0.90)` với `EXACT`, `min(conf, 0.85)` với `REORDERED` |
| **S3-R10** | `unmapped_evidences[]`. Party đủ điều kiện = `INDIVIDUAL` có `party_role ∉ COUNTERPARTY_ROLES`. (a) evidence có party đủ điều kiện nhưng **không** party nào ghép được → mỗi party chưa ghép là 1 phần tử; (b) evidence có ≥ 1 party ghép được → party chưa ghép **không** vào `unmapped`, **trừ** party có `ownership.is_current_owner = true`; (c) evidence có party nhưng không party nào có tên hoặc số → 1 phần tử `party_index = null`, `NO_IDENTITY_FIELDS`; (d) `ORGANIZATION` và `COUNTERPARTY_ROLES` được thử ghép nhưng không bao giờ sinh `unmapped`; (e) evidence `ERROR` không tham gia. Lý do ∈ {`NO_IDENTITY_MATCH`, `NAME_SPELLING_DIFFERENCE`, `NO_IDENTITY_FIELDS`, `AMBIGUOUS_IDENTITY_MATCH`} |

### 3.3 Số định danh

| ID | Rule |
|---|---|
| **S3-R11** | `role_conflict`: với người `p`, gom party `HOLDER` thuộc `ID_DOC_TYPES` đã ghép vào `p` thành **cụm danh tính** theo số (số 9 trong `previous_id_numbers` của cụm thì thuộc cụm đó). `role_conflict = true` khi ≥ 2 cụm và có 2 cụm khác nhau rõ về `date_of_birth` (cả hai khác null và khác nhau) hoặc `gender` (cả hai khác null và khác nhau). ≥ 2 cụm không phân biệt được → cùng người, chỉ là `CURRENT_ID_NUMBER_CONFLICT`. Khi `true`: `role_conflict_details` 1 phần tử / vai trò, `candidates` 1 / cụm; `current_id_number = null`; evidence thuộc `ID_DOC_TYPES` của `p` nhận `MULTIPLE_IDENTITIES_FOR_ROLE`. Nhiều người khác nhau cùng là chủ TSBĐ **không** phải `role_conflict` |
| **S3-R12** | Số hiện tại / lịch sử / quan sát: (1) **Hiện tại**: ứng viên = `id_number` của party `HOLDER` thuộc `ID_DOC_TYPES` đã ghép; ưu tiên số 12 (số 9 chỉ khi không có số 12); sắp theo `id_issue_date` giảm dần (null cuối), rồi thứ tự `evidences[]`; `current_id_number` = số đầu. Có ứng viên khác cùng độ dài, khác số, không thuộc `previous_id_numbers` của ứng viên nào → xung đột: `current_id_number = null`. (2) **Lịch sử** = mọi `previous_id_numbers` đã ghép ∪ mọi số 9 quan sát được khi số tham chiếu `R = current ?? declared` có 12 chữ số. (3) `id_status` mỗi quan sát: `CURRENT` nếu bằng `current` (khi xung đột: mọi ứng viên hiện tại); `HISTORICAL` nếu ∈ lịch sử; còn lại `OBSERVED`. Quan sát **không giải thích được** = `OBSERVED` và khác `R` |
| **S3-R13** | `id_number_check` (dừng ở dòng đầu thỏa): 1) xung đột hiện tại hoặc `role_conflict` → `CURRENT_ID_NUMBER_CONFLICT`, `HIGH`, review; 2) `declared`, `current` đều khác null, khác nhau, `declared ∉ lịch sử` → `NOT_VERIFIABLE`, `REVIEW`, review, `DECLARED_ID_DIFFERS`; 3) có quan sát không giải thích được → `NOT_VERIFIABLE`, `REVIEW`, review, `OBSERVED_ID_DIFFERS`; 4) có số lịch sử (9 số) giải thích được → `HISTORICAL_ID_NUMBER`, `INFO` (nâng `REVIEW` nếu confidence < 0.80), review = (severity là `REVIEW`); 5) còn lại → `CONSISTENT`, `INFO`, không review |

### 3.4 Tài sản

| ID | Rule |
|---|---|
| **S3-R14** | Khóa nối. `K(v)` = HOA, bỏ khoảng trắng, `.`, `-`; riêng `license_plate` bỏ thêm hậu tố trong ngoặc. Hai descriptor cùng họ (`real_estate`+`apartment` là 1 họ; `vehicle` 1 họ) được nối khi: BĐS/căn hộ — (`land_parcel_number` và `map_sheet_number` cùng khác null và bằng nhau) **hoặc** `certificate_number` bằng nhau **hoặc** (`apartment_number` và `building_name` cùng khác null và bằng nhau); Xe — `chassis_number` **hoặc** `engine_number` **hoặc** `license_plate` bằng nhau; `deposit`, `other` không có khóa, mỗi cái một tài sản. Hai descriptor của **cùng** evidence không nối trực tiếp |
| **S3-R15** | Lệch định danh. (1) Nhóm có ≥ 2 giá trị `K()` khác nhau (đều khác null) ở cùng một field `identifiers` → 1 phần tử `identifier_conflicts[]`. (2) Nối gần đúng khi chưa có cạnh chính xác: `chassis_number`/`engine_number`/`certificate_number` dài ≥ 6 và Levenshtein = 1, và không có field định danh nào khác khác null mà khác nhau → nối + ghi `identifier_conflicts`. (3) Bao đóng bắc cầu đưa 2 descriptor cùng evidence vào 1 nhóm → bỏ cạnh gần đúng; vẫn chung → giữ, `AMBIGUOUS` / `ASSET_IDENTIFIER_CONFLICT`. (4) Descriptor có `usage_context_hint` mà không có khóa đầy đủ: đúng 1 nhóm cùng họ có khóa đầy đủ → nối yếu vào đó; 0 hoặc ≥ 2 → tài sản riêng. Không khóa, không hint → tài sản riêng (5) **Nghi lỗi đọc** (D-41): conflict có đúng 2 giá trị, giá trị đa số đến từ ≥ 2 chứng từ, giá trị còn lại từ đúng 1 chứng từ, lệch đúng 1 ký tự, cả hai dài ≥ 6 → `probable_ocr_error = true`, `outlier_evidence_ids` = chứng từ lệch; conflict loại này **không** làm tài sản mất `CONFIRMED` (S3-R19) |
| **S3-R16** | `asset_id = asset-{n}` theo thứ tự descriptor đầu tiên của nhóm trong `evidences[]` (cùng evidence: theo `asset_index`). Chọn `asset_type` và `identifiers` theo ưu tiên nguồn: (1) descriptor được trỏ bởi `parties[].ownership.asset_index`; (2) `usage_context_hint = null`; (3) có hint. Cùng mức: `field_confidences.assets` cao hơn, rồi thứ tự `evidences[]`. Mỗi field lấy giá trị khác null của nguồn ưu tiên cao nhất. Trong họ BĐS, `apartment` thắng nếu nguồn mức (1) là `apartment` |
| **S3-R17** | Chủ sở hữu. Party `OWNER` gán cho tài sản qua `ownership.asset_index`; `ownership = null` và evidence chỉ có 1 tài sản → gán cho tài sản đó; còn lại không gán. `owner_person_ids` = người ghép từ mọi party `OWNER` (bìa + biến động). `current_owner_person_ids`: trong các evidence có `ownership` trỏ tới tài sản, chọn evidence có mốc mới nhất (mốc = `max(ownership_change_date)` của `CHANGE_RECORD`; không có → `legal_info.issue_date`; null thấp nhất; hòa → đứng trước); kết quả = người ghép từ party `is_current_owner = true` của evidence đó. Không có chứng từ sở hữu → `[]`. Không dùng chủ TSBĐ khai trên đơn vay làm chủ sở hữu |
| **S3-R18** | `usage_contexts` = hợp các `usage_context_hint` khác null trong nhóm, sắp theo `collateral`, `rental_income`. Một tài sản có thể có cả hai; cùng evidence được tính cho cả hai |
| **S3-R19** | `context_status` (theo thứ tự): (1) `usage_contexts = []` → `UNRESOLVED` / `ASSET_CONTEXT_AMBIGUOUS`; (2) `identifier_conflicts` khác rỗng hoặc S3-R15(3) → `AMBIGUOUS` / `ASSET_IDENTIFIER_CONFLICT`; (3) có nối yếu, hoặc họ có khóa mà không descriptor nào có khóa đầy đủ → `AMBIGUOUS` / `ASSET_CONTEXT_AMBIGUOUS`; (4) còn lại → `CONFIRMED`, `context_reason_code = null`. Chỉ `CONFIRMED` được S4 tính tự động |

### 3.5 Quan hệ nhân thân và Customer 360

| ID | Rule |
|---|---|
| **S3-R20** | Loại quan hệ. Chỉ sinh cho người `q` có `collateral_owner` và không có `borrower`/`co_borrower`; `subject_person_id` = người `borrower`. `relationship_raw` = `party_details[k].relationship_to_borrower_raw` (k = `party_index` của party anchor mang vai trò `collateral_owner` cho `q`); null → `party_role_raw`. `relationship_type` = `party_details[k].relationship_to_borrower` nếu khác null; ngược lại suy theo từ **nguyên vẹn** trên `N(relationship_raw)` (cũng so dạng bỏ dấu), ưu tiên theo bảng: `VỢ`/`CHỒNG` → `SPOUSE` (required null); `BỐ`/`CHA`/`MẸ`/`BA`/`MÁ`/`CON` → `PARENT_CHILD` (1); `ANH`/`CHỊ`/`EM` → `SIBLING` (2); khác, khác rỗng → `OTHER` (null); rỗng → `null` (riêng `q` là vợ/chồng theo `customer_360` → `SPOUSE`). "BẠN BÈ" không chứa từ `BA` |
| **S3-R21** | Xác minh qua giấy khai sinh. Giấy khai sinh = evidence `SUCCESS` có party `CHILD`; 3 tên = `full_name` của `CHILD`, `FATHER`, `MOTHER` (thiếu → không khớp; `total_names = 3`). Tên khớp người khi `name_level ∈ {EXACT, REORDERED}` với tên bất kỳ của người đó. Xét mọi giấy khai sinh của hồ sơ. `PARENT_CHILD`: hợp lệ khi ≥ 2/3 tên khớp **và** gồm cả `subject` và `q` (một ở `CHILD`, một ở `FATHER`/`MOTHER`); cần 1 giấy. `SIBLING`: mỗi giấy hợp lệ khi ≥ 1/3 tên khớp `subject` hoặc `q`; cần ≥ 2. Loại khác: không xét. S3 chỉ đếm; so với `required_count` thuộc S4 |
| **S3-R22** | `customer_360[i]` (cùng thứ tự `role_registry`). `identity.full_name` = tên; `identity.id_number` = `current ?? declared`. `date_of_birth`, `gender`: party nguồn số hiện tại → anchor. `permanent_address`, `current_address`: giá trị khác null của party `HOLDER` ở evidence có `legal_info.issue_date` mới nhất → party nguồn số hiện tại → anchor. `marital_status`: `data.marital_status` của evidence mới nhất mà người là `HOLDER` (bỏ bản bị thay thế, S3-R27) → `MARRIED` nếu là `HUSBAND`/`WIFE` đã ghép → `party_details[k].marital_status` của anchor → null. `spouse_person_id`: người còn lại của cặp `HUSBAND`/`WIFE` ghép được → người từ party `SPOUSE` của anchor → null. `business`: chỉ `borrower`/`co_borrower` — `business_info` của anchor (nếu `borrower`), nếu không có thì của evidence đầu tiên đã ghép có `business_info`. `owned_asset_ids` = các `asset_id` mà người ∈ `current_owner_person_ids` |

### 3.6 Chung

| ID | Rule |
|---|---|
| **S3-R23** | Một thuật toán chung cho mọi loại chứng từ (chạy trên `parties[]`, `assets[]`). Ngoại lệ duy nhất: (a) `loan_application` làm anchor; (b) chứng từ sở hữu (party có `ownership`) cho chủ sở hữu hiện tại; (c) `ID_DOC_TYPES` là nguồn số hiện tại |
| **S3-R24** | Evidence trong `duplicate_groups` vẫn ghép bình thường (mỗi bản một phần tử `mapped_evidences`); S3 không chọn bản chính |
| **S3-R25** | Kết quả nghiệp vụ không làm `FAILED`: thiếu anchor, unmapped, xung đột, ngữ cảnh chưa rõ chỉ làm `INSUFFICIENT_DATA`/`PARTIAL_SUCCESS` |
| **S3-R26** | Tất định. PII (tên, số, địa chỉ) không vào log; chỉ log `evidence_id`, `person_id`, `asset_id`, mã lý do |
| **S3-R27** | **Bản thay thế khi bản cũ hết hiệu lực.** Khách hàng được nộp bổ sung bản mới thay cho bản đã hết hạn. Xét các evidence `SUCCESS` cùng `doc_type_key` và cùng phạm vi (loại theo người → cùng `person_id` của party `HOLDER`/chủ thể; loại theo tài sản → cùng `asset_id`; còn lại → cả hồ sơ). Hiệu lực tính bằng `evaluateValidity` (T-S4-02, quy tắc S4-R15) với `d0 = dossier_submitted_at`. Evidence `e` là **bị thay thế** khi `e` hết hạn **và** có ≥ 1 evidence `e'` cùng nhóm còn hạn (`dateOK = true`, không hết hạn); `superseded_by_evidence_ids` = mọi `e'` như vậy, sắp theo `issue_date` giảm dần. Không có bản còn hạn → không bản nào bị thay thế (S4 báo `DOCUMENT_EXPIRED`). Hai bản cùng còn hạn → không bản nào bị thay thế (khác nhau thì S5 báo lệch). Bản bị thay thế vẫn ghép người/tài sản bình thường (S3-R24) nhưng **không** làm nguồn cho `customer_360` (S3-R22), điều kiện S4, so sánh S5, gợi ý S6 |

## 4. Trạng thái stage

| Điều kiện (theo thứ tự) | `status` | `status_code` |
|---|---|---|
| Không có anchor | `INSUFFICIENT_DATA` | `LOAN_APPLICATION_MISSING` |
| Có `role_conflict` | `PARTIAL_SUCCESS` | `ROLE_CONFLICT_PRESENT` |
| Có `unmapped_evidences` | `PARTIAL_SUCCESS` | `UNMAPPED_DOCUMENTS_PRESENT` |
| Có tài sản `context_status ≠ CONFIRMED` | `PARTIAL_SUCCESS` | `ASSET_CONTEXT_UNRESOLVED` |
| Còn lại | `SUCCESS` | `COMPLETED` |

## 5. Acceptance criteria

| ID | Given / When / Then | Rule |
|---|---|---|
| S3-AC01 | Given đơn vay có vợ là đồng vay / Then 1 người `roles=[co_borrower]`, `customer_360.spouse_person_id` = khách vay | R02, R22 |
| S3-AC02 | Given chủ TSBĐ là chính khách vay / Then 1 `person_id` có `[borrower, collateral_owner]` | R03 |
| S3-AC03 | Given CCCD khớp số với khách vay / Then `mapped_evidences` có `matched_by=ID_NUMBER` | R06 |
| S3-AC04 | Given CCCD tên "NGUYỄN THI HẰNG" vs anchor "NGUYỄN THỊ HẰNG", không có số / Then `unmapped` `NAME_SPELLING_DIFFERENCE` | R08 |
| S3-AC05 | Given CCCD 9 số trên đơn vay, CCCD 12 số trên thẻ, CCCD in số 9 ở mặt sau / Then `HISTORICAL_ID_NUMBER`, `INFO` | R12, R13 |
| S3-AC06 | Given 2 thẻ cùng vai khác ngày sinh / Then `role_conflict = true`, `current_id_number = null` | R11 |
| S3-AC07 | Given GCN trên đơn vay và định giá cùng số thửa+tờ / Then 1 `asset_id`, 2 `sources` | R14 |
| S3-AC08 | Given số khung lệch 1 ký tự, biển số trùng / Then 1 tài sản, `identifier_conflicts` có `chassis_number`, `AMBIGUOUS` | R15, R19 |
| S3-AC09 | Given GCN có 2 biến động / Then `current_owner_person_ids` là người nhận sau cùng | R17 |
| S3-AC10 | Given GCN không được đơn vay nhắc tới / Then `usage_contexts=[]`, `UNRESOLVED` | R19 |
| S3-AC11 | Given chủ TSBĐ là "Mẹ" và giấy khai sinh có đủ cả 2 tên / Then `PARENT_CHILD`, `verified_count=1` | R20, R21 |
| S3-AC12 | Given "BẠN BÈ" / Then `OTHER` (không phải `PARENT_CHILD`) | R20 |
| S3-AC13 | Given không có `loan_application` / Then `INSUFFICIENT_DATA`, `asset_registry` vẫn dựng | R01 |
| S3-AC14 | Given cùng input chạy 2 lần / Then output giống hệt | R26 |
| S3-AC15 | Given `d0 = 2026-10-14`, khách vay có xác nhận tình trạng hôn nhân cấp 2026-01-05 ("Độc thân", hết hạn) và bản cấp lại 2026-09-20 ("Đã kết hôn", còn hạn) / Then bản cũ ở `superseded_evidences` với `superseded_by_evidence_ids` = bản mới; `customer_360.marital_status` lấy từ bản mới | R27, R22 |
| S3-AC16 | Given chỉ có 1 xác nhận cư trú đã hết hạn / Then `superseded_evidences = []` | R27 |

## 6. Task cards

Các hàm trong `lib/loan-dossier/s3/` đều là hàm thuần. Dùng chung `lib/loan-dossier/common/` (T-COM-*).

### T-COM-01 — Chuẩn hóa và so khớp tên
- Depends: T-S2-03
- Files: `lib/loan-dossier/common/name.ts`, `tests/loan-dossier/common-name.test.ts`
- Refs: S3-R07, S3-R08
- Làm: `normalizeName(s)` (= `N()`), `nameLevel(a, b): 'EXACT'|'REORDERED'|'SPELLING_DIFFERENCE'|'NO_MATCH'`, `isNameMatch(level)`. Levenshtein dùng gói `fastest-levenshtein` đã có trong `package.json`.
- DoD:
  - test: bỏ danh xưng `ÔNG`, `Mr`
  - test: `A B C` vs `C A B` → `REORDERED`
  - test: `HẰNG` vs `HANG` → `SPELLING_DIFFERENCE`, `isNameMatch=false`
  - test: `Đ` vs `D` được coi là bỏ dấu
  - test: khác 3 ký tự, cùng số từ → `NO_MATCH`
  - test: chuỗi rỗng/null → `NO_MATCH`
- Verify: `npx jest tests/loan-dossier/common-name.test.ts`

### T-COM-02 — So khớp số định danh
- Depends: T-S2-03
- Files: `lib/loan-dossier/common/id-number.ts`, `tests/loan-dossier/common-id-number.test.ts`
- Refs: S3-R06, S3-R12
- Làm: `idKind(n): 'ID9'|'ID12'|'OTHER'`, `isOldNewPair(a,b)` (9 số vs 12 số), `sameId(a,b)` (so chữ số sau chuẩn hóa).
- DoD:
  - test: `0123 456 789` ≡ `0123456789` sau chuẩn hóa; số 0 đầu giữ
  - test: `isOldNewPair('012345678','012345678901')` true; hai số 12 khác nhau false
  - test: `idKind` đúng 3 nhánh
- Verify: `npx jest tests/loan-dossier/common-id-number.test.ts`

### T-S3-01 — Chọn anchor
- Depends: T-S2-02
- Files: `lib/loan-dossier/s3/anchor.ts`, `tests/loan-dossier/s3-anchor.test.ts`
- Refs: S3-R01
- Làm: `pickAnchor(evidences): Evidence | null`.
- DoD:
  - test: 2 ứng viên → chọn `field_confidences.parties` cao hơn
  - test: hòa → đứng trước
  - test: `loan_application` không có BORROWER có tên/số → null
  - test: evidence `ERROR` bị bỏ qua
- Verify: `npx jest tests/loan-dossier/s3-anchor.test.ts`

### T-S3-02 — Tách chủ sở hữu ghép
- Depends: —
- Files: `lib/loan-dossier/s3/split-names.ts`, `tests/loan-dossier/s3-split-names.test.ts`
- Refs: S3-R04
- Làm: `splitJointOwner(party): Party[]`.
- DoD:
  - test: "NGUYỄN VĂN A và TRẦN THỊ B" → 2 party, `id_number=null`, giữ `party_index`/`party_role`
  - test: đoạn 1 từ ("A, B") → không tách
  - test: dấu `&`, `;`, ` CÙNG ` đều tách
  - test: tên 1 người → không đổi
- Verify: `npx jest tests/loan-dossier/s3-split-names.test.ts`

### T-S3-03 — Dựng role registry từ anchor
- Depends: T-S3-01, T-S3-02, T-COM-01, T-COM-02
- Files: `lib/loan-dossier/s3/registry.ts`, `tests/loan-dossier/s3-registry.test.ts`
- Refs: S3-R02, S3-R03, S3-R05
- Làm: `buildRegistry(anchor): Person[]` — duyệt party theo thứ tự S3-R05, gộp theo S3-R03, gán `roles`, `primary_role`, `other_role_detail`, `declared_id_number`, sinh `person-n`, tạo `mapped_evidences` `ANCHOR`.
- DoD:
  - test: S3-AC01, S3-AC02
  - test: hai người cùng vai (2 chủ TSBĐ) → 2 `person_id`
  - test: tên khác chính tả → 2 người, cả hai có `NAME_SPELLING_DIFFERENCE`
  - test: cặp 9/12 số, tên EXACT → cùng người
  - test: party không tên không số → bỏ qua
  - test: người có `co_borrower` và `spouse` → `roles=['co_borrower']` (không giữ `other`)
- Verify: `npx jest tests/loan-dossier/s3-registry.test.ts`

### T-S3-04 — Ghép party chứng từ khác theo số, rồi theo tên
- Depends: T-S3-03
- Files: `lib/loan-dossier/s3/match-parties.ts`, `tests/loan-dossier/s3-match-parties.test.ts`
- Refs: S3-R06, S3-R07, S3-R08, S3-R09
- Làm: `matchParties(registry, evidences): {registry, unmatched[]}` — vòng số (≤ 5 vòng, cập nhật `K(p)`), dự phòng tên, đánh dấu `AMBIGUOUS_IDENTITY_MATCH`/`NAME_SPELLING_DIFFERENCE`/`NO_IDENTITY_MATCH`/`NO_IDENTITY_FIELDS`, tính `match_confidence`.
- DoD:
  - test: S3-AC03, S3-AC04
  - test: số thuộc `K()` của 2 người → `AMBIGUOUS_IDENTITY_MATCH`
  - test: ghép theo tên mở rộng `K(p)` rồi chứng từ sau khớp theo số (vòng lặp)
  - test: confidence số < 0.50 → rơi sang xét tên
  - test: tên khớp 2 người, DOB phân biệt được → ghép 1 người
  - test: `match_confidence` đúng R09 (`EXACT` ≤ 0.90, `REORDERED` ≤ 0.85)
  - test: cùng input chạy 2 lần cho cùng kết quả
- Verify: `npx jest tests/loan-dossier/s3-match-parties.test.ts`

### T-S3-05 — Dựng `unmapped_evidences`
- Depends: T-S3-04
- Files: `lib/loan-dossier/s3/unmapped.ts`, `tests/loan-dossier/s3-unmapped.test.ts`
- Refs: S3-R10
- Làm: `buildUnmapped(unmatched, evidences): Unmapped[]` kèm `message` theo mẫu.
- DoD:
  - test: mỗi điều (a)–(e) của R10 một test
  - test: party `SELLER` không ghép được → không sinh `unmapped`
  - test: party `OWNER` hiện tại không ghép được dù evidence còn party khác ghép được → vẫn `unmapped`
  - test: thứ tự theo `evidences[]` rồi `party_index`
- Verify: `npx jest tests/loan-dossier/s3-unmapped.test.ts`

### T-S3-06 — Số định danh hiện tại / lịch sử / kiểm tra
- Depends: T-S3-04, T-COM-02
- Files: `lib/loan-dossier/s3/id-check.ts`, `tests/loan-dossier/s3-id-check.test.ts`
- Refs: S3-R11, S3-R12, S3-R13
- Làm: `computeIdState(person, evidences)` → `current_id_number`, `historical_id_numbers`, `observed_id_numbers`, `id_number_sources`, `id_number_check`, `role_conflict`, `role_conflict_details`, cảnh báo cho từng `mapped_evidences`.
- DoD:
  - test: S3-AC05, S3-AC06
  - test: hai số 12 khác nhau, cùng DOB → xung đột (`current=null`), **không** `role_conflict`
  - test: ưu tiên số 12 hơn số 9
  - test: mỗi dòng 1–5 của bảng R13 một test
  - test: `HISTORICAL_ID_NUMBER` nâng `REVIEW` khi confidence < 0.80
  - test: `observed ⊇ historical ∪ {current}`
- Verify: `npx jest tests/loan-dossier/s3-id-check.test.ts`

### T-S3-07 — Khóa và nối tài sản
- Depends: T-S2-03
- Files: `lib/loan-dossier/s3/asset-key.ts`, `tests/loan-dossier/s3-asset-key.test.ts`
- Refs: S3-R14
- Làm: `assetKeys(descriptor): string[]` (các tổ hợp khóa đầy đủ), `canLink(a, b): boolean` (chính xác), `hasFullKey(d)`. Đây cũng là `assetKeyFn` cho T-S2-06.
- DoD:
  - test: BĐS nối theo (thửa+tờ), theo `certificate_number`, theo (căn hộ+tòa)
  - test: xe nối theo khung / máy / biển số; biển `88C-276.60 (T)` ≡ `88C27660`
  - test: `deposit`/`other` không nối
  - test: BĐS và xe không nối với nhau
  - test: hai descriptor cùng evidence không nối
- Verify: `npx jest tests/loan-dossier/s3-asset-key.test.ts`

### T-S3-08 — Gom nhóm tài sản (union-find) và nối gần đúng
- Depends: T-S3-07
- Files: `lib/loan-dossier/s3/asset-group.ts`, `tests/loan-dossier/s3-asset-group.test.ts`
- Refs: S3-R15, S3-R16
- Làm: `groupAssets(descriptors): Group[]` — nối chính xác, nối gần đúng (Levenshtein = 1), xử lý bắc cầu, nối yếu theo hint, gán `asset-n`, ghi `identifier_conflicts`.
- DoD:
  - test: S3-AC07, S3-AC08
  - test: bắc cầu đưa 2 descriptor cùng evidence vào chung nhóm → bỏ cạnh gần đúng; vẫn chung → `AMBIGUOUS`
  - test: descriptor có hint không khóa + đúng 1 nhóm ứng viên → nối yếu; 2 ứng viên → tài sản riêng
  - test: `asset_id` theo thứ tự xuất hiện, ổn định giữa 2 lần chạy
  - test: field định danh khác nhau ở 2 field khác → **không** nối gần đúng
- Verify: `npx jest tests/loan-dossier/s3-asset-group.test.ts`

### T-S3-09 — Chọn thuộc tính tài sản, chủ sở hữu, ngữ cảnh
- Depends: T-S3-08, T-S3-04
- Files: `lib/loan-dossier/s3/asset-attrs.ts`, `tests/loan-dossier/s3-asset-attrs.test.ts`
- Refs: S3-R16, S3-R17, S3-R18, S3-R19
- Làm: `finalizeAssets(groups, registry, evidences): AssetRegistryEntry[]`.
- DoD:
  - test: S3-AC09, S3-AC10
  - test: ưu tiên nguồn (1)>(2)>(3) khi chọn `identifiers`
  - test: `apartment` thắng `real_estate` khi nguồn (1) là `apartment`
  - test: `ownership=null` + evidence 1 tài sản → gán; 2 tài sản → không gán
  - test: hòa mốc → evidence đứng trước
  - test: mỗi dòng 1–4 của `context_status` một test
  - test: tài sản vừa `collateral` vừa `rental_income`
- Verify: `npx jest tests/loan-dossier/s3-asset-attrs.test.ts`

### T-S3-10 — Loại quan hệ
- Depends: T-COM-01
- Files: `lib/loan-dossier/s3/relationship.ts`, `tests/loan-dossier/s3-relationship.test.ts`
- Refs: S3-R20
- Làm: `classifyRelationship(raw, declaredType, isSpouseByCustomer360): {relationship_type, required_count}`.
- DoD:
  - test: S3-AC12
  - test: mỗi từ khóa trong bảng R20 một test, có cả dạng không dấu
  - test: `declaredType` khác null thắng suy luận
  - test: rỗng + là vợ/chồng → `SPOUSE`; rỗng + không phải → null
  - test: ưu tiên theo thứ tự bảng ("VỢ CON" → `SPOUSE`)
- Verify: `npx jest tests/loan-dossier/s3-relationship.test.ts`

### T-S3-11 — Xác minh qua giấy khai sinh
- Depends: T-S3-10, T-COM-01
- Files: `lib/loan-dossier/s3/birth-cert.ts`, `tests/loan-dossier/s3-birth-cert.test.ts`
- Refs: S3-R21
- Làm: `verifyByBirthCerts(subject, owner, type, certs): {verified_documents, verified_count}`.
- DoD:
  - test: S3-AC11
  - test: `PARENT_CHILD` chỉ có tên cha mẹ, không có tên con → không hợp lệ
  - test: `SIBLING` 1 giấy hợp lệ = `verified_count 1`; 2 giấy = 2
  - test: tên khác chính tả không tính
  - test: `SPOUSE`/`OTHER`/null → `verified_count 0`
  - test: giấy `ERROR` bị bỏ qua
- Verify: `npx jest tests/loan-dossier/s3-birth-cert.test.ts`

### T-S3-12 — Customer 360
- Depends: T-S3-06, T-S3-09, T-S3-16
- Files: `lib/loan-dossier/s3/customer360.ts`, `tests/loan-dossier/s3-customer360.test.ts`
- Refs: S3-R22
- Làm: `buildCustomer360(registry, assets, evidences, anchor)`.
- DoD:
  - test: địa chỉ lấy evidence có `issue_date` mới nhất, rồi nguồn số hiện tại, rồi anchor
  - test: `marital_status` theo chuỗi ưu tiên (4 bước)
  - test: bản bị thay thế không làm nguồn `marital_status` (S3-AC15)
  - test: `spouse_person_id` đối xứng
  - test: `business` chỉ có ở `borrower`/`co_borrower`
  - test: `owned_asset_ids` theo `current_owner_person_ids`
- Verify: `npx jest tests/loan-dossier/s3-customer360.test.ts`

### T-S3-13 — Trạng thái stage + `content_preview`
- Depends: T-S3-05, T-S3-09, T-S3-12
- Files: `lib/loan-dossier/s3/status.ts`, `tests/loan-dossier/s3-status.test.ts`
- Refs: §4, S3-R25
- Làm: `stageStatus(data)`, `contentPreview(data)`.
- DoD: mỗi dòng của bảng §4 một test; `content_preview` đúng 8 số; không bao giờ `FAILED`.
- Verify: `npx jest tests/loan-dossier/s3-status.test.ts`

### T-S3-14 — Kiểm tra nhất quán output
- Depends: T-S3-12
- Files: `lib/loan-dossier/s3/invariants.ts`, `tests/loan-dossier/s3-invariants.test.ts`
- Refs: §2 (ràng buộc nhất quán)
- Làm: `checkInvariants(data): string[]` trả danh sách vi phạm (rỗng = tốt).
- DoD: mỗi ràng buộc trong §2 có một test vi phạm và một test đạt.
- Verify: `npx jest tests/loan-dossier/s3-invariants.test.ts`

### T-S3-15 — Lắp ráp stage S3
- Depends: T-S3-04, T-S3-05, T-S3-06, T-S3-09, T-S3-11, T-S3-12, T-S3-13, T-S3-14, T-S3-16
- Files: `lib/loan-dossier/s3/run.ts`, `tests/loan-dossier/s3-run.test.ts`
- Refs: toàn bộ
- Làm: `runMapDossier(input): StageResult` nối các bước; nhận evidence đã áp bản vá (F-R06), không tự đọc `field_edits`.
- DoD:
  - test: S3-AC13, S3-AC14, S3-AC15
  - test: fixture hồ sơ đầy đủ (1 vay, 1 đồng vay là vợ, 2 chủ TSBĐ, 1 xe, 1 BĐS) cho ra snapshot ổn định (`toMatchSnapshot` — fixture dữ liệu giả)
  - test: `checkInvariants` rỗng trên mọi fixture
  - test: không có `console.log` nào chứa tên/số định danh (spy `console`)
- Verify: `npx jest tests/loan-dossier/s3-run.test.ts`

### T-S3-16 — Bản bị thay thế (bản cũ hết hiệu lực)
- Depends: T-S3-04, T-S3-09, T-S4-02
- Files: `lib/loan-dossier/s3/superseded.ts`, `tests/loan-dossier/s3-superseded.test.ts`
- Refs: S3-R27
- Làm: `findSuperseded(evidences, registry, assets, validityByDocType, d0): SupersededEvidence[]` — nhóm theo (`doc_type_key`, phạm vi), gọi `evaluateValidity` (T-S4-02), trả bản hết hạn có bản còn hạn cùng nhóm. `validityByDocType` dựng từ `checklist_catalog.json` (T-S4-01).
- DoD:
  - test: S3-AC15, S3-AC16
  - test: 2 bản cùng còn hạn → `[]`
  - test: bản hết hạn của người A không bị thay bởi bản còn hạn của người B
  - test: báo cáo định giá cũ (> 365 ngày) và bản mới cùng `asset_id` → bản cũ bị thay thế
  - test: loại `validity_days = null` chỉ bị thay thế khi `valid_until` in trên giấy đã qua (CCCD hết hạn + CCCD mới)
  - test: bản `dateOK = false` không được coi là bản thay thế
- Verify: `npx jest tests/loan-dossier/s3-superseded.test.ts`
