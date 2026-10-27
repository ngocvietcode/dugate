# Requirements: Trích xuất Sổ đỏ theo thông tin có hiệu lực mới nhất (bổ sung US1)

## Giới thiệu
Với Sổ đỏ có nhiều lần chuyển nhượng/điều chỉnh, AI đang lấy thông tin ở trang đầu thay vì thông tin có hiệu lực sau chỉnh sửa. Thông tin cập nhật có vị trí không cố định, có thể nằm giữa tài liệu, phát sinh từ chuyển nhượng, tặng cho, thừa kế...

## Requirements

### Requirement 1: Không mặc định lấy thông tin trang đầu
**User Story:** Là người thẩm định, tôi muốn hệ thống lấy thông tin Sổ đỏ còn hiệu lực sau các biến động, để kết quả phản ánh đúng hiện trạng.

#### Acceptance Criteria
1. WHEN xử lý Sổ đỏ THEN hệ thống SHALL quét toàn bộ các trang để tìm nội dung biến động (chuyển nhượng, tặng cho, thừa kế, điều chỉnh...).
2. WHEN nội dung biến động nằm ở bất kỳ trang nào THEN hệ thống SHALL nhận diện được, không phụ thuộc vị trí trang cố định.
3. WHEN không có biến động THEN hệ thống SHALL trả kết quả như hành vi hiện tại.

### Requirement 2: Xác định giá trị có hiệu lực
**User Story:** Là người thẩm định, tôi muốn mỗi trường thông tin là giá trị hiệu lực mới nhất.

#### Acceptance Criteria
1. WHEN có một hoặc nhiều biến động ảnh hưởng một trường THEN hệ thống SHALL trả giá trị có hiệu lực sau biến động cuối cùng theo thứ tự thời gian.
2. WHEN thông tin trang đầu mâu thuẫn với biến động THEN hệ thống SHALL dùng giá trị từ biến động mới nhất.
3. IF không xác định được thứ tự thời gian hoặc nội dung biến động không rõ THEN hệ thống SHALL gắn cờ cần kiểm tra thủ công và SHALL NOT trả giá trị đoán không cảnh báo.

### Requirement 3: Truy vết nguồn
**User Story:** Là người thẩm định, tôi muốn biết giá trị lấy từ đâu để kiểm chứng.

#### Acceptance Criteria
1. WHEN trả giá trị một trường THEN hệ thống SHALL kèm số trang nguồn và loại biến động (gốc, chuyển nhượng, tặng cho, thừa kế, điều chỉnh...).
2. WHEN giá trị đã thay đổi so với trang đầu THEN hệ thống SHALL thể hiện rõ giá trị đã được cập nhật.

## Phạm vi trường áp dụng (BA chốt)
Chủ sở hữu/người sử dụng, diện tích, mục đích sử dụng, thông tin thế chấp/hạn chế, các trường khác do BA bổ sung.

## Câu hỏi mở
- CO cung cấp case thực tế khi nào? Tối thiểu: chuyển nhượng, tặng cho, thừa kế, nhiều biến động liên tiếp.
- Trường nào bắt buộc áp dụng logic biến động?
- Có cần hiển thị lịch sử biến động không?
