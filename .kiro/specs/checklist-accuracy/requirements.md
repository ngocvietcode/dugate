# Requirements: Checklist hồ sơ chính xác

## Giới thiệu
AI yêu cầu một số chứng từ không phù hợp với hồ sơ thực tế, ví dụ Giấy đăng ký kinh doanh, Văn bản đồng ý thế chấp của đồng sở hữu. Nghi ngờ đang dùng bảng yêu cầu chứng từ chưa cập nhật mới nhất.

## Requirements

### Requirement 1: Yêu cầu chứng từ theo ngữ cảnh
**User Story:** Là người thẩm định, tôi muốn checklist chỉ yêu cầu chứng từ phù hợp với hồ sơ, để không bị cảnh báo sai.

#### Acceptance Criteria
1. WHEN khách hàng không phải pháp nhân/hộ kinh doanh THEN hệ thống SHALL NOT yêu cầu Giấy đăng ký kinh doanh (điều kiện chính xác do BA xác nhận).
2. WHEN tài sản thế chấp không có đồng sở hữu THEN hệ thống SHALL NOT yêu cầu Văn bản đồng ý thế chấp của đồng sở hữu.
3. WHEN hồ sơ thỏa điều kiện áp dụng của một chứng từ THEN hệ thống SHALL yêu cầu chứng từ đó.
4. Mỗi chứng từ trong bảng yêu cầu SHALL có điều kiện áp dụng được định nghĩa rõ.

### Requirement 2: Bảng yêu cầu chứng từ cập nhật
**User Story:** Là BA, tôi muốn bảng yêu cầu chứng từ có phiên bản, để biết hệ thống đang dùng bản nào.

#### Acceptance Criteria
1. Bảng yêu cầu chứng từ SHALL có phiên bản và ngày hiệu lực.
2. WHEN sinh checklist THEN hệ thống SHALL dùng phiên bản mới nhất đang hiệu lực.
3. WHEN BA cập nhật bảng THEN hệ thống SHALL áp dụng được mà không cần sửa logic (nếu điều kiện đã mô tả được bằng dữ liệu).

### Requirement 3: Rà soát các lỗi đã highlight
**User Story:** Là BA/dev, tôi muốn mỗi lỗi CO đã highlight có kết luận rõ ràng.

#### Acceptance Criteria
1. Mỗi lỗi đã highlight SHALL có dòng trong bảng rà soát với nguyên nhân và cách xử lý.
2. Nguyên nhân SHALL thuộc một trong: bảng yêu cầu cũ, điều kiện logic sai, dữ liệu đầu vào sai, không phải lỗi.
3. Sau khi sửa, hồ sơ gây lỗi SHALL được chạy lại và cho kết quả đúng.

## Bảng rà soát lỗi (BA điền từ danh sách CO highlight)
| Mã lỗi | Mô tả | Nguyên nhân | Cách xử lý | Trạng thái |
|---|---|---|---|---|
| | Yêu cầu Giấy đăng ký kinh doanh sai ngữ cảnh | | | |
| | Yêu cầu Văn bản đồng ý thế chấp của đồng sở hữu sai ngữ cảnh | | | |

## Câu hỏi mở
- Bản bảng yêu cầu chứng từ nào là bản chuẩn hiện hành? Ai là owner?
- Danh sách đầy đủ lỗi đã highlight ở đâu?
