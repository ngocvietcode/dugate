# Hướng dẫn Core API — xử lý tài liệu qua link CSP

> **Mục đích:** Hướng dẫn hệ thống nguồn (IDP/CSP/WorkDrive) gửi **link tải file** thay vì upload file trực tiếp vào DUGate.
>
> **Core endpoint:** `POST /api/v1/docs/workflows`  
> **Theo dõi kết quả:** `GET /api/v1/operations/{operationId}`  
> **Cập nhật theo code hiện tại:** 10/09/2026

## 1. Luồng tích hợp

```text
Hệ thống nguồn tạo URL CSP
  → POST /api/v1/docs/workflows (file_urls)
  → DUGate trả 202 + operationId
  → Worker tải file từ CSP, kiểm tra an toàn URL, lưu file và chạy workflow
  → Client nhận kết quả qua webhook hoặc poll operation
```

`202 Accepted` chỉ xác nhận DUGate đã nhận và xếp hàng yêu cầu. Việc tải link CSP và xử lý tài liệu diễn ra bất đồng bộ trong worker. Vì vậy, cần chờ webhook hoặc poll đến khi `done: true` mới kết luận URL/token/file hợp lệ.

## 2. Điều kiện trước khi gọi

1. Admin đã cấp `x-api-key` và bật workflow cần dùng cho Profile tương ứng.
2. Chọn giá trị `process` là workflow đã đăng ký, ví dụ `payment-account-management` hoặc `payroll-verify`.
3. Link CSP phải là URL `http` hoặc `https` mà worker DUGate truy cập được.
4. Nếu CSP yêu cầu xác thực, **khuyến nghị Admin cấu hình file URL authentication trong Profile → Tích hợp**. Khi đó client chỉ gửi URL, không truyền secret CSP.
5. Nếu dùng callback, `callback_url` là tên field ưu tiên. `webhook_url` vẫn được hỗ trợ tương thích. Không gửi đồng thời hai field với hai URL khác nhau.

> Không đặt thủ công header `Content-Type` khi dùng `FormData` hoặc `curl -F`; client phải tự thêm `multipart/form-data` boundary.

## 3. Gửi yêu cầu

### Endpoint và header

```http
POST {BASE_URL}/api/v1/docs/workflows
x-api-key: {API_KEY}
x-correlation-id: {REQUEST_ID_TU_HE_THONG_NGUON}   // khuyến nghị
```

`X-IBM-Client-Id` chỉ thêm khi API Gateway của môi trường yêu cầu. Không ghi API key, token CSP hoặc client secret vào source code/log/ticket.

### Form field dùng chung

| Field | Kiểu | Bắt buộc | Mô tả |
|---|---|:---:|---|
| `process` | string | Có | Mã workflow đã được bật cho API key/Profile. |
| `file_urls` | JSON string | Có* | Mảng URL file, tối đa 20 phần tử. |
| `metadata` | JSON string | Tùy workflow | Tham số nghiệp vụ của workflow. |
| `callback_url` | URL | Không | URL nhận callback khi xử lý xong; field khuyến nghị cho tích hợp mới. |
| `webhook_url` | URL | Không | Alias tương thích của `callback_url`. |
| `allowed_extensions` | string | Không | Danh sách đuôi file, ví dụ `.pdf,.jpg,.jpeg,.png`; Profile có thể ghi đè. |
| `file_url_auth` | JSON string | Không | Auth tạm thời cho URL file; chỉ dùng khi Admin chưa cấu hình auth trên Profile. |

\* Có thể upload file trực tiếp thay cho `file_urls`, nhưng tài liệu này chỉ áp dụng cho luồng link CSP.

### Cấu trúc `file_urls`

`file_urls` là **một chuỗi JSON**, không phải JSON body thuần:

```json
[
  {
    "url": "https://csp.example.vn/files/v1/.../content",
    "filename": "ho_so_mo_tai_khoan.pdf",
    "mime_type": "application/pdf",
    "file_id": "SOURCE-DOC-0001",
    "total_chunks": 1
  }
]
```

| Thuộc tính | Bắt buộc | Quy tắc |
|---|:---:|---|
| `url` | Có | URL hợp lệ, không rỗng. Chỉ `http`/`https`; không nhúng username/password trong URL. |
| `filename` | Không, khuyến nghị | Tên file có phần mở rộng. Nếu bỏ trống, DUGate suy ra từ `Content-Disposition` hoặc URL. |
| `mime_type` | Không | MIME kỳ vọng. Nếu response CSP có `Content-Type`, response đó được ưu tiên. |
| `file_id` | Không, khuyến nghị mạnh | Chuỗi định danh do hệ thống nguồn cấp; được giữ để đối chiếu/map kết quả theo tài liệu. |
| `total_chunks` | Không | Số nguyên `>= 1`. Dùng khi CSP hỗ trợ HTTP Range cho file lớn; `1` hoặc bỏ trống là tải một lần. |

## 4. Ví dụ cURL — link CSP, auth cấu hình sẵn trên Profile

Ví dụ dưới đây gọi workflow `payment-account-management`. Thay `process` và `metadata` theo workflow đã được cấp cho hệ thống của bạn.

```bash
curl --request POST "https://{HOST}/api/v1/docs/workflows" \
  --header "x-api-key: {API_KEY}" \
  --header "x-correlation-id: idp-case-20260910-001" \
  --form 'process=payment-account-management' \
  --form 'metadata={"mode":"open","stage":"e2e"}' \
  --form 'callback_url=https://idp.example.vn/api/dugate/callback' \
  --form 'file_urls=[
    {
      "url":"https://csp.example.vn/files/v1/cases/CASE-001/documents/DOC-001/content",
      "filename":"don_mo_tai_khoan.pdf",
      "mime_type":"application/pdf",
      "file_id":"CASE-001-DOC-001"
    },
    {
      "url":"https://csp.example.vn/files/v1/cases/CASE-001/documents/DOC-002/content",
      "filename":"cccd_mat_truoc.jpg",
      "mime_type":"image/jpeg",
      "file_id":"CASE-001-DOC-002"
    }
  ]'
```

Với `payment-account-management`, `metadata.mode` bắt buộc là `open` hoặc `update`; `stage` có thể là `classification`, `extraction` hoặc `e2e` (mặc định `e2e`). Với `payroll-verify`, dùng `process=payroll-verify` và gửi đúng bộ file/profile đã được cấu hình cho workflow đó.

## 5. CSP cần OAuth2 nhưng Profile chưa cấu hình

Đây chỉ là phương án tương thích/tạm thời. Cách an toàn cho production là lưu credential ở Profile để secret không đi qua request từ hệ thống nguồn.

```bash
curl --request POST "https://{HOST}/api/v1/docs/workflows" \
  --header "x-api-key: {API_KEY}" \
  --form 'process=payroll-verify' \
  --form 'file_urls=[{"url":"https://csp.example.vn/files/v1/.../content","filename":"bang_luong.pdf","file_id":"PAYROLL-001"}]' \
  --form 'file_url_auth={
    "type":"csp_oauth2",
    "token_url":"https://csp.example.vn/auth/v1/csp/token",
    "client_id":"{CSP_CLIENT_ID}",
    "client_secret":"{CSP_CLIENT_SECRET}"
  }'
```

Độ ưu tiên credential: cấu hình endpoint của Profile → cấu hình cấp Profile/API key → tham số CSP cũ trong Profile → `file_url_auth` trong request. Vì vậy request không thể ghi đè credential đã được Admin cấu hình.

Không gửi `{ "type": "none" }` trong `file_url_auth`: route hiện tại xem đây là shape không hợp lệ. Nếu file công khai, chỉ cần **bỏ hẳn field** `file_url_auth`.

## 6. Response ban đầu và lấy operation ID

Khi request hợp lệ, API trả `HTTP 202`:

```json
{
  "name": "operations/4f21bba8-0000-4000-8000-123456789abc",
  "done": false,
  "metadata": {
    "state": "RUNNING",
    "workflow": "payment-account-management",
    "progress_percent": 0,
    "progress_message": "Initializing workflow..."
  }
}
```

Response cũng có hai header:

```http
X-Operation-ID: 4f21bba8-0000-4000-8000-123456789abc
Operation-Location: /api/v1/operations/4f21bba8-0000-4000-8000-123456789abc
```

Lưu `operationId`, `x-correlation-id` và thời điểm gọi để hỗ trợ tra soát.

## 7. Poll trạng thái/kết quả

Gọi bằng **cùng API key/Profile** đã tạo operation:

```bash
curl --request GET "https://{HOST}/api/v1/operations/{OPERATION_ID}" \
  --header "x-api-key: {API_KEY}"
```

Poll theo backoff (ví dụ 2s, 4s, 8s, tối đa 15–30s), dừng khi `done: true`.

### Đang xử lý

```json
{
  "name": "operations/{OPERATION_ID}",
  "done": false,
  "metadata": {
    "state": "RUNNING",
    "progress_percent": 45,
    "progress_message": "..."
  }
}
```

### Thành công

```json
{
  "name": "operations/{OPERATION_ID}",
  "done": true,
  "metadata": { "state": "SUCCEEDED", "progress_percent": 100 },
  "result": {
    "output_format": "json",
    "extracted_data": { "...": "payload nghiệp vụ theo workflow" }
  }
}
```

Đọc payload nghiệp vụ tại `result.extracted_data`. Hình dạng chi tiết phụ thuộc `process` và `metadata`; tham khảo tài liệu workflow tương ứng.

### Thất bại

```json
{
  "name": "operations/{OPERATION_ID}",
  "done": true,
  "metadata": { "state": "FAILED" },
  "error": {
    "code": "FILE_URL_DOWNLOAD_FAILED",
    "message": "...",
    "failed_step": "..."
  }
}
```

Khi lỗi sau `202`, không tự động gửi lại hàng loạt. Trước tiên kiểm tra `operationId`, `x-correlation-id`, URL/token CSP và log callback/poll để tránh xử lý trùng hồ sơ.

## 8. Callback

Nếu gửi `callback_url`/`webhook_url` hợp lệ hoặc Admin cấu hình callback cho Profile, DUGate sẽ gửi kết quả khi hoàn tất. Hệ thống nguồn nên:

- trả HTTP `2xx` sau khi nhận và lưu payload thành công;
- xử lý idempotent theo `operationId`/`request_id` vì callback có thể được gửi lại;
- vẫn giữ cơ chế poll làm fallback khi callback không đến;
- xác thực callback theo cơ chế được Admin thống nhất cho môi trường triển khai.

## 9. Quy tắc bảo mật và giới hạn URL CSP

Khi worker tải file, DUGate thực hiện các kiểm tra sau:

- chỉ chấp nhận `http`/`https`;
- chặn `localhost`, IP private/reserved và hostname DNS phân giải tới private/reserved IP, trừ hostname được Admin cho phép rõ ràng trong `ALLOWED_PRIVATE_HOSTS`;
- kiểm tra mọi URL redirect, tối đa 5 redirect;
- chặn redirect khác origin khi credentialed download đang bị giới hạn origin;
- nếu đặt `ALLOWED_FILE_AUTH_ORIGINS`, chỉ gửi credential tới **đúng origin** được allowlist;
- kiểm tra phần mở rộng/MIME, giới hạn dung lượng và timeout khi tải.

Do đó link CSP phải là link mà server DUGate thực sự truy cập được, không phải link chỉ mở được từ trình duyệt người dùng/VPN riêng. Nếu CSP nằm trong mạng private, Admin cần cấu hình network và allowlist hostname phù hợp; không dùng IP nội bộ trực tiếp trong `file_urls`.

## 10. Lỗi thường gặp

| Thời điểm | HTTP/trạng thái | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|---|
| Submit | `400` | Thiếu `process`; `file_urls` không phải JSON array; URL sai format; không có file nào | Kiểm tra field multipart và chuỗi JSON của `file_urls`. |
| Submit | `401` | Thiếu/sai/revoked `x-api-key` | Cấp lại key hoặc kiểm tra môi trường/gateway. |
| Submit | `403` | API key không active; workflow chưa được cấu hình/bật trong Profile | Admin bật endpoint `workflows:{process}` cho Profile. |
| Submit | `404` | `process` không có trong registry | Dùng mã workflow đã được DUGate đăng ký. |
| Submit | `503` | Queue/worker group quá tải hoặc không xác định được queue | Retry có backoff theo `Retry-After`; không đổi request ID một cách tùy tiện. |
| Poll sau `202` | `FAILED` | CSP trả 401/403, token hết hạn, DNS/network lỗi, URL bị SSRF policy chặn, file sai định dạng/quá dung lượng | Đọc `error`, kiểm tra URL CSP và cấu hình credential/origin/Profile. |
| Poll | `403` | API key khác Profile tạo operation | Poll bằng đúng API key/Profile ban đầu. |

## 11. Checklist triển khai

- [ ] Workflow `process` đã được Admin enable cho API key/Profile.
- [ ] URL CSP dùng `https`, có thể truy cập từ worker DUGate và không trỏ IP private.
- [ ] Mỗi file có `file_id` duy nhất để map kết quả.
- [ ] Credential CSP được lưu tại Profile; không truyền secret từ client production.
- [ ] Có `x-correlation-id` duy nhất cho mỗi yêu cầu nghiệp vụ.
- [ ] Lưu `operationId` từ response `202`.
- [ ] Có callback receiver idempotent hoặc cơ chế poll đến `done: true`.
- [ ] Không kết luận thành công chỉ dựa trên `202`.

## 12. Tài liệu liên quan

- `docs/IDP-PAYMENT-ACCOUNT-MANAGEMENT-API-GUIDE.md`: contract nghiệp vụ Payment Account Management.
- `docs/IDP-PAYROLL-VERIFY-API-GUIDE.md`: contract nghiệp vụ Payroll Verify.
- Source contract: `app/api/v1/docs/workflows/route.ts`, `lib/pipelines/submit.ts`, `lib/file-url-downloader.ts`, `app/api/v1/operations/[id]/route.ts`.
