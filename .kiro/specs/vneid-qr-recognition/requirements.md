# Requirements: Tách riêng nhận diện VNeID/QR khỏi CCCD

## Giới thiệu
VNeID/QR hiện được nhận diện gộp chung với CCCD nên bị phân loại sai loại chứng từ. Cần tách thành loại chứng từ độc lập.

## Requirements

### Requirement 1: Loại chứng từ VNeID/QR độc lập
**User Story:** Là người thẩm định, tôi muốn hệ thống phân biệt VNeID/QR với CCCD, để hồ sơ được phân loại đúng loại chứng từ.

#### Acceptance Criteria
1. WHEN tài liệu đầu vào là ảnh/bản chụp CCCD THEN hệ thống SHALL phân loại là CCCD.
2. WHEN tài liệu đầu vào là ảnh/bản chụp VNeID hoặc mã QR định danh THEN hệ thống SHALL phân loại là VNeID/QR và SHALL NOT phân loại là CCCD.
3. WHEN hồ sơ chứa cả CCCD và VNeID/QR THEN hệ thống SHALL phân loại đúng từng tài liệu.

### Requirement 2: Xử lý ở các bước sau phân loại
**User Story:** Là người thẩm định, tôi muốn checklist và trích xuất xử lý VNeID/QR như một loại chứng từ riêng.

#### Acceptance Criteria
1. WHEN hiển thị checklist/kết quả THEN hệ thống SHALL hiển thị đúng tên loại chứng từ (CCCD hoặc VNeID/QR).
2. WHEN trích xuất thông tin từ VNeID/QR THEN hệ thống SHALL dùng bộ trường dành riêng cho VNeID/QR.
3. WHEN một yêu cầu đang chấp nhận CCCD làm giấy tờ tùy thân THEN hệ thống SHALL áp dụng quy tắc chấp nhận VNeID/QR đã được BA chốt (xem Câu hỏi mở).

## Câu hỏi mở (BA chốt)
- VNeID/QR có được chấp nhận thay CCCD trong checklist giấy tờ tùy thân không?
- Danh sách trường cần trích xuất từ VNeID/QR?
- Cung cấp bộ mẫu: CCCD, VNeID, QR, hồ sơ hỗn hợp.
