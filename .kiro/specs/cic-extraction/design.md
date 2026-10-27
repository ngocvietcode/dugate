# Design: Trích xuất CIC

> Thiết kế viết từ yêu cầu nghiệp vụ, chưa đối chiếu code. Dev/Agent khảo sát code và điền mục đầu tiên trước khi sửa.

## Kết quả khảo sát (dev điền)
- Vị trí trích xuất CIC (prompt/extractor/schema): _TBD_
- Chỗ nào đang phụ thuộc tên/mã biểu mẫu: _TBD_
- Chỗ nào đang giới hạn 12 tháng/nhóm 2: _TBD_
- Danh sách US liên quan CIC: _TBD_

## Hướng thiết kế
1. Định nghĩa schema theo trường, độc lập biểu mẫu:
   - thông tin đối tượng tra cứu
   - danh sách khoản vay/nợ: tổ chức tín dụng, nhóm nợ, thời điểm, số tiền
   - tổng hợp nợ xấu: danh sách khoản nợ xấu trong 5 năm, cờ `within_12_months`, `within_5_years`
2. Trích xuất dựa vào nội dung/nhãn trường, không rẽ nhánh theo tên hoặc mã biểu mẫu. Mỗi mẫu CIC ánh xạ nhãn trường về schema chung.
3. Tính cờ thời gian từ mốc tham chiếu CO xác nhận (tham số cấu hình, không nhúng cứng).
4. Bảng định nghĩa thống nhất (nhóm nợ, thời hạn, mốc, điều kiện cảnh báo) dùng chung cho mọi US liên quan.
5. Trường thiếu trả `null`/"không có dữ liệu" kèm lý do, không đoán.

## Rủi ro
- Mẫu CIC chưa đủ: thiết kế ánh xạ nhãn phải dễ mở rộng khi có mẫu mới.
- Dữ liệu dạng bảng nhiều dòng, dễ sai khi OCR: cần kiểm thử với mẫu thực tế.

## Kiểm thử
- Mẫu CIC cũ và mới từ CO: mọi trường cần thiết được trích xuất.
- Hồ sơ có nợ nhóm 2+ cách 2-5 năm: được nhận diện.
- Đổi tên/mã biểu mẫu: kết quả không đổi.
