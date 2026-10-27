# Hướng dẫn cấu hình Multi-Connector Pipeline cho Admin

> Tài liệu này hướng dẫn Admin cách thêm, sắp xếp, và quản lý nhiều API Connector
> cho một Endpoint — **không cần sửa code, không cần redeploy.**

---

## Tổng quan kiến trúc

Mỗi Endpoint (VD: `extract:invoice`, `compare:diff`) mặc định gọi đến **một hoặc nhiều
API Connector** được định nghĩa sẵn trong code (`SERVICE_REGISTRY`).

Admin có thể **override** danh sách connector này ở 2 cấp:

| Cấp | Phạm vi | Lưu ở đâu | Ưu tiên |
|-----|---------|-----------|---------|
| **Global** | Áp dụng cho TẤT CẢ client | Bảng `EndpointConnectionConfig` | 🟡 Trung bình |
| **Per-Client** | Chỉ áp dụng cho 1 API Key cụ thể | Bảng `ProfileEndpoint.connectionsOverride` | 🔴 Cao nhất |
| **Code Default** | Fallback nếu không có config nào | File `registry.ts` | 🟢 Thấp nhất |

**Thứ tự ưu tiên:** Per-Client > Global > Code Default

---

## Bước 1: Tạo API Connector mới

### 1.1. Vào Admin UI → External API Connections → Thêm mới

Điền các trường bắt buộc:

| Trường | Mô tả | Ví dụ |
|--------|-------|-------|
| **Name** | Tên hiển thị | `Invoice Validator` |
| **Slug** | Mã unique (không dấu, dùng `-`) | `ext-invoice-validator` |
| **Endpoint URL** | URL của AI service | `https://ai.company.com/validate` |
| **HTTP Method** | Phương thức HTTP | `POST` |
| **Auth Type** | Loại xác thực | `API_KEY_HEADER` |
| **Auth Key Header** | Tên header chứa key | `x-api-key` |
| **Auth Secret** | Secret key | `sk-abc123...` |
| **Prompt Field Name** | Tên field gửi prompt | `query` |
| **File Field Name** | Tên field gửi file | `files` |
| **Default Prompt** | Prompt mặc định (xem mục 1.2) | *(xem bên dưới)* |
| **Response Content Path** | Đường dẫn lấy kết quả từ JSON response | `data.result` |
| **Timeout (giây)** | Thời gian chờ tối đa | `60` |
| **State** | Trạng thái | `ENABLED` |

### 1.2. Viết Default Prompt

Prompt hỗ trợ **biến động** (template variable) sử dụng cú pháp `{{tên_biến}}`.

#### Các biến có sẵn:

| Biến | Nguồn | Mô tả |
|------|-------|-------|
| `{{input_content}}` | **Tự động** (output bước trước) | Nội dung kết quả từ bước pipeline trước đó |
| `{{output_format}}` | Client gửi lên | Định dạng output mong muốn (json, md, html...) |
| `{{language}}` | Client gửi lên | Ngôn ngữ tài liệu |
| `{{fields}}` | Client gửi lên | Danh sách trường cần trích xuất |
| `{{schema}}` | Client gửi lên | JSON Schema bắt buộc |
| `{{business_rules}}` | Admin cấu hình (ProfileEndpoint) | Quy tắc nghiệp vụ |
| *(bất kỳ tên nào)* | Từ `variables` của pipeline step | Tham số tuỳ chỉnh |

#### Ví dụ prompt cho connector bước 2 (nhận output bước 1):

```
Bạn là chuyên gia kiểm tra hóa đơn. Hãy kiểm tra tính hợp lệ của dữ liệu hóa đơn sau:

{{input_content}}

Yêu cầu:
1. Kiểm tra các trường bắt buộc: seller_name, buyer_name, total_amount, tax
2. Kiểm tra MST có đúng định dạng không
3. Kiểm tra tổng tiền = sum(line_items) + tax

Trả về JSON:
{
  "valid": true/false,
  "errors": ["mô tả lỗi nếu có"],
  "warnings": ["cảnh báo nếu có"]
}
```

> **Lưu ý quan trọng:** Biến `{{input_content}}` sẽ được hệ thống **tự động thay thế**
> bằng output text/JSON từ bước pipeline ngay trước đó. Admin không cần cấu hình
> thêm bất kỳ mapping nào.

---

## Bước 2: Gắn Connector vào Endpoint

### 2.1. Override Global (cho tất cả client)

**Cách 1: Qua Admin UI** (sau khi triển khai Phương án A)

- Vào **Admin → Endpoint Connection Manager**
- Tìm endpoint cần sửa (VD: `extract:invoice`)
- Thêm connector mới vào danh sách, sắp xếp thứ tự
- Lưu

**Cách 2: Qua Database trực tiếp**

```sql
INSERT INTO "EndpointConnectionConfig" (id, "endpointSlug", connections, description, enabled)
VALUES (
  gen_random_uuid(),
  'extract:invoice',
  '["ext-data-extractor", "ext-invoice-validator"]',
  'Thêm bước validate hóa đơn sau extract',
  true
);
```

### 2.2. Override Per-Client (cho 1 API Key cụ thể)

```sql
-- Tìm API Key ID
SELECT id, name, prefix FROM "ApiKey" WHERE name = 'VPBank Production';

-- Tạo/cập nhật ProfileEndpoint
INSERT INTO "ProfileEndpoint" (id, "apiKeyId", "endpointSlug", "connectionsOverride", enabled)
VALUES (
  gen_random_uuid(),
  '<api-key-id>',
  'extract:invoice',
  '["ext-data-extractor", "ext-invoice-validator"]',
  true
)
ON CONFLICT ("apiKeyId", "endpointSlug")
DO UPDATE SET "connectionsOverride" = EXCLUDED."connectionsOverride";
```

---

## Cách Pipeline thực thi nhiều bước

### Quy tắc chaining tự động

```
┌─────────────────────────────────────────────────────────────┐
│  Bước 1 (index = 0)                                        │
│  ├─ Nhận: file gốc từ client (PDF, DOCX, ảnh...)           │
│  ├─ Gửi: file + prompt đến connector                       │
│  └─ Output: text/JSON → lưu vào currentText                │
│                                                             │
│  Bước 2 (index = 1)                                        │
│  ├─ Nhận: KHÔNG có file, chỉ có currentText từ bước 1      │
│  ├─ currentText được inject vào variables['input_content']  │
│  ├─ Prompt dùng {{input_content}} để nhận dữ liệu          │
│  └─ Output: text/JSON → lưu vào currentText                │
│                                                             │
│  Bước 3+ (tương tự bước 2)                                 │
│  ├─ Nhận: currentText từ bước ngay trước                    │
│  └─ ...                                                     │
└─────────────────────────────────────────────────────────────┘
```

### Quy tắc quan trọng

| Quy tắc | Chi tiết |
|---------|---------|
| **Chỉ bước 1 nhận file** | Các bước sau chỉ nhận text output từ bước trước |
| **Tự động chaining** | `input_content` được inject tự động, không cần config |
| **Prompt phải dùng `{{input_content}}`** | Connector bước 2+ **phải** có `{{input_content}}` trong prompt để nhận dữ liệu |
| **Tối đa 5 bước** | Pipeline giới hạn tối đa 5 connector steps |
| **Lỗi dừng pipeline** | Nếu 1 bước fail → toàn bộ pipeline dừng, không chạy bước sau |

---

## Ví dụ thực tế

### Ví dụ 1: Extract Invoice + Validate (2 bước)

```
Endpoint: extract:invoice
Connections: ["ext-data-extractor", "ext-invoice-validator"]

Bước 1 - ext-data-extractor:
  Input:  hoadon.pdf
  Output: {"seller": "Cty ABC", "total": 5000000, "tax": 500000}

Bước 2 - ext-invoice-validator:
  Input:  {{input_content}} = '{"seller": "Cty ABC", "total": 5000000, ...}'
  Output: {"valid": true, "errors": [], "warnings": ["tax_rate_unusual"]}
```

### Ví dụ 2: Compare Semantic với OCR trước (2 bước)

```
Endpoint: compare:semantic
Connections: ["ext-doc-layout", "ext-comparator"]

Bước 1 - ext-doc-layout:
  Input:  contract_v1.pdf, contract_v2.pdf
  Output: "Nội dung text đã OCR của 2 file..."

Bước 2 - ext-comparator:
  Input:  {{input_content}} = 'Nội dung text đã OCR...'
  Output: {"differences": [...], "summary": "Phát hiện 3 thay đổi chính..."}
```

### Ví dụ 3: Analyze Fact-Check (2 bước — đã có sẵn trong registry)

```
Endpoint: analyze:fact-check
Connections: ["ext-data-extractor", "ext-fact-verifier"]

Bước 1 - ext-data-extractor:
  Input:  baocao.pdf
  Output: {"claims": ["Doanh thu Q4 = 100 tỷ", "Tăng trưởng 20%"]}

Bước 2 - ext-fact-verifier:
  Input:  {{input_content}} = '{"claims": [...]}'
  Output: {"verified": 1, "disputed": 1, "details": [...]}
```

---

## Rollback & Troubleshooting

### Xoá override để quay về mặc định

```sql
-- Xoá global override
DELETE FROM "EndpointConnectionConfig" WHERE "endpointSlug" = 'extract:invoice';

-- Xoá per-client override
DELETE FROM "ProfileEndpoint"
WHERE "apiKeyId" = '<api-key-id>' AND "endpointSlug" = 'extract:invoice';
```

Sau khi xoá, hệ thống tự động fallback về `connections` mặc định trong code.

### Kiểm tra connector có tồn tại

```sql
-- Liệt kê tất cả connector đang ENABLED
SELECT slug, name, state FROM "ExternalApiConnection" WHERE state = 'ENABLED';
```

### Debug pipeline

Kiểm tra Operation log để xem pipeline chạy đúng bao nhiêu bước:

```sql
SELECT id, "endpointSlug", state, "pipelineJson", "stepsResultJson", "errorMessage"
FROM "Operation"
WHERE "endpointSlug" = 'extract:invoice'
ORDER BY "createdAt" DESC
LIMIT 5;
```

---

## Checklist trước khi cấu hình

- [ ] Connector mới đã được tạo và ở trạng thái `ENABLED`
- [ ] Đã test connector mới riêng lẻ (gọi trực tiếp API)
- [ ] Prompt của connector bước 2+ có chứa `{{input_content}}`
- [ ] `Response Content Path` đúng với cấu trúc JSON response
- [ ] Thứ tự connector trong mảng `connections` đúng logic
- [ ] Đã test end-to-end với file thật trước khi áp dụng cho client
