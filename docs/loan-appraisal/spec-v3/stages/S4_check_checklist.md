# S4 — `check_checklist`: Kiểm tra danh mục hồ sơ

## 1. Mục đích

Đối chiếu chứng từ đã nhận diện/trích xuất với checklist chuẩn của đúng `flow`, trả cho **từng mục**: bắt buộc hay không, trạng thái, lý do, chứng từ nguồn, đề xuất xử lý. RM biết ngay thiếu gì; CO không phải tra checklist thủ công.

Rule-based. LLM chỉ dùng cho 6 điều kiện `LLM_SEMANTIC` trong catalog (S4-R10).

## 2. Input / Output

| Input | Nguồn | Bắt buộc |
|---|---|:---:|
| `flow` | `CheckInput.flow` | ✔ |
| `product_code` | tham số chạy (V2-R01) → chương trình checklist (S4-R24) | ✔ |
| Ghi đè mức yêu cầu | Profile `loan_checklist_overrides` (S4-R25) | |
| `dossier_submitted_at` | `CheckInput.dossier_submitted_at` | ✔ |
| `external_input.deviation_code`, `.loan_amount`, `.collateral_mortgaged_elsewhere` | `extractExternalInput(confirmation)` (T-U3-02); bản `AUTO` → `deviation_code`, `collateral_mortgaged_elsewhere` null | |
| `files[]`, `repeated_doc_types[]` | `CheckInput.classify` (S1) | ✔ |
| `evidences[]` (đã áp bản vá, T-EDIT-01) | `CheckInput.evidences` (S2) | ✔ |
| `role_registry[]`, `unmapped_evidences[]`, `asset_registry[]`, `relationship_verifications[]`, `customer_360[]`, `superseded_evidences[]` | S3 | |
| Catalog | `03_catalogs/checklist_catalog.json` (46 item, 19 điều kiện, 5 nhóm) + `03_catalogs/checklist_programs.json` (chương trình, luồng, mức yêu cầu) | ✔ |

**Định nghĩa khả dụng của S3:**

- `subject_mapping_available` = S3 `SUCCESS`/`PARTIAL_SUCCESS` **và** `role_registry` ≥ 1 người.
- `asset_mapping_available` = S3 `SUCCESS`/`PARTIAL_SUCCESS`.
- S3 `FAILED` → scheduler cho S4 `UNAVAILABLE` / `DEPENDENCY_FAILED`; không chạy chế độ dự phòng.

**Output `data`:** `flow`, `program_key`, `product_code`, `overrides_applied[]` (S4-R24, R25), `dossier_submitted_at`, `catalog_version`, `subject_mapping_available`, `asset_mapping_available`, `completeness_percent`, `items[]`, `summary_by_group[]`, `condition_evaluations[]`, `excluded_evidences[]`.

**`items[]` (ChecklistItemResult):**

| Field | Mô tả |
|---|---|
| `item_key`, `checklist_group`, `checklist_subgroup`, `item_no`, `item_label` | Từ catalog |
| `doc_type_key` | `accepted_doc_type_keys[0]`; null với `collateral_cic_check` (mục này không còn trong chương trình HKD, D-52) |
| `scope` | `PERSON`/`DOSSIER`/`ASSET` |
| `person_id`, `roles[]`, `primary_role` | Chỉ dòng `PERSON` |
| `asset_id`, `usage_context`, `context_status` | Chỉ dòng `ASSET` |
| `required` | boolean |
| `status` | `PRESENT`/`SUBSTITUTED`/`MISSING`/`NEEDS_RESCAN`/`NEEDS_REVIEW`/`NOT_APPLICABLE` |
| `reason_code`, `message` | Mã scope `CHK` + câu tiếng Việt |
| `substituted_by_item_key`, `substituted_by_doc_type_key` | Bắt buộc khi `SUBSTITUTED` |
| `found_in[]` | Nguồn quyết định trạng thái: `evidence_id`, `file_id`, `file_name`, `page`, `field_path` |
| `duplicate_group_ids[]`, `duplicate_status` | Mức cao nhất trong `found_in` |
| `condition_id`, `condition_source`, `condition_result` | Null cả ba khi không áp dụng |
| `validity_days`, `expired_evidence_ids[]` | `expired_evidence_ids` = mọi ứng viên hết hạn của dòng, kể cả khi dòng `PRESENT` nhờ bản mới (S4-R23) |
| `relationship_checks[]` | Chỉ `legal_birth_certificate` khi điều kiện `MET` |
| `original_or_copy` | Chỉ hiển thị |
| `suggested_action` | `UPLOAD`/`RESCAN`/`REVIEW_CONTEXT`/`NONE` |
| `note` | VD cảnh báo `needs_manual_review` của S1 |

**Quy ước đếm:**

- `total_items` = số dòng. `total_required` = số dòng `required = true`.
- `present_count`, `substituted_count`, `missing_count`, `needs_rescan_count`, `needs_review_count` chỉ đếm dòng `required = true`; tổng 5 số = `total_required`.
- `not_required_count` = số dòng `required = false`; `total_items = total_required + not_required_count`.
- `completeness_percent = round_half_up((present + substituted) / total_required × 100, 2)`. `total_required = 0` → `100` (stage), `null` (nhóm).

`content_preview`: `flow`, `program_key`, `completeness_percent`, `subject_mapping_available`, `asset_mapping_available`, `persons_evaluated`, `total_required`, `missing_count`, `needs_rescan_count`, `needs_review_count`.

## 3. Rule

### 3.1 Phạm vi dòng

| ID | Rule |
|---|---|
| **S4-R01** | `flow` không thuộc `flows` của chương trình checklist của sản phẩm (S4-R24; HKD: `FULL`/`FAST`/`SIMPLE`) hoặc vắng → `FAILED` / `INVALID_FLOW`, `data = null`. Không có bộ mặc định. Không suy luận `flow` |
| **S4-R02** | `checklist_catalog.json` là nguồn duy nhất cho định nghĩa item, điều kiện, thay thế, hiệu lực; mức yêu cầu theo luồng lấy từ chương trình (S4-R24) sau ghi đè Profile (S4-R25). Item không có trong `requirements` của chương trình, hoặc mức `null` ở luồng, không sinh dòng. HKD luồng `FAST` chỉ có `income_general_income_statement` ở nhóm nguồn thu |
| **S4-R03** | Nhóm `legal`: 1 bộ item cho mỗi người có vai trò `borrower`/`co_borrower`/`collateral_owner`, sắp theo số của `person_id`. Vai trò của cùng người gộp, điều kiện xét trên hợp vai trò. Người chỉ có `other` không có bộ. Nhiều người cùng vai trò là hợp lệ |
| **S4-R04** | Nhóm `loan_plan`, `income_source`, `credit_relationship`: 1 dòng / item. Item `scope = ASSET`: 1 dòng / `asset_id` có `asset_type ∈ item.asset_types` và `item.usage_context ∈ usage_contexts` |
| **S4-R05** | Dòng tài sản thêm: (a) tài sản `usage_contexts = []`, `asset_type` khớp → 1 dòng **chỉ ở nhóm `collateral`**, `usage_context = null`; (b) evidence thuộc `accepted_doc_type_keys` của item nhóm `collateral` mà không nằm trong `sources[]` của tài sản nào → 1 dòng `asset_id = null` gộp mọi evidence mồ côi; (c) không có dòng nào cho item → 1 dòng `asset_id = null` (điều kiện `NOT_MET`) |
| **S4-R06** | `asset_mapping_available = false` → item `ASSET` có đúng 1 dòng `asset_id = null`, điều kiện `INPUT_NOT_PROVIDED` |
| **S4-R07** | Chế độ dự phòng (`subject_mapping_available = false`): nhóm `legal` chấm 1 bộ duy nhất `person_id = null`, `roles = []`, ứng viên = mọi evidence cùng loại; điều kiện theo người trả `INPUT_NOT_PROVIDED`. Không tạo bộ theo vai trò giả |
| **S4-R08** | Evidence thuộc `unmapped_evidences[]` hoặc của người `role_conflict = true` không được tính cho ai; ghi `excluded_evidences[]` (kèm mã lý do gốc, hoặc `MULTIPLE_IDENTITIES_FOR_ROLE`) |
| **S4-R09** | Cùng một evidence được tính cho cả item `collateral` và item `income_source` (nhóm con `rental`) khi gắn cùng `asset_id` và tài sản `CONFIRMED` có cả hai `usage_contexts` |
| **S4-R24** | **Chương trình checklist theo sản phẩm** (D-37): `checklist_programs.json` gom `product_codes` (nhiều sản phẩm → 1 chương trình; 1 sản phẩm thuộc đúng 1 chương trình) và khai báo `flows[]` riêng (`flow_key` viết HOA, VD `FULL`/`FAST`/`SIMPLE` cho HKD hoặc `A`/`B`) cùng `requirements`: `item_key` → `flow_key` → `REQUIRED`/`CONDITIONAL`/`NOT_REQUIRED`/`null`. Mỗi mục khai phải nêu đủ mọi luồng của chương trình; `CONDITIONAL` chỉ cho mục có `condition_id`. Luồng đầu là luồng mặc định cho phạm vi rule (V2-R01). Input S4 có `product_code`; output ghi `program_key`, `product_code`. Mở phân khúc mới = thêm chương trình + mục/điều kiện/loại chứng từ cần thiết, không sửa engine |
| **S4-R25** | **Ghi đè từ Profile** (param `loan_checklist_overrides`): `{ programs: { program_key: { item_key: { flow_key: mức | null } } } }`. Chỉ đổi mức của mục **đã có** trong `checklist_catalog.json` ở luồng **đã có** của chương trình (`null` = bỏ mục ở luồng đó; được đưa mục có sẵn vào chương trình). Không tạo mục, luồng, chương trình, điều kiện, loại chứng từ, và không đổi hiệu lực/thay thế. Lưu Profile: sai → 400 (fail-closed). Lúc chạy: mục sai bị bỏ + cảnh báo. Ghi đè làm đổi mức → `data.overrides_applied[] = {item_key, flow, from, to}` để tái lập kết quả |
| **S4-R26** | Evidence `ERROR`/`FORM_NOT_FOUND` (S2-R04: S1 nhận nhầm loại, S2 không thấy mẫu biểu ở các trang đó) **không** là ứng viên của mục nào và không làm loại đó "có mặt" khi xét điều kiện: ghi `excluded_evidences[]` với `reason_code = FORM_NOT_FOUND`. Mục bắt buộc không còn ứng viên → `MISSING`/`DOCUMENT_NOT_FOUND` (không phải `NEEDS_RESCAN`), `note` nêu file + trang đã kiểm và bị nhận nhầm. `UNREADABLE_CONTENT` vẫn theo R13 #7 (`NEEDS_RESCAN`) |

### 3.2 Điều kiện

| ID | Rule |
|---|---|
| **S4-R10** | Mỗi điều kiện có `condition_source` (`OCR`/`EXTERNAL_INPUT`) và `evaluation_mode` (`RULE`/`LLM_SEMANTIC`). Thiếu input → `INPUT_NOT_PROVIDED` rồi áp `on_input_missing`; không suy đoán. LLM: nhiệt độ 0, chỉ nhận chuỗi văn bản của field input, trả nhãn trong tập đóng. Lỗi/timeout LLM → `INPUT_NOT_PROVIDED`, **không** làm stage `FAILED`. Input của điều kiện `OCR` không lấy từ evidence trong `superseded_evidences` (S3-R27). Các điều kiện `income_source_*` dùng chung **1** lần gọi LLM; `loan_purpose_*` dùng chung **1** lần |
| **S4-R11** | Điều kiện ghép AND (`part_condition_ids`): có phần `NOT_MET` → `NOT_MET`; không có `NOT_MET` nhưng có `INPUT_NOT_PROVIDED` → `INPUT_NOT_PROVIDED`; tất cả `MET` → `MET`. `condition_source` của dòng = nguồn của phần quyết định kết quả |
| **S4-R12** | Mỗi khóa `(condition_id, person_id, asset_id)` đánh giá một lần, ghi 1 phần tử `condition_evaluations[]`. Chỉ đánh giá điều kiện mà dòng đã sinh cần |

**`required`:**

| mức yêu cầu (S4-R24/R25) | `condition_result` | `required` |
|---|---|---|
| `REQUIRED` | — | `true` |
| `NOT_REQUIRED` | — | `false` |
| `CONDITIONAL` | `MET` | `true` (nếu `requires_exact_doc_when_met` → tắt thay thế) |
| `CONDITIONAL` | `NOT_MET` | `false` |
| `CONDITIONAL` | `INPUT_NOT_PROVIDED` | theo `on_input_missing`: `REQUIRED`→`true`; `NOT_REQUIRED`→`false`; `NEEDS_REVIEW`→`true` và ép `NEEDS_REVIEW` |

### 3.3 Trạng thái từng dòng

Ký hiệu: `cands` = ứng viên của dòng; `valid` = `{c ∈ cands | c.status = SUCCESS ∧ ¬expired(c) ∧ c.duplicate_status ≠ CONFLICTING_DUPLICATES ∧ dateOK(c)}`.

**Ứng viên:** loại trích xuất sâu → mỗi evidence (kể cả `ERROR`); loại chỉ nhận diện (`needs_extraction = false`) → mỗi `instance` của S1 (`page = page_range[0]`), tính `PRESENT` chỉ dựa trên S1; `evidence_id` = evidence `LIGHT` cùng (file, loại, bản thể) nếu có (S2-R20), ngược lại null; phạm vi `PERSON` gán người theo party chủ thể của evidence `LIGHT` (S3); `needs_manual_review = true` vẫn `PRESENT` và ghi `note`.

**S4-R13** — Nếu `required = false`: `valid ≠ ∅` → `PRESENT`/`DOCUMENT_FOUND`; ngược lại `NOT_APPLICABLE` với `CONDITION_NOT_MET` | `CONDITION_INPUT_NOT_PROVIDED` | `NOT_REQUIRED_FOR_FLOW`. Dừng. Nếu `required = true`, xét theo thứ tự, dừng ở dòng đầu khớp:

| # | Điều kiện | `status` / `reason_code` |
|--:|---|---|
| 1 | `on_input_missing = NEEDS_REVIEW` ∧ `INPUT_NOT_PROVIDED` | `NEEDS_REVIEW` / `ASSET_CONTEXT_UNRESOLVED` |
| 2 | `scope = ASSET` ∧ (`asset_id = null` ∨ `context_status ≠ CONFIRMED` ∨ `usage_context = null`) | `NEEDS_REVIEW` / `ASSET_CONTEXT_UNRESOLVED` |
| 3 | `scope = PERSON` ∧ `role_conflict` ∧ `cands ≠ ∅` | `NEEDS_REVIEW` / `ROLE_CONFLICT_UNRESOLVED` |
| 4 | `has_count_rule` | theo S4-R17 |
| 5 | ∃ `c` `SUCCESS` có `CONFLICTING_DUPLICATES` | `NEEDS_REVIEW` / `CONFLICTING_DUPLICATES` |
| 6 | `valid ≠ ∅` | `PRESENT` / `DOCUMENT_FOUND` |
| 7 | ∃ `c` `ERROR` và không có `c'` `SUCCESS` | `NEEDS_RESCAN` / `EXTRACTION_FAILED` |
| 8 | ∃ `c` `SUCCESS` với `dateOK = false` | `NEEDS_RESCAN` / `ISSUE_DATE_UNREADABLE` |
| 9 | thay thế được phép ∧ ∃ `s ∈ item.substitutes` (theo thứ tự catalog) có chứng từ hợp lệ cùng phạm vi | `SUBSTITUTED` / `SUBSTITUTED_BY_ALLOWED_DOC` |
| 10 | ∃ `c` `expired(c)` | `MISSING` / `DOCUMENT_EXPIRED` |
| 11 | `condition_result = INPUT_NOT_PROVIDED` | `MISSING` / `CONDITION_INPUT_NOT_PROVIDED` |
| 12 | còn lại | `MISSING` / `DOCUMENT_NOT_FOUND` |

| ID | Rule |
|---|---|
| **S4-R14** | Thay thế: chỉ theo `item.substitutes`, cùng phạm vi (`PERSON`→cùng `person_id`; `ASSET`→cùng `asset_id`; `DOSSIER`→hồ sơ). Chứng từ thay thế phải hợp lệ theo `validity_days` của **item thay thế**. Item thay thế không cần là item bắt buộc. Không suy luận thêm cặp thay thế |
| **S4-R27** | Nhóm chứng từ thay thế nhau là **một yêu cầu** (D-48), xét sau S4-R13/R14 trong cùng phạm vi (`PERSON` cùng `person_id`, `ASSET` cùng `asset_id`, `DOSSIER`): (1) dòng bắt buộc đã `SUBSTITUTED` → `required = false` (không vào mẫu số `completeness_percent`, `message` nêu chứng từ đã thay); (2) các dòng bắt buộc thay thế được cho nhau (theo `substitutes`, hai chiều, bắc cầu trong nhóm) mà đều `MISSING`/`NEEDS_RESCAN`/`NEEDS_REVIEW` → giữ 1 dòng bắt buộc đại diện (ưu tiên `NEEDS_RESCAN`, `NEEDS_REVIEW`, `MISSING` có bản hết hạn, rồi `item_no` nhỏ), các dòng khác `required = false`, `NOT_APPLICABLE`/`COVERED_BY_ALTERNATIVE`, `suggested_action = NONE`; (3) dòng còn bắt buộc và cho phép thay thế có `note` "Có thể nộp thay bằng: …". Không áp cho dòng đang tắt thay thế (`requires_exact_doc_when_met` ∧ điều kiện `MET`) |
| **S4-R28** | **Có chứng từ nhưng chưa gán chắc cho người (D-64).** Dòng `PERSON` bắt buộc không còn ứng viên (sau S4-R08), nhưng trong hồ sơ có chứng từ đúng loại chưa gán chắc cho người đang chấm → `NEEDS_REVIEW`/`DOCUMENT_OWNER_UNCONFIRMED` (hoặc `ROLE_CONFLICT_UNRESOLVED` với chính người `role_conflict`), `found_in` = chứng từ đó, `message` nêu file / trang và lý do, không báo `MISSING`. Các trường hợp: (1) một party trên chứng từ chưa ghép cho ai (kể cả khi party khác trên cùng chứng từ đã ghép được — VD giấy đăng ký kết hôn có chồng ghép được, vợ ghi tên khác chính tả) mà tên chỉ khác chính tả so với người này (`nameLevel = SPELLING_DIFFERENCE`); (2) `unmapped_evidences` với `AMBIGUOUS_IDENTITY_MATCH` và tên giống người này; (3) chứng từ bị loại theo R08 vì một người cùng trên chứng từ có `role_conflict = true`, mà người này vẫn được ghép vào chứng từ. Không gán bừa: tên khác hẳn hoặc không có chứng từ nào vẫn `MISSING`; chứng từ không đổi nơi nằm trong `excluded_evidences`. Đặt sau R13 #10 (hết hạn), trước #11 / #12 |
| **S4-R15** | Hiệu lực, `d0 = dossier_submitted_at`. Hai căn cứ, hết hạn khi **một trong hai** kết luận hết hạn: **(A) Ngày hết hạn in trên giấy** — áp cho **mọi** item, kể cả `validity_days = null` (VD CCCD quá hạn), trừ item `ignore_printed_expiry = true` (đăng kiểm xe): (a) `valid_until` đủ ngày và `< d0` → hết hạn. **(B) Thời hạn theo catalog** — chỉ khi `validity_days ≠ null`: (b) `issue_date` đủ ngày: hết hạn khi `(d0 − issue_date) > validity_days` (ngày thứ `validity_days` còn hạn); (c) `issue_date` dạng `YYYY-MM`/`YYYY`: `e` = ngày sớm nhất, `l` = muộn nhất của khoảng; `(d0 − l) > validity_days` → hết hạn; `(d0 − e) ≤ validity_days` → còn hạn; còn lại `dateOK = false`; (d) `issue_date = null` và không kết luận từ `valid_until` → `dateOK = false`. (e) Chứng từ chỉ nhận diện không có ngày → luôn còn hạn. Item cùng `doc_type_key` phải cùng `validity_days`, `ignore_printed_expiry` (T-S4-01 kiểm) để S3 dùng chung kết quả |
| **S4-R16** | Trùng lặp: nhiều bản cùng loại chỉ tính 1 dòng, mọi bản ở `found_in[]`. `DUPLICATE_CANDIDATE`, `CONFIRMED_DUPLICATE` không ảnh hưởng trạng thái. `CONFLICTING_DUPLICATES` → dòng #5, không tự chọn bản chuẩn |
| **S4-R17** | Giấy khai sinh (`legal_birth_certificate`) khi điều kiện `MET`: với mỗi chủ TSBĐ `q` khác người đang chấm `p` (trừ vợ/chồng), lấy `relationship_verifications` có `subject = p`, `collateral_owner = q`, ghi 1 `relationship_checks[]`: không có bản ghi hoặc `required_count = null` → `is_satisfied = null`; `verified_count ≥ required_count` → `true`; ngược lại `false`. Trạng thái dòng: mọi check `true` → `PRESENT` (`found_in` = `verified_documents`); có `false` → `MISSING` với `INSUFFICIENT_BIRTH_CERTIFICATES` nếu `E(p)` có ≥ 1 giấy khai sinh, ngược lại `DOCUMENT_NOT_FOUND`; không có `false` nhưng có `null` → `NEEDS_REVIEW` / `RELATIONSHIP_UNVERIFIED`. S4 không tự so tên |
| **S4-R18** | `suggested_action`: `MISSING`→`UPLOAD`; `NEEDS_RESCAN`→`RESCAN`; `NEEDS_REVIEW`→`REVIEW_CONTEXT`; còn lại→`NONE` |
| **S4-R19** | `found_in[]`: `PRESENT` → mọi ứng viên hợp lệ (kể cả bản trùng); `SUBSTITUTED` → chứng từ hợp lệ của item thay thế; `NEEDS_*` → ứng viên liên quan; `MISSING` hết hạn → bản hết hạn; `MISSING` khác → `[]`. `field_path`: `PERSON` → `data.parties[<party_index>]`; `ASSET` → `data.assets[<asset_index>]`; còn lại null |
| **S4-R20** | Thứ tự dòng: nhóm I→V; trong `legal` theo `person_id` rồi `item_no`; nhóm khác theo thứ tự item trong catalog, cùng item theo `asset_id` (`null` cuối) |
| **S4-R21** | `original_or_copy` chỉ hiển thị; engine không phân biệt bản gốc/sao |
| **S4-R22** | Tất định; chạy lại ghi đè. `found_in`, `note`, `message` có thể chứa tên file/PII: không log plaintext |
| **S4-R23** | **Bổ sung bản mới thay bản hết hạn.** (1) Dòng có cả bản hết hạn và bản còn hạn → `PRESENT` / `DOCUMENT_FOUND` theo #6 (bản mới không bị coi là trùng mâu thuẫn vì khác ngày cấp, S2-R17); `found_in` chỉ gồm bản còn hạn; `expired_evidence_ids` gồm bản hết hạn; `note` = "Bản cấp ngày {issue_date cũ} đã hết hiệu lực; dùng bản cấp ngày {issue_date mới}". (2) Dòng chỉ có bản hết hạn → `MISSING` / `DOCUMENT_EXPIRED`, `suggested_action = UPLOAD`; `message` nêu hạn của bản cũ và yêu cầu bổ sung: `validity_days ≠ null` → "Cần bổ sung bản cấp từ ngày {d0 − validity_days} trở đi"; hết hạn theo căn cứ (A) → "Cần bổ sung bản còn hạn". (3) Bản mới được nộp bằng cách thêm file và chạy lại W1 (`evidence_id` của file cũ không đổi, S2-R14), rồi W2. Engine không xóa bản cũ khỏi hồ sơ |

## 4. Trạng thái stage

| # | Điều kiện | `status` | `status_code` |
|--:|---|---|---|
| 1 | Dependency `FAILED` | `UNAVAILABLE` | `DEPENDENCY_FAILED` |
| 2 | `product_code` không thuộc chương trình nào | `FAILED` | `UNKNOWN_CHECKLIST_PROGRAM` |
| 2b | `flow` thiếu/sai (không thuộc chương trình) | `FAILED` | `INVALID_FLOW` |
| 3 | Lỗi kỹ thuật | `FAILED` | `ENGINE_CRASH`/`ENGINE_TIMEOUT`/`OUT_OF_MEMORY`/`JSON_PARSE_ERROR` |
| 4 | Không có file nào `CLASSIFIED` | `INSUFFICIENT_DATA` | `MISSING_PRIMARY_EVIDENCE` |
| 5 | `subject_mapping_available = false` | `PARTIAL_SUCCESS` | `SUBJECT_MAPPING_UNAVAILABLE` |
| 6 | Có dòng `EXTERNAL_INPUT` + `INPUT_NOT_PROVIDED` | `PARTIAL_SUCCESS` | `MISSING_CONDITIONAL_EVIDENCE` |
| 7 | Có dòng `required` ở `NEEDS_RESCAN`/`NEEDS_REVIEW` | `PARTIAL_SUCCESS` | `CHECKLIST_ITEMS_UNRESOLVED` |
| 8 | Còn lại | `SUCCESS` | `COMPLETED` |

`MISSING` là kết quả nghiệp vụ: **không** làm stage `PARTIAL_SUCCESS`, không sinh `blocking_inputs`. Dòng #6 sinh 1 `EXTERNAL_DATA` / field thiếu (`external_input.<field>`).

## 5. Acceptance criteria

| ID | Given / When / Then | Rule |
|---|---|---|
| S4-AC01 | Given `flow = EXPRESS` / Then `FAILED`/`INVALID_FLOW`, `data = null` | R01 |
| S4-AC02 | Given 2 chủ TSBĐ khác nhau / Then 2 bộ `legal` riêng, không `role_conflict` | R03 |
| S4-AC03 | Given người vừa `borrower` vừa `collateral_owner` / Then 1 bộ `legal`, `roles` có cả hai | R03 |
| S4-AC04 | Given CCCD hợp lệ / Then `legal_id_card` `PRESENT` | R13 #6 |
| S4-AC05 | Given thiếu VNeID nhưng có xác nhận cư trú còn hạn / Then `legal_vneid` `SUBSTITUTED` | R14 |
| S4-AC06 | Given xác nhận cư trú ngày cấp cách `d0` 181 ngày / Then `MISSING`/`DOCUMENT_EXPIRED`; 180 ngày → còn hạn | R15 |
| S4-AC07 | Given evidence `ERROR` duy nhất / Then `NEEDS_RESCAN`/`EXTRACTION_FAILED` | R13 #7 |
| S4-AC08 | Given `loan_amount` chưa nhập, điều kiện `loan_amount_over_3_billion` / Then `INPUT_NOT_PROVIDED` → áp `on_input_missing` | R10 |
| S4-AC09 | Given LLM timeout / Then điều kiện `INPUT_NOT_PROVIDED`, stage không `FAILED` | R10 |
| S4-AC10 | Given tài sản `context_status = AMBIGUOUS` / Then dòng `NEEDS_REVIEW`/`ASSET_CONTEXT_UNRESOLVED` | R13 #2 |
| S4-AC11 | Given 2 GCN `CONFLICTING_DUPLICATES` / Then `NEEDS_REVIEW`/`CONFLICTING_DUPLICATES` | R16 |
| S4-AC12 | Given chủ TSBĐ là "Mẹ", 1 giấy khai sinh đạt / Then `legal_birth_certificate` `PRESENT` | R17 |
| S4-AC13 | Given quan hệ `SIBLING` chỉ 1 giấy / Then `MISSING`/`INSUFFICIENT_BIRTH_CERTIFICATES` | R17 |
| S4-AC14 | Given `flow = FAST` / Then không có dòng `income_salary_*`, `income_household_*` | R02 |
| S4-AC15 | Given 10 dòng bắt buộc, 7 `PRESENT` + 1 `SUBSTITUTED` / Then `completeness_percent = 80` | §2 |
| S4-AC16 | Given chạy lại cùng input / Then output giống hệt | R22 |
| S4-AC17 | Given `d0 = 2026-10-14`, xác nhận tình trạng hôn nhân cấp 2026-01-05 (hết hạn) và bản cấp lại 2026-09-20 / Then `legal_marital_status_confirmation` `PRESENT`, `found_in` = bản mới, `expired_evidence_ids` = bản cũ, có `note` | R23 |
| S4-AC18 | Given chỉ có xác nhận tình trạng hôn nhân cấp 2026-01-05, `d0 = 2026-10-14` / Then `MISSING`/`DOCUMENT_EXPIRED`, `UPLOAD`, `message` có "từ ngày 2026-04-17" | R15, R23 |
| S4-AC19 | Given CCCD `valid_until = 2026-08-01`, `d0 = 2026-10-14` / Then `legal_id_card` `MISSING`/`DOCUMENT_EXPIRED` dù item `validity_days = null` | R15 |
| S4-AC20 | Given đăng kiểm xe `valid_until` < `d0` / Then `collateral_vehicle_inspection` không bị hết hạn (`ignore_printed_expiry`) | R15 |
| S4-AC21 | Given chương trình có luồng `A`/`B` gồm 2 sản phẩm / When chạy bằng sản phẩm thứ hai, `flow = A` / Then `data.program_key` là chương trình đó, chỉ có dòng của mục khai trong `requirements`, mục `null` ở `B` không có dòng khi `flow = B`; `flow = FULL` → `INVALID_FLOW` | R01, R24 |
| S4-AC22 | Given `product_code` không thuộc chương trình nào / Then `FAILED`/`UNKNOWN_CHECKLIST_PROGRAM`, `data = null` | R24 |
| S4-AC23 | Given Profile ghi đè `hkd_secured.legal_vneid.FAST = NOT_REQUIRED` và `credit_cic_report.FAST = null` / Then dòng VNeID `required = false`, không có dòng CIC, `overrides_applied` ghi `from`/`to`; luồng `FULL` không đổi | R25 |
| S4-AC24 | Given Profile ghi đè mục không có trong catalog, luồng không thuộc chương trình, hoặc `CONDITIONAL` cho mục không có điều kiện / Then API lưu Profile trả 400; lúc chạy mục đó bị bỏ và có cảnh báo trong `config_snapshot.warnings` | R25 |
| S4-AC25 | Given báo cáo định giá BĐS nội bộ tr.4–20 của 1 file bị S2 trả `FORM_NOT_FOUND` / Then mục tương ứng `MISSING`/`DOCUMENT_NOT_FOUND` (không `NEEDS_RESCAN`), `note` nêu file + trang bị nhận nhầm, evidence nằm trong `excluded_evidences` | R26 |
| S4-AC26 | Given thiếu VNeID, có xác nhận cư trú còn hạn / Then dòng VNeID `SUBSTITUTED`, `required = false`; `substituted_count` của nhóm `legal` = 0 | R27 |
| S4-AC27 | Given thiếu cả VNeID và xác nhận cư trú / Then chỉ dòng VNeID `required = true`, `MISSING`, `note` nêu xác nhận cư trú là lựa chọn thay; dòng xác nhận cư trú `NOT_APPLICABLE`/`COVERED_BY_ALTERNATIVE` | R27 |
| S4-AC28 | Given giấy đăng ký kết hôn ghi vợ "NGHIÊM THỊ MINH" còn đề nghị vay ghi "NGHIỆM THỊ MINH" (chồng ghép được theo số), hoặc cả hai lệch chính tả và lệch số / Then dòng của người chưa ghép được là `NEEDS_REVIEW`/`DOCUMENT_OWNER_UNCONFIRMED` (`found_in` = giấy đăng ký kết hôn, `message` nêu tên trên chứng từ và nói rõ không phải thiếu), không phải `MISSING`; không có chứng từ nào hoặc tên khác hẳn thì vẫn `MISSING` | R28 |
| S4-AC29 | Given giấy đăng ký kết hôn ghép được cho chồng và vợ, nhưng chồng có `role_conflict = true` (2 căn cước khác số / khác ngày sinh) / Then dòng của chồng `NEEDS_REVIEW`/`ROLE_CONFLICT_UNRESOLVED`, dòng của vợ `NEEDS_REVIEW`/`DOCUMENT_OWNER_UNCONFIRMED`; chứng từ vẫn nằm trong `excluded_evidences` (R08) | R28 |

## 6. Task cards

### T-S4-01 — Nạp và kiểm tra catalog checklist
- Depends: T-CAT-02
- Files: `lib/loan-dossier/s4/catalog.ts`, `tests/loan-dossier/s4-catalog.test.ts`
- Refs: S4-R02
- Làm: `loadChecklistCatalog()` parse bằng zod, kiểm tra: mọi `condition_id` của item tồn tại; mọi `substitutes` trỏ tới `item_key` tồn tại; mọi `part_condition_ids` tồn tại; mọi `accepted_doc_type_keys` ∈ `doc_types.json`. `itemsForFlow(flow)`. `validityByDocType(): Map<doc_type_key, {validityDays, ignorePrintedExpiry}>` (dùng ở S3-R27).
- DoD:
  - test: catalog thật qua (46 item, 19 điều kiện)
  - test: mỗi loại tham chiếu hỏng một test (bản sao catalog bị sửa)
  - test: 2 item cùng `doc_type_key` khác `validity_days` hoặc `ignore_printed_expiry` → lỗi
  - test: `validityByDocType()` cho `marital_status_confirmation` → 180, `vehicle_inspection` → `ignorePrintedExpiry = true`
  - test: `itemsForFlow('FAST')` không chứa `income_salary_labor_contract`
  - test: `itemsForFlow('FAST')` có `income_general_income_statement`
- Verify: `npx jest tests/loan-dossier/s4-catalog.test.ts`

### T-S4-02 — Hiệu lực chứng từ (hàm dùng chung S3/S4)
- Depends: T-S2-03
- Files: `lib/loan-dossier/common/validity.ts`, `tests/loan-dossier/common-validity.test.ts`
- Refs: S4-R15, S3-R27
- Làm: `evaluateValidity(c, {validityDays, ignorePrintedExpiry}, d0): {expired, dateOK, basis}` — `basis` ∈ `PRINTED_EXPIRY`/`VALIDITY_DAYS`/null cho biết căn cứ kết luận hết hạn (S4-R23 chọn câu `message`). Nằm ở `common/` vì S3 dùng trước S4.
- DoD:
  - test: ngày thứ `validityDays` còn hạn, ngày `validityDays+1` hết hạn
  - test: `valid_until < d0` hết hạn dù `issue_date` còn hạn
  - test: `validityDays = null`, `valid_until < d0` → hết hạn (CCCD, S4-AC19); `ignorePrintedExpiry = true` → không hết hạn (S4-AC20)
  - test: `YYYY-MM` chắc chắn hết hạn / chắc chắn còn hạn / không kết luận (`dateOK=false`)
  - test: `issue_date = null` → `dateOK = false`
  - test: `validityDays = null`, không có `valid_until` → không bao giờ hết hạn
  - test: chứng từ chỉ nhận diện không ngày → còn hạn
- Verify: `npx jest tests/loan-dossier/common-validity.test.ts`

### T-S4-03 — Đánh giá điều kiện bằng rule
- Depends: T-S4-01
- Files: `lib/loan-dossier/s4/conditions-rule.ts`, `tests/loan-dossier/s4-conditions-rule.test.ts`
- Refs: S4-R10, S4-R11, S4-R12
- Làm: `evaluateRuleCondition(id, ctx): 'MET'|'NOT_MET'|'INPUT_NOT_PROVIDED'` cho 12 điều kiện `RULE` đơn (`person_is_married`, `person_is_not_married`, `person_has_multiple_id_numbers`, `same_person_commitment_required`, `collateral_owner_differs_from_person`, `deviation_code_present`, `loan_amount_over_3_billion`, `collateral_vehicle_present`, `collateral_real_estate_present`, `rental_vehicle_present`, `rental_real_estate_present`, `collateral_mortgaged_elsewhere`), theo đúng `logic` trong catalog. `combineAnd(parts)` cho điều kiện ghép `household_business_license_required` (phần: `income_source_household_business` + `loan_amount_over_3_billion`; kết quả phần LLM được truyền vào).
- DoD:
  - test: mỗi điều kiện có ≥ 1 test `MET`, 1 `NOT_MET`, 1 `INPUT_NOT_PROVIDED` (nếu có thể xảy ra)
  - test: `person_is_married` — 4 nhánh theo `logic` trong catalog
  - test: input lấy từ evidence trong `superseded_evidences` bị bỏ qua (S4-R10)
  - test: `combineAnd` — NOT_MET thắng INPUT_NOT_PROVIDED thắng MET
  - test: `loan_amount = 3_000_000_000` → `NOT_MET` (chỉ "trên 3 tỷ" mới `MET`)
- Verify: `npx jest tests/loan-dossier/s4-conditions-rule.test.ts`

### T-S4-04 — Đánh giá điều kiện ngữ nghĩa (LLM)
- Depends: T-S4-01
- Files: `lib/loan-dossier/s4/conditions-llm.ts`, `tests/loan-dossier/s4-conditions-llm.test.ts`
- Refs: S4-R10
- Làm: `LlmClassifierPort.classifyIncomeSource(text)` và `.classifyLoanPurpose(text)`; `evaluateSemanticConditions(ctx, port)` gọi mỗi port **tối đa 1 lần**, map nhãn → 6 điều kiện `LLM_SEMANTIC` (`loan_purpose_vehicle_purchase`, `loan_purpose_factory_purchase`, `income_source_salary`, `income_source_rental`, `income_source_household_business`, `income_source_enterprise`). Nhãn ngoài tập đóng hoặc lỗi → `INPUT_NOT_PROVIDED`.
- DoD:
  - test: port giả được gọi đúng 1 lần dù 4 điều kiện `income_source_*` được hỏi
  - test: nhãn lạ → `INPUT_NOT_PROVIDED`
  - test: port ném lỗi / timeout → `INPUT_NOT_PROVIDED`, không ném ra ngoài
  - test: text đầu vào rỗng → không gọi port
  - test: lời nhắc chỉ chứa chuỗi field, không chứa tên file
- Verify: `npx jest tests/loan-dossier/s4-conditions-llm.test.ts`

### T-S4-05 — Sinh dòng checklist
- Depends: T-S4-01
- Files: `lib/loan-dossier/s4/rows.ts`, `tests/loan-dossier/s4-rows.test.ts`
- Refs: S4-R03…R09, S4-R20
- Làm: `buildRows(catalog, flow, s3, mode): Row[]` — chỉ sinh dòng và gán ứng viên, chưa tính trạng thái.
- DoD:
  - test: S4-AC02, AC03, AC14
  - test: người chỉ `other` không có bộ legal
  - test: tài sản `usage_contexts=[]` → 1 dòng nhóm `collateral`, không có ở `income_source`
  - test: evidence mồ côi → 1 dòng `asset_id = null`
  - test: `asset_mapping_available=false` → 1 dòng `asset_id = null`
  - test: chế độ dự phòng → 1 bộ `person_id = null`
  - test: thứ tự dòng đúng R20
  - test: `unmapped` và `role_conflict` vào `excluded_evidences`
- Verify: `npx jest tests/loan-dossier/s4-rows.test.ts`

### T-S4-06 — Xác định `required`
- Depends: T-S4-03
- Files: `lib/loan-dossier/s4/required.ts`, `tests/loan-dossier/s4-required.test.ts`
- Refs: S4-R10 (bảng `required`)
- Làm: `resolveRequired(item, conditionResult, flow): {required, forceReview, allowSubstitute}`.
- DoD: mỗi dòng của bảng `required` một test; `requires_exact_doc_when_met` tắt thay thế; `on_input_missing=NEEDS_REVIEW` → `forceReview`.
- Verify: `npx jest tests/loan-dossier/s4-required.test.ts`

### T-S4-07 — Quyết định trạng thái dòng
- Depends: T-S4-02, T-S4-05, T-S4-06
- Files: `lib/loan-dossier/s4/row-status.ts`, `tests/loan-dossier/s4-row-status.test.ts`
- Refs: S4-R13, S4-R14, S4-R16, S4-R18, S4-R19, S4-R23
- Làm: `decideRowStatus(row, ctx): {status, reason_code, message, found_in, suggested_action, ...}` theo bảng 12 dòng.
- DoD:
  - test: mỗi dòng #1–#12 một test, thứ tự ưu tiên giữa các dòng kề nhau (VD #5 trước #6)
  - test: S4-AC04…AC07, AC10, AC11, AC17, AC18, AC19
  - test: `required=false` có chứng từ hợp lệ → `PRESENT`; không → `NOT_APPLICABLE` với đúng 3 mã
  - test: thay thế chọn theo thứ tự `substitutes`; chứng từ thay thế hết hạn theo `validity_days` của item thay thế
  - test: chứng từ chỉ nhận diện `needs_manual_review` → `PRESENT` + `note`
  - test: `found_in` đủ mọi bản trùng khi `PRESENT`
- Verify: `npx jest tests/loan-dossier/s4-row-status.test.ts`

### T-S4-08 — Giấy khai sinh
- Depends: T-S4-07
- Files: `lib/loan-dossier/s4/birth-cert.ts`, `tests/loan-dossier/s4-birth-cert.test.ts`
- Refs: S4-R17
- Làm: `evaluateBirthCertRow(p, ctx): {status, reason_code, relationship_checks, found_in}`.
- DoD: S4-AC12, AC13; không chủ TSBĐ nào khác `p` → điều kiện `NOT_MET` (xử lý ở T-S4-03); chủ TSBĐ là vợ/chồng bị loại; có `null` mà không có `false` → `NEEDS_REVIEW`; 2 chủ TSBĐ → 2 check.
- Verify: `npx jest tests/loan-dossier/s4-birth-cert.test.ts`

### T-S4-09 — Tổng hợp và trạng thái stage
- Depends: T-S4-07
- Files: `lib/loan-dossier/s4/summary.ts`, `tests/loan-dossier/s4-summary.test.ts`
- Refs: §2 (quy ước đếm), §4
- Làm: `summarize(rows)`, `completeness(...)`, `stageStatus(...)`, `blockingInputs(...)`.
- DoD:
  - test: S4-AC15; `total_required=0` → 100 (stage), null (nhóm)
  - test: làm tròn half-up (VD 66.665 → 66.67)
  - test: tổng 5 số đếm = `total_required` (property-based trên dữ liệu ngẫu nhiên cố định seed)
  - test: `legal` có 1 `summary_by_group` / người; 4 nhóm còn lại luôn có phần tử, kể cả `total_items=0`
  - test: mỗi dòng bảng §4; `MISSING` không sinh `blocking_inputs`
- Verify: `npx jest tests/loan-dossier/s4-summary.test.ts`

### T-S4-10 — Lắp ráp stage S4
- Depends: T-S4-04, T-S4-08, T-S4-09
- Files: `lib/loan-dossier/s4/run.ts`, `tests/loan-dossier/s4-run.test.ts`
- Refs: toàn bộ
- Làm: `runChecklist(input, ports): StageResult`.
- DoD:
  - test: S4-AC01, AC08, AC09, AC16
  - test: fixture hồ sơ `FULL` đầy đủ (dữ liệu giả) → snapshot ổn định
  - test: không `console.log` nào chứa PII
- Verify: `npx jest tests/loan-dossier/s4-run.test.ts`
