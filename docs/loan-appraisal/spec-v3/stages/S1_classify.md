# S1 — `classify`: Phân loại chứng từ

## 1. Mục đích

Nhận các file của một request W1, xác định mỗi file chứa **loại chứng từ nào** (`doc_type_key`), bao nhiêu bản thể, ở trang nào. Chỉ dựa vào nội dung trang, không dựa vào tên file hay tên thư mục. Từ D-70, mỗi bản thể còn kèm `summary` và `key_facts[]` (danh mục cố định theo `doc_types.summary_fields`) để bước đánh giá bằng LLM dùng thay cho bóc tách đầy đủ; S1 **không** đối chiếu hay kết luận gì từ các giá trị này.

## 2. Input / Output

| Input | Nguồn | Ghi chú |
|---|---|---|
| `files[]` | `files[]` của request W1 (`ctx.filesData`) | Tên, mime, đường đọc file |
| `upload_hint` | Phần tử cùng chỉ số trong `upload_hints` của W1 | Chỉ để cảnh báo lệch nhóm (S1-R03) |

**Output `data`:**

```json
{
  "files": [
    {
      "file_id": "file-3f9a1c2b7d10",
      "file_name": "ho-so-1.pdf",
      "status": "CLASSIFIED",
      "reason_code": null,
      "next_action": null,
      "message": null,
      "page_count": 6,
      "matches": [
        {
          "doc_type_key": "id_card",
          "confidence": 0.93,
          "needs_manual_review": false,
          "needs_extraction": true,
          "instances_count": 2,
          "hint_mismatch": false,
          "instances": [
            { "instance_index": 1, "page_range": [1, 2], "confidence": 0.95,
              "summary": "Căn cước công dân của người vay, in hai mặt.",
              "key_facts": [
                { "subject": "borrower", "key": "full_name", "value": "NGUYEN VAN A", "page": 1 },
                { "subject": "borrower", "key": "id_number", "value": "001090000001", "page": 1 }
              ] },
            { "instance_index": 2, "page_range": [3, 4], "confidence": 0.93,
              "summary": "Căn cước công dân thứ hai trong cùng file.",
              "key_facts": [
                { "subject": "person-2", "key": "full_name", "value": null, "page": null },
                { "subject": "person-2", "key": "id_number", "value": "[không rõ]", "page": 3 }
              ] }
          ]
        }
      ]
    }
  ],
  "repeated_doc_types": [
    { "doc_type_key": "land_use_certificate", "file_ids": ["file-3f9a1c2b7d10", "file-8e2d4b6a1c03"],
      "status": "DUPLICATE_CANDIDATE", "requires_review": true }
  ]
}
```

`content_preview`: `file_count`, `classified_count`, `unknown_count`, `blocked_count`, `match_count`.

## 3. Rule

| ID | Rule |
|---|---|
| **S1-R01** | Chỉ `application/pdf`, `image/jpeg`, `image/png`, xác định từ **nội dung** (magic bytes). Loại khác → `UNSUPPORTED_FILE` / `UNSUPPORTED_FORMAT`. Đuôi file sai mà nội dung hợp lệ vẫn xử lý |
| **S1-R02** | `file_id = "file-" + sha256(nội dung)[0:12]`. Cùng nội dung → cùng `file_id` |
| **S1-R03** | Tên file, tên thư mục, đường dẫn **không** đưa vào classifier và không ảnh hưởng `doc_type_key`. `upload_hint` cũng không ảnh hưởng kết quả; chỉ đặt `hint_mismatch = true` khi nhóm checklist của `doc_type_key` ≠ `upload_hint` |
| **S1-R04** | Ngưỡng: `confidence ≥ 0.80` nhận; `0.50 ≤ c < 0.80` nhận kèm `needs_manual_review = true`; `< 0.50` loại. File không còn match → `UNKNOWN` / `UNCLASSIFIED` |
| **S1-R05** | Mã lý do và `next_action` theo bảng §4 |
| **S1-R06** | 1 file có thể có nhiều `matches[]`; mỗi `doc_type_key` tối đa 1 match / file |
| **S1-R07** | Nhiều bản thể cùng loại trong 1 file → 1 match, `instances_count = n`, `instances[]` riêng từng bản. Từ D-70, mỗi instance mang `summary` và `key_facts[]` (S1-R19…R23); S1 không tự suy ra vai trò hay quan hệ giữa các bản |
| **S1-R08** | Mặt trước + mặt sau của cùng thẻ, hoặc các trang liên tiếp của cùng văn bản = 1 instance. Trang của 1 instance phải liên tiếp. Nhiều chứng từ chụp chung 1 trang được phép trùng `page_range` |
| **S1-R09** | PDF > 100 trang: chia batch 20 trang. Segment cuối batch k và đầu batch k+1 cùng `doc_type_key` được ghép thành 1 instance khi classifier không báo "bắt đầu văn bản mới" ở trang đầu batch k+1; `confidence` ghép = min của hai |
| **S1-R10** | Xoay đúng chiều trang trước khi phân loại; ảnh xoay 90/180/270° không được trả `UNKNOWN` chỉ vì sai chiều |
| **S1-R11** | Chỉ gán `doc_type_key` khi file **thực sự chứa** mẫu biểu đó. Nội dung nhắc tới thông tin loại khác (VD chứng thư định giá ghi số CCCD) không tạo match `id_card` |
| **S1-R12** | Mỗi request W1 phân loại lại mọi file; không đọc kết quả của request trước (D-02). Tối ưu tái sử dụng để sau (OQ-12) |
| **S1-R13** | Nhiều file cùng `file_id` trong 1 request → chỉ giữ 1 record (file đứng trước trong `files[]`), file sau bị bỏ, không gọi model cho file đó. Giao diện chặn trùng trước khi gửi (U1-R05) |
| **S1-R14** | `needs_extraction` tra bảng `doc_types.json`, **không** do model quyết định |
| **S1-R15** | Không tải được file từ storage = lỗi tích hợp → stage `UNAVAILABLE` / `INTEGRATION_SERVICE_DOWN`; không sinh record `CORRUPTED_FILE` |
| **S1-R16** | `repeated_doc_types[]` chỉ là tín hiệu nghi trùng ở mức loại: luôn `DUPLICATE_CANDIDATE`, `requires_review = true`. Không xóa, không gộp, không làm stage lỗi. Nhiều instance cùng loại trong **1** file không tạo phần tử này |
| **S1-R17** | Kết quả nghiệp vụ không làm `FAILED`. File lỗi / `UNKNOWN` chỉ làm stage `PARTIAL_SUCCESS` hoặc `INSUFFICIENT_DATA` |
| **S1-R18** | Loại dễ nhầm có `recognition_hint` trong `doc_types.json` (dấu hiệu trên mặt chứng từ); prompt phân loại và prompt bóc tách gửi `recognition_hint` thay cho `note`. Văn bản định giá chọn loại theo **đơn vị lập** (tên, logo, phần ký), không theo chữ "định giá": báo cáo do Công ty TNHH Thịnh Điền lập thì chọn tiếp theo **loại tài sản** ghi ở tiêu đề / dòng "Áp dụng đối với" (D-62): "BÁO CÁO TƯ VẤN VỀ GIÁ TÀI SẢN BẢO ĐẢM" (Bất động sản) → `real_estate_valuation_report`; "BÁO CÁO TƯ VẤN GIÁ HIỆN TRẠNG TÀI SẢN ĐẢM BẢO" (PTVT/PTTC/MMTB/DCSX) → `movable_asset_valuation_report`; chứng thư của công ty thẩm định giá khác (SBA, CITICS, FARGO, VVFC, ...) → `external_valuation_certificate`; không xác định được đơn vị lập → confidence < 0.80 (cần rà soát, S1-R04) |
| **S1-R19** | Mỗi instance có `summary` (chuỗi 1–3 câu, tiếng Việt) và `key_facts[]`. `summary` nêu loại chứng từ, chủ thể và mục đích; thông tin có in trên chứng từ nhưng không thuộc danh mục key (ngày sinh, địa chỉ, hạn hiệu lực, số hợp đồng, tên đơn vị lập…) ghi **nguyên văn** vào `summary` khi có |
| **S1-R20** | Danh mục `key_facts` lấy từ `doc_types.summary_fields` (D-70), cố định theo loại; classifier chỉ được trả key có trong danh mục của đúng `doc_type_key`, key ngoài danh mục bị bỏ. Mỗi loại FULL ≤ 5 key, `loan_application` ≤ 7. Loại LIGHT không có danh mục: `key_facts = []`, chỉ có `summary` |
| **S1-R21** | `key_facts[i] = { subject, key, value, page }`. `subject` là nhãn đối tượng trên chứng từ (`borrower`, `co_borrower`, `person-n`, `asset-n`, …) để một chứng từ có nhiều người / tài sản vẫn dùng chung bộ key; chỉ gán vai trò khi chính văn bản nêu rõ, nếu không dùng `person-n` / `asset-n` theo thứ tự xuất hiện. `page` là trang tuyệt đối trong file hoặc null |
| **S1-R22** | `value` chép **nguyên văn** như in trên chứng từ: không chuẩn hóa, không sửa lỗi chính tả hay OCR, không thêm / bỏ dấu, không đổi định dạng số hay ngày. Không có trên chứng từ → `value = null`; có nhưng không đọc được → `"[không rõ]"`. Không suy đoán. Chỉ ghi dữ kiện của chính chứng từ, không ghi thông tin của loại khác chỉ được nhắc tới (nối S1-R11) |
| **S1-R23** | S1 không đối chiếu, không chọn giá trị đúng, không kết luận đủ / thiếu / hợp lệ từ `key_facts`. Giá trị là dữ liệu cá nhân: không ghi vào log; chỉ nằm trong `data` của stage (OQ-38) |

## 4. Mã lý do theo trạng thái file

| `status` | `reason_code` | `next_action` | Thông báo mẫu |
|---|---|---|---|
| `CLASSIFIED` | null | null | null |
| `UNSUPPORTED_FILE` | `UNSUPPORTED_FORMAT` | `CONVERT_AND_REUPLOAD` | "Định dạng {ext} chưa được hỗ trợ. Vui lòng chuyển sang PDF hoặc ảnh (.jpg, .jpeg, .png) và tải lại." |
| `PASSWORD_PROTECTED` | `PASSWORD_PROTECTED` | `REMOVE_PASSWORD_AND_REUPLOAD` | "File PDF đang đặt mật khẩu. Vui lòng gỡ mật khẩu và tải lại." |
| `CORRUPTED_FILE` | `CORRUPTED_FILE` | `RESCAN_AND_REUPLOAD` | "File bị hỏng, không mở được. Vui lòng scan/xuất lại và tải lên." |
| `UNKNOWN` | `EMPTY_OR_UNREADABLE` | `RESCAN_AND_REUPLOAD` | "File không có nội dung đọc được. Vui lòng kiểm tra và tải lại." |
| `UNKNOWN` | `LOW_QUALITY_UNREADABLE` | `RESCAN_AND_REUPLOAD` | "Ảnh/scan quá mờ, không nhận diện được. Vui lòng scan lại rõ hơn." |
| `UNKNOWN` | `UNCLASSIFIED` | null | "Không xác định được loại chứng từ thuộc danh mục hồ sơ." |

## 5. Trạng thái stage

| Điều kiện (xét theo thứ tự, dừng ở dòng đầu thỏa) | `status` | `status_code` |
|---|---|---|
| Không tải được file | `UNAVAILABLE` | `INTEGRATION_SERVICE_DOWN` |
| Không có file nào xử lý được (mọi file lỗi/`UNKNOWN`/không có file) | `INSUFFICIENT_DATA` | `NO_PROCESSABLE_FILES` |
| Có ≥ 1 file `UNSUPPORTED_FILE`/`PASSWORD_PROTECTED`/`CORRUPTED_FILE` | `PARTIAL_SUCCESS` | `UNSUPPORTED_FILES_PRESENT` |
| Có ≥ 1 file `UNKNOWN` | `PARTIAL_SUCCESS` | `UNKNOWN_FILES_PRESENT` |
| Còn lại | `SUCCESS` | `COMPLETED` |

## 6. Acceptance criteria

| ID | Given / When / Then | Rule |
|---|---|---|
| S1-AC01 | Given file `.docx` / When classify / Then `UNSUPPORTED_FILE`, `next_action = CONVERT_AND_REUPLOAD` | R01, R05 |
| S1-AC02 | Given PDF đặt tên `a.jpg` / When classify / Then xử lý bình thường | R01 |
| S1-AC03 | Given file tên `CCCD.pdf` chứa Giấy đề nghị vay / When classify / Then `loan_application` | R03 |
| S1-AC04 | Given instance `confidence 0.65` / When classify / Then match có `needs_manual_review = true` | R04 |
| S1-AC05 | Given 2 CCCD trong 1 file 4 trang / When classify / Then 1 match, `instances_count = 2`, `[1,2]` và `[3,4]` | R07, R08 |
| S1-AC06 | Given PDF 130 trang, CCCD chạy qua trang 20–21 / When classify / Then 1 instance `[19,22]` | R09 |
| S1-AC07 | Given chứng thư định giá ghi số CCCD / When classify / Then không có match `id_card` | R11 |
| S1-AC08 | Given 2 file cùng nội dung trong 1 request / When classify / Then 1 record, model chỉ được gọi cho 1 file | R13 |
| S1-AC09 | Given `upload_hint = collateral` nhưng file là CCCD / When classify / Then `hint_mismatch = true`, `doc_type_key = id_card` | R03 |
| S1-AC10 | Given 2 file khác nhau cùng là GCN / When classify / Then `repeated_doc_types` có 1 phần tử | R16 |
| S1-AC11 | Given storage lỗi / When classify / Then `UNAVAILABLE`, không có `CORRUPTED_FILE` | R15 |
| S1-AC12 | Given chứng thư thẩm định giá của công ty FARGO / Then match `external_valuation_certificate`, không phải `real_estate_valuation_report`; prompt phân loại chứa dấu hiệu nhận biết của cả hai loại | R18 |
| S1-AC13 | Given màn hình "Thông tin Căn cước công dân" (chữ, có số CCCD + số CMND cũ, chú thích "lấy từ mã QR in trên CCCD", không ảnh chân dung) / Then prompt phân loại có dấu hiệu nhận biết cho `qr_code_info` và `vneid` đủ để phân biệt (VNeID có ảnh chân dung, quê quán, nơi đăng ký khai sinh); chứng từ trên match `qr_code_info`, không phải `vneid` | R18 |
| S1-AC14 | Given màn hình VNeID "Thông tin cá nhân" (ảnh chân dung, huy hiệu "Định danh mức 2", dòng Số định danh cá nhân / Giới tính / Ngày sinh / Số điện thoại / Nơi thường trú, không có quê quán) / Then dấu hiệu nhận biết của `vneid` mô tả cả kiểu màn hình này (ảnh chân dung + "Định danh mức 1/2"), chứng từ match `vneid`, không phải `qr_code_info` | R18 |
| S1-AC15 | Given báo cáo Thịnh Điền "BÁO CÁO TƯ VẤN VỀ GIÁ TÀI SẢN BẢO ĐẢM (Áp dụng đối với tài sản là Bất động sản)" và báo cáo Thịnh Điền "BÁO CÁO TƯ VẤN GIÁ HIỆN TRẠNG TÀI SẢN ĐẢM BẢO (Áp dụng với tài sản là PTVT/PTTC/MMTB/DCSX)" / Then prompt phân loại có dấu hiệu nhận biết đủ để phân biệt: báo cáo thứ nhất match `real_estate_valuation_report`, báo cáo thứ hai match `movable_asset_valuation_report`; báo cáo BĐS không bị gán loại động sản (tránh sinh tài sản `vehicle` trùng số GCN với tài sản BĐS) | R18 |
| S1-AC16 | Given CCCD có số `001090000001` / When classify / Then instance có `key_facts` với `key` ∈ {`full_name`, `id_number`}, `value` đúng như in, không có key ngoài danh mục | R20, R22 |
| S1-AC17 | Given model trả `value` đã chuẩn hóa hoặc key không thuộc danh mục của loại / When classify / Then key ngoài danh mục bị bỏ, `value` của key hợp lệ giữ nguyên chuỗi model trả (S1 không sửa) | R20, R22 |
| S1-AC18 | Given GCN trải 2 batch (130 trang, trang 20–21) / When classify / Then 1 instance `[19,22]`, `key_facts` hợp nhất từ cả hai batch, cùng `(subject, key, value)` chỉ giữ một dòng, `summary` lấy của batch đầu | R19, R21 |
| S1-AC19 | Given loại LIGHT (VD `household_business_license`) / When classify / Then `key_facts = []`, `summary` có | R19, R20 |

## 7. Task cards

### T-S1-01 — Nhận dạng định dạng và `file_id`
- Depends: T-CAT-02
- Files: `lib/loan-dossier/s1/file-id.ts`, `tests/loan-dossier/s1-file-id.test.ts`
- Refs: S1-R01, S1-R02
- Làm: `sniffMime(buf): 'application/pdf'|'image/jpeg'|'image/png'|null` đọc magic bytes. `computeFileId(buf): string` = `file-` + 12 ký tự hex đầu của SHA-256.
- DoD:
  - test: PDF, JPEG, PNG nhận đúng; `.docx` (zip) → null
  - test: PDF đặt tên `.jpg` vẫn nhận `application/pdf` (hàm không nhận tên file)
  - test: cùng buffer → cùng `file_id`; khác 1 byte → khác
  - test: `file_id` khớp `/^file-[0-9a-f]{12}$/`
- Verify: `npx jest tests/loan-dossier/s1-file-id.test.ts`

### T-S1-02 — Bảng trạng thái file → mã lý do
- Depends: T-CAT-02
- Files: `lib/loan-dossier/s1/file-status.ts`, `tests/loan-dossier/s1-file-status.test.ts`
- Refs: S1-R05
- Làm: `fileOutcome(kind, ctx): {status, reason_code, next_action, message}` với `kind` ∈ 7 dòng bảng §4; `{ext}` được thay bằng `ctx.ext`. Thông báo lấy đúng chuỗi §4.
- DoD:
  - test: 7 dòng trả đúng `status`/`reason_code`/`next_action`
  - test: `UNSUPPORTED_FORMAT` thay `{ext}` = `.docx`
  - test: mọi `reason_code` trả ra đều có trong `reason_codes.json` scope `FILE`
- Verify: `npx jest tests/loan-dossier/s1-file-status.test.ts`

### T-S1-03 — Chia batch PDF và ghép segment
- Depends: —
- Files: `lib/loan-dossier/s1/batching.ts`, `tests/loan-dossier/s1-batching.test.ts`
- Refs: S1-R09
- Làm: `planBatches(pageCount): [number,number][]` (≤ 100 trang → 1 batch; > 100 → batch 20 trang). `mergeSegments(batches)` ghép segment liền kề cùng `doc_type_key` khi `starts_new_document = false`, `confidence = min`.
- DoD:
  - test: 100 trang → `[[1,100]]`; 101 trang → 6 batch, batch cuối `[101,101]`
  - test: 130 trang → batch cuối `[121,130]`
  - test: ghép khi `starts_new_document=false`; không ghép khi `true`
  - test: không ghép nếu khác `doc_type_key`
  - test: `confidence` ghép = min
- Verify: `npx jest tests/loan-dossier/s1-batching.test.ts`

### T-S1-04 — Hậu xử lý kết quả model
- Depends: T-S1-02, T-CAT-02
- Files: `lib/loan-dossier/s1/postprocess.ts`, `tests/loan-dossier/s1-postprocess.test.ts`
- Refs: S1-R04, S1-R06, S1-R07, S1-R14, S1-R03
- Làm: `postprocess(raw, hint): ClassifiedFile` — áp ngưỡng, loại match trùng `doc_type_key` (giữ confidence cao), gán `needs_extraction` từ catalog, `instances_count`, `hint_mismatch`, và `UNKNOWN/UNCLASSIFIED` khi hết match.
- DoD:
  - test: 0.80 nhận không review; 0.79 nhận có review; 0.49 loại
  - test: hết match → `UNKNOWN`/`UNCLASSIFIED`
  - test: 2 match cùng `doc_type_key` → còn 1
  - test: `needs_extraction` đúng cho `id_card` (true) và `deposit_certificate` (false), bỏ qua giá trị model trả
  - test: `hint_mismatch` true/false đúng
  - test: `doc_type_key` không có trong catalog → bị loại
- Verify: `npx jest tests/loan-dossier/s1-postprocess.test.ts`

### T-S1-05 — Tín hiệu nghi trùng mức loại
- Depends: T-S1-04
- Files: `lib/loan-dossier/s1/repeated.ts`, `tests/loan-dossier/s1-repeated.test.ts`
- Refs: S1-R16
- Làm: `repeatedDocTypes(files): RepeatedDocType[]`.
- DoD:
  - test: 2 file cùng loại → 1 phần tử, `file_ids` đủ
  - test: 2 instance cùng loại trong 1 file → rỗng
  - test: luôn `DUPLICATE_CANDIDATE` + `requires_review = true`
- Verify: `npx jest tests/loan-dossier/s1-repeated.test.ts`

### T-S1-06 — Cổng gọi model phân loại
- Depends: T-S1-03, T-S1-04
- Files: `lib/loan-dossier/s1/classifier-port.ts`, `tests/loan-dossier/s1-classifier-port.test.ts`
- Refs: S1-R03, S1-R09, S1-R10
- Làm: Định nghĩa `ClassifierPort.classifyPages(pages, docTypes): Promise<RawSegments>` và bộ parse bằng zod cho phản hồi model (JSON lỗi → ném `JSON_PARSE_ERROR`). Lời nhắc **không** có `file_name`/đường dẫn. Bản gọi thật dùng `enqueueSubStep` với processor `ext-classifier` (tên cần xác nhận — OQ-03); test chỉ dùng bản giả.
- DoD:
  - test: phản hồi hợp lệ được parse
  - test: phản hồi thiếu field → `JSON_PARSE_ERROR`
  - test: chuỗi lời nhắc dựng ra không chứa tên file hay đường dẫn truyền vào
- Verify: `npx jest tests/loan-dossier/s1-classifier-port.test.ts`

### T-S1-07 — Lắp ráp stage S1
- Depends: T-S1-01, T-S1-02, T-S1-04, T-S1-05, T-S1-06
- Files: `lib/loan-dossier/s1/run.ts`, `tests/loan-dossier/s1-run.test.ts`
- Refs: S1-R12, S1-R13, S1-R15, S1-R17, §5
- Làm: `runClassify(input, ports): StageResult` — bỏ file trùng `file_id`, phân loại từng file, tính `content_preview` và trạng thái theo §5.
- DoD:
  - test: 1 test cho mỗi dòng của bảng §5
  - test: S1-AC08 (file trùng, model giả chỉ được gọi 1 lần)
  - test: S1-AC11
  - test: không bao giờ trả `FAILED` vì file lỗi
- Verify: `npx jest tests/loan-dossier/s1-run.test.ts`

### T-S1-08 — Tóm tắt và `key_facts` theo danh mục cố định
- Depends: T-S1-04, T-S1-06, T-S1-07
- Files: `lib/loan-dossier/s1/classifier-port.ts`, `lib/loan-dossier/s1/postprocess.ts`, `lib/loan-dossier/s1/batching.ts`, `lib/loan-dossier/s1/run.ts`, `lib/loan-dossier/contracts/stage-result.ts`, `tests/loan-dossier/s1-summary.test.ts`
- Refs: S1-R19, S1-R20, S1-R21, S1-R22, S1-R23
- Làm: prompt phân loại (bỏ quy tắc cũ "không trả tên, số giấy tờ…") thêm danh mục `summary_fields` theo loại và quy tắc chép nguyên văn; `ResponseSchema` nhận `summary` và `key_facts` ở mỗi instance; `postprocess` lọc key ngoài danh mục, mặc định `summary = ""` và `key_facts = []` khi model không trả; `mergeSegments` hợp nhất `key_facts` (khử trùng `(subject, key, value)`); `ClassifyInstanceSchema` nhận hai field mới.
- DoD:
  - test: S1-AC16, S1-AC17, S1-AC19
  - test: S1-AC18 (hợp nhất hai batch, không trùng dòng)
  - test: prompt chứa danh mục key của đúng từng loại và quy tắc "nguyên văn"; không còn câu cấm trả tên / số giấy tờ
  - test: log của stage không chứa `value` (S1-R23)
- Verify: `npx jest tests/loan-dossier/s1- tests/loan-dossier/contract-stage-result.test.ts`
