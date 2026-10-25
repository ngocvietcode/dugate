# Điểm lệch hồ sơ SYN-HKD-0005
Ngày tham chiếu 2026-10-23 · chỉ dựa trên JSON, chưa đọc ảnh · 5 điểm cần xử lý (S3 5) · theo loại: A 3, A|B 2 · 7 biến thể không phải lỗi (N)

| X | Mức | Loại | Field | Nội dung | Giá trị chuẩn | Trạng thái | Nhánh 2 |
|---|---|---|---|---|---|---|---|
| X01 | S3 | A A5 | F49 | A1.land_use_term_raw: D9 trích ra nhiều ứng viên ⟨Đất ở tại nông thôn: Lâu dài | Lâu dài⟩ — chọn «Đất ở tại nông thôn: Lâu dài» theo các ứng viên chứa nhau, lấy bản đầy đủ nhất | Đất ở tại nông thôn: Lâu dài | chốt theo quy tắc |  |
| X02 | S3 | A|B B4 | F7 | P1.id_issue_place: D7 ghi «Cục Cảnh sát QLHC về TTXH», giá trị chuẩn «BỘ CÔNG AN» — thông tin giấy tờ trên chứng từ không khớp giấy tờ gốc | BỘ CÔNG AN | chờ xác nhận (cần ảnh hoặc người) |  |
| X03 | S3 | A A4 | F7 | P1.id_issue_place: D1 trích ra nhiều ứng viên ⟨BỘ CÔNG AN | CỤC CẢNH SÁT QUẢN LÝ HÀNH CHÍNH VỀ TRẬT TỰ XÃ HỘI⟩ — chọn «BỘ CÔNG AN» theo thẩm quyền (in trên mặt thẻ) | BỘ CÔNG AN | chốt theo quy tắc |  |
| X04 | S3 | A A4 | F8 | P1.id_type: D2 ghi «CCCD», giá trị chuẩn «CAN_CUOC» — giấy tờ nhà nước bậc 1 ghi khác: nghi lỗi bóc tách | CAN_CUOC | chốt theo quy tắc |  |
| X05 | S3 | A|B B4 | F8 | P1.id_type: D6,D8 ghi «CCCD», giá trị chuẩn «CAN_CUOC» — thông tin giấy tờ trên chứng từ không khớp giấy tờ gốc | CAN_CUOC | chờ xác nhận (cần ảnh hoặc người) |  |

## Biến thể không phải lỗi (N, tự đóng)

- X06 F17: P2.id_issue_date: D5 ghi «2020-11-11», giá trị chuẩn «2023-05-10» — giá trị cũ trên chứng từ thuộc thời kỳ trước
- X07 F18: P2.permanent_address: 2 cách viết cùng giá trị — bằng nhau sau chuẩn hoá
- X08 F41: A1.identifiers.certificate_number: 2 cách viết cùng giá trị — bằng nhau sau chuẩn hoá
- X09 F5: P1.id_issue_date: D5 ghi «2021-03-01», giá trị chuẩn «2024-08-20» — giá trị cũ trên chứng từ thuộc thời kỳ trước
- X10 F6: P1.permanent_address: 2 cách viết cùng giá trị — bằng nhau sau chuẩn hoá
- X11 F7: P1.id_issue_place: D5 ghi «Cục Cảnh sát quản lý hành chính về trật tự xã hội», giá trị chuẩn «BỘ CÔNG AN» — giá trị cũ trên chứng từ thuộc thời kỳ trước
- X12 F8: P1.id_type: D5 ghi «CCCD», giá trị chuẩn «CAN_CUOC» — giá trị cũ trên chứng từ thuộc thời kỳ trước
