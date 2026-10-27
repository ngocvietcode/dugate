# API Hướng dẫn tích hợp: Quản lý Tài khoản Thanh toán (Payment Account Management)

> Đối tượng: hệ thống IDP gọi API trên môi trường **Production** với `file_urls`.
> Workflow: `payment-account-management` — cung cấp **2 API nghiệp vụ** chọn qua `metadata.mode`.

---

## 1. Tổng quan — 2 API nghiệp vụ

Cùng một HTTP endpoint (`POST /api/v1/docs/workflows`) nhưng phục vụ **hai tình huống nghiệp vụ khác nhau**. Từ góc nhìn IDP, bạn có thể xem đây là 2 API riêng biệt vì payload + response khác nhau.

| # | API | `metadata.mode` | Khi nào dùng | Tài liệu bắt buộc | `metadata.data`? |
|:-:|-----|:---------------:|-------------|:-----------------:|:----------------:|
| **1** | 👉 **[Mở tài khoản](#2-api-1--mở-tài-khoản-modeopen)** | `open` | Hồ sơ mở TK mới | Không (ít nhất 1 PDF/ảnh) | Không |
| **2** | 👉 **[Cập nhật tài khoản](#3-api-2--cập-nhật-tài-khoản-modeupdate)** | `update` | Hồ sơ cập nhật thông tin/dịch vụ | **MB03** | **Có** (dữ liệu core bank để đối chiếu) |

**Điểm chung của cả 2 API:**

- Bất đồng bộ (async): trả `202 Accepted` ngay; kết quả lấy qua **webhook** hoặc **poll GET** (xem §6, tùy chọn).
- Kết quả trả về **theo từng tài liệu** (fan-out), khóa duy nhất là `file_id`.
- Mỗi document xử lý **song song, cô lập lỗi** — một tài liệu lỗi không làm hỏng cả bộ.
- Với **từng tài liệu**, workflow chạy:
  1. **Phân loại (classification)** — nhận diện loại tài liệu (CCCD, hộ chiếu, MB02, MB03, điều lệ, ...).
  2. **Trích xuất (extraction)** — đọc các trường theo schema của loại tài liệu đó.
  3. *(chỉ API 2, stage `e2e`)* **Đối chiếu (validation)** — LLM so từng field với dữ liệu core bank.

**`stage` (tùy chọn, mặc định `e2e`):** `classification` (chỉ phân loại) · `extraction` (phân loại + trích xuất) · `e2e` (đầy đủ). Chi tiết: §4.2.

---

## 2. API 1 — Mở tài khoản (`mode: open`)

**Nghiệp vụ:** hồ sơ mở tài khoản thanh toán mới. Phân loại + trích xuất **mọi** tài liệu trong hồ sơ. Không có tài liệu bắt buộc; không cần `metadata.data`.

**Yêu cầu đầu vào:** ít nhất **1** file PDF hoặc ảnh trong `file_urls`.

### 2.1. Request

```bash
curl -X POST https://api.dugate.vn/api/v1/docs/workflows \
  -H "x-api-key: dg_live_xxxxxxxxxxxxxxxx" \
  -H "x-correlation-id: idp-open-acc-20260717-001" \
  -F 'process=payment-account-management' \
  -F 'metadata={"mode":"open","stage":"e2e"}' \
  -F 'allowed_extensions=.pdf,.jpg,.jpeg,.png' \
  -F 'webhook_url=https://idp.vpbank.dev/callbacks/open-account' \
  -F 'file_urls=[
        {"url":"https://csp.workdrive.vpbank.dev/download/abc","filename":"don_mo_tk.pdf","mime_type":"application/pdf","file_id":"IDP-DOC-0001"},
        {"url":"https://csp.workdrive.vpbank.dev/download/def","filename":"cccd_mat_truoc.jpg","mime_type":"image/jpeg","file_id":"IDP-DOC-0002"}
      ]'
```

> Nếu Admin **chưa** cấu hình CSP auth trên Profile, thêm `file_url_auth` (§4.4).

**Các field chính:** `process`, `metadata`, `file_urls` (bắt buộc); `webhook_url`, `allowed_extensions` (khuyến nghị). Xem §4 để biết đầy đủ.

### 2.2. Response

**Ở stage `extraction` / `e2e`** (mặc định), `result.extracted_data.result` có shape:

```jsonc
{
  "stage": "e2e",
  "documents": [
    {
      "file_id": "IDP-DOC-0002",              // echo từ file_urls[].file_id
      "name": "cccd_mat_truoc.jpg",
      "classification": {
        "code": "can_cuoc_cong_dan",
        "title": "Nguyễn Văn A - 038201005678",
        "confidence": 0.96,
        "reason": "Có cụm 'CĂN CƯỚC CÔNG DÂN' và số định danh 12 chữ số."
      },
      "extracted": {
        "id_no": { "value": "038201005678", "confidence": 0.98 },
        "full_name": { "value": "NGUYỄN VĂN A", "confidence": 0.95 },
        "date_of_birth": { "value": "18/11/1988", "confidence": 0.9 }
      }
    },
    {
      "file_id": "IDP-DOC-0003",
      "name": "mb02_hop_dong.pdf",
      "classification": {
        "code": "MB02",
        "title": "GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ VÀ SỬ DỤNG TÀI KHOẢN...",
        "confidence": 0.91,
        "reason": "Khớp mã biểu mẫu MB02.HDM-TT.DT.TK/02."
      },
      "extracted": {
        "org_name_vi": { "value": "CONG TY TNHH ABC", "confidence": 0.95 },
        "org_name_foreign": { "value": "ABC COMPANY LIMITED", "confidence": 0.92 },
        "org_short_name": { "value": "ABC", "confidence": 0.94 },
        "business_registration_no": { "value": "0312345678", "confidence": 0.97 },
        "legal_representatives": [
          {
            "full_name": { "value": "NGUYEN VAN A", "confidence": 0.96 },
            "id_no": { "value": "038201005678", "confidence": 0.98 },
            "position": { "value": "GIAM DOC", "confidence": 0.94 }
          }
        ],
        "title": { "value": "GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ VÀ SỬ DỤNG TÀI KHOẢN THANH TOÁN", "confidence": 1 }
      }
    },
    {
      "file_id": "IDP-DOC-0004",
      "name": "anh_mo.jpg",
      "classification": {
        "code": "unknown",
        "title": "unknown",
        "confidence": 0.42,
        "reason": "Không khớp bất kỳ mã biểu mẫu hoặc từ khóa nào."
      },
      "extracted": null,
      "error": "Không xác định được loại tài liệu — bỏ qua trích xuất."
    }
  ]
}
```

**Ở stage `classification`**, không có `extracted`; thêm `summary`:

```jsonc
{
  "stage": "classification",
  "documents": [ /* mỗi document chỉ có file_id, name, classification */ ],
  "summary": { "pdfs": 1, "images": 1, "excels": 0, "others": 0 }
}
```

**Ghi chú:**
- `extracted` chỉ hiển thị trích đoạn — mỗi loại tài liệu có schema riêng (CCCD ~15 trường, MB02 ~85 trường). Xem `ACCOUNT_EXTRACT_SCHEMAS` trong `shared/extract-schemas.ts` để có danh sách trường cho từng loại.
- `extracted: null` xảy ra ở 2 trường hợp: (1) `classification.code === "unknown"` (không nhận diện được loại), (2) LLM trích xuất lỗi sau nhiều lần retry hoặc file hỏng. Cả hai đều kèm `error`.
- Envelope đầy đủ (extracted_data / result nested): xem §5.

---

## 3. API 2 — Cập nhật tài khoản (`mode: update`)

**Nghiệp vụ:** hồ sơ cập nhật thông tin / dịch vụ tài khoản hiện có. Khác API 1 ở 3 điểm:

1. **Bắt buộc có tài liệu `MB03`** (Giấy đề nghị cập nhật thông tin và dịch vụ). Không có → workflow **vẫn `SUCCEEDED`** nhưng `result.status = "REQUIRED_DOCUMENT_MISSING"` (§3.4).
2. **Chỉ trích xuất `MB03`** — các tài liệu khác vẫn được phân loại (ở stage `classification`) nhưng **không** được trích xuất.
3. **Cần `metadata.data`** — dữ liệu tài khoản từ hệ thống ngân hàng. Ở stage `e2e`, LLM so từng field trên MB03 với dữ liệu này và ghi kết quả trực tiếp vào `extracted`. Đây là **yêu cầu mềm**: thiếu vẫn chạy được nhưng không có đối chiếu (§3.4).

### 3.1. Data contract — `metadata.data` (dữ liệu core bank)

`metadata.data` chứa dữ liệu tài khoản **hiện có** từ hệ thống ngân hàng, dùng làm nguồn sự thật khi đối chiếu với thông tin trích xuất từ MB03. Shape được thiết kế để **mirror 1:1** các key trích xuất trên MB03 → bước đối chiếu là phép so trực tiếp theo field, không cần map trung gian.

**Schema:**

```ts
/** Một cá nhân từ core bank, dùng để đối chiếu với người khai trên MB03. */
interface BankPersonRef {
  full_name?: string | null;   // Họ và tên — khóa khớp người
  id_no?: string | null;       // Số GTTT (CCCD / hộ chiếu / ...) — khóa khớp người
  position?: string | null;    // Chức vụ — TRƯỜNG DUY NHẤT được so sánh
}

/** Dữ liệu tài khoản hiện tại từ core bank. Đặt tại metadata.data. */
interface UpdateAccountBankData {
  // ── Định danh tổ chức (Section 2 trên MB03) ─────────────────────────
  org_name_vi?: string | null;       // Tên doanh nghiệp (tiếng Việt)
  org_name_foreign?: string | null;  // Tên doanh nghiệp (tiếng nước ngoài)
  org_short_name?: string | null;    // Tên viết tắt

  // ── 5 danh sách cá nhân (Section 4 trên MB03) ───────────────────────
  legal_representatives?: BankPersonRef[];            // 4.I  Đại diện theo pháp luật
  authorized_representatives?: BankPersonRef[];       // 4.II ĐD hợp pháp là ĐD theo ủy quyền
  authorized_account_users?: BankPersonRef[];         // 4.III Người ủy quyền sử dụng tài khoản
  chief_accountants?: BankPersonRef[];                // 4.IV Kế toán trưởng / Phụ trách kế toán
  authorized_by_chief_accountants?: BankPersonRef[];  // 4.V   Người ủy quyền KTT / PTKT
}
```

**Mapping bank ↔ MB03** (bảng tra nhanh cho reviewer):

| Bank field | MB03 key đối chiếu | Ý nghĩa |
|---|---|---|
| `org_name_vi` | `org_name_new_vi` (Section 2.I) | Tên doanh nghiệp (VI) — chỉ đối chiếu khi Section 1 tick "Thay đổi tên tổ chức" |
| `org_name_foreign` | `org_name_new_foreign` | Tên doanh nghiệp (nước ngoài) — tương tự |
| `org_short_name` | `org_name_new_abbr` | Tên viết tắt — tương tự |
| `legal_representatives[]` | `legal_representatives` (4.I) | Đại diện theo pháp luật |
| `authorized_representatives[]` | `authorized_representatives` (4.II) | ĐD hợp pháp — Ủy quyền |
| `authorized_account_users[]` | `authorized_account_users` (4.III) | Người UQ sử dụng TK |
| `chief_accountants[]` | `chief_accountants` (4.IV) | Kế toán trưởng / PTKT |
| `authorized_by_chief_accountants[]` | `authorized_by_chief_accountants` (4.V) | UQ KTT / PTKT |

**Trong mỗi `BankPersonRef`:**

| Field | Vai trò | Đối chiếu với sub-key MB03 |
|---|---|---|
| `full_name` | Khóa khớp người (identifier) | `full_name` |
| `id_no` | Khóa khớp người (identifier) — Số GTTT | `id_no` |
| `position` | **Trường được so sánh** | `position` |

> **Quy ước khớp người:** hai bản ghi là "cùng một người" khi khớp đồng thời `full_name` và `id_no` (case- và diacritic-insensitive). Sau khi khớp, hệ thống **chỉ** so `position` — `full_name` và `id_no` không tự sinh check bằng/khác.

**Quy tắc "yêu cầu mềm" (soft) trên từng field** — mọi field của `UpdateAccountBankData` đều **optional**:

| Tình huống | Hành vi đối chiếu |
|---|---|
| Toàn bộ `metadata.data` không gửi | `data_status: "BANK_DATA_MISSING"` (§3.4) — bỏ qua đối chiếu |
| Một trường org bỏ trống (ví dụ `org_short_name` = `null`) | Bỏ qua check đó, các check khác vẫn chạy |
| Một list vắng mặt (`chief_accountants` không có key) | Bỏ qua toàn bộ check cho list đó |
| Một list là `[]` (rỗng, có gửi) | Vẫn đối chiếu: mọi entry cùng loại trên MB03 sẽ được coi là "thêm mới" |
| Một `BankPersonRef` thiếu `id_no` hoặc `full_name` | Không khớp được người → không sinh check `position` cho entry đó |

### 3.2. Request

```bash
curl -X POST https://api.dugate.vn/api/v1/docs/workflows \
  -H "x-api-key: dg_live_xxxxxxxxxxxxxxxx" \
  -H "x-correlation-id: idp-update-acc-20260717-001" \
  -F 'process=payment-account-management' \
  -F 'metadata={"mode":"update","stage":"e2e","data":{"org_name_vi":"CÔNG TY TNHH ABC","org_name_foreign":"ABC COMPANY LIMITED","org_short_name":"ABC","legal_representatives":[{"full_name":"NGUYỄN VĂN A","id_no":"012345678901","position":"GIÁM ĐỐC"}],"chief_accountants":[{"full_name":"TRẦN THỊ B","id_no":"098765432109","position":"KẾ TOÁN TRƯỞNG"}]}}' \
  -F 'allowed_extensions=.pdf,.jpg,.jpeg,.png' \
  -F 'webhook_url=https://idp.vpbank.dev/callbacks/update-account' \
  -F 'file_urls=[
        {"url":"https://csp.workdrive.vpbank.dev/download/ghi","filename":"mb03_cap_nhat.pdf","mime_type":"application/pdf","file_id":"IDP-DOC-1001"}
      ]'
```

**Payload `metadata.data` đầy đủ** (để tham chiếu):

```json
{
  "mode": "update",
  "stage": "e2e",
  "data": {
    "org_name_vi": "CÔNG TY TNHH ABC",
    "org_name_foreign": "ABC COMPANY LIMITED",
    "org_short_name": "ABC",

    "legal_representatives": [
      { "full_name": "NGUYỄN VĂN A", "id_no": "012345678901", "position": "GIÁM ĐỐC" }
    ],
    "authorized_representatives": [
      { "full_name": "LÊ THỊ C", "id_no": "023456789012", "position": "PHÓ GIÁM ĐỐC" }
    ],
    "authorized_account_users": [
      { "full_name": "PHẠM VĂN D", "id_no": "034567890123", "position": "TRƯỞNG PHÒNG TÀI CHÍNH" }
    ],
    "chief_accountants": [
      { "full_name": "TRẦN THỊ B", "id_no": "098765432109", "position": "KẾ TOÁN TRƯỞNG" }
    ],
    "authorized_by_chief_accountants": [
      { "full_name": "HOÀNG VĂN E", "id_no": "045678901234", "position": "PHỤ TRÁCH KẾ TOÁN" }
    ]
  }
}
```

### 3.3. Response — có MB03 + có `metadata.data`

`result.extracted_data.result` (envelope ngoài xem §5):

```jsonc
{
  "stage": "e2e",
  "documents": [
    {
      "file_id": "IDP-DOC-1001",
      "name": "mb03_cap_nhat.pdf",
      "classification": {
        "code": "MB03",
        "title": "GIẤY ĐỀ NGHỊ CẬP NHẬT THÔNG TIN VÀ DỊCH VỤ",
        "confidence": 0.93,
        "reason": "Khớp mã biểu mẫu MB03.HDM-TT.DT.TK/02."
      },
      "extracted": {
        "requested_services_org_info_changes": {
          "value": ["Thay đổi tên tổ chức"],
          "confidence": 0.94
        },
        "org_name_new_vi": {
          "value": "CONG TY TNHH ABC MOI",
          "confidence": 0.93,
          "validation": [
            {
              "code": "org_name_match:org_name_vi",
              "status": "fail",
              "severity": "warning",
              "bank_value": "CÔNG TY TNHH ABC",
              "reason": "Bank=\"CÔNG TY TNHH ABC\" ≠ MB03=\"CONG TY TNHH ABC MOI\"."
            }
          ]
        },
        "org_name_new_foreign": {
          "value": "ABC NEW COMPANY LIMITED",
          "confidence": 0.9,
          "validation": [
            {
              "code": "org_name_match:org_name_foreign",
              "status": "fail",
              "severity": "warning",
              "bank_value": "ABC COMPANY LIMITED",
              "reason": "Bank=\"ABC COMPANY LIMITED\" ≠ MB03=\"ABC NEW COMPANY LIMITED\"."
            }
          ]
        },
        "org_name_new_abbr": {
          "value": "ABC MOI",
          "confidence": 0.92,
          "validation": [
            {
              "code": "org_name_match:org_short_name",
              "status": "fail",
              "severity": "warning",
              "bank_value": "ABC",
              "reason": "Bank=\"ABC\" ≠ MB03=\"ABC MOI\"."
            }
          ]
        },
        "chief_accountants": [
          {
            "full_name": { "value": "TRAN THI B", "confidence": 0.96 },
            "id_no": { "value": "098765432109", "confidence": 0.98 },
            "position": {
              "value": "KE TOAN TRUONG",
              "confidence": 0.94,
              "validation": [
                {
                  "code": "position_match:chief_accountants",
                  "status": "pass",
                  "severity": "warning",
                  "bank_value": "Kế toán trưởng"
                }
              ]
            },
            "date_of_birth": { "value": "12/05/1985", "confidence": 0.9 },
            "action_type": { "value": ["Thay đổi"], "confidence": 0.91 }
          }
        ],
        "legal_representatives": [],
        "title": { "value": "GIẤY ĐỀ NGHỊ CẬP NHẬT THÔNG TIN VÀ DỊCH VỤ", "confidence": 1 }
      },
      "validation": {
        "overall": "pass",
        "summary": { "pass": 1, "fail": 3, "skip": 0 }
      }
    }
  ],
  "bank_data": {
    "org_name_vi": "CÔNG TY TNHH ABC",
    "org_name_foreign": "ABC COMPANY LIMITED",
    "org_short_name": "ABC",
    "legal_representatives": [
      { "full_name": "NGUYỄN VĂN A", "id_no": "012345678901", "position": "GIÁM ĐỐC" }
    ],
    "chief_accountants": [
      { "full_name": "TRẦN THỊ B", "id_no": "098765432109", "position": "KẾ TOÁN TRƯỞNG" }
    ]
  }
}
```

**Ghi chú:**

- `documents[]` chỉ chứa (các) tài liệu **MB03** — tài liệu khác không xuất hiện ở stage `extraction`/`e2e` (chúng vẫn có ở stage `classification`).
- `extracted` chỉ hiển thị trích đoạn — MB03 có ~200 trường trên 6 nhóm (Section 1–6). Xem `MB03_SCHEMA` trong `shared/extract-schemas.ts` để có danh sách đầy đủ.
- `bank_data` là echo nguyên trạng của `metadata.data`.

**Về `validation` (mode `update`, stage `e2e`):**

Kết quả đối chiếu được gắn TRỰC TIẾP vào từng leaf trong `extracted` qua thuộc tính `validation` — mỗi phần tử là một `ValidationEntry`:

```ts
interface ValidationEntry {
  code: string;                          // định danh check (ổn định để FE map)
  status: 'pass' | 'fail' | 'skip';      // pass = khớp; fail = khác; skip = không đối chiếu được
  severity: 'error' | 'warning';         // hiện tại luôn là 'warning'
  bank_value: string | null;             // giá trị RAW bên core bank (chưa normalize)
  reason?: string;                       // giải thích ngắn (VN); có thể bỏ khi pass
}
```

- Trường **không có rule** đối chiếu (đại đa số trong 200+ trường của MB03) sẽ **không có** key `validation` — vẫn giữ nguyên `{ value, confidence }`.
- Trường **có rule nhưng bị skip** (do gate không thỏa hoặc thiếu dữ liệu một bên) vẫn xuất hiện `validation` với `status: "skip"` và `reason` giải thích lý do.
- **Bank person không có trên MB03** (hoặc ngược lại) **không sinh** validation entry — reviewer đối chiếu trực tiếp giữa `bank_data` và danh sách cá nhân trong `extracted`.
- Kèm theo trên mỗi tài liệu là envelope `validation` (bên cạnh `extracted`):
  - `overall`: `pass` khi không có check nào ở `severity: 'error'` fail. Hiện tại mọi check đều `warning` nên `overall` luôn `pass`.
  - `summary`: đếm nhanh `{ pass, fail, skip }` từ toàn bộ field-level check.
  - `error` (tùy chọn): xuất hiện khi bước LLM verify **không chạy được** (extract null, LLM gọi lỗi, LLM trả về không phải JSON). Khi có `error`, `summary` sẽ là `{ 0, 0, 0 }` và không có validation nào được gắn vào `extracted`. Workflow **vẫn `SUCCEEDED`**.

### 3.4. Các signal đặc thù của API 2

Cả hai signal dưới đây đều **không** phải lỗi — workflow vẫn `SUCCEEDED`, IDP đọc trong `result` để xử lý.

**A. Thiếu tài liệu MB03 → `REQUIRED_DOCUMENT_MISSING`**

Áp dụng cho stage `extraction` / `e2e`:

```json
{
  "stage": "e2e",
  "status": "REQUIRED_DOCUMENT_MISSING",
  "required_code": "MB03",
  "message": "Tính năng cập nhật tài khoản yêu cầu tài liệu MB03 (Giấy đề nghị cập nhật thông tin và dịch vụ). Không tìm thấy trong hồ sơ.",
  "documents": [ /* danh sách phân loại đã tìm được, để tham chiếu */ ]
}
```

> IDP nên kiểm tra `result.status === "REQUIRED_DOCUMENT_MISSING"` và yêu cầu người dùng bổ sung MB03. `documents[]` liệt kê những gì đã nhận diện được để hỗ trợ chẩn đoán.

**B. Thiếu `metadata.data` → `BANK_DATA_MISSING`** (chỉ ở stage `e2e`)

```json
{
  "stage": "e2e",
  "documents": [ /* MB03 như §3.3 nhưng KHÔNG có validation */ ],
  "data_status": "BANK_DATA_MISSING",
  "warning": "Dữ liệu tài khoản từ hệ thống ngân hàng (metadata.data) chưa được cung cấp — không thể đối chiếu với tài liệu trích xuất."
}
```

**Tóm tắt hình dạng `result` (mode `update`, stage `e2e`):**

| Tình huống | Field đặc trưng trong `result` |
|-----------|--------------------------------|
| Thiếu MB03 | `status: "REQUIRED_DOCUMENT_MISSING"`, `required_code`, `message`, `documents` |
| Có MB03 + có `data` | `documents` (chỉ MB03, có `validation`), `bank_data` |
| Có MB03 + thiếu `data` | `documents` (chỉ MB03, KHÔNG có `validation`), `data_status: "BANK_DATA_MISSING"`, `warning` |

---

## 4. Reference: Chi tiết Request (chung cho cả 2 API)

Mục này liệt kê ĐẦY ĐỦ các field trong request. Người dùng đã có CURL mẫu ở §2/§3 có thể chỉ đọc phần này khi cần tuỳ chỉnh.

### 4.1. Endpoint & Headers

**Endpoint:** `POST /api/v1/docs/workflows`

| Header | Giá trị | Bắt buộc |
|--------|---------|:--------:|
| `x-api-key` | API key được cấp bởi SkillHub Admin | ✅ |
| `X-IBM-Client-Id` | Client ID của API Gateway (nếu qua gateway) | Tùy môi trường |
| `x-correlation-id` | ID để trace log (khuyến nghị) | ❌ |

> **Không** đặt `Content-Type` thủ công — để HTTP client tự set `multipart/form-data` kèm boundary.

### 4.2. Form fields (multipart/form-data)

| Field | Type | Bắt buộc | Mô tả |
|-------|------|:--------:|-------|
| `process` | string | ✅ | Luôn là `payment-account-management` |
| `metadata` | JSON string | ✅ | Điều khiển workflow — mode, stage, data. Xem bên dưới |
| `file_urls` | JSON string | ✅ | Mảng URL tài liệu (tối đa **20**). Xem §4.3 |
| `allowed_extensions` | string | ❌ | Ghi đè whitelist đuôi file, ví dụ `.pdf,.jpg,.jpeg,.png`. Nếu bỏ trống dùng cấu hình Profile |
| `webhook_url` | string | Khuyến nghị | URL callback để nhận kết quả khi xong (§6) |
| `file_url_auth` | JSON string | ❌ | Cấu hình auth để tải `file_urls`. Xem §4.4. Nếu Admin đã cấu hình trên Profile thì **không cần gửi** |

**Cấu trúc `metadata`:**

```json
{ "mode": "open" | "update", "stage": "e2e", "data": { /* chỉ khi mode=update */ } }
```

| Field | Bắt buộc | Giá trị | Ý nghĩa |
|-------|:--------:|---------|---------|
| `mode` | ✅ | `open` \| `update` | Chọn API nghiệp vụ. `close` / `freeze` chưa triển khai |
| `stage` | ❌ | `classification` \| `extraction` \| `e2e` | Giai đoạn xử lý. Mặc định `e2e` |
| `data` | Tùy mode | object | **Chỉ dùng cho `mode: update`** — xem §3.1 |

**Ý nghĩa từng `stage`:**

| stage | Chạy tới bước | Response |
|-------|---------------|----------|
| `classification` | Chỉ phân loại | `documents[]` chỉ có `classification` |
| `extraction` | Phân loại + trích xuất | `documents[]` có `classification` + `extracted` |
| `e2e` (mặc định) | Phân loại + trích xuất *(+ đối chiếu ở mode `update`)* | `documents[]` đầy đủ; mode `update` thêm `validation` |

> **Đồng nhất:** cả 3 stage đều trả về mảng `documents[]` với **cùng cấu trúc per-file** — mỗi tài liệu luôn có `file_id`, `name`, `classification`; các stage sau bổ sung thêm `extracted` (+ `validation` cho update/e2e).

> Các key **khác** `mode`/`stage`/`data` trong `metadata` được forward nguyên trạng qua `metadata.extra` để tương thích về sau.

### 4.3. `file_urls`

Chuỗi JSON của một mảng, tối đa **20** phần tử:

```json
[
  {
    "url": "https://csp.workdrive.vpbank.dev/download/abc123",
    "filename": "don_mo_tk.pdf",
    "mime_type": "application/pdf",
    "file_id": "IDP-DOC-0001",
    "total_chunks": 1
  }
]
```

| Field | Bắt buộc | Mô tả |
|-------|:--------:|-------|
| `url` | ✅ | URL tải tài liệu. Phải hợp lệ; bị chặn SSRF (không cho IP nội bộ) |
| `filename` | Khuyến nghị | Tên file (kèm đuôi `.pdf`/`.jpg`/...). Nếu bỏ trống, suy ra từ `Content-Disposition` hoặc path của URL |
| `mime_type` | ❌ | MIME override. Nếu bỏ trống, lấy từ `Content-Type` của server |
| `file_id` | **Khuyến nghị mạnh** | ID tài liệu do IDP cấp. **Được echo nguyên trạng vào kết quả** để map ngược. Nếu bỏ trống, hệ thống tự sinh `tmp_<uuid>` |
| `total_chunks` | ❌ | Số nguyên ≥ 1 (mặc định **1**). Với file lớn từ CSP: tải theo Range thành `total_chunks` mảnh. `1` = tải một lần như thường. Kích thước mỗi mảnh cấu hình trên Profile (`csp_chunk_size`, mặc định 10MB) |

> **Vì sao nên gửi `file_id`:** kết quả trả về theo từng tài liệu và khóa bằng `file_id`. Nếu IDP cấp sẵn `file_id`, việc map kết quả về đúng hồ sơ là chính xác 100%, không phụ thuộc thứ tự file.

### 4.4. `file_url_auth` (khi CSP yêu cầu xác thực)

Trên Production, `url` thường là link CSP WorkDrive cần token. Có 2 cách cung cấp auth:

- **(Khuyến nghị) Admin cấu hình sẵn trên Profile** → IDP **không gửi** `file_url_auth`, hệ thống tự dùng.
- **Gửi trực tiếp trong request** qua `file_url_auth` (JSON string). Các kiểu:

```jsonc
// CSP OAuth2 (lấy Bearer token tự động rồi tải file)
{ "type": "csp_oauth2", "token_url": "https://.../auth/v1/csp/token",
  "client_id": "xxx", "client_secret": "yyy" }

// Bearer tĩnh
{ "type": "bearer", "token": "eyJhbG..." }

// Header tùy biến
{ "type": "header", "header_name": "X-Auth", "header_value": "secret" }

// Query param
{ "type": "query", "query_key": "token", "query_value": "secret" }

// Không auth
{ "type": "none" }
```

---

## 5. Reference: Cấu trúc Response (chung cho cả 2 API)

### 5.1. Envelope ngoài — `result.extracted_data`

Cả 2 API đều bọc payload nghiệp vụ trong `result.extracted_data`:

```jsonc
{
  "done": true,
  "metadata": { "state": "SUCCEEDED", "progress_percent": 100 },
  "result": {
    "extracted_data": {
      "request_id": "8f3c1e2a-...",
      "skill_code": "payment-account-management",
      "status": "SUCCESS",
      "metadata": { "mode": "open", "stage": "e2e" },
      "result": { /* payload nghiệp vụ — xem §2.2 (open) / §3.3 (update) */ }
    }
  }
}
```

| Field (trong `extracted_data`) | Ý nghĩa |
|--------------------------------|---------|
| `request_id` | = operationId |
| `skill_code` | Luôn `payment-account-management` |
| `status` | `SUCCESS` (kết quả tổng thể của workflow) |
| `metadata.mode` / `metadata.stage` | Echo lại mode + stage đã gọi |
| `result` | Payload chi tiết, hình dạng theo `mode` + `stage` |

> **Lưu ý:** `status: "SUCCESS"` là trạng thái workflow chạy xong. Các tín hiệu nghiệp vụ (thiếu tài liệu bắt buộc, thiếu core bank data) nằm **bên trong** `result` — xem §3.4.

### 5.2. Mỗi phần tử `documents[]`

Chung cho cả 2 API:

```jsonc
{
  "file_id": "IDP-DOC-0002",              // echo từ file_urls[].file_id (hoặc tmp_<uuid>)
  "name": "cccd_mat_truoc.jpg",           // tên file đã chuẩn hóa
  "classification": {
    "code": "can_cuoc_cong_dan",          // loại tài liệu; "unknown" nếu không xác định
    "title": "Nguyễn Văn A - 038201005678",
    "confidence": 0.96,                   // độ tin cậy phân loại, 0..1
    "reason": "Có cụm 'CĂN CƯỚC CÔNG DÂN'..."
  },
  "extracted": {                          // chỉ có ở stage extraction/e2e; null nếu code=unknown hoặc đọc lỗi
    "id_no": { "value": "038201005678", "confidence": 0.98 },
    "full_name": { "value": "NGUYỄN VĂN A", "confidence": 0.95 }
  },
  "validation": { /* chỉ mode=update, stage=e2e — §3.3 */ },
  "error": "..."                          // chỉ có khi extracted = null
}
```

**Bảng field kết quả (tham chiếu nhanh):**

| Field | Ý nghĩa |
|-------|---------|
| `file_id` | Echo từ `file_urls[].file_id` (hoặc `tmp_<uuid>` nếu không gửi) |
| `name` | Tên file (đã chuẩn hóa) |
| `classification.code` | Loại tài liệu nhận diện được; `unknown` nếu không xác định |
| `classification.title` | Tên hiển thị (đã điền các slot `<Tên người>`, `<Số ...>` nếu có) |
| `classification.confidence` | Độ tin cậy phân loại, `0..1` |
| `classification.reason` | Giải thích ngắn vì sao chọn loại đó |
| `extracted` | Map trường đã đọc, mỗi trường `{ value, confidence }`; `null` nếu `code=unknown` hoặc trích xuất lỗi |
| `validation` | *(mode=update, stage=e2e)* Envelope kết quả đối chiếu — xem §3.3 |
| `error` | Lý do khi `extracted = null` |

> **Định dạng trường `extracted`:** mỗi trường là object `{ "value": ..., "confidence": 0..1 \| null }`. `confidence` là độ tin cậy của AI cho trường đó; `null` nếu không có. Trường do hệ thống điền cố định (fixed field) có `confidence: 1`.
> **Ở mode `update` stage `e2e`:** một số leaf trong `extracted` có thêm `validation: ValidationEntry[]` — xem §3.3.

---

## 6. (Tùy chọn) Theo dõi & lấy kết quả — Async lifecycle

Cả 2 API đều xử lý bất đồng bộ. Mục này chỉ cần đọc nếu IDP muốn setup tracking / poll tùy chỉnh; nếu chỉ dùng `webhook_url` thì có thể bỏ qua và chờ callback.

### 6.1. Response ngay lập tức (HTTP 202 Accepted)

```json
{
  "name": "operations/8f3c1e2a-...",
  "done": false,
  "metadata": {
    "state": "RUNNING",
    "workflow": "payment-account-management",
    "progress_percent": 0,
    "progress_message": "Initializing workflow..."
  }
}
```

Header trả kèm: `X-Operation-ID` (ID operation để poll), `Operation-Location` (`/api/v1/operations/{id}`).
Lưu `operationId` = phần sau `operations/` trong `name`.

### 6.2. Theo dõi & lấy kết quả

- **Webhook (khuyến nghị):** khi xong, hệ thống POST tới `webhook_url`. Payload nghiệp vụ nằm trong `result.extracted_data` (§5.1).
- **Poll GET:** `GET /api/v1/operations/{operationId}` tới khi `done = true`.
  - `metadata.state = "SUCCEEDED"` → thành công, đọc `result.extracted_data`.
  - `metadata.state = "FAILED"` → lỗi, đọc `error` (xem §8).

---

## 7. (Tùy chọn) Loại tài liệu & mức hỗ trợ trích xuất

Classifier nhận diện các `code` dưới đây. Tất cả loại tài liệu đều đã có schema trích xuất — nếu một tài liệu lỗi khi trích xuất (LLM trả sai định dạng sau nhiều lần retry, file hỏng, ...), trường `extracted` sẽ là `null` kèm `error` cho tài liệu đó.

| code | Loại tài liệu | Trích xuất |
|------|---------------|:----------:|
| `can_cuoc_cong_dan` | Căn cước công dân (mẫu cũ) | ✅ |
| `can_cuoc` | Căn cước (mẫu 07/2024) | ✅ |
| `passport` | Hộ chiếu | ✅ |
| `thi_thuc` | Thị thực / Visa | ✅ |
| `the_tam_tru` | Thẻ tạm trú | ✅ |
| `tracuu_1414` | Tra cứu 1414 | ✅ |
| `dieu_le` | Điều lệ / Quy chế | ✅ |
| `bien_ban_giao_nhan` | Biên bản giao nhận | ✅ |
| `cam_key_khong_co_ktt` | Cam kết chưa có KTT/PTKT | ✅ |
| `van_ban_uy_quyen` | Văn bản ủy quyền | ✅ |
| `quyet_dinh_bo_nhiem_ktt` | QĐ bổ nhiệm KTT/PTKT | ✅ |
| `vneid` | VNeID | ✅ |
| `MB01` | Giấy đăng ký thiết lập quan hệ | ✅ |
| `MB02` | HĐ mở & sử dụng TK thanh toán | ✅ |
| `MB03` | Giấy đề nghị cập nhật thông tin & dịch vụ | ✅ |
| `MB04` | HĐ mở & sử dụng TK thanh toán CHUNG | ✅ |
| `dang_ky_kinh_doanh` | Giấy ĐKKD / ĐKDN | ✅ |
| `webca` | Bảng kiểm tra chữ ký số (WEBCA) | ✅ |
| `phieu_thu_phi` | Phiếu thu phí | ✅ |

> ✅ = có schema trích xuất. Danh sách schema đăng ký trong `ACCOUNT_EXTRACT_SCHEMAS` (`lib/pipelines/workflows/payment-account-management/shared/extract-schemas.ts`) — nếu classifier trả về `code: "unknown"` (không nhận diện được), tài liệu đó vẫn có mặt trong kết quả nhưng `extracted: null` kèm `error`.

---

## 8. (Tùy chọn) Xử lý lỗi

### 8.1. Lỗi request (HTTP 4xx) — trả ngay

| HTTP | Nguyên nhân |
|------|-------------|
| 400 | Thiếu `process`; `metadata` sai JSON hoặc thiếu `mode`; `file_urls` sai format; `file_urls` > 20 phần tử; `total_chunks` không phải số nguyên ≥ 1; thiếu file |
| 401 | Thiếu / sai `x-api-key` (hoặc API Gateway chặn) |
| 404 | `process` không tồn tại (sai tên workflow) |
| 413 | Tổng dung lượng file vượt giới hạn |
| 422 | Tải `file_urls` thất bại (401/403 từ CSP, timeout, quá kích thước, sai đuôi file) |

Ví dụ 422 khi tải file lỗi:

```json
{ "title": "File URL Download Failed", "status": 422,
  "detail": "file_urls[0]: authentication failed (HTTP 401)" }
```

### 8.2. Lỗi xử lý (async) — qua webhook / poll

`done = true`, `metadata.state = "FAILED"`, đọc `error`:

```json
{
  "done": true,
  "metadata": { "state": "FAILED" },
  "error": { "code": "INVALID_INPUT", "message": "...", "failed_step": 0 }
}
```

| `message` chứa | Nguyên nhân |
|--------------|-------------|
| `INVALID_METADATA` | `metadata` thiếu/sai `mode`, hoặc `mode` không thuộc `open`/`close`/`freeze`/`update` |
| `INVALID_INPUT: ... stage ...` | `stage` không thuộc `classification`/`extraction`/`e2e` |
| `INVALID_INPUT: Cần ít nhất 1 file PDF hoặc ảnh` | Bộ hồ sơ không có PDF/ảnh hợp lệ |
| `NOT_IMPLEMENTED: close-account ...` | Gọi `mode` chưa triển khai (`close`/`freeze`) |

> **Lưu ý cô lập lỗi:** một tài liệu đơn lẻ lỗi (đọc lỗi, không tải được, không nhận diện được loại) **không** làm workflow FAILED — nó trả về phần tử tương ứng với `code: "unknown"` hoặc `extracted: null` kèm `error`, còn `state` vẫn `SUCCEEDED`.

> **Phân biệt với tín hiệu nghiệp vụ `update`:** thiếu MB03 (`REQUIRED_DOCUMENT_MISSING`) và thiếu core-bank data (`BANK_DATA_MISSING`) **không** phải lỗi — workflow vẫn `SUCCEEDED`, tín hiệu nằm trong `result` (§3.4), không nằm ở `error`.

---

## 9. (Tùy chọn) Checklist tích hợp Production

**Chung (cả 2 API):**
- [ ] Có `x-api-key` Production và đã bật endpoint `workflows:payment-account-management` trên Profile.
- [ ] Auth tải `file_urls` (CSP OAuth2) đã cấu hình trên Profile **hoặc** gửi kèm `file_url_auth`.
- [ ] Mỗi phần tử `file_urls` có `file_id` do IDP cấp (để map kết quả).
- [ ] Có `webhook_url` (hoặc cơ chế poll) để nhận kết quả async.
- [ ] Map kết quả theo `file_id`; xử lý riêng document có `code: "unknown"` / `extracted: null`.
- [ ] File lớn: cân nhắc set `total_chunks` theo kích thước file (mỗi mảnh ~10MB).

**API 1 — Mở tài khoản:**
- [ ] `metadata = { mode: "open", stage: "e2e" }` (hoặc stage mong muốn).

**API 2 — Cập nhật tài khoản:**
- [ ] `metadata = { mode: "update", stage: "e2e", data: { ...UpdateAccountBankData... } }` — schema chi tiết ở §3.1.
- [ ] `metadata.data` gửi đủ 3 trường tên tổ chức (`org_name_vi`, `org_name_foreign`, `org_short_name`) + 5 danh sách cá nhân (`legal_representatives`, `authorized_representatives`, `authorized_account_users`, `chief_accountants`, `authorized_by_chief_accountants`), tùy tình huống. Mỗi cá nhân có `full_name`, `id_no`, `position`.
- [ ] Hồ sơ có tài liệu **MB03**; xử lý `result.status === "REQUIRED_DOCUMENT_MISSING"` khi thiếu.
- [ ] Xử lý `result.data_status === "BANK_DATA_MISSING"` khi chưa gửi `metadata.data`.
- [ ] Duyệt inline `extracted.<field>.validation[]` để hiển thị pass/fail per-field trên UI; đọc `documents[].validation.summary` để biết roll-up.


---

## 9. Batch 3 callback and Profile integration compatibility

### Preferred callback alias

Use **`callback_url`** for new multipart requests. `webhook_url` remains a supported legacy alias, so all existing samples in this guide continue to work.

| Request shape | Expected behavior |
|---|---|
| `callback_url` only | Accepted; preferred |
| `webhook_url` only | Accepted; backward compatible |
| Both aliases with the same URL | Accepted |
| Both aliases with different URLs | HTTP 400 |

Callback delivery is destination-driven: a callback is sent only when the request, endpoint, or Profile resolves a permitted destination. There is no IDP-facing callback-enable switch.

### Profile integration configuration

An Admin configures reusable file and callback integration values in **Profile → Tích hợp**; callers should not send persisted credentials again unless deliberately providing a one-request `file_url_auth` replacement.

- Supported file URL auth includes bearer, custom header, query, CSP OAuth2 and OAuth2 client credentials.
- **Gateway headers** are a list of configurable name/value pairs, apply to token/file/callback outbound requests, and retain legacy `ibm_client_id` compatibility as `X-IBM-Client-Id`.
- Profile callback settings include URL, authentication, optional `WITH_RESULT` payload and URL lock. Endpoint/sub-case values override Profile only when non-empty; unset exact fields inherit from the service endpoint, then Profile.
- Saved secrets and gateway values are masked in the UI. Do not copy placeholders, Vault refs or secret values into logs/tickets.

### Input validation and origin protection

`file_urls[].file_id`, when supplied, must be a string. `file_urls[].total_chunks`, when supplied, must be an integer ≥ 1; invalid values receive HTTP 400 while valid existing requests are unchanged. For credentialed downloads, the deployment must allow the file origin in `ALLOWED_FILE_AUTH_ORIGINS`; otherwise DUGate rejects the request before attaching credentials.
