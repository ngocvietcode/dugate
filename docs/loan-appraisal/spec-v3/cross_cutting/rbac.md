# RBAC — Phân quyền luồng Loan Dossier

> **Nền v2 (D-32, 2026-10-16):** chỉ áp dụng phần được liệt kê ở [cross_cutting/v2_integration.md](v2_integration.md) §1; phần gắn với W1/W2 không làm.

## 1. Hiện trạng (đã đọc trong repo)

- `POST /api/v1/docs/workflows` chỉ xác thực bằng `x-api-key`; Profile phải bật endpoint (`loadProfileEndpoint`, `enabled`), nếu không trả 403.
- `GET /api/v1/operations/{id}`: API key chỉ đọc Operation của Profile đó; người dùng phiên (không phải ADMIN) chỉ đọc Operation do mình tạo (`createdByUserId` lấy từ `x-user-id` mà middleware gắn).
- Tham số ProfileEndpoint có `isLocked`; `mergeParameters` không cho client ghi đè tham số đã khóa. Sửa tham số theo `endpoint:manage` (loại `configurable`, OPS mặc định có).

## 2. Rule

| ID | Rule |
|---|---|
| **R-R01** | Không thêm capability, role hay route. Quyền chạy W1/W2 = API key của Profile (route có sẵn) |
| **R-R02** | ADMIN (hoặc người có `endpoint:manage`) bật `workflows:loan-dossier-ocr` và `workflows:loan-dossier-check` cho từng Profile. Chưa bật → route trả 403 `Endpoint Not Configured` |
| **R-R03** | Đọc kết quả theo quy tắc sẵn có của `GET /api/v1/operations/{id}` (§1). Spec không nới quy tắc này |
| **R-R04** | `auto_check_enabled`, `auto_check_min_confidence` khai báo `defaultLocked: true` (T-RUN-05): client không gửi được; sửa ở trang Profile có sẵn. Người sửa được là người có `endpoint:manage`, **rộng hơn** bản cũ (chỉ ADMIN); xem OQ-22 |
| **R-R05** | Giao diện DUGate (`/loan-dossier`) không có capability riêng; người dùng nhập API key của Profile, giữ trong ref của hook như `app/loan-appraisal-v2` (không `localStorage`, không URL). Quyền thật do API key quyết. Mở lại bằng `?op=`/`?check=` dùng phiên đăng nhập: chỉ người đã tạo Operation hoặc ADMIN đọc được (R-R03) |
| **R-R06** | RM và CO là vai trò nghiệp vụ của **hệ thống gọi**. DUGate không phân biệt RM/CO, không có thao tác "CO quyết định giá trị" hay "xác nhận bảng OCR↔SL" (S6-R12) |

## 3. Task

### T-NAV-01 — Điều hướng
- Depends: —
- Files: `lib/navigation/registry.ts`, `tests/loan-dossier/navigation.test.ts`
- Refs: R-R05
- Làm: Thêm mục `/loan-dossier` ("Thẩm định hồ sơ vay HKD", `group: 'workflows'`, `status: 'beta'`, không `capability`) cạnh mục `/loan-appraisal`. Không xóa mục cũ.
- DoD:
  - test: mục mới tồn tại, `group = 'workflows'`, không có `capability`
  - test: mục `/loan-appraisal` vẫn còn
- Verify: `npx jest tests/loan-dossier/navigation.test.ts`
