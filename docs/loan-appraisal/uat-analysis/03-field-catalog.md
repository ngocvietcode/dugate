# 03 – Danh sách field extraction theo từng loại mẫu biểu

Danh mục sạch (không kèm kết quả test) rút từ `TestResults_CheckChecklist_2.xlsx`. Kết quả test và các trường không khớp nằm ở [`01-field-extraction-by-form.md`](./01-field-extraction-by-form.md). Bản máy đọc được: [`03-field-catalog.json`](./03-field-catalog.json).

Quy ước:

- **Nhãn** là tên trường lấy nguyên văn từ file test. **Key** là tên tiếng Anh do tôi **đề xuất**, chưa có trong file, cần đối chiếu với schema trong code trước khi dùng.
- **Theo người**: mẫu biểu có dữ liệu riêng cho từng người (người vay, đồng vay, chủ TSBĐ), nên kết quả cần trả theo từng người.
- **Tên đối tượng (`subject_name`)**: mọi chứng từ, kể cả loại chỉ cần nhận diện loại chứng từ (sao kê lương, VSSID, ảnh HKD…), phải trả kèm tên người/đơn vị mà chứng từ thuộc về, để không nhầm chứng từ của người này sang người khác. Các dòng này đánh dấu **[Bổ sung]**: không có trong file test, thêm theo yêu cầu.
- **Kiểu JSON** (cột `Kiểu JSON`): mọi giá trị trả về là `string`, hoặc `string[]` khi có nhiều giá trị. Không có kiểu `object`: thông tin bên bán, bên mua, xe cần mua của hợp đồng mua bán được tách thành các trường phẳng (`seller_*`, `buyer_*`, `brand_model`, `engine_no`…).
- **Format** là gợi ý ngữ nghĩa cho bước chuẩn hóa và đối chiếu, không đổi kiểu JSON: `text`, `name`, `id_number`, `date`, `datetime`, `address`, `money`, `number`, `percent`, `phone`, `enum`, `text_full` (lấy toàn bộ chữ như trên chứng từ), `string|money`, `date+string`.
- Giá trị trả về giữ nguyên như in trên chứng từ (địa chỉ, số tiền, ngày…); bản chuẩn hóa dùng để đối chiếu được tạo ở bước sau, không trộn vào kết quả trích xuất.
- Mọi trường đã liệt kê, kể cả trường chưa có dữ liệu test trong 4 hồ sơ.

Tổng: **45 mẫu biểu, 278 trường** (253 trường từ file test, 8 trường [Bổ sung] tên đối tượng, 3 trường [Bổ sung] lãi suất %/năm và nghĩa vụ nợ hiện hữu trên đề nghị vay vốn để tính DSCR; 5 trường object của hợp đồng mua bán được tách thành 19 trường phẳng).

## Tên đối tượng của từng mẫu biểu

Với các mẫu đã có sẵn trường tên trong file test, trường đó đóng vai trò tên đối tượng. Với các mẫu còn lại, dùng `subject_name` [Bổ sung].

| Mẫu biểu | Trường tên đối tượng |
|---|---|
| `cccd` | `full_name` |
| `vneid` | `full_name` |
| `qr_code` | `full_name` |
| `xac_nhan_cu_tru` | `full_name` |
| `xac_nhan_hon_nhan` | `full_name` |
| `xac_nhan_cmnd_dia_phuong` | `full_name` |
| `cam_ket_cmnd_cccd` | `full_name` |
| `dang_ky_ket_hon` | `spouse_names` |
| `giay_khai_sinh` | `father_name`, `mother_name`, `child_name` |
| `de_nghi_vay_von` | `borrower_name`, `co_borrower_name`, `collateral_owner_name`, `reference_name` |
| `bang_ke_mua_hang` | `buyer_name` |
| `hd_mua_ban_hang_hoa` | `seller_name`, `buyer_name` |
| `hd_mua_ban_xe` | `seller_name`, `buyer_name` |
| `gcn_qsdd_nha_xuong` | `owner_name` |
| `to_trinh_ngoai_le` | `subject_name` [Bổ sung] |
| `dang_ky_xe` | `owner_name` |
| `dang_kiem_xe` | `owner_name` |
| `bao_gia_tai_san` | `subject_name` [Bổ sung] |
| `dinh_gia_dong_san` | `customer_name` |
| `gcn_qsdd` | `owner_name` |
| `gcn_can_ho` | `owner_name` |
| `dinh_gia_bds_thinh_dien` | `customer_name` |
| `chung_thu_sba` | `requester_name` |
| `chung_thu_citics` | `requester_name` |
| `chung_thu_fargo` | `requester_name` |
| `chung_thu_vvfc` | `requester_name` |
| `bang_ke_thu_nhap` | `customer_name`, `rental_owner_name`, `rental_tenant_name` |
| `hd_lao_dong` | `employee_name` |
| `xac_nhan_luong` | `employee_name` |
| `sao_ke_luong` | `subject_name` [Bổ sung] |
| `vssid` | `subject_name` [Bổ sung] |
| `gcn_dkhkd` | `business_name`, `representative_name` |
| `xac_nhan_kinh_doanh` | `subject_name` [Bổ sung] |
| `chung_tu_nop_thue` | `payer_name` |
| `so_sach` | `subject_name` [Bổ sung] |
| `hinh_anh_hkd` | `subject_name` [Bổ sung] |
| `dkkd_doanh_nghiep` | `company_name`, `legal_representative` |
| `to_khai_vat` | `taxpayer_name` |
| `bckqkd` | `company_name` |
| `bang_can_doi_ke_toan` | `company_name` |
| `hinh_anh_doanh_nghiep` | `subject_name` [Bổ sung] |
| `bien_ban_hdtv` | `company_name`, `full_name` |
| `cic_khach_hang` | `full_name` |
| `hd_tin_dung_tctd_khac` | `borrower` |
| `cic_tsbd` | `full_name` |

## Mục lục

**A. Hồ sơ pháp lý**

- `cccd` – Căn cước công dân (8 trường)
- `vneid` – Căn cước điện tử (VNeID) (7 trường)
- `qr_code` – Thông tin sau khi quét mã QR code (4 trường)
- `xac_nhan_cu_tru` – Xác nhận cư trú (7 trường)
- `xac_nhan_hon_nhan` – Xác nhận tình trạng hôn nhân (độc thân/ly hôn/góa) (9 trường)
- `xac_nhan_cmnd_dia_phuong` – Xác nhận chứng minh nhân dân của chính quyền địa phương (6 trường)
- `cam_ket_cmnd_cccd` – Cam kết 2 chứng minh nhân dân, Căn cước công dân là của 01 người (mẫu VPBank) (4 trường)
- `dang_ky_ket_hon` – Đăng ký kết hôn (nếu đã kết hôn) (5 trường)
- `giay_khai_sinh` – Giấy khai sinh (chứng minh quan hệ KH/người đồng vay với chủ TSBĐ) (4 trường)

**B. Hồ sơ phương án vay vốn**

- `de_nghi_vay_von` – Giấy đề nghị vay vốn (mẫu VPBank) (21 trường)
- `bang_ke_mua_hang` – Bảng kê mua hàng (3 trường)
- `hd_mua_ban_hang_hoa` – Hợp đồng mua bán hàng hóa (9 trường)
- `hd_mua_ban_xe` – Hợp đồng mua bán xe (14 trường)
- `gcn_qsdd_nha_xuong` – Giấy chứng nhận quyền sử dụng đất cần mua/đã sang tên KH (làm nhà xưởng) (6 trường)
- `to_trinh_ngoai_le` – Tờ trình phê duyệt ngoại lệ (2 trường)

**C1. Hồ sơ TSBĐ là động sản**

- `dang_ky_xe` – Chứng nhận đăng ký xe ô tô (5 trường)
- `dang_kiem_xe` – Đăng kiểm xe (4 trường)
- `bao_gia_tai_san` – Báo giá tài sản (5 trường)
- `dinh_gia_dong_san` – Báo cáo định giá động sản (5 trường)

**C2. Hồ sơ TSBĐ là bất động sản**

- `gcn_qsdd` – Giấy chứng nhận quyền sử dụng đất, quyền sở hữu tài sản khác gắn liền với đất (6 trường)
- `gcn_can_ho` – Giấy chứng nhận QSDĐ, quyền sở hữu nhà ở và tài sản khác gắn liền với đất (căn hộ chung cư) (5 trường)
- `dinh_gia_bds_thinh_dien` – Báo cáo định giá Bất động sản (Công ty TNHH Thịnh Điền) (9 trường)
- `chung_thu_sba` – Chứng thư định giá - Công ty CP Tư vấn Quy hoạch và Thẩm định giá SBA (SBA) (7 trường)
- `chung_thu_citics` – Chứng thư định giá - Công ty CP CITICS (CITICS) (7 trường)
- `chung_thu_fargo` – Chứng thư định giá - Công ty CP Thẩm định giá FARGO (FARGO) (7 trường)
- `chung_thu_vvfc` – Chứng thư định giá - Công ty CP Định giá và Dịch vụ Tài chính Việt Nam (VVFC) (7 trường)

**D1. Hồ sơ chứng minh nguồn thu nhập**

- `bang_ke_thu_nhap` – Bảng kê thu nhập (MB01.Qđi-TDCN/41) (37 trường)
- `hd_lao_dong` – Hợp đồng lao động (4 trường)
- `xac_nhan_luong` – Giấy xác nhận lương (4 trường)
- `sao_ke_luong` – Sao kê lương (2 trường)
- `vssid` – VSSID (2 trường)
- `gcn_dkhkd` – Giấy chứng nhận đăng ký hộ kinh doanh (6 trường)
- `xac_nhan_kinh_doanh` – Xác nhận kinh doanh của chính quyền địa phương (4 trường)
- `chung_tu_nop_thue` – Chứng từ nộp thuế (Giấy nộp tiền vào ngân sách nhà nước) (2 trường)
- `so_sach` – Sổ sách (bán hàng/nhập hàng) (2 trường)
- `hinh_anh_hkd` – Hình ảnh HKD (1 trường)
- `dkkd_doanh_nghiep` – Đăng ký kinh doanh doanh nghiệp (4 trường)
- `to_khai_vat` – Tờ khai thuế VAT (mẫu 01/GTGT) (2 trường)
- `bckqkd` – Báo cáo kết quả hoạt động kinh doanh (2 trường)
- `bang_can_doi_ke_toan` – Bảng cân đối kế toán (2 trường)
- `hinh_anh_doanh_nghiep` – Hình ảnh doanh nghiệp KH làm chủ (1 trường)
- `bien_ban_hdtv` – Biên bản hội đồng thành viên (3 trường)

**D2. Hồ sơ lịch sử tín dụng**

- `cic_khach_hang` – CIC KH - người đồng vay - chủ Tài sản bảo đảm (S11A/S11T) (10 trường)
- `hd_tin_dung_tctd_khac` – Hợp đồng tín dụng (Tổ chức tín dụng khác) (8 trường)
- `cic_tsbd` – CIC Tài sản bảo đảm (không OCR, lấy dữ liệu từ IL) (6 trường)

---

## A. Hồ sơ pháp lý

### Căn cước công dân

- Mã mẫu biểu: `cccd` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `id_number` | Số Căn cước công dân (mặt trước) | `string` | `id_number` | 12 số |
| 3 | `full_name` | Họ và tên | `string` | `name` | In hoa có dấu |
| 4 | `date_of_birth` | Ngày sinh | `string` | `date` | dd/mm/yyyy |
| 5 | `gender` | Giới tính | `string` | `enum` | Nam/Nữ |
| 6 | `permanent_address` | Nơi thường trú | `string` | `address` | Địa chỉ in trên thẻ, thường là địa chỉ cũ; không dùng làm nguồn chuẩn |
| 7 | `issue_date_place` | Ngày cấp, Nơi cấp (mặt sau) | `string` | `date+string` | Mặt sau |
| 8 | `valid_until` | Có giá trị đến | `string` | `date` |  |

### Căn cước điện tử (VNeID)

- Mã mẫu biểu: `vneid` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `full_name` | Họ và tên | `string` | `name` |  |
| 3 | `id_number` | Số Căn cước công dân (mặt trước) | `string` | `id_number` |  |
| 4 | `permanent_address` | Nơi thường trú | `string` | `address` | Nguồn chuẩn cho địa chỉ thường trú |
| 5 | `temporary_address` | Nơi tạm trú | `string` | `address` | '---' nếu không có |
| 6 | `current_address` | Nơi ở hiện tại | `string` | `address` |  |
| 7 | `old_id_number` | Số chứng minh nhân dân 9 số | `string` | `id_number` | Thường để trống |

### Thông tin sau khi quét mã QR code

- Mã mẫu biểu: `qr_code` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `id_number` | Số Căn cước công dân | `string` | `id_number` |  |
| 3 | `old_id_number` | Số chứng minh nhân dân 9 số | `string` | `id_number` | Cầu nối CMND 9 số - CCCD 12 số |
| 4 | `full_name` | Họ và tên | `string` | `name` |  |

### Xác nhận cư trú

- Mã mẫu biểu: `xac_nhan_cu_tru` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `full_name` | Họ và tên | `string` | `name` |  |
| 3 | `date_of_birth` | Ngày tháng năm sinh | `string` | `date` |  |
| 4 | `id_number` | Số Căn cước công dân | `string` | `id_number` |  |
| 5 | `permanent_address` | Nơi thường trú | `string` | `address` | Nguồn chuẩn cho địa chỉ thường trú |
| 6 | `temporary_or_current_address` | Nơi tạm trú / Nơi ở hiện tại | `string` | `address` |  |
| 7 | `residence_valid_until` | Thời hạn xác nhận cư trú | `string` | `date` | Dạng '20 tháng 03 năm 2027' |

### Xác nhận tình trạng hôn nhân (độc thân/ly hôn/góa)

- Mã mẫu biểu: `xac_nhan_hon_nhan` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `effective_date` | Ngày hiệu lực | `string` | `date` | Dạng '07 tháng 5 năm 2026' |
| 2 | `form_title` | Tên mẫu biểu | `string` | `text` | Ví dụ: GIẤY XÁC NHẬN TÌNH TRẠNG HÔN NHÂN |
| 3 | `full_name` | Họ và tên | `string` | `name` |  |
| 4 | `date_of_birth` | Ngày tháng năm sinh | `string` | `date` |  |
| 5 | `id_number` | Số Căn cước công dân/CMND 9 số | `string` | `id_number` |  |
| 6 | `marital_status` | Tình trạng hôn nhân | `string` | `text_full` | Lấy cả câu |
| 7 | `residence` | Nơi cư trú (4) | `string` | `address` |  |
| 8 | `issue_date` | Ngày, tháng, năm (cấp) | `string` | `date` |  |
| 9 | `purpose` | Giấy này được sử dụng để (7) | `string` | `text_full` |  |

### Xác nhận chứng minh nhân dân của chính quyền địa phương

- Mã mẫu biểu: `xac_nhan_cmnd_dia_phuong` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `full_name` | Họ và tên | `string` | `name` |  |
| 3 | `date_of_birth` | Ngày tháng năm sinh | `string` | `date` |  |
| 4 | `id_number` | Số Căn cước công dân | `string` | `id_number` |  |
| 5 | `permanent_address` | Nơi thường trú | `string` | `address` |  |
| 6 | `effective_date` | Ngày hiệu lực | `string` | `date` |  |

### Cam kết 2 chứng minh nhân dân, Căn cước công dân là của 01 người (mẫu VPBank)

- Mã mẫu biểu: `cam_ket_cmnd_cccd` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `full_name` | Họ và tên | `string` | `name` |  |
| 3 | `id_numbers` | Số chứng minh nhân dân, Căn cước công dân số | `string[]` | `id_number` | Có 2 số (CMND và CCCD) |
| 4 | `permanent_address` | Nơi thường trú | `string` | `address` |  |

### Đăng ký kết hôn (nếu đã kết hôn)

- Mã mẫu biểu: `dang_ky_ket_hon` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Ví dụ: GIẤY CHỨNG NHẬN KẾT HÔN |
| 2 | `spouse_names` | Họ và tên vợ/chồng | `string[]` | `name` | Có thể gộp 2 người: 'A + B' |
| 3 | `date_of_birth` | Ngày tháng năm sinh | `string` | `date` | Có thể chỉ có năm |
| 4 | `id_number` | Số Căn cước công dân/CMND 9 số | `string` | `id_number` | Thường là CMND 9 số |
| 5 | `marriage_date` | Ngày đăng ký kết hôn | `string` | `date` |  |

### Giấy khai sinh (chứng minh quan hệ KH/người đồng vay với chủ TSBĐ)

- Mã mẫu biểu: `giay_khai_sinh`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `father_name` | Họ và tên bố | `string` | `name` |  |
| 3 | `mother_name` | Họ và tên mẹ | `string` | `name` |  |
| 4 | `child_name` | Họ và tên con | `string` | `name` |  |

---

## B. Hồ sơ phương án vay vốn

### Giấy đề nghị vay vốn (mẫu VPBank)

- Mã mẫu biểu: `de_nghi_vay_von`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Mẫu 3-trong-1, có thể có 3 tiêu đề nối bằng ';' |
| 2 | `borrower_name` | Tên KH vay | `string` | `name` |  |
| 3 | `borrower_id` | Căn cước công dân KH vay | `string` | `id_number` |  |
| 4 | `co_borrower_name` | Tên người đồng vay | `string` | `name` |  |
| 5 | `co_borrower_id` | Căn cước công dân người đồng vay | `string` | `id_number` |  |
| 6 | `marital_status` | Tình trạng hôn nhân | `string` | `enum` |  |
| 7 | `collateral_owner_name` | Tên Chủ sở hữu Tài sản bảo đảm | `string[]` | `name` | Nhiều chủ nối bằng '+' hoặc 'và' |
| 8 | `collateral_owner_id` | Căn cước công dân chủ sở hữu tài sản | `string[]` | `id_number` |  |
| 9 | `relationship_to_borrower` | Quan hệ với khách hàng vay | `string` | `text` | Chính chủ / Vợ chồng / Chính người vay |
| 10 | `business_line` | Ngành nghề kinh doanh | `string` | `text` |  |
| 11 | `loan_amount` | Số tiền cho vay | `string` | `money` | Nhiều dạng: 425,000,000 đồng; 990.000.000; 266000000 |
| 12 | `loan_term` | Thời hạn vay | `string` | `number` | Tháng |
| 13 | `loan_purpose` | Mục đích vay vốn | `string` | `text_full` | Lấy nội dung được chọn/điền, không lấy tên phương án in sẵn |
| 14 | `repayment_source` | Nguồn trả nợ | `string` | `string|money` |  |
| 15 | `interest_rate` | Lãi suất | `string` | `text` | Mã biểu lãi suất: LC10, LC9, LC11... |
| 16 | `reference_name` | Họ tên người tham chiếu | `string` | `name` |  |
| 17 | `reference_relationship` | Mối quan hệ với người vay chính | `string` | `text` |  |
| 18 | `reference_phone` | Số điện thoại người tham chiếu | `string` | `phone` |  |
| 19 | `interest_rate_percent` | Lãi suất (%/năm) **[Bổ sung]** | `string` | `percent` | Lãi suất %/năm trên đề nghị vay; khác mã biểu lãi suất (`interest_rate`). Dùng tính DSCR |
| 20 | `has_existing_debt` | Có nghĩa vụ nợ hiện hữu tại TCTD **[Bổ sung]** | `string` | `enum` | Có / Không theo khai của KH |
| 21 | `existing_monthly_debt_payment` | Số tiền trả nợ hàng tháng của các khoản vay hiện hữu **[Bổ sung]** | `string` | `money` | '0' khi KH khai không có khoản vay. Dùng tính DSCR |

### Bảng kê mua hàng

- Mã mẫu biểu: `bang_ke_mua_hang`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Tiêu đề thay đổi: BẢNG KÊ HÀNG HÓA MUA VÀO / HÀNG CẦN NHẬP / MUA HÀNG... |
| 2 | `buyer_name` | Khách hàng/Người mua hàng | `string` | `name` |  |
| 3 | `total_value` | Tổng giá trị bảng kê | `string` | `money` |  |

### Hợp đồng mua bán hàng hóa

- Mã mẫu biểu: `hd_mua_ban_hang_hoa`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `seller_name` | Thông tin bên bán - Tên bên bán | `string` | `name` | Tên cá nhân hoặc doanh nghiệp/đại lý bán |
| 3 | `seller_id_or_tax_code` | Thông tin bên bán - Số CCCD / Mã số thuế | `string` | `text` | CCCD nếu bên bán là cá nhân, mã số thuế nếu là doanh nghiệp; không dùng làm định danh khách hàng |
| 4 | `seller_address` | Thông tin bên bán - Địa chỉ | `string` | `address` |  |
| 5 | `seller_representative` | Thông tin bên bán - Người đại diện | `string` | `name` | Chỉ khi bên bán là doanh nghiệp |
| 6 | `buyer_name` | Thông tin bên mua - Tên bên mua | `string` | `name` | Thường là khách hàng vay; dùng đối chiếu họ tên |
| 7 | `buyer_id_number` | Thông tin bên mua - Số CCCD | `string` | `id_number` | Dùng gắn hợp đồng vào khách hàng vay |
| 8 | `buyer_address` | Thông tin bên mua - Địa chỉ | `string` | `address` |  |
| 9 | `total_value` | Tổng giá trị mua hàng | `string` | `money` |  |

### Hợp đồng mua bán xe

- Mã mẫu biểu: `hd_mua_ban_xe`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `seller_name` | Thông tin bên bán - Tên bên bán | `string` | `name` | Tên cá nhân hoặc doanh nghiệp/đại lý bán |
| 3 | `seller_id_or_tax_code` | Thông tin bên bán - Số CCCD / Mã số thuế | `string` | `text` | CCCD nếu bên bán là cá nhân, mã số thuế nếu là doanh nghiệp; không dùng làm định danh khách hàng |
| 4 | `seller_address` | Thông tin bên bán - Địa chỉ | `string` | `address` |  |
| 5 | `seller_representative` | Thông tin bên bán - Người đại diện | `string` | `name` | Chỉ khi bên bán là doanh nghiệp |
| 6 | `buyer_name` | Thông tin bên mua - Tên bên mua | `string` | `name` | Thường là khách hàng vay; dùng đối chiếu họ tên |
| 7 | `buyer_id_number` | Thông tin bên mua - Số CCCD | `string` | `id_number` | Dùng gắn hợp đồng vào khách hàng vay |
| 8 | `buyer_address` | Thông tin bên mua - Địa chỉ | `string` | `address` |  |
| 9 | `brand_model` | Thông tin xe cần mua - Nhãn hiệu, số loại | `string` | `text` | Ví dụ: KIA, CARENS |
| 10 | `manufacture_year` | Thông tin xe cần mua - Năm sản xuất | `string` | `number` |  |
| 11 | `engine_no` | Thông tin xe cần mua - Số máy | `string` | `text` |  |
| 12 | `chassis_no` | Thông tin xe cần mua - Số khung | `string` | `text` |  |
| 13 | `plate_no` | Thông tin xe cần mua - Biển số | `string` | `text` | Để trống nếu xe mới chưa đăng ký |
| 14 | `total_value` | Tổng giá trị mua hàng | `string` | `money` |  |

### Giấy chứng nhận quyền sử dụng đất cần mua/đã sang tên KH (làm nhà xưởng)

- Mã mẫu biểu: `gcn_qsdd_nha_xuong`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `owner_name` | Tên Chủ sở hữu Tài sản bảo đảm | `string` | `name` |  |
| 3 | `parcel_no` | Thửa đất số | `string` | `text` |  |
| 4 | `map_sheet_no` | Tờ bản đồ số | `string` | `text` | File gộp 'Tờ bản đồ số / Địa chỉ thửa đất', tách thành 2 trường (giả định G6) |
| 5 | `parcel_address` | Địa chỉ thửa đất | `string` | `address` |  |
| 6 | `certificate_no` | Số Giấy chứng nhận | `string` | `text` | Ký tự bằng số và chữ |

### Tờ trình phê duyệt ngoại lệ

- Mã mẫu biểu: `to_trinh_ngoai_le` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Chỉ cần nhận diện loại chứng từ |
| 2 | `subject_name` | Tên khách hàng/đối tượng được đề nghị ngoại lệ | `string` | `name` | **[Bổ sung]** Để biết tờ trình thuộc hồ sơ của ai |

---

## C1. Hồ sơ TSBĐ là động sản

### Chứng nhận đăng ký xe ô tô

- Mã mẫu biểu: `dang_ky_xe`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `registration_no` | Số (Number) | `string` | `text` |  |
| 3 | `owner_name` | Tên chủ xe | `string` | `name` |  |
| 4 | `brand_model` | Nhãn hiệu, số loại | `string` | `text` | Ví dụ: KIA, CARENS |
| 5 | `plate_no` | Biển số đăng ký | `string` | `text` | Ví dụ: 86A-364.34 |

### Đăng kiểm xe

- Mã mẫu biểu: `dang_kiem_xe`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | GIẤY CHỨNG NHẬN KIỂM ĐỊNH AN TOÀN KỸ THUẬT VÀ BẢO VỆ MÔI TRƯỜNG XE CƠ GIỚI |
| 2 | `inspection_no` | Số (Number) | `string` | `text` |  |
| 3 | `manufacture_year` | Năm sản xuất | `string` | `number` |  |
| 4 | `owner_name` | Tên chủ xe | `string` | `name` |  |

### Báo giá tài sản

- Mã mẫu biểu: `bao_gia_tai_san` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `subject_name` | Tên khách hàng/chủ tài sản | `string` | `name` | **[Bổ sung]** Báo giá cho ai |
| 3 | `brand_model` | Loại (Model) / Nhãn hiệu | `string` | `text` |  |
| 4 | `manufacture_year` | Năm sản xuất | `string` | `number` |  |
| 5 | `asset_value` | Giá trị của tài sản | `string` | `money` |  |

### Báo cáo định giá động sản

- Mã mẫu biểu: `dinh_gia_dong_san`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `customer_name` | Tên khách hàng vay vốn | `string` | `name` |  |
| 3 | `plate_no` | Biển kiểm soát xe | `string` | `text` |  |
| 4 | `engine_no` | Số máy | `string` | `text` |  |
| 5 | `asset_value` | Giá trị của tài sản | `string` | `money` |  |

---

## C2. Hồ sơ TSBĐ là bất động sản

### Giấy chứng nhận quyền sử dụng đất, quyền sở hữu tài sản khác gắn liền với đất

- Mã mẫu biểu: `gcn_qsdd`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | File có comment 'Trường này ko cần check nhé' (giả định G3) |
| 2 | `owner_name` | Tên Chủ sở hữu | `string[]` | `name` | Nhiều chủ nối bằng '+' |
| 3 | `parcel_no` | Thửa đất số | `string` | `text` |  |
| 4 | `map_sheet_no` | Tờ bản đồ số | `string` | `text` | Có thể nằm ở trang cập nhật/biến động |
| 5 | `parcel_address` | Địa chỉ thửa đất | `string` | `address` | Thường là địa chỉ cũ trước sáp nhập |
| 6 | `certificate_no` | Số Giấy chứng nhận | `string` | `text` | Ví dụ: BQ 747032, CY 857027 |

### Giấy chứng nhận QSDĐ, quyền sở hữu nhà ở và tài sản khác gắn liền với đất (căn hộ chung cư)

- Mã mẫu biểu: `gcn_can_ho`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `owner_name` | Tên Chủ sở hữu | `string` | `name` | Mục 1. Người sử dụng đất, chủ sở hữu |
| 3 | `house_type` | Loại nhà ở | `string` | `text` | Mục 2.a |
| 4 | `apartment_building_name` | Tên nhà chung cư | `string` | `text` | Mục 2.a |
| 5 | `certificate_no` | Số Giấy chứng nhận | `string` | `text` |  |

### Báo cáo định giá Bất động sản (Công ty TNHH Thịnh Điền)

- Mã mẫu biểu: `dinh_gia_bds_thinh_dien`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | BÁO CÁO ĐỊNH GIÁ TÀI SẢN |
| 2 | `customer_name` | Tên khách hàng vay vốn | `string` | `name` | Mục I. Thông tin chung - Khách hàng vay (dự kiến) |
| 3 | `certificate_no` | Số Giấy chứng nhận Tài sản bảo đảm | `string` | `text` | Mục II.1; có thể kèm cơ quan cấp, ngày cấp, số vào sổ |
| 4 | `parcel_no` | Thửa đất số | `string` | `text` | Mục II.3 A |
| 5 | `map_sheet_no` | Tờ bản đồ số | `string` | `text` | Mục II.3 A |
| 6 | `parcel_address` | Địa chỉ thửa đất | `string` | `address` | Mục II.3 A - Địa chỉ |
| 7 | `land_use_status` | Hiện trạng thửa đất | `string` | `text` | Mục II.2 |
| 8 | `asset_value` | Giá trị của tài sản (VNĐ) | `string` | `money` | Mục III.1 - Tổng giá trị tài sản tư vấn về giá |
| 9 | `asset_grade` | Hạng tài sản | `string` | `text` | Mục IV - Xếp loại TSBĐ |

### Chứng thư định giá - Công ty CP Tư vấn Quy hoạch và Thẩm định giá SBA (SBA)

- Mã mẫu biểu: `chung_thu_sba`
- Ghi chú: Vị trí lấy dữ liệu: xem 01-field-extraction-by-form.md mục C2.4

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `requester_name` | Tên khách hàng yêu cầu | `string` | `name` |  |
| 3 | `collateral_info` | Thông tin TSBĐ | `string` | `text_full` |  |
| 4 | `land_use_status` | Hiện trạng thửa đất | `string` | `text` |  |
| 5 | `asset_value` | Giá trị của tài sản (VNĐ) | `string` | `money` |  |
| 6 | `certificate_no` | Số Giấy chứng nhận | `string` | `text` |  |
| 7 | `asset_grade` | Hạng tài sản | `string` | `text` |  |

### Chứng thư định giá - Công ty CP CITICS (CITICS)

- Mã mẫu biểu: `chung_thu_citics`
- Ghi chú: Vị trí lấy 'Hạng tài sản' trong file có vẻ chưa đúng (giả định G7)

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `requester_name` | Tên khách hàng yêu cầu | `string` | `name` |  |
| 3 | `collateral_info` | Thông tin TSBĐ | `string` | `text_full` |  |
| 4 | `land_use_status` | Hiện trạng thửa đất | `string` | `text` |  |
| 5 | `asset_value` | Giá trị của tài sản (VNĐ) | `string` | `money` |  |
| 6 | `certificate_no` | Số Giấy chứng nhận | `string` | `text` |  |
| 7 | `asset_grade` | Hạng tài sản | `string` | `text` |  |

### Chứng thư định giá - Công ty CP Thẩm định giá FARGO (FARGO)

- Mã mẫu biểu: `chung_thu_fargo`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `requester_name` | Tên khách hàng yêu cầu | `string` | `name` |  |
| 3 | `collateral_info` | Thông tin TSBĐ | `string` | `text_full` |  |
| 4 | `land_use_status` | Hiện trạng thửa đất | `string` | `text` |  |
| 5 | `asset_value` | Giá trị của tài sản (VNĐ) | `string` | `money` |  |
| 6 | `certificate_no` | Số Giấy chứng nhận | `string` | `text` |  |
| 7 | `asset_grade` | Hạng tài sản | `string` | `text` |  |

### Chứng thư định giá - Công ty CP Định giá và Dịch vụ Tài chính Việt Nam (VVFC)

- Mã mẫu biểu: `chung_thu_vvfc`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `requester_name` | Tên khách hàng yêu cầu | `string` | `name` |  |
| 3 | `collateral_info` | Thông tin TSBĐ | `string` | `text_full` |  |
| 4 | `land_use_status` | Hiện trạng thửa đất | `string` | `text` |  |
| 5 | `asset_value` | Giá trị của tài sản (VNĐ) | `string` | `money` |  |
| 6 | `certificate_no` | Số Giấy chứng nhận | `string` | `text` |  |
| 7 | `asset_grade` | Hạng tài sản | `string` | `text` |  |

---

## D1. Hồ sơ chứng minh nguồn thu nhập

### Bảng kê thu nhập (MB01.Qđi-TDCN/41)

- Mã mẫu biểu: `bang_ke_thu_nhap` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | THÔNG TIN THU NHẬP CỦA KHÁCH HÀNG / BẢNG KÊ THU NHẬP |
| 2 | `customer_name` | Tên khách hàng vay/ người đồng vay | `string` | `name` | Có thể gộp 2 người: 'A/B' -> tách thành từng người |
| 3 | `id_number` | Căn cước công dân | `string` | `id_number` | Chỉ lấy số; bỏ ngày cấp, nơi cấp nếu có |
| 4 | `income_source_type` | Loại nguồn thu | `string` | `text` |  |
| 5 | `capital_turnover` | Vòng quay | `string` | `number` | Số vòng quay vốn |
| 6 | `salary_section` | II.1 Nguồn thu từ lương | `string` | `text_full` |  |
| 7 | `salary_current_job` | II.1 a> Thông tin về công việc hiện tại | `string` | `text_full` |  |
| 8 | `salary_position` | II.1 Chức vụ | `string` | `text` |  |
| 9 | `salary_months_at_employer` | II.1 Thời gian làm việc tại đơn vị hiện tại (tháng) | `string` | `number` |  |
| 10 | `salary_workplace_address` | II.1 Địa chỉ nơi làm việc | `string` | `address` |  |
| 11 | `salary_net_income` | II.1 Thu nhập sau thuế (VND/tháng) | `string` | `money` |  |
| 12 | `rental_section` | II.2 Nguồn thu từ cho thuê tài sản | `string` | `text_full` |  |
| 13 | `rental_asset_description` | II.2 Mô tả chi tiết về tài sản | `string` | `text_full` |  |
| 14 | `rental_owner_name` | II.2 Tên chủ sở hữu | `string` | `name` | Chỉ chữ |
| 15 | `rental_tenant_name` | II.2 Họ và tên người thuê | `string` | `name` | Chỉ chữ |
| 16 | `rental_contract_term` | II.2 Thời hạn hợp đồng thuê | `string` | `text` |  |
| 17 | `rental_net_income` | II.2 Thu nhập sau thuế (VND/tháng) | `string` | `money` |  |
| 18 | `hkd_business_name` | II.3.1 HKD - Tên cơ sở kinh doanh | `string` | `text` |  |
| 19 | `hkd_business_form` | II.3.1 HKD - Hình thức kinh doanh | `string[]` | `enum` | Ô tích trên form có 3 lựa chọn. Trả về danh sách các hình thức được tích, chỉ gồm 'Có cơ sở kinh doanh' và/hoặc 'Online'. Nếu tích 'Cả 2 hình thức trên' thì trả cả hai giá trị; danh sách rỗng nếu không tích ô nào. Giá trị cho phép: `Có cơ sở kinh doanh`, `Online` |
| 20 | `hkd_business_line` | II.3.1 HKD - Ngành nghề kinh doanh | `string` | `text` |  |
| 21 | `hkd_operating_time` | II.3.1 HKD - Thời gian đã hoạt động | `string` | `text` | Ví dụ: Từ năm 2021 đến nay; > 3 năm; 6 NĂM |
| 22 | `hkd_actual_address` | II.3.1 HKD - Địa chỉ kinh doanh thực tế | `string` | `address` |  |
| 23 | `hkd_premises_type` | II.3.1 HKD - Mặt bằng, trụ sở kinh doanh | `string` | `text` | Thuê / Khách hàng sở hữu |
| 24 | `hkd_premises_area_m2` | II.3.1 HKD - Diện tích mặt bằng kinh doanh (m2) | `string` | `number` |  |
| 25 | `hkd_net_revenue` | II.3.1 HKD - Doanh thu thuần | `string` | `money` | Theo năm (VND/năm) |
| 26 | `hkd_cogs` | II.3.1 HKD - Giá vốn hàng bán | `string` | `money` |  |
| 27 | `hkd_gross_profit` | II.3.1 HKD - Lợi nhuận gộp | `string` | `money` |  |
| 28 | `hkd_total_cost` | II.3.1 HKD - Tổng chi phí | `string` | `money` |  |
| 29 | `hkd_net_profit` | II.3.1 HKD - Lợi nhuận ròng | `string` | `money` | Theo năm (VND/năm) |
| 30 | `trip_vehicle` | II.3.2 Kinh doanh buôn chuyến - Phương tiện vận tải | `string` | `text` |  |
| 31 | `trip_net_profit` | II.3.2 Kinh doanh buôn chuyến - Lợi nhuận ròng | `string` | `money` | File ghi nhãn '3.1' |
| 32 | `enterprise_name` | II.3.3 Doanh nghiệp - Tên doanh nghiệp | `string` | `text` |  |
| 33 | `enterprise_reg_no` | II.3.3 Doanh nghiệp - Số ĐKKD/MST | `string` | `text` |  |
| 34 | `enterprise_capital_share` | II.3.3 Doanh nghiệp - Tỷ lệ góp vốn của KH | `string` | `percent` | Số + % |
| 35 | `enterprise_address` | II.3.3 Doanh nghiệp - Địa chỉ theo ĐKKD | `string` | `address` |  |
| 36 | `enterprise_annual_result` | II.3.3 Doanh nghiệp - Kết quả kinh doanh năm gần nhất (VNĐ/năm) | `string` | `money` |  |
| 37 | `enterprise_avg_monthly_profit` | II.3.3 Doanh nghiệp - Lợi nhuận trung bình tháng | `string` | `money` |  |

### Hợp đồng lao động

- Mã mẫu biểu: `hd_lao_dong` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | HỢP ĐỒNG LAO ĐỘNG |
| 2 | `company` | Công ty | `string` | `text` |  |
| 3 | `employee_name` | Tên KH | `string` | `name` |  |
| 4 | `id_number` | Căn cước công dân | `string` | `id_number` | Lấy toàn bộ số |

### Giấy xác nhận lương

- Mã mẫu biểu: `xac_nhan_luong` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | GIẤY XÁC NHẬN LƯƠNG |
| 2 | `employee_name` | Tên KH | `string` | `name` |  |
| 3 | `id_number` | Căn cước công dân | `string` | `id_number` | Lấy toàn bộ số |
| 4 | `net_income` | Tổng thu nhập thực lãnh | `string` | `money` |  |

### Sao kê lương

- Mã mẫu biểu: `sao_ke_luong` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `subject_name` | Tên chủ tài khoản | `string` | `name` | **[Bổ sung]** Sao kê của ai: người vay, đồng vay hay người khác |
| 2 | `statement_type` | Sổ phụ tài khoản/sổ chi tiết tài khoản | `string` | `text` | Chỉ nhận diện loại chứng từ |

### VSSID

- Mã mẫu biểu: `vssid` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `subject_name` | Họ và tên người tham gia bảo hiểm xã hội | `string` | `name` | **[Bổ sung]** VSSID của ai |
| 2 | `social_insurance_history` | Quá trình tham gia bảo hiểm xã hội | `string` | `text` | Chỉ nhận diện loại chứng từ |

### Giấy chứng nhận đăng ký hộ kinh doanh

- Mã mẫu biểu: `gcn_dkhkd`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `reg_no` | Số | `string` | `text` |  |
| 2 | `business_name` | Tên HKD | `string` | `text` |  |
| 3 | `business_address` | Địa điểm kinh doanh | `string` | `address` |  |
| 4 | `business_line` | Ngành nghề | `string` | `text` |  |
| 5 | `representative_name` | Người đại diện | `string` | `name` |  |
| 6 | `id_number` | Căn cước công dân | `string` | `id_number` |  |

### Xác nhận kinh doanh của chính quyền địa phương

- Mã mẫu biểu: `xac_nhan_kinh_doanh` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `subject_name` | Tên người/hộ được xác nhận kinh doanh | `string` | `name` | **[Bổ sung]** Xác nhận cho ai |
| 2 | `business_confirmation` | Xác nhận kinh doanh | `string` | `text_full` |  |
| 3 | `business_line` | Ngành nghề | `string` | `text` |  |
| 4 | `business_address` | Địa chỉ kinh doanh | `string` | `address` |  |

### Chứng từ nộp thuế (Giấy nộp tiền vào ngân sách nhà nước)

- Mã mẫu biểu: `chung_tu_nop_thue`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `payer_name` | Người nộp ngân sách nhà nước | `string` | `name` |  |
| 2 | `tax_code` | Mã số thuế | `string` | `text` |  |

### Sổ sách (bán hàng/nhập hàng)

- Mã mẫu biểu: `so_sach` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `subject_name` | Tên chủ sổ sách / hộ kinh doanh | `string` | `name` | **[Bổ sung]** Sổ của ai |
| 2 | `ledger_content` | Sổ sách bán hàng/ sổ sách nhập hàng | `string` | `text_full` | Lấy toàn bộ chữ, kể cả viết tắt |

### Hình ảnh HKD

- Mã mẫu biểu: `hinh_anh_hkd` · Theo người: có
- Ghi chú: Chỉ nhận diện ảnh, không có trường trích xuất

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `subject_name` | Tên chủ hộ kinh doanh / tên cơ sở (nếu thể hiện trên ảnh) | `string` | `name` | **[Bổ sung]** Nếu ảnh không thể hiện tên thì để trống và gắn cảnh báo, không tự suy từ hồ sơ |

### Đăng ký kinh doanh doanh nghiệp

- Mã mẫu biểu: `dkkd_doanh_nghiep`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `reg_no` | Số đăng ký kinh doanh | `string` | `text` |  |
| 2 | `company_name` | Tên công ty | `string` | `text` |  |
| 3 | `hq_address` | Địa chỉ trụ sở | `string` | `address` |  |
| 4 | `legal_representative` | Người đại diện theo pháp luật | `string` | `name` |  |

### Tờ khai thuế VAT (mẫu 01/GTGT)

- Mã mẫu biểu: `to_khai_vat`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `tax_period` | Kỳ tính thuế | `string` | `text` |  |
| 2 | `taxpayer_name` | Tên người nộp thuế | `string` | `text` |  |

### Báo cáo kết quả hoạt động kinh doanh

- Mã mẫu biểu: `bckqkd`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `period` | Kỳ | `string` | `text` |  |
| 2 | `company_name` | Tên công ty | `string` | `text` |  |

### Bảng cân đối kế toán

- Mã mẫu biểu: `bang_can_doi_ke_toan`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `period` | Kỳ | `string` | `text` |  |
| 2 | `company_name` | Tên công ty | `string` | `text` |  |

### Hình ảnh doanh nghiệp KH làm chủ

- Mã mẫu biểu: `hinh_anh_doanh_nghiep` · Theo người: có
- Ghi chú: Chỉ nhận diện ảnh, không có trường trích xuất

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `subject_name` | Tên chủ doanh nghiệp / tên công ty (nếu thể hiện trên ảnh) | `string` | `name` | **[Bổ sung]** Nếu ảnh không thể hiện tên thì để trống và gắn cảnh báo |

### Biên bản hội đồng thành viên

- Mã mẫu biểu: `bien_ban_hdtv`

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `company_name` | Tên công ty | `string` | `text` |  |
| 2 | `full_name` | Họ và tên | `string` | `name` |  |
| 3 | `id_number` | Căn cước công dân | `string` | `id_number` |  |

---

## D2. Hồ sơ lịch sử tín dụng

### CIC KH - người đồng vay - chủ Tài sản bảo đảm (S11A/S11T)

- Mã mẫu biểu: `cic_khach_hang` · Theo người: có

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | BÁO CÁO CHI TIẾT QUAN HỆ TÍN DỤNG; có thể kèm '(Khách hàng thể nhân)' hoặc 'TỨC THỜI' |
| 2 | `query_date` | Ngày tra cứu | `string` | `datetime` | Có thể kèm giờ; trên form là 'Thời gian gửi báo cáo' |
| 3 | `full_name` | Họ và tên | `string` | `name` | In hoa, thường không dấu |
| 4 | `cic_code` | Mã CIC | `string` | `text` | 10 chữ số |
| 5 | `id_number` | Số CCCD/CMND | `string` | `id_number` |  |
| 6 | `debt_group` | Kiểm tra nhóm nợ | `string` | `enum` | Nhóm 1 (Nợ đủ tiêu chuẩn)... |
| 7 | `bad_debt_5y` | Lịch sử nợ xấu trong 5 năm (mục 3.5) | `string` | `text_full` |  |
| 8 | `card_late_payment_3y` | Lịch sử chậm thanh toán thẻ trong 3 năm (mục 3.6) | `string` | `text_full` |  |
| 9 | `watchlist_debt_12m` | Nợ cần chú ý trong 12 tháng (mục 3.7) | `string` | `text_full` |  |
| 10 | `queried_institutions` | Danh sách TCTD tra cứu (1 năm gần nhất) | `string[]` | `string` | Danh sách tên hoặc số lượng |

### Hợp đồng tín dụng (Tổ chức tín dụng khác)

- Mã mẫu biểu: `hd_tin_dung_tctd_khac`
- Ghi chú: Lấy toàn bộ thông tin bao gồm cả dấu và số

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `contract_no` | Số hợp đồng tín dụng | `string` | `text` |  |
| 2 | `sign_date` | Ngày ký | `string` | `date` |  |
| 3 | `lender` | Bên cho vay | `string` | `text` |  |
| 4 | `borrower` | Bên vay | `string` | `text` |  |
| 5 | `id_number` | Căn cước công dân | `string` | `id_number` |  |
| 6 | `loan_amount` | Số tiền vay | `string` | `money` |  |
| 7 | `loan_purpose` | Mục đích | `string` | `text_full` |  |
| 8 | `loan_term` | Thời hạn vay | `string` | `text` |  |

### CIC Tài sản bảo đảm (không OCR, lấy dữ liệu từ IL)

- Mã mẫu biểu: `cic_tsbd`
- Ghi chú: Theo file: không OCR, dữ liệu lấy từ IL

| # | Key đề xuất | Nhãn (theo file) | Kiểu JSON | Format | Ghi chú |
|---|---|---|---|---|---|
| 1 | `form_title` | Tên mẫu biểu | `string` | `text` | Nhận diện loại chứng từ |
| 2 | `query_date` | Ngày tra cứu | `string` | `datetime` |  |
| 3 | `full_name` | Họ tên | `string` | `name` |  |
| 4 | `cic_code` | Mã CIC | `string` | `text` |  |
| 5 | `id_number` | Căn cước công dân | `string` | `id_number` |  |
| 6 | `other_institutions` | Danh sách Tổ chức tín dụng khác đang quan hệ | `string[]` | `string` |  |
