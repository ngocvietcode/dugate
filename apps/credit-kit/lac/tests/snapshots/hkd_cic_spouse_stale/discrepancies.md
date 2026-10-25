# Điểm lệch hồ sơ SYN-HKD-0002
Ngày tham chiếu 2026-10-23 · chỉ dựa trên JSON, chưa đọc ảnh · 3 điểm cần xử lý (S1 2, S3 1) · theo loại: A|B 1, B 2 · 7 biến thể không phải lỗi (N)

| X | Mức | Loại | Field | Nội dung | Giá trị chuẩn | Trạng thái | Nhánh 2 |
|---|---|---|---|---|---|---|---|
| X01 | S1 | B B6 | CIC@D11.subject | Báo cáo CIC D11 thuộc P2, không phải người vay P1; người vay chưa có CIC — liên kết trung bình: địa chỉ (đầy đủ) · loại P1: CMND cũ 012987654 ≠ 012345678 (mức liên kết trung bình: cần người xác nhận) | CIC gắn cho P2 | chờ xác nhận (liên kết danh tính mức trung bình) |  |
| X02 | S1 | B B5 | F75 | CIC D11 lập 2026-07-01, đã 114 ngày tính đến 2026-10-23 — vượt 30 ngày (tham số mặc định, chờ QLRR chốt) |  | chốt theo quy tắc |  |
| X03 | S3 | A|B A2 | CIC@D11.queried_institutions | 1 lượt tra cứu CIC có ngày sau ngày lập báo cáo 2026-07-01 — Ngân hàng Mẫu 2026-12-03 |  | chờ xác nhận (cần ảnh hoặc người) |  |

## Biến thể không phải lỗi (N, tự đóng)

- X04 F10: P1.id_issue_place: D5 ghi «Cục Cảnh sát quản lý hành chính về trật tự xã hội», giá trị chuẩn «BỘ CÔNG AN» — giá trị cũ trên chứng từ thuộc thời kỳ trước
- X05 F17: P2.id_issue_date: D5 ghi «2020-11-11», giá trị chuẩn «2023-05-10» — giá trị cũ trên chứng từ thuộc thời kỳ trước
- X06 F18: P2.permanent_address: 2 cách viết cùng giá trị — bằng nhau sau chuẩn hoá
- X07 F42: A1.identifiers.certificate_number: 2 cách viết cùng giá trị — bằng nhau sau chuẩn hoá
- X08 F5: P1.id_issue_date: D5 ghi «2021-03-01», giá trị chuẩn «2024-08-20» — giá trị cũ trên chứng từ thuộc thời kỳ trước
- X09 F6: P1.permanent_address: 2 cách viết cùng giá trị — bằng nhau sau chuẩn hoá
- X10 F7: P1.id_type: D5 ghi «CCCD», giá trị chuẩn «CAN_CUOC» — giá trị cũ trên chứng từ thuộc thời kỳ trước
