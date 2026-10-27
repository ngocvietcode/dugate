# S5 — `cross_check_documents`: Đối chiếu chéo giữa các chứng từ

## 1. Mục đích

Với **cùng một người** hoặc **cùng một tài sản**, so sánh giá trị của cùng một thuộc tính (họ tên, số định danh, địa chỉ, số tiền vay, thông tin tài sản…) giữa các chứng từ khác nhau trong hồ sơ. Trả danh sách khớp / lệch / chưa kết luận để CO xử lý.

Không kết luận gian lận hay lỗi OCR; không chọn "bản đúng".

## 2. Input / Output

| Input | Nguồn |
|---|---|
| `evidences[]` `SUCCESS` (đã áp bản vá, T-EDIT-01), `field_confidences`, `duplicate_*` | `CheckInput.evidences` (S2) |
| `role_registry[]` (`mapped_evidences`, `id_number_sources`), `asset_registry[]` (`sources`, `identifier_conflicts`), `unmapped_evidences[]`, `superseded_evidences[]` | S3 |
| `03_catalogs/cross_check_matrix.json` (12 `field_group`, 3 `logic_rules`) | Catalog |

S3 `INSUFFICIENT_DATA`/`NOT_EVALUATED`/`UNAVAILABLE` hoặc `role_registry = []` → S5 `UNAVAILABLE` / `ROLE_REGISTRY_UNAVAILABLE`. Không so sánh "mù".

**Output `data`:** `matrix_version`, `results[]`, `logic_findings[]`, `skipped_evidences[]`.

**`results[]` (CrossCheckResult):**

| Field | Mô tả |
|---|---|
| `result_id` | `xck-{n}` tăng dần theo thứ tự S5-R16 |
| `person_id`, `primary_role`, `roles[]` | Dòng theo người; dòng tài sản: `null`, `null`, `[]`. `primary_role` ưu tiên `borrower` > `co_borrower` > `collateral_owner` > `other` |
| `asset_id` | Dòng tài sản và `collateral_owner_identity`; ngược lại null |
| `field_group`, `field_label`, `sub_field` | Từ ma trận; `sub_field = null` khi nhóm chỉ có 1 field |
| `comparison_method` | `EXACT`/`SEMANTIC`/`ADDRESS_REFERENCE`/`METRIC` |
| `match_status` | `MATCH`/`MISMATCH`/`UNDETERMINED` |
| `reason_code`, `severity`, `requires_review` | Ràng buộc ở S5-R05…R11 |
| `values[]` (≥ 2) | `value`, `normalized_value`, `id_status`, `metric`, `period`, `unit`, `source{evidence_id,file_id,file_name,doc_type_key,field_path,page}`, `duplicate_group_id`, `duplicate_status` — mọi nguồn, kể cả bản trùng |
| `canonical_source` | `{rule, doc_type_key, evidence_id}` — **chỉ hiển thị**, không dùng để kết luận đúng/sai |
| `reason` | Tiếng Việt, bắt buộc |

**`logic_findings[]`:** `finding_id`, `rule_key`, `person_id`, `asset_id`, `evidence_ids[]`, `violated`, `severity`, `requires_review`, `needs_ba_confirmation`, `message`. Ghi **cả** rule `violated = false` để truy vết.

**`skipped_evidences[]`:** `evidence_id`, `doc_type_key`, `skip_reason` ∈ `EVIDENCE_ERROR`/`UNMAPPED`/`ROLE_CONFLICT`/`SUPERSEDED`.

`content_preview`: `total_comparisons`, `match_count`, `mismatch_count`, `undetermined_count` (tổng = `total_comparisons`), `requires_review_count`, `high_severity_count`, `logic_violation_count`, `persons_compared`, `assets_compared`.

## 3. Rule

| ID | Rule |
|---|---|
| **S5-R01** | Ma trận là nguồn duy nhất cho nhóm field, vai trò áp dụng, nguồn, `field_path`. Không so field ngoài ma trận. **Nguồn thu (`income`) có trong ma trận như một `field_group` chứng từ-với-chứng từ; không liên quan tới S6** |
| **S5-R02** | Chỉ so trong cùng `person_id` hoặc cùng `asset_id`. Không so chéo khách vay với người đồng vay |
| **S5-R03** | Người nhiều vai trò: hợp nhóm field của mọi vai trò; 1 dòng / (người, nhóm, sub_field); không nhân bản |
| **S5-R04** | Chỉ so khi có ≥ 2 giá trị khác null từ ≥ 2 evidence khác nhau. 1 nguồn → không sinh dòng. Evidence `ERROR`, `unmapped`, của người `role_conflict`, hoặc nằm trong `superseded_evidences` của S3 (bản cũ hết hạn đã có bản mới, S3-R27 — skip `SUPERSEDED`) bị bỏ (ghi `skipped_evidences`). Với `attribution = PARTY`: chỉ lấy `party_index` trong `mapped_evidences` của người đó và `party_role ∈ source.party_roles`. Nhóm `ASSET`: lấy từ `asset.sources[]`, đúng `asset_index` |
| **S5-R05** | `MATCH` khi mọi giá trị trùng sau chuẩn hóa (`EXACT_MATCH`) hoặc cùng bản chất (`SEMANTIC_MATCH`). Luôn `INFO`, `requires_review = false` |
| **S5-R06** | `MISMATCH` / `VALUE_CONFLICT` / `REVIEW` khi ≥ 2 nguồn mâu thuẫn trên cùng field của cùng đối tượng |
| **S5-R07** | Chuẩn hóa theo `comparison_method`: `EXACT` — trim, HOA, bỏ khoảng trắng/dấu chấm thừa; **họ tên** (D-38): khác nhau nhưng trùng sau khi bỏ dấu và các bản có dấu chỉ có 1 cách viết (có chứng từ ghi không dấu, VD CIC) → `MATCH`/`UNACCENTED_MATCH`/`INFO`; 2 cách viết có dấu khác nhau ("TRẦN"/"TRÂN") vẫn `MISMATCH`/`VALUE_CONFLICT`; **gần khớp** (D-41) — mã/số (GCN, số khung, số máy, biển số…) dài ≥ 6, đúng 2 giá trị, ≥ 2 chứng từ ghi giống nhau và đúng 1 nguồn lệch đúng 1 ký tự → `NEAR_MATCH`/`PROBABLE_OCR_ERROR`/`INFO`, `requires_review = true`, `reason` nêu mẫu biểu (tên loại chứng từ) + file + trang của nguồn lệch; xét **trước** S5-R09 — bản trùng đọc sai 1 ký tự so với đa số là gần khớp, không phải `DUPLICATE_VALUE_CONFLICT` (D-43); không áp cho họ tên, địa chỉ, tiền, số định danh người (đã có S3-R13); mã/số (số định danh, GCN, biển số, khung, máy, MST, số thửa) so từng ký tự, chỉ lấy giá trị lõi. `SEMANTIC` — LLM nhiệt độ 0, nhãn `SAME`/`DIFFERENT`/`UNSURE`. `ADDRESS_REFERENCE` — so **trên bề mặt chứng từ**: văn bản địa chỉ như in (`full_text`, thiếu thì ghép các cấp), chỉ chuẩn hóa HOA, dấu câu, khoảng trắng; **không** tra dữ liệu địa giới, **không** quy đổi địa danh cũ/mới, **không** dùng LLM (D-35). `METRIC` — chỉ so khi `metric`, `period`, `unit` tương thích |
| **S5-R08** | Số định danh: ≥ 2 giá trị `id_status = CURRENT` khác nhau → `MISMATCH`/`CURRENT_ID_NUMBER_CONFLICT`/`HIGH`. Khác nhau chỉ do CMND 9 số `HISTORICAL` và CCCD 12 số `CURRENT` → `UNDETERMINED`/`HISTORICAL_ID_NUMBER`/`REVIEW`, giữ cả hai số. **Ngoại lệ (D-61):** nếu một chứng từ nối số — `qr_code_info`, `same_person_commitment` (Cam kết 2 CMND/CCCD) hoặc `local_cmnd_confirmation` (Xác nhận CMND địa phương); cả ba là nguồn `id_number` + `previous_id_numbers[]` trong ma trận — thể hiện đủ MỌI số đang so (VD số CCCD 12 số + CMND 9 số cũ) thì chính chứng từ đó cho biết đó là cùng một người → `MATCH`/`ID_LINKED_BY_DOCUMENT`/`INFO`, không cần rà soát; chứng từ nối chỉ có một phần các số, hoặc có ≥ 2 số `CURRENT` khác nhau, thì không áp dụng |
| **S5-R09** | Hai bản cùng `duplicate_group_id` có `CONFLICTING_DUPLICATES` và giá trị khác nhau → `MISMATCH`/`DUPLICATE_VALUE_CONFLICT`/`REVIEW` (số định danh hiện tại dùng S5-R08). Liệt kê mọi bản, không chọn bản chuẩn |
| **S5-R10** | Địa chỉ khác văn bản sau chuẩn hóa → `MISMATCH`/`VALUE_CONFLICT`/`REVIEW`, kể cả địa danh cũ/mới cùng vị trí (CO tự đánh giá). Chỉ số khác kỳ/bản chất (doanh thu năm vs thu nhập tháng; `requested_amount` vs `bank_proposed_amount`) → `UNDETERMINED`/`METRIC_INCOMPATIBLE`/`REVIEW`. **Số tiền vay luôn so bằng `bank_proposed_amount`** |
| **S5-R11** | `SEMANTIC` trả `UNSURE` → `MISMATCH`/`VALUE_CONFLICT`/`REVIEW`, `reason` nêu không chắc chắn. LLM lỗi/timeout → `UNDETERMINED`/`SEMANTIC_UNAVAILABLE`/`REVIEW`. **Hoãn (D-57):** giai đoạn tiếp nhận chạy S5 với `defer_semantic = true` — cặp khác nhau sau chuẩn hóa không gọi LLM mà ra `UNDETERMINED`/`SEMANTIC_DEFERRED`/`INFO`, `requires_review = false`, không làm S5 thành `PARTIAL_SUCCESS`; chuỗi giống hệt vẫn `MATCH`. Khi chạy giai đoạn thẩm định, workflow chạy lại S5 với port LLM thật và ghi đè kết quả |
| **S5-R12** | Mỗi `identifier_conflicts[]` của S3 phải xuất hiện thành 1 dòng `MISMATCH` tương ứng (cùng `sub_field`) để CO thấy |
| **S5-R13** | Logic rule (`logic_rules[]`): đánh giá với dữ liệu từ `inputs[]` của rule; ghi mọi kết quả vào `logic_findings[]`; `violated = true` → `severity_when_violated`, `requires_review = true` |
| **S5-R14** | Không đổi `id_number_check` của S3. Không có field `recommended_action` |
| **S5-R15** | `values[].value` là PII: không log plaintext |
| **S5-R16** | Thứ tự `results[]`: theo `person_id`, rồi thứ tự nhóm trong ma trận; dòng tài sản (`person_id = null`) theo `asset_id` ở cuối. Tất định; chạy lại ghi đè |
| **S5-R17** | Bộ lọc UI: "Khớp" = `MATCH`; "Không khớp" = `MISMATCH` + `UNDETERMINED` (mặc định); "Tất cả" |
| **S5-R18** | **Tình trạng hôn nhân (D-63).** Nhóm `marital_status` (`EXACT`, người): so `loan_application.data.party_details[].marital_status` (theo `party_index`) với `marital_status_confirmation.data.marital_status`. Khác nhau (VD đề nghị vay Ly hôn, xác nhận Đã kết hôn, hoặc ngược lại) → `MISMATCH`/`VALUE_CONFLICT`/`REVIEW`. Không so với `marriage_certificate` (giấy đăng ký kết hôn chỉ chứng minh từng kết hôn, không loại trừ ly hôn về sau). Một bên không khai (`null`) → không có dòng |

## 4. Trạng thái stage

| # | Điều kiện | `status` | `status_code` |
|--:|---|---|---|
| 1 | Dependency `FAILED` | `UNAVAILABLE` | `DEPENDENCY_FAILED` |
| 2 | Không có role registry dùng được | `UNAVAILABLE` | `ROLE_REGISTRY_UNAVAILABLE` |
| 3 | Lỗi kỹ thuật | `FAILED` | `ENGINE_CRASH`/`ENGINE_TIMEOUT`/`OUT_OF_MEMORY`/`JSON_PARSE_ERROR` |
| 4 | Không có evidence `SUCCESS` | `INSUFFICIENT_DATA` | `MISSING_PRIMARY_EVIDENCE` |
| 5 | Chỉ 1 evidence `SUCCESS` | `INSUFFICIENT_DATA` | `SINGLE_DOCUMENT_ONLY` |
| 6 | Không nhóm field nào có ≥ 2 nguồn | `NOT_EVALUATED` | `NO_COMPARABLE_PAIRS` |
| 7 | Có ≥ 1 dòng `UNDETERMINED` | `PARTIAL_SUCCESS` | `UNDETERMINED_RESULTS_PRESENT` |
| 8 | Còn lại (kể cả có `MISMATCH`) | `SUCCESS` | `COMPLETED` |

`MISMATCH` là kết quả nghiệp vụ, không làm stage `PARTIAL_SUCCESS`/`FAILED`.

## 5. Acceptance criteria

| ID | Given / When / Then | Rule |
|---|---|---|
| S5-AC01 | Given CCCD và đơn vay cùng tên/số / Then 2 dòng `MATCH` (`full_name`, `id_number`) | R05 |
| S5-AC02 | Given đơn vay ghi số CCCD lệch 1 chữ số / Then `MISMATCH`/`VALUE_CONFLICT` | R06 |
| S5-AC03 | Given CMND 9 số lịch sử vs CCCD 12 số hiện tại / Then `UNDETERMINED`/`HISTORICAL_ID_NUMBER`, giữ cả hai số | R08 |
| S5-AC04 | Given 2 CCCD `CURRENT` khác số / Then `MISMATCH`/`CURRENT_ID_NUMBER_CONFLICT`/`HIGH` | R08 |
| S5-AC05 | Given 2 địa chỉ chỉ khác hoa/thường, dấu câu, khoảng trắng / Then `MATCH`/`EXACT_MATCH` | R05, R07 |
| S5-AC06 | Given địa chỉ cũ (3 cấp) và mới (2 cấp) khác văn bản / Then `MISMATCH`/`VALUE_CONFLICT`/`REVIEW` | R07, R10 |
| S5-AC07 | Given `requested_amount` ≠ `bank_proposed_amount` nhưng `bank_proposed_amount` khớp tài liệu khác / Then `MATCH` | R10 |
| S5-AC08 | Given chỉ 1 nguồn cho `business_line` / Then không có dòng | R04 |
| S5-AC09 | Given khách vay và đồng vay khác tên / Then không có dòng so chéo giữa họ | R02 |
| S5-AC10 | Given `identifier_conflicts` của S3 có `chassis_number` / Then có dòng `MISMATCH` `chassis_number` | R12 |
| S5-AC11 | Given tổng hợp đồng mua < số tiền vay / Then `purchase_total_below_loan_amount` `violated=true`; ngược lại `violated=false` vẫn được ghi | R13 |
| S5-AC12 | Given `SEMANTIC` trả `UNSURE` / Then `MISMATCH`/`VALUE_CONFLICT` | R11 |
| S5-AC13 | Given chạy lại cùng input / Then `result_id` giống hệt | R16 |
| S5-AC14 | Given xác nhận tình trạng hôn nhân cũ (hết hạn, "Độc thân") bị bản mới ("Đã kết hôn") thay thế / Then bản cũ ở `skipped_evidences` với `SUPERSEDED`, không sinh `MISMATCH` tình trạng hôn nhân giữa hai bản | R04 |
| S5-AC15 | Given đơn vay, CCCD ghi "NGUYỄN VĂN AN"/"Nguyễn Văn An", CIC ghi "NGUYEN VAN AN" / Then dòng họ tên `MATCH`/`UNACCENTED_MATCH`, không cần rà soát; nếu CCCD ghi "NGUYỄN VĂN ÂN" → `MISMATCH`/`VALUE_CONFLICT` | R07 |
| S5-AC16 | Given số GCN: giấy đề nghị vay "AA08798136", GCN "AA 08798136", báo cáo định giá "AA 0798136" / Then dòng `NEAR_MATCH`/`PROBABLE_OCR_ERROR`, `requires_review = true`, `reason` nêu file của báo cáo định giá; stage vẫn `SUCCESS`; preview có `near_match_count` | R07 |
| S5-AC17 | Given 3 bản trùng GCN (cùng `duplicate_group_id`, `CONFLICTING_DUPLICATES`), 2 bản Số vào sổ "CN 6475", 1 bản "CH.6475" / Then dòng Số vào sổ là `NEAR_MATCH`/`PROBABLE_OCR_ERROR`, không phải `DUPLICATE_VALUE_CONFLICT`; `reason` nêu mẫu biểu + file của bản lệch | R07, R09 |
| S5-AC18 | Given đơn vay ghi CMND 9 số, CCCD ghi 12 số, `qr_code_info` thể hiện cả hai số (số hiện tại + số cũ) / Then dòng `id_number` là `MATCH`/`ID_LINKED_BY_DOCUMENT`/`INFO`, `requires_review = false`, vẫn liệt kê cả hai số; nếu QR chỉ có 1 số (số còn lại ở chứng từ khác) thì vẫn `UNDETERMINED`/`HISTORICAL_ID_NUMBER` | R08 |
| S5-AC19 | Given đề nghị vay ghi tình trạng hôn nhân Ly hôn (`DIVORCED`) nhưng giấy xác nhận tình trạng hôn nhân ghi Đã kết hôn (`MARRIED`) — hoặc ngược lại / Then dòng `marital_status` là `MISMATCH`/`VALUE_CONFLICT`/`REVIEW`; cùng giá trị → `MATCH`; đề nghị vay không khai tình trạng hôn nhân → không có dòng | R18 |

## 6. Task cards

### T-S5-01 — Nạp và kiểm tra ma trận
- Depends: T-CAT-02
- Files: `lib/loan-dossier/s5/matrix.ts`, `tests/loan-dossier/s5-matrix.test.ts`
- Refs: S5-R01
- Làm: `loadMatrix()` parse zod; kiểm tra mọi `doc_type_key` trong `sources[]` ∈ `doc_types.json` và `needs_extraction = true`; `field_path` bắt đầu bằng `data.`.
- DoD:
  - test: ma trận thật qua (10 nhóm)
  - test: `doc_type_key` lạ → lỗi
  - test: nguồn thuộc loại `needs_extraction=false` → lỗi
- Verify: `npx jest tests/loan-dossier/s5-matrix.test.ts`

### T-S5-02 — Thu thập giá trị theo (người | tài sản) × nhóm
- Depends: T-S5-01
- Files: `lib/loan-dossier/s5/collect.ts`, `tests/loan-dossier/s5-collect.test.ts`
- Refs: S5-R02, S5-R03, S5-R04
- Làm: `collectValues(matrix, s3, evidences): Collected[]` + `skipped_evidences`. Áp `attribution`, `party_roles`, `index_field_path`, `filter`; bỏ null; chỉ giữ nhóm có ≥ 2 giá trị từ ≥ 2 evidence.
- DoD:
  - test: S5-AC08, AC09
  - test: `party_roles` không khớp → không lấy
  - test: người 2 vai trò → 1 bộ nhóm, không nhân đôi
  - test: evidence `ERROR`/`unmapped`/`role_conflict` vào `skipped_evidences` với đúng lý do
  - test: S5-AC14 (bản bị thay thế → `SUPERSEDED`)
  - test: 2 giá trị từ **cùng** evidence → không đủ điều kiện so
- Verify: `npx jest tests/loan-dossier/s5-collect.test.ts`

### T-S5-03 — So khớp `EXACT`
- Depends: T-S2-03
- Files: `lib/loan-dossier/s5/compare-exact.ts`, `tests/loan-dossier/s5-compare-exact.test.ts`
- Refs: S5-R07
- Làm: `compareExact(values, kind): {allEqual, normalized[]}` với `kind` ∈ `text`/`code`.
- DoD:
  - test: `nguyễn văn a` ≡ `NGUYỄN VĂN A`; khác dấu → khác
  - test: mã so từng ký tự (`BS872510` ≠ `BS872511`)
  - test: bỏ khoảng trắng/dấu chấm thừa ở text
  - test: biển số `88C-276.60 (T)` ≡ `88C27660`
- Verify: `npx jest tests/loan-dossier/s5-compare-exact.test.ts`

### T-S5-04 — Địa chỉ so trên bề mặt chứng từ
- Depends: T-S5-01
- Files: `lib/loan-dossier/s5/address.ts`, `tests/loan-dossier/s5-address.test.ts`
- Refs: S5-R05, S5-R07, S5-R10
- Làm: `compareAddress(values)` so văn bản địa chỉ như in (`full_text`, thiếu thì ghép các cấp) sau chuẩn hóa HOA, dấu câu, khoảng trắng; trả `MATCH/EXACT_MATCH` hoặc `MISMATCH/VALUE_CONFLICT`. Không tra dữ liệu địa giới, không quy đổi địa danh cũ/mới (D-35).
- DoD:
  - test: S5-AC05, AC06
  - test: khác tỉnh → `MISMATCH`
  - test: không gọi LLM, không có tham số dữ liệu địa giới
- Verify: `npx jest tests/loan-dossier/s5-address.test.ts`

### T-S5-05 — So khớp `METRIC`
- Depends: T-S5-01
- Files: `lib/loan-dossier/s5/metric.ts`, `tests/loan-dossier/s5-metric.test.ts`
- Refs: S5-R10
- Làm: `compareMetric(values): result` — tương thích khi `metric`, `period`, `unit` đều bằng nhau (hoặc cùng null); ngược lại `METRIC_INCOMPATIBLE`. Số tiền vay lấy từ `bank_proposed_amount`.
- DoD:
  - test: S5-AC07
  - test: doanh thu năm vs thu nhập tháng → `METRIC_INCOMPATIBLE`
  - test: cùng kỳ khác số → `MISMATCH`
  - test: cùng số → `MATCH`
- Verify: `npx jest tests/loan-dossier/s5-metric.test.ts`

### T-S5-06 — So khớp `SEMANTIC` (LLM)
- Depends: T-S5-01
- Files: `lib/loan-dossier/s5/semantic.ts`, `tests/loan-dossier/s5-semantic.test.ts`
- Refs: S5-R07, S5-R11
- Làm: `SemanticPort.judge(a, b): 'SAME'|'DIFFERENT'|'UNSURE'`; `compareSemantic(values, port)`. Nhiều hơn 2 giá trị → so cặp với giá trị đầu tiên.
- DoD:
  - test: S5-AC12
  - test: `SAME` → `MATCH/SEMANTIC_MATCH`
  - test: port lỗi/timeout → `UNDETERMINED/SEMANTIC_UNAVAILABLE`
  - test: nhãn lạ → coi là lỗi
  - test: lời nhắc chỉ có hai chuỗi giá trị, không có tên file
- Verify: `npx jest tests/loan-dossier/s5-semantic.test.ts`

### T-S5-07 — Quy tắc số định danh và bản trùng
- Depends: T-S5-03
- Files: `lib/loan-dossier/s5/id-and-dup.ts`, `tests/loan-dossier/s5-id-and-dup.test.ts`
- Refs: S5-R08, S5-R09
- Làm: `adjudicateIdNumber(values)` và `adjudicateDuplicates(values)`.
- DoD:
  - test: S5-AC03, AC04
  - test: 3 số: 2 cùng `CURRENT` khác nhau → `HIGH`
  - test: `CONFLICTING_DUPLICATES` khác giá trị → `DUPLICATE_VALUE_CONFLICT`, liệt kê mọi bản
  - test: số định danh hiện tại lệch **và** bản trùng xung đột → dùng `CURRENT_ID_NUMBER_CONFLICT`
- Verify: `npx jest tests/loan-dossier/s5-id-and-dup.test.ts`

### T-S5-08 — Dòng từ `identifier_conflicts`
- Depends: T-S5-02
- Files: `lib/loan-dossier/s5/identifier-conflicts.ts`, `tests/loan-dossier/s5-identifier-conflicts.test.ts`
- Refs: S5-R12
- Làm: `rowsFromIdentifierConflicts(assetRegistry, existingRows)` — thêm dòng còn thiếu, không nhân đôi dòng đã có cùng `sub_field`.
- DoD:
  - test: S5-AC10
  - test: đã có dòng cùng `sub_field` → không thêm
  - test: mỗi conflict một dòng
- Verify: `npx jest tests/loan-dossier/s5-identifier-conflicts.test.ts`

### T-S5-09 — Logic rule liên chứng từ
- Depends: T-S5-01
- Files: `lib/loan-dossier/s5/logic-rules.ts`, `tests/loan-dossier/s5-logic-rules.test.ts`
- Refs: S5-R13
- Làm: `evaluateLogicRules(matrix, s3, evidences): LogicFinding[]` cho 3 rule trong ma trận: `id_issue_date_before_labor_contract`, `purchase_total_below_loan_amount`, `declared_collateral_owner_not_current_owner`. Cả 3 mang `needs_ba_confirmation = true` (OQ-05): vẫn chạy, nhưng mỗi finding có `needs_ba_confirmation = true` để UI hiển thị nhãn "Chờ BA xác nhận".
- DoD:
  - test: S5-AC11 (cả `violated=true` và `false`)
  - test: `id_issue_date_before_labor_contract` `violated=true` khi `id_issue_date > sign_date`, cùng `id_number`; khác `id_number` → không sinh finding
  - test: thiếu input → không sinh finding (không đoán)
  - test: `declared_collateral_owner_not_current_owner` đúng khi chủ khai ∉ `current_owner_person_ids`
  - test: mọi finding mang `needs_ba_confirmation = true`
  - test: rule không biết → lỗi rõ ràng
- Verify: `npx jest tests/loan-dossier/s5-logic-rules.test.ts`

### T-S5-10 — Lắp ráp stage S5
- Depends: T-S5-04, T-S5-05, T-S5-06, T-S5-07, T-S5-08, T-S5-09
- Files: `lib/loan-dossier/s5/run.ts`, `tests/loan-dossier/s5-run.test.ts`
- Refs: S5-R05, S5-R06, S5-R14, S5-R16, §4
- Làm: `runCrossCheck(input, ports): StageResult` — gán `result_id`, `canonical_source`, tổng hợp `content_preview`, trạng thái §4.
- DoD:
  - test: S5-AC01, AC02, AC13
  - test: mỗi dòng bảng §4 một test
  - test: `content_preview` đếm khớp
  - test: không PII trong `console`
  - test: `id_number_check` của S3 không bị đổi
- Verify: `npx jest tests/loan-dossier/s5-run.test.ts`
