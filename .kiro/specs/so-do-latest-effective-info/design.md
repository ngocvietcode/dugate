# Design: Sổ đỏ - thông tin hiệu lực mới nhất

> Thiết kế viết từ yêu cầu nghiệp vụ, chưa đối chiếu code. Dev/Agent khảo sát code và điền mục đầu tiên trước khi sửa.

## Kết quả khảo sát (dev điền)
- Vị trí trích xuất Sổ đỏ (prompt/extractor/schema): _TBD_
- Nội dung US1 hiện tại và nơi lưu: _TBD_
- Cách tài liệu nhiều trang được đưa vào mô hình (toàn bộ hay trang đầu): _TBD_

## Hướng thiết kế
1. Trích xuất theo hai giai đoạn:
   - Giai đoạn A: đọc thông tin gốc (thường ở trang đầu).
   - Giai đoạn B: quét toàn bộ trang, trích danh sách biến động: loại, ngày, nội dung thay đổi, trang nguồn.
2. Áp dụng biến động lên dữ liệu gốc theo thứ tự thời gian để ra giá trị hiệu lực. Nếu thiếu ngày, dùng thứ tự xuất hiện trong tài liệu và gắn cờ độ tin cậy thấp.
3. Schema đầu ra mỗi trường: `value`, `source_page`, `change_type`, `is_updated`, `needs_review`.
4. Đảm bảo toàn bộ trang được đưa vào xử lý, kể cả tài liệu dài (chia đoạn nếu cần, không cắt bỏ trang giữa).
5. Cập nhật US1 với các yêu cầu của spec này.

## Rủi ro
- Biến động viết tay hoặc chất lượng ảnh thấp dẫn đến đọc sai: dùng cờ `needs_review`.
- Chủ sở hữu thay đổi nhiều lần: cần giữ lịch sử để đối chiếu.

## Kiểm thử
- Bộ case thực tế từ CO (chưa có, đang chờ). Khi chưa có, dùng case tổng hợp cho từng loại biến động.
- Kiểm tra: không biến động, một biến động giữa tài liệu, nhiều biến động liên tiếp, biến động mâu thuẫn trang đầu, biến động không rõ ngày.
