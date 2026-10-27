# Requirements: Trích xuất thông tin CIC

## Giới thiệu
AI mới nhận diện nợ nhóm 2 trong 12 tháng, trong khi đặc tả yêu cầu lịch sử nợ xấu 5 năm. Mẫu CIC dùng khi xây dựng US và khi test có khác biệt.

## Requirements

### Requirement 1: Trích xuất theo trường, không theo biểu mẫu
**User Story:** Là người thẩm định, tôi muốn hệ thống đọc đúng thông tin CIC dù mẫu biểu khác nhau.

#### Acceptance Criteria
1. WHEN xử lý tài liệu CIC THEN hệ thống SHALL trích xuất dựa trên các trường thông tin cần lấy, không phụ thuộc cứng vào tên hoặc mã biểu mẫu.
2. WHEN gặp mẫu CIC khác nhau có cùng nội dung THEN hệ thống SHALL trả kết quả tương đương.
3. IF một trường không có trong tài liệu THEN hệ thống SHALL trả "không có dữ liệu" và SHALL NOT suy đoán.

### Requirement 2: Lịch sử nợ xấu 5 năm
**User Story:** Là người thẩm định, tôi muốn biết toàn bộ lịch sử nợ xấu trong 5 năm.

#### Acceptance Criteria
1. WHEN tài liệu CIC có khoản nợ xấu trong 5 năm THEN hệ thống SHALL nhận diện, không chỉ nợ nhóm 2 trong 12 tháng.
2. Với mỗi khoản nợ xấu, hệ thống SHALL trả: nhóm nợ, thời điểm, tổ chức tín dụng, số tiền (nếu có).
3. Hệ thống SHALL đánh dấu khoản nằm trong 12 tháng gần nhất và khoản nằm trong 5 năm.
4. Nhóm nợ tính là nợ xấu và mốc tính 5 năm SHALL theo định nghĩa CO xác nhận (xem Câu hỏi mở).

### Requirement 3: Đồng bộ logic giữa các US
**User Story:** Là BA, tôi muốn các US liên quan CIC dùng cùng một định nghĩa.

#### Acceptance Criteria
1. Danh sách US liên quan CIC SHALL được rà soát.
2. Các US SHALL dùng chung định nghĩa về nhóm nợ, thời hạn, mốc tính và điều kiện cảnh báo.
3. Sự khác biệt giữa US và hành vi hệ thống SHALL được ghi lại và xử lý.

## Câu hỏi mở (CO làm rõ)
- Nhóm nợ nào tính là nợ xấu cho lịch sử 5 năm?
- Mốc 5 năm tính từ ngày thẩm định hay ngày tra cứu CIC?
- CIC của những đối tượng nào được dùng (người vay, đồng vay, bảo lãnh, bên thế chấp)?
- Các mẫu CIC cần hỗ trợ (CO gửi lại mẫu dùng khi viết US và mẫu dùng khi test)?
