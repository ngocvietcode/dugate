# 02 — Quy ước

## 1. Đặt tên

| Đối tượng | Quy ước | Ví dụ |
|---|---|---|
| Key trong JSON/DB | `snake_case`, tiếng Anh | `doc_type_key`, `person_id` |
| Enum | `UPPER_SNAKE_CASE` | `PARTIAL_SUCCESS` |
| `stage_key` | `snake_case` | `map_dossier_roles` |
| ID đối tượng | `{tiền tố}-{n}` hoặc `{tiền tố}-{uuid}` | `person-1`, `asset-2`, `ev-3f…` |
| Mã stage trong tài liệu | `S1`…`S6` | `S3` |
| Rule | `S{n}-R{nn}` | `S3-R05` |
| Acceptance criteria | `S{n}-AC{nn}` | `S4-AC03` |
| Task | `T-{khu vực}-{nn}` | `T-S3-04`, `T-U2-02` |
| Mã lý do | `UPPER_SNAKE_CASE`, phải có trong `03_catalogs/reason_codes.json` | `DOCUMENT_NOT_FOUND` |
| Nhãn hiển thị | Tiếng Việt, nằm ở `*.label` trong catalog hoặc file `copy` của UI | — |

`doc_type_key` mô tả **loại chứng từ vật lý**, không mô tả mục đích hay tên công ty/mã mẫu. Biến thể mẫu → `form_variant`.

## 2. Kiểu dữ liệu

| Kiểu | Biểu diễn | Ghi chú |
|---|---|---|
| Ngày | chuỗi ISO `YYYY-MM-DD` | Hiển thị `dd/MM/yyyy` ở UI |
| Thời điểm | ISO 8601 UTC | `2026-10-14T03:00:00Z` |
| Tiền | số nguyên VND | Không dấu phân cách |
| Độ tin cậy | số `0…1` | Field null → `0` |
| Số định danh | chuỗi, giữ số `0` đầu | CMND 9 số, CCCD 12 số |
| Địa chỉ | `{full_text, street, ward, district, province}` | `district` null với địa chỉ 2 cấp (sau 01/07/2025) |
| Giá trị trống | `null` | Không dùng `""` |
| Mảng rỗng | `[]` | Không bỏ field |

## 3. Trạng thái stage

| `status` | Khi nào |
|---|---|
| `RUNNING` | Đang chạy |
| `SUCCESS` | Chạy xong, đủ dữ liệu |
| `PARTIAL_SUCCESS` | Có kết quả nhưng còn mục cần người xử lý |
| `INSUFFICIENT_DATA` | Thiếu đầu vào nghiệp vụ nên không kết luận được |
| `NOT_EVALUATED` | Không áp dụng / bị bỏ qua có chủ ý |
| `UNAVAILABLE` | Phụ thuộc không dùng được (stage trước `FAILED`, dịch vụ ngoài chết) |
| `FAILED` | Lỗi hệ thống (crash, timeout, parse JSON lỗi). **Không bao giờ** do dữ liệu nghiệp vụ |

Mọi stage có thêm `status_code` (mã trong `reason_codes.json`, scope `STAGE`) và `message` tiếng Việt.

**Scheduler:**

1. Stage chạy khi mọi stage trong `depends_on` đã kết thúc.
2. Dependency `FAILED` → stage kết thúc `UNAVAILABLE` / `DEPENDENCY_FAILED`.
3. Dependency khác (`PARTIAL_SUCCESS`, `INSUFFICIENT_DATA`, …) **không chặn**; stage sau tự quyết định.
4. S4, S5, S6 không phụ thuộc nhau, được chạy song song.

| Stage | `depends_on` |
|---|---|
| S1 `classify` | — |
| S2 `extract_evidence` | S1 |
| S3 `map_dossier_roles` | S1, S2 |
| S4 `check_checklist` | S1, S2, S3 |
| S5 `cross_check_documents` | S2, S3 |
| S6 `compare_ocr_sl` | S2, S3 |

## 4. Mẫu trả về của mỗi stage

```json
{
  "stage_key": "check_checklist",
  "status": "PARTIAL_SUCCESS",
  "status_code": "CHECKLIST_ITEMS_UNRESOLVED",
  "message": "Còn 2 mục cần rà soát.",
  "started_at": "2026-10-14T03:00:00Z",
  "finished_at": "2026-10-14T03:00:02Z",
  "content_preview": { "…": "số liệu tóm tắt, riêng từng stage" },
  "data": { "…": "kết quả đầy đủ, riêng từng stage" },
  "blocking_inputs": [
    { "type": "EXTERNAL_DATA", "key": "loan_amount", "message": "Cần số tiền vay." }
  ]
}
```

`blocking_inputs[].type` ∈ `DOCUMENT` | `EXTERNAL_DATA` | `INTEGRATION`.

## 5. Bảo mật dữ liệu

Bắt buộc đọc `docs/SECURITY-RULES.md` trước khi viết route. Tóm tắt áp dụng cho spec này:

- `data.*`, `FieldEdit.value`, form xác nhận là **PII**. Không log plaintext; log `operation_id`, `evidence_id`, `person_id`, mã lý do.
- Luồng không lưu PII mới; PII chỉ nằm trong file và nội dung Operation do nền tảng quản lý (xem [cross_cutting/security.md](cross_cutting/security.md)).
- Ví dụ trong spec dùng dữ liệu giả (`NGUYEN VAN A`, số `000000000000`). Không dán dữ liệu thật.
- `GET` chỉ đọc. Mọi thay đổi trạng thái dùng `POST`/`PUT`/`PATCH`.

## 6. Task card

Mỗi task trong các file spec có đúng 7 mục, để agent làm một mạch:

```text
### T-S3-04 — Ghép party theo số định danh
- Depends: T-S3-02, T-S3-03
- Files:   lib/loan-dossier/s3/match-by-id.ts, tests/loan-dossier/s3-match-by-id.test.ts
- Refs:    S3-R06
- Làm:     (1–3 dòng, nói rõ hàm, chữ ký, hành vi)
- DoD:     (danh sách test phải có, mỗi dòng 1 test)
- Verify:  npx jest tests/loan-dossier/s3-match-by-id.test.ts
```

Giới hạn để task đủ nhỏ:

- Tối đa **1 module** + **1 file test**. Cần sửa thêm file khác → tách task.
- Hàm thuần (không DB, không mạng) khi có thể. Phần I/O nằm ở task riêng.
- DoD dưới 10 dòng. Nhiều hơn → tách.
- Mọi `Verify` chạy được độc lập và exit 0 khi đạt.

## 7. Cấu trúc thư mục code

```text
lib/loan-dossier/
  catalog/        # nạp + kiểm tra catalog JSON (zod)
  common/         # chuẩn hóa tên, số, địa chỉ, ngày; so tên
  s1/ … s6/       # logic từng stage (hàm thuần)
  contracts/      # zod cho OcrOutput, CheckInput, CheckOutput, StageResult (04_data_model)
  edits/          # áp bản vá lên evidence (hàm thuần)
  confirmation/   # form xác nhận, gợi ý OCR, ngưỡng tự động
  run/            # scheduler, port StageRunner
  ui/             # view-model, reducer, client gọi workflow (hàm thuần cho giao diện)
lib/pipelines/workflows/loan-dossier-ocr.ts     # W1, đăng ký trong workflow-engine
lib/pipelines/workflows/loan-dossier-check.ts   # W2
app/loan-dossier/                         # UI, cùng bố cục /loan-appraisal-v2 (xem ui/)
tests/loan-dossier/                       # test, 1 file / module
```

Không có `app/api/loan-dossier/`, không có bảng DB (04_data_model D-01). Catalog được copy vào `lib/loan-dossier/catalog/data/` bởi task `T-CAT-01`; không import trực tiếp từ `docs/`.
