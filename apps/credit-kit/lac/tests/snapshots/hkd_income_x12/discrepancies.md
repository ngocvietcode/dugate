# Điểm lệch hồ sơ SYN-HKD-0003
Ngày tham chiếu 2026-10-23 · chỉ dựa trên JSON, chưa đọc ảnh · 1 điểm cần xử lý (S2 1) · theo loại: C 1 · 7 biến thể không phải lỗi (N)

| X | Mức | Loại | Field | Nội dung | Giá trị chuẩn | Trạng thái | Nhánh 2 |
|---|---|---|---|---|---|---|---|
| X01 | S2 | C C1 | F65, F37 | Thu nhập: đơn vay 300.000.000/MONTHLY (= 3.600.000.000/năm), bảng kê lợi nhuận 300.000.000/năm — lệch 12 lần (đúng hệ số 12: có thể là lỗi bóc tách kỳ (A3); chưa có ảnh nên giữ C) | 300.000.000/năm (giá trị thận trọng, bảng kê đứng trước đơn vay) | chờ xác nhận (cần ảnh hoặc người) | có |

## Biến thể không phải lỗi (N, tự đóng)

- X02 F10: P1.id_issue_place: D5 ghi «Cục Cảnh sát quản lý hành chính về trật tự xã hội», giá trị chuẩn «BỘ CÔNG AN» — giá trị cũ trên chứng từ thuộc thời kỳ trước
- X03 F17: P2.id_issue_date: D5 ghi «2020-11-11», giá trị chuẩn «2023-05-10» — giá trị cũ trên chứng từ thuộc thời kỳ trước
- X04 F18: P2.permanent_address: 2 cách viết cùng giá trị — bằng nhau sau chuẩn hoá
- X05 F41: A1.identifiers.certificate_number: 2 cách viết cùng giá trị — bằng nhau sau chuẩn hoá
- X06 F5: P1.id_issue_date: D5 ghi «2021-03-01», giá trị chuẩn «2024-08-20» — giá trị cũ trên chứng từ thuộc thời kỳ trước
- X07 F6: P1.permanent_address: 2 cách viết cùng giá trị — bằng nhau sau chuẩn hoá
- X08 F7: P1.id_type: D5 ghi «CCCD», giá trị chuẩn «CAN_CUOC» — giá trị cũ trên chứng từ thuộc thời kỳ trước
