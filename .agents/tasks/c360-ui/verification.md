# Kiểm chứng Customer 360 — D-113

Ngày: 2026-10-28 (Asia/Bangkok). Nhánh: `codex/c360-ui`.
Worktree: `D:\Projects\dugate-wt\c360-ui`.
Kế hoạch: `.agents/tasks/c360-ui/plan.md`.

## Phạm vi đã thực hiện

- Thêm `Decision360Card.tsx`: dải tóm tắt có điều kiện, danh sách cần chú ý theo thứ tự view-model (5 dòng đầu, phần còn lại trong Disclosure), bảng nguồn thu có dòng tổng và bảng hộ kinh doanh có chip chứng từ.
- `Customer360Panel.tsx` dùng lại `summary`, `claims` và gọi `buildDecision360` trong `useMemo`; badge đầu thẻ chỉ đếm danger/warning. Giữ khối khoản vay cũ cho kết quả không có `profile_360`; kết quả mới đưa chi tiết đơn vay vào Disclosure.
- Thêm hàm thuần `shouldOpenDetail` ở `customer360-view.ts`; chi tiết người mặc định thu gọn, chỉ mở sẵn khi có `alerts` hoặc `notes.warnings`.
- Thêm đúng một case trong `decision-360.test.ts`, kiểm cả cảnh báo trên người, cảnh báo đối chiếu, không cảnh báo và chỉ có thông tin xác nhận / biến thể.
- Không sửa `buildCustomer360`, `decision-360.ts`, backend, API, thư viện, secrets hoặc `worker.pam.js`; không thêm localStorage hay log dữ liệu.

## Kết quả lệnh

| Lệnh | Kết quả |
| --- | --- |
| `npx tsc --noEmit` | PASS, exit 0; không có chẩn đoán. |
| `npx jest tests/loan-appraisal-v2 --ci` | FAIL, exit 1; 25/27 suites pass, 299/301 tests pass, 2 tests fail, 0 snapshots; 37.831 giây. Case mới `shouldOpenDetail` pass. |
| `git diff --check` | PASS; không có lỗi whitespace. Git chỉ cảnh báo chuẩn hóa LF thành CRLF. |

Jest đã chạy đúng một lần theo yêu cầu kiểm tối thiểu. Runtime phát cảnh báo `--localstorage-file` không có đường dẫn hợp lệ; thay đổi này không sử dụng localStorage.

## Hai assertion cũ không còn phù hợp với UI theo kế hoạch

1. `tests/loan-appraisal-v2/customer360-detail.test.ts`, test `Customer360Panel (render) › thứ tự: Khoản vay → Tài sản → Người; có đủ chi tiết, không chỉ định danh`: assertion tại dòng 179 yêu cầu `Nhóm 1` và `HKD KIỀU ANH` xuất hiện ngay trong HTML ban đầu. Người trong fixture không có cảnh báo nên Disclosure nay đóng mặc định; cơ chế lazy hiện có chưa mount nội dung chi tiết. Jest dừng ở chuỗi thiếu `Nhóm 1`.
2. `tests/loan-appraisal-v2/claims-view.test.ts`, test `Customer360Panel + ClaimsPanel (render) › header gộp số cảnh báo của claim vào "điểm cần chú ý"`: assertion tại dòng 155 cấm chuỗi `điểm cần chú ý` trên toàn panel khi không có cảnh báo. Kế hoạch yêu cầu chính xác thông báo rỗng `Không có điểm cần chú ý`, nên assertion khớp thông báo này mặc dù badge header đã ẩn đúng.

Hai file test trên nằm ngoài danh sách được phép sửa. Giữ nguyên hành vi và thông báo đã yêu cầu; không thay assertion, không đổi UI để né kiểm tra. Đây là hai kiểm tra bị ảnh hưởng bởi thay đổi hành vi có chủ đích, không được báo là lỗi đã có từ trước.

## Rà soát và quyết định triển khai

- Reviewer độc lập phát hiện các dòng chi tiết đơn vay (`loan.rows`) còn chứa nguồn trả nợ, nợ hiện hữu, phương thức giải ngân / trả nợ, ân hạn, giá trị TSBĐ / LTV khai và thông tin lãi suất gốc. Giữ các dòng này trong Disclosure `Chi tiết đơn vay` cùng mục đích và thu nhập khai để không mất dữ liệu; phần tóm tắt vẫn chỉ dùng view-model có sẵn. Reviewer xác nhận đã xử lý, không còn phát hiện cần sửa.
- Bảng nguồn thu dùng bảng HTML có `tfoot` để dòng tổng luôn ở đúng cuối bảng và cột tiền; bảng hộ kinh doanh dùng `DataTable` hiện có. Không sửa UI kit.
- Không thiếu trường trong view-model. Không tạo ledger / artifact ngoài năm file được kế hoạch liệt kê. Quy tắc kiểm tối thiểu và phạm vi file của người dùng được ưu tiên so với quy trình skill tổng quát.
- Jest chạy trước bổ sung `loan.rows` vào Disclosure theo review; không chạy lại Jest. Typecheck được chạy lại sau bổ sung này. Chưa kiểm giao diện trực tiếp trong trình duyệt.
- Commit theo yêu cầu trên `codex/c360-ui`; không push, không merge.
