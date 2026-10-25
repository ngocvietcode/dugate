# Điểm lệch hồ sơ SYN-HKD-0006
Ngày tham chiếu 2026-10-23 · chỉ dựa trên JSON, chưa đọc ảnh · 8 điểm cần xử lý (S1 2, S2 5, S3 1) · theo loại: A|B 3, B 3, C 2 · 5 biến thể không phải lỗi (N)

| X | Mức | Loại | Field | Nội dung | Giá trị chuẩn | Trạng thái | Nhánh 2 |
|---|---|---|---|---|---|---|---|
| X01 | S1 | A|B B2 | D7.signature | D7 income_statement: không thấy chữ ký khách hàng, ngày lập/ký — có thể chứng từ thiếu thật (B2) hoặc bản trích xuất bỏ sót (A5) (thiếu chữ ký bên vay là mức chặn; hạ mức nếu ảnh có chữ ký) |  | chờ xác nhận (cần ảnh hoặc người) |  |
| X02 | S1 | B B6 | checklist.collateral_valuation_certificate | Thiếu chứng từ bắt buộc: collateral_valuation_certificate |  | chốt theo quy tắc |  |
| X03 | S2 | B B6 | F51 | A1.asset_value = 1.150.000.000 không có chứng từ nguồn — không có trong bản ghi chứng từ nào | 1.150.000.000 | chốt theo quy tắc |  |
| X04 | S2 | C C3 | F53, F72 | Tổng phương án vốn 850.000.000 ≠ số tiền vay 800.000.000 |  | chờ xác nhận (cần ảnh hoặc người) | có |
| X05 | S2 | A|B B3 | G1.items[2] | G1 dòng 2: 4.000 × 75.000 = 300.000.000 ≠ 350.000.000 |  | chờ xác nhận (cần ảnh hoặc người) |  |
| X06 | S2 | B B6 | P2.identity_documents | P2 có vai trò CO_BORROWER, SPOUSE nhưng hồ sơ không có CCCD/Căn cước/VNeID — thông tin nhân thân chỉ đến từ chứng từ bậc 2–3 (nâng S1 nếu xác định là người đồng vay) |  | chốt theo quy tắc |  |
| X07 | S2 | C C2 | P2.role | P2: vai trò khác nhau giữa các chứng từ: SPOUSE [D5]; CO_BORROWER [D7] — vai trò quyết định nghĩa vụ và bộ chứng từ bắt buộc | SPOUSE (giấy đề nghị vay là bậc 1 cho đề nghị vay) | chờ xác nhận (cần ảnh hoặc người) | có |
| X08 | S3 | A|B B4 | F18 | P2.id_issue_date: D5 ghi «2023-05-10», giá trị chuẩn «2020-11-11» — thông tin giấy tờ trên chứng từ không khớp giấy tờ gốc | 2020-11-11 | chờ xác nhận (cần ảnh hoặc người) |  |

## Biến thể không phải lỗi (N, tự đóng)

- X09 F10: P1.id_issue_place: D4 ghi «Cục Cảnh sát quản lý hành chính về trật tự xã hội», giá trị chuẩn «BỘ CÔNG AN» — giá trị cũ trên chứng từ thuộc thời kỳ trước
- X10 F40: A1.identifiers.certificate_number: 2 cách viết cùng giá trị — bằng nhau sau chuẩn hoá
- X11 F5: P1.id_issue_date: D4 ghi «2021-03-01», giá trị chuẩn «2024-08-20» — giá trị cũ trên chứng từ thuộc thời kỳ trước
- X12 F6: P1.permanent_address: 2 cách viết cùng giá trị — bằng nhau sau chuẩn hoá
- X13 F7: P1.id_type: D4 ghi «CCCD», giá trị chuẩn «CAN_CUOC» — giá trị cũ trên chứng từ thuộc thời kỳ trước
