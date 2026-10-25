# dugate Constitution

Luật bất biến cho mọi thay đổi — người hay AI agent. Spec mâu thuẫn với constitution thì constitution thắng; muốn đổi luật phải có ADR.

Trạng thái: **DRAFT** cùng ARCHITECTURE_V5. Các điều đánh dấu *(v5)* áp dụng cho code mới viết trên Temporal; code BullMQ cũ được giữ nguyên tới khi chuyển đổi.

## I. Dữ liệu & bảo mật
1. Không commit secret, key, mật khẩu, hay giá trị mặc định dùng được ở production (kể cả trong `docker-compose.yml`, seed, test fixtures).
2. Không log nội dung tài liệu khách hàng, raw response LLM, hay PII (CCCD, số tài khoản, SĐT, email) ở mức INFO trở lên. Log ID, hash, độ dài.
3. Mọi endpoint thao tác trên một operation phải kiểm tra operation thuộc phạm vi của caller (apiKey/user/profile) trước khi đọc hoặc ghi.
4. Mọi lời gọi HTTP ra ngoài đi qua `http-client` có SSRF guard; không gọi `fetch` trực tiếp tới URL do người dùng cung cấp.
5. Không tắt kiểm tra TLS (`NODE_TLS_REJECT_UNAUTHORIZED=0`, `rejectUnauthorized: false`) trong code chạy production.
6. *(v5)* Bytes tài liệu (PDF/ảnh) không đi vào payload Temporal; chỉ truyền tham chiếu (URL ECM / mã Operation của Core). Dữ liệu trích xuất có cấu trúc (đầu ra DU, `lac.json`) được phép đi trong payload khi < 1 MB. **Mọi payload luôn qua Payload Codec AES-256-GCM** (`apps/src/platform/codec.ts`, `lac/codec.py`), khoá từ Vault/KMS, có xoay vòng.

## II. Kiểm soát nghiệp vụ
7. Người duyệt (checker) phải khác người tạo/sửa (maker) — kiểm tra ở server, không chỉ ở UI.
8. Mọi hành động thay đổi trạng thái nghiệp vụ hoặc cấu hình (duyệt, sửa dữ liệu trích xuất, đổi prompt/connector/profile) ghi một `AuditEvent` (ai, gì, đối tượng, trước/sau, lúc nào, correlationId). Audit là append-only.
9. Tiền tệ/chi phí dùng kiểu số thập phân chính xác (`numeric`), không dùng float cho dữ liệu mới.

## II-b. Phân tầng Core / Apps *(ADR-0002)*
- L1. Phụ thuộc một chiều: hệ thống ngân hàng → Apps → Core → engines. Core không gọi/import Apps.
- L2. Apps (thư mục `apps/`, cùng repo) chỉ gọi Core qua API công khai (`core-client`); không import `lib/**` của Core, không đọc DB của Core, không gọi connector/engine trực tiếp.
- L3. Core không chứa khái niệm nghiệp vụ (khoản vay, L/C, giải ngân…). Năng lực mới thêm vào Core phải dùng được cho mọi client.
- L4. Apps không sở hữu master data, không ra quyết định cuối, không ghi vào hệ thống nguồn của ngân hàng. Dữ liệu nghiệp vụ **chỉ** nhận qua `context` của request — App không gọi hệ thống ngân hàng để lấy dữ liệu; thiếu dữ liệu thì từ chối ở bước validate.
- L5. Mọi App tuân Workflow Service Contract chung; mọi finding phải có evidence trỏ về tài liệu.

## III. Orchestration *(v5)*
10. Code trong thư mục workflow phải deterministic: không I/O, không `Date.now()`/`Math.random()`/`setTimeout` gốc, không import `db`, `fs`, `fetch`, SDK bên ngoài. Side effect đặt trong activity.
11. Activity phải idempotent (an toàn khi Temporal retry): dùng idempotency key theo `workflowId + activityId` khi gọi hệ thống ngoài có side effect.
12. Mọi activity khai báo `startToCloseTimeout` và retry policy; lỗi validation/4xx là non-retryable.
13. Thay đổi logic workflow đã deploy phải pass replay test; thay đổi không tương thích dùng `patched()`/worker versioning — không sửa trực tiếp nhánh code mà workflow đang chạy dở có thể đi qua.
14. Cấu hình (pipeline steps, prompt version, connector) được resolve **một lần** khi start và truyền vào input workflow; workflow không đọc cấu hình động giữa chừng.

## IV. AI
- AI-0. Mọi lời gọi LLM đi qua VPBank AIHub bằng `ExternalApiConnection` của Core (ADR-0003); không thêm SDK/HTTP gọi trực tiếp nhà cung cấp LLM.
15. Mỗi lời gọi AI lưu: connector, model, prompt version, hash input/output, token, chi phí.
16. Prompt mặc định nằm trong file `*prompts.ts` dạng hàm thuần, có unit test; thay đổi prompt dùng cho production cần eval trên golden set (khi bộ eval đã có).
17. Kết quả AI không tự động là quyết định cuối với nghiệp vụ tín dụng/thanh toán — phải có điểm HITL hoặc quy tắc kiểm tra xác định được mô tả trong spec.

## V. Quy trình phát triển
18. Mỗi feature có `specs/NNN-<slug>/spec.md` → `plan.md` → `tasks.md`. Không implement khi spec còn câu hỏi Critical chưa trả lời (`/clarify`).
19. Mỗi task nhỏ, có tiêu chí kiểm chứng; `/implement` chỉ làm đúng một task.
20. Thay đổi phải kèm test chứng minh (bug fix: test tái hiện bug trước). `npm run test` và typecheck phải xanh trước khi commit.
21. Thay đổi bề mặt (surgical): không refactor/format code không liên quan; dead code phát hiện được thì ghi chú, không tự xóa.
22. Quyết định kiến trúc mới → ADR trong `docs/adr/`. Không tự ý thêm dependency lớn hoặc đổi công nghệ đã có ADR.
23. Tài liệu agent (`CLAUDE.md`, constitution, ADR) phải đúng với code; ai làm nó lệch thì sửa trong cùng thay đổi.
