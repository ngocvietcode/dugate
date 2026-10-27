# 01 – Danh sách trường trích xuất theo từng mẫu biểu + kết quả không khớp

Nguồn: `TestResults_CheckChecklist_2.xlsx` (các sheet `OCR FAST …`). Tổng quan, giả định và lỗi dữ liệu test nằm ở [`README.md`](./README.md).

## Quy ước

Bốn hồ sơ test (luồng FAST):

| Mã | Mã hồ sơ | Người vay | Người đồng vay |
|---|---|---|---|
| HS1 | LN2605288322713 (MYNTH11) | Trần Thanh Tuấn | – |
| HS2 | LN2610088913941 (NGOCTTP3) | Ngô Ngọc Hoàn | Nguyễn Thị Phương Thảo |
| HS3 | LN2608218749371 (PHUONGNT13) | Võ Thị Cẩm Tiên | Tạ Viết Dũng |
| HS4 | LN2609038780853 (HOACL) | Trương Thị Mỹ Liên | Lữ Kim An |

Ký hiệu trạng thái ở các cột HS1–HS4:

- ✓ Khớp (kỳ vọng = thực tế, hoặc file đánh giá "Khớp" và giá trị thực sự khớp).
- ✗ Không khớp (file đánh giá "Không khớp", hoặc ghi chú "AI không nhận diện/không đọc được").
- ⚠ File ghi "Khớp" nhưng không kiểm chứng được. Có 3 dạng: kỳ vọng chỉ là gợi ý vị trí (vd "Lấy toàn bộ chữ và số…"), kỳ vọng được gán bằng công thức `=cột thực tế`, hoặc giá trị kỳ vọng và thực tế lệch nhau/một bên để trống.
- `–` Hồ sơ này không có dữ liệu test cho trường đó.
- `n/a` Hồ sơ này không có chứng từ đó.

Cột "Ghi chú" là định dạng, vị trí lấy dữ liệu hoặc quy tắc nêu trong file. Với các sheet chia cột theo người, "KH" là người vay và "ĐV" là người đồng vay.

Mọi trường đều được liệt kê, kể cả trường chưa có dữ liệu test, để không bỏ sót. Nhóm A–D lấy theo cấu trúc của file test.

Lưu ý: các chứng từ "chỉ nhận diện loại" (Tờ trình ngoại lệ, Sao kê lương, VSSID, Sổ sách, Hình ảnh HKD/doanh nghiệp, Xác nhận kinh doanh, Báo giá tài sản) vẫn phải trả kèm tên đối tượng của chứng từ. Trường này không có trong file test nên không xuất hiện ở các bảng dưới, xem [`03-field-catalog.md`](./03-field-catalog.md) (trường `subject_name`).

---

## A. Nhóm hồ sơ pháp lý

### A1. Căn cước công dân (CCCD) – 8 trường

| # | Trường | Ghi chú | HS1 | HS2 | HS3 | HS4 |
|---|---|---|---|---|---|---|
| 1 | Tên mẫu biểu | "Căn cước công dân" | ✓ | ✓ | ✓ | ✓ |
| 2 | Số CCCD (mặt trước) | 12 số | ✓ | ✓ | ✓ | ✓ |
| 3 | Họ và tên | In hoa có dấu | ✓ | ✓ | ✓ | ✗ ĐV |
| 4 | Ngày sinh | HS1 ghi `06/7/1979`, HS3 đọc ra dạng ngày giờ `1992-03-05 00:00:00` | ✓ | ✓ | ✓ | ✓ |
| 5 | Giới tính | Nam/Nữ | ✓ | ✓ | ✓ | ✓ |
| 6 | Nơi thường trú | Địa chỉ in trên thẻ (thường là địa chỉ cũ) | ✓ | ✓ | ✗ KH+ĐV | ✓ |
| 7 | Ngày cấp, Nơi cấp (mặt sau) | `dd/mm/yyyy` + "Cục trưởng Cục CSQLHC về TTXH" | ✓ | ✓ | ✓ | ✓ |
| 8 | Có giá trị đến | `dd/mm/yyyy` | ✓ | ✓ | ✓ | ✓ |

### A2. Căn cước điện tử (VNeID) – 7 trường

| # | Trường | Ghi chú | HS1 | HS2 | HS3 | HS4 |
|---|---|---|---|---|---|---|
| 1 | Tên mẫu biểu | HS3: thông tin khớp nhưng tiêu đề không được nêu bật | – | ✓ | ✓ | – |
| 2 | Họ và tên | | – | ✓ | ✓ | – |
| 3 | Số CCCD (mặt trước) | | – | ✓ | ✓ | – |
| 4 | Nơi thường trú | Nguồn đúng cho địa chỉ thường trú (xem README §Quy tắc địa chỉ) | – | ✗ KH | ✓ | – |
| 5 | Nơi tạm trú | `---` nếu không có | – | ✓ | ✓ | – |
| 6 | Nơi ở hiện tại | | – | ✓ | ✓ | – |
| 7 | Số CMND 9 số | HS3 đặt kỳ vọng = `0` và thực tế = `0` | – | – | ✓ | – |

HS1 và HS4: AI không nhận diện VNeID (xem checklist). File chỉ có giá trị kỳ vọng.

### A3. Thông tin sau khi quét mã QR – 4 trường

| # | Trường | Ghi chú | HS1 | HS2 | HS3 | HS4 |
|---|---|---|---|---|---|---|
| 1 | Tên mẫu biểu | | – | ✗ | ✗ | ✗ |
| 2 | Số CCCD | | – | ✓ | ✓ | ✓ KH / ⚠ ĐV |
| 3 | Số CMND 9 số | QR là nguồn có cả CCCD lẫn CMND 9 số | – | ✓ | ✓ | ✓ KH / ⚠ ĐV |
| 4 | Họ và tên | | – | ✓ | ✓ | ✗ |

HS1: AI không nhận diện mã QR (xem checklist).

### A4. Xác nhận cư trú – 7 trường (chỉ HS4 có dữ liệu)

| # | Trường | Ghi chú | HS4 |
|---|---|---|---|
| 1 | Tên mẫu biểu | | ✗ |
| 2 | Họ và tên | | ✗ |
| 3 | Ngày tháng năm sinh | | ✓ |
| 4 | Số CCCD | | ✓ |
| 5 | Nơi thường trú | Nguồn đúng cho địa chỉ thường trú | ✗ |
| 6 | Nơi tạm trú / Nơi ở hiện tại | | ✗ |
| 7 | Thời hạn xác nhận cư trú | Dạng "20 tháng 03 năm 2027" | ✓ |

### A5. Xác nhận tình trạng hôn nhân (độc thân/ly hôn/góa) – 9 trường

| # | Trường | Ghi chú | HS1 | HS4 |
|---|---|---|---|---|
| 1 | Ngày hiệu lực | "07 tháng 5 năm 2026" | ✓ | – |
| 2 | Tên mẫu biểu | "GIẤY XÁC NHẬN TÌNH TRẠNG HÔN NHÂN" | ✓ | – |
| 3 | Họ và tên | | ✓ | – |
| 4 | Ngày tháng năm sinh | | ✓ | – |
| 5 | Số CCCD/CMND 9 số | | ✓ | – |
| 6 | Tình trạng hôn nhân | Lấy cả câu, ví dụ "Có đăng ký kết hôn, nhưng đã ly hôn theo Quyết định số … ngày 05/5/2026" | ✓ | – |
| 7 | Nơi cư trú (4) | | ✓ | – |
| 8 | Ngày, tháng, năm (cấp) | | ✓ | – |
| 9 | Giấy này được sử dụng để (7) | | ✓ | – |

HS2 và HS3 không có chứng từ này. Ở HS4 các dòng này không có dữ liệu, nhưng cột đánh giá đã điền sẵn "Khớp".

### A6. Xác nhận CMND của chính quyền địa phương – 6 trường (chưa có dữ liệu test)

Tên mẫu biểu · Họ và tên · Ngày tháng năm sinh · Số CCCD · Nơi thường trú · Ngày hiệu lực.

HS1 và HS4 đã điền sẵn "Khớp" dù không có giá trị nào.

### A7. Cam kết 2 CMND/CCCD là của 01 người (mẫu VPBank) – 4 trường (chưa có dữ liệu test)

Tên mẫu biểu · Họ và tên · Số CMND/CCCD · Nơi thường trú.

### A8. Đăng ký kết hôn (nếu đã kết hôn) – 5 trường

| # | Trường | Ghi chú | HS1 | HS2 | HS3 | HS4 |
|---|---|---|---|---|---|---|
| 1 | Tên mẫu biểu | HS3: "GIẤY CHỨNG NHẬN KẾT HÔN" | – | ✓ | ✓ | ✓ |
| 2 | Họ và tên vợ/chồng | HS4 kỳ vọng: "TRƯƠNG THỊ MỸ LIÊN + LỮ KIM AN" | – | ✓ | ✓ | ✗ |
| 3 | Ngày tháng năm sinh | HS4 chỉ có năm: `1975 + 1968` | – | ✓ | ✓ | ✓ |
| 4 | Số CCCD/CMND 9 số | Giấy có thể ghi CMND 9 số, không phải CCCD 12 số (HS2: `162859621`, `091940527`) | – | ✓ | ✓ | ✓ |
| 5 | Ngày đăng ký kết hôn | HS2 `14/11/2018`, HS3 `15/3/2016`, HS4 "12 tháng 6 năm 2004" | – | ✓ | ✓ | ✓ |

### A9. Giấy khai sinh (chứng minh quan hệ KH/người đồng vay với chủ TSBĐ) – 4 trường (chưa có dữ liệu test)

Tên mẫu biểu · Họ và tên bố · Họ và tên mẹ · Họ và tên con.

---

## B. Nhóm hồ sơ phương án vay vốn

### B1. Giấy đề nghị vay vốn (mẫu VPBank) – 18 trường

| # | Trường | Ghi chú | HS1 | HS2 | HS3 | HS4 |
|---|---|---|---|---|---|---|
| 1 | Tên mẫu biểu | Mẫu 3-trong-1: kỳ vọng là cả 3 tiêu đề nối bằng `;`, AI chỉ trả tiêu đề đầu (xem B1 bên dưới) | ✗ | ✗ | ✓ ⚠ | ✗ |
| 2 | Tên KH vay | | ✓ | ✓ | ✓ | ✓ |
| 3 | CCCD KH vay | | ✓ | ✓ | ✓ | ✓ |
| 4 | Tên người đồng vay | | – | ✓ | ✓ | ✓ |
| 5 | CCCD người đồng vay | | – | ✓ | ✓ | ✓ |
| 6 | Tình trạng hôn nhân | | ✗ | ✓ | ✓ | ✓ |
| 7 | Tên chủ sở hữu TSBĐ | Nhiều chủ nối bằng "+" hoặc "và" | ✓ | ✓ | ✓ | ✗ |
| 8 | CCCD chủ sở hữu tài sản | Nhiều chủ nối bằng "+" | ✗ | ✓ | ✓ | ✓ |
| 9 | Quan hệ với khách hàng vay | "Chính chủ", "Vợ chồng", "Chính người vay" | ✓ | ✓ | ✓ | ✓ |
| 10 | Ngành nghề kinh doanh | | ✓ | ✓ | ✗ | ✓ |
| 11 | Số tiền cho vay | Số kèm đơn vị nhiều dạng: `425,000,000 đồng`, `990.000.000`, `266000000` | ✓ | ✓ | ✓ | ✓ |
| 12 | Thời hạn vay | `24`, `36 tháng`, `24 Tháng` | ✓ | ✓ | ✓ | ✓ |
| 13 | Mục đích vay vốn | | ✗ | ✗ | ✗ | ✓ |
| 14 | Nguồn trả nợ | Số (`425000000`) hoặc chữ ("Lợi nhuận từ kinh doanh") | ✓ | ✓ | ✓ | ✓ |
| 15 | Lãi suất | Mã biểu lãi suất (`LC10`, `LC9`, `LC11`…) | ✗ | ✗ | ✗ | ✓ |
| 16 | Họ tên người tham chiếu | | ✓ | ✓ | ✓ | ✓ |
| 17 | Mối quan hệ với người vay chính | | ✓ | ✗ | ✓ | ✓ |
| 18 | SĐT người tham chiếu | | ✓ | ✓ | ✓ | ✓ |

### B2. Bảng kê mua hàng – 3 trường

| # | Trường | Ghi chú | HS1 | HS2 | HS3 | HS4 |
|---|---|---|---|---|---|---|
| 1 | Tên mẫu biểu | Tiêu đề khác nhau theo hồ sơ: "BẢNG KÊ HÀNG HÓA MUA VÀO", "BẢNG KÊ HÀNG CẦN NHẬP", "Bảng kê hàng hóa cần mua", "BẢNG KÊ MUA HÀNG" | ✓ | ✓ | ✓ | ✓ |
| 2 | Khách hàng/Người mua hàng | | ✓ | ✓ | ✓ | ✓ |
| 3 | Tổng giá trị bảng kê | HS1 450.000.000; HS2 1.187.000.000; HS3 3.865.403.000; HS4 266.000.000 | ✓ | ✓ | ✓ | ✓ |

### B3. Hợp đồng mua bán hàng hóa – 4 trường (chưa có dữ liệu test)

Tên mẫu biểu · Thông tin bên bán · Thông tin bên mua · Tổng giá trị mua hàng.

HS4: checklist ghi kỳ vọng "Có" và AI trả "Có" nhưng không có trường nào được trích.

### B4. Hợp đồng mua bán xe – 5 trường (chưa có dữ liệu test)

Tên mẫu biểu · Thông tin bên bán · Thông tin bên mua · Thông tin xe cần mua · Tổng giá trị mua hàng.

### B5. Giấy chứng nhận QSDĐ cần mua/đã sang tên KH (làm nhà xưởng) – 6 trường sau khi tách (chưa có dữ liệu test)

Tên mẫu biểu · Tên chủ sở hữu TSBĐ · Thửa đất số · Tờ bản đồ số / Địa chỉ thửa đất · Số Giấy chứng nhận.

Dòng "Tờ bản đồ số / Địa chỉ thửa đất" trong file là một dòng gộp. Giả định G6: tách thành 2 trường.

### B6. Tờ trình phê duyệt ngoại lệ – 1 trường (chưa có dữ liệu test)

Tên mẫu biểu. Chỉ cần nhận diện loại chứng từ.

---

## C. Nhóm hồ sơ tài sản đảm bảo

### C1. Tài sản là động sản

#### C1.1 Chứng nhận đăng ký xe ô tô – 5 trường

| # | Trường | Ghi chú | HS1 |
|---|---|---|---|
| 1 | Tên mẫu biểu | | ✓ |
| 2 | Số (Number) | `4900023055` | ✓ |
| 3 | Tên chủ xe | | ✓ |
| 4 | Nhãn hiệu, số loại | Kỳ vọng "KIA, CARENS", AI không trả giá trị | ✗ (thiếu kết quả) |
| 5 | Biển số đăng ký | `86A-364.34` | ✓ |

#### C1.2 Đăng kiểm xe – 4 trường

| # | Trường | Ghi chú | HS1 |
|---|---|---|---|
| 1 | Tên mẫu biểu | "GIẤY CHỨNG NHẬN KIỂM ĐỊNH AN TOÀN KỸ THUẬT VÀ BẢO VỆ MÔI TRƯỜNG XE CƠ GIỚI" | ✓ |
| 2 | Số (Number) | Kỳ vọng `VA1971478`, AI không trả | ✗ (thiếu kết quả) |
| 3 | Năm sản xuất | Kỳ vọng `2025`, AI không trả | ✗ (thiếu kết quả) |
| 4 | Tên chủ xe | Chưa có kỳ vọng | – |

#### C1.3 Báo giá tài sản – 4 trường (chưa có dữ liệu test)

Tên mẫu biểu · Loại (Model)/Nhãn hiệu · Năm sản xuất · Giá trị của tài sản.

#### C1.4 Báo cáo định giá động sản – 5 trường

| # | Trường | Ghi chú | HS1 |
|---|---|---|---|
| 1 | Tên mẫu biểu | "BÁO CÁO ĐỊNH GIÁ TÀI SẢN" | ✓ |
| 2 | Tên khách hàng vay vốn | | ✓ |
| 3 | Biển kiểm soát xe | | ✓ |
| 4 | Số máy | `G4FLSV149183` | ✓ |
| 5 | Giá trị của tài sản | `610000000` | ✓ |

### C2. Tài sản là bất động sản

#### C2.1 GCN quyền sử dụng đất, quyền sở hữu tài sản khác gắn liền với đất – 6 trường

| # | Trường | Ghi chú | HS1 | HS2 | HS3 | HS4 |
|---|---|---|---|---|---|---|
| 1 | Tên mẫu biểu | Có comment trong file: "Trường này ko cần check nhé" (xem giả định G3) | ⚠ | ✓ | ✓ | ✓ |
| 2 | Tên chủ sở hữu | Nhiều chủ nối bằng "+" | ⚠ | ✓ | ✓ | ✗ |
| 3 | Thửa đất số | | ⚠ | ✓ | ✓ | ✓ |
| 4 | Tờ bản đồ số | | ⚠ | ✓ | ✓ | ✓ |
| 5 | Địa chỉ thửa đất | | ⚠ | ✗ | ✓ | ✓ |
| 6 | Số Giấy chứng nhận | Ví dụ `BQ 747032`, `CY 857027`, `AA 01015410` | ⚠ | ✓ | ✓ | ✓ |

HS1 là ⚠ vì dữ liệu GCN trong hồ sơ HS1 thực chất là dữ liệu của HS4 (xem README, lỗi dữ liệu E2).

#### C2.2 GCN QSDĐ, sở hữu nhà ở và tài sản khác gắn liền với đất (căn hộ chung cư) – 5 trường

Tên mẫu biểu · Tên chủ sở hữu · Loại nhà ở · Tên nhà chung cư · Số Giấy chứng nhận.

Ở HS1 và HS4 các ô kỳ vọng chỉ là gợi ý vị trí ("… 2. Nhà ở: a, Loại nhà ở:"), không có giá trị thực tế, nhưng đánh giá vẫn ghi "Khớp" (⚠).

#### C2.3 Báo cáo định giá Bất động sản (Công ty TNHH Thịnh Điền) – 9 trường

| # | Trường | Vị trí/Ghi chú | HS1 | HS3 | HS4 |
|---|---|---|---|---|---|
| 1 | Tên mẫu biểu | "BÁO CÁO ĐỊNH GIÁ TÀI SẢN" | – | ✓ | ✓ |
| 2 | Tên khách hàng vay vốn | Mục I. Thông tin chung → "Khách hàng vay (dự kiến)" | – | ✓ | ⚠ |
| 3 | Số Giấy chứng nhận TSBĐ | Mục II.1 Giấy tờ chứng minh quyền sở hữu. Thực tế có thể kèm "do UBND … cấp ngày …, Số vào sổ …" | ⚠ | ✓ | ⚠ |
| 4 | Thửa đất số | Mục II.3 A – Thửa đất được quyền sử dụng TS1 → "Thửa đất số" | ⚠ | ✓ | ⚠ |
| 5 | Tờ bản đồ số | Cùng mục, "Tờ bản đồ số" | ⚠ | ✓ | ⚠ |
| 6 | Địa chỉ thửa đất | Cùng mục, "Địa chỉ" | ⚠ | ✓ | ⚠ |
| 7 | Hiện trạng thửa đất | Mục II.2 Hiện trạng sử dụng của tài sản (*) | ⚠ | ✓ | ⚠ |
| 8 | Giá trị của tài sản (VNĐ) | Mục III.1 Kết quả định giá → "Tổng giá trị tài sản tư vấn về giá" | ⚠ | ✓ | ⚠ |
| 9 | Hạng tài sản | Mục IV "Xếp loại TSBĐ" | ⚠ | ✓ | ⚠ |

Ở HS1 và HS4 cột Kỳ vọng chứa gợi ý vị trí, không phải giá trị, nên ⚠.

#### C2.4 Chứng thư/Báo cáo thẩm định giá của 4 công ty (7 trường mỗi công ty)

Cùng 7 trường cho cả 4 công ty: (1) Tên mẫu biểu · (2) Tên khách hàng yêu cầu · (3) Thông tin TSBĐ · (4) Hiện trạng thửa đất · (5) Giá trị của tài sản (VNĐ) · (6) Số Giấy chứng nhận · (7) Hạng tài sản.

Vị trí lấy dữ liệu theo từng công ty (theo ghi chú của file):

| Trường | SBA | CITICS | FARGO | VVFC |
|---|---|---|---|---|
| Tên mẫu biểu | CHỨNG THƯ THẨM ĐỊNH GIÁ | Chứng thư Thẩm Định Giá | CÔNG TY CP THẨM ĐỊNH GIÁ FARGO | CÔNG TY CP ĐỊNH GIÁ VÀ DỊCH VỤ TÀI CHÍNH VIỆT NAM VVFC |
| Tên KH yêu cầu | 1. Khách hàng thẩm định giá → "Khách hàng yêu cầu" | KHÁCH HÀNG | Khách hàng | Đơn vị đề nghị |
| Thông tin TSBĐ | 3. Thông tin về tài sản thẩm định giá → "Tài sản thẩm định giá" | TÀI SẢN THẨM ĐỊNH | Tài sản thẩm định | Tài sản thẩm định |
| Hiện trạng thửa đất | BC VI.2.1 Thửa đất → D. Các thông tin khác → 1. Hiện trạng sử dụng | BC 2.3 Hiện trạng thửa đất → Hiện trạng sử dụng | BC 4.A.II.1 Về đất → Hiện trạng tài sản sử dụng | 3.1 Đất → Hiện trạng sử dụng |
| Giá trị (VNĐ) | 9. Giá trị tài sản thẩm định giá → Tổng cộng | "Kết quả thẩm định giá như sau" → Tổng giá trị làm tròn | 8.4 Kết quả định giá → Tổng cộng | 10. Giá trị tài sản → 4. Tổng cộng → Giá trị (đồng) |
| Số GCN | BC V.1 Nguồn thông tin do KH cung cấp | "Thông tin pháp lý do khách hàng cung cấp" | 4.A.1 Giấy chứng nhận/quyết định… | 3.1 Đất → Pháp lý |
| Hạng tài sản | BC VI.2.1 → D. → 6. Xếp hạng tài sản | "Những điều khoản loại trừ và hạn chế" (nghi ngờ: vị trí này không đúng chỗ ghi hạng tài sản, xem G7) | 4.A.II.1 → "Xếp hạng tài sản theo quy định VPBank" | 3.1 Đất → Vị trí → "tài sản xếp hạng" |

Kết quả test: chỉ FARGO ở HS2 có dữ liệu.

| # | Trường (FARGO) | HS2 |
|---|---|---|
| 1 | Tên mẫu biểu | ✓ |
| 2 | Tên KH yêu cầu | ✓ |
| 3 | Thông tin TSBĐ | ✓ |
| 4 | Hiện trạng thửa đất | ✗ |
| 5 | Giá trị của tài sản (VNĐ) | ✓ |
| 6 | Số Giấy chứng nhận | ✓ (⚠ thực tế có thêm "Số vào sổ cấp GCN: CS00123") |
| 7 | Hạng tài sản | ✓ |

SBA, CITICS, VVFC: chưa có dữ liệu test.

---

## D. Nhóm hồ sơ chứng minh nguồn thu nhập và lịch sử tín dụng

### D1. Bảng kê thu nhập (MB01.Qđi-TDCN/41) – 37 trường

Trong nhóm thu nhập, cột Kỳ vọng của HS1 hay lấy bằng công thức `=cột thực tế` (⚠: không có giá trị kỳ vọng độc lập). Cột Kỳ vọng của HS4 chỉ là mô tả kiểu dữ liệu ("Lấy toàn bộ chữ và số…", "Ký tự bằng số"), nên không đối chiếu được (⚠).

| # | Trường | Kiểu/Ghi chú | HS1 | HS2 | HS3 | HS4 |
|---|---|---|---|---|---|---|
| 1 | Tên mẫu biểu | "THÔNG TIN THU NHẬP CỦA KHÁCH HÀNG / BẢNG KÊ THU NHẬP" | ✓ | ✓ | ✓ | ✓ |
| 2 | Tên khách hàng vay/người đồng vay | | ⚠ | ✓ | ✓ | ✗ |
| 3 | Căn cước công dân | HS4 trả kèm ngày cấp, nơi cấp | ✓ | ✓ | ✓ | ⚠ |
| 4 | Loại nguồn thu | | ✓ | ✓ | – | ✗ |
| 5 | Vòng quay | Số vòng quay vốn | ✗ | – | – | ✗ |
| 6 | II.1 Nguồn thu từ lương (mục) | Lấy toàn bộ chữ và số | – | – | – | – |
| 7 | II.1 a) Thông tin công việc hiện tại | Chữ và số | – | – | – | – |
| 8 | II.1 Chức vụ | Chữ và số | – | – | – | – |
| 9 | II.1 Thời gian làm việc tại đơn vị hiện tại (tháng) | Chữ và số | – | – | – | – |
| 10 | II.1 Địa chỉ nơi làm việc | Chữ và số | – | – | – | – |
| 11 | II.1 Thu nhập sau thuế (VND/tháng) | Chỉ số | – | – | – | – |
| 12 | II.2 Nguồn thu từ cho thuê tài sản (mục) | Chữ và số | – | – | – | – |
| 13 | II.2 Mô tả chi tiết về tài sản | Chữ và số | – | – | – | – |
| 14 | II.2 Tên chủ sở hữu | Chỉ chữ | – | – | – | – |
| 15 | II.2 Họ và tên người thuê | Chỉ chữ | – | – | – | – |
| 16 | II.2 Thời hạn hợp đồng thuê | Chữ và số | – | – | – | – |
| 17 | II.2 Thu nhập sau thuế (VND/tháng) | Chữ và số | – | – | – | – |
| 18 | II.3.1 HKD – Tên cơ sở kinh doanh | | ⚠ | ✓ | ✓ | ⚠ |
| 19 | II.3.1 HKD – Hình thức kinh doanh | Ô tích: "Có cơ sở kinh doanh" / "Online" / "Cả 2 hình thức trên" | ⚠ | ✓ | ✓ | ✗ |
| 20 | II.3.1 HKD – Ngành nghề kinh doanh | | ✓ | ✓ | ✓ | ⚠ |
| 21 | II.3.1 HKD – Thời gian đã hoạt động | Ví dụ "Từ năm 2021 đến nay", "> 3 năm", "6 NĂM" | ⚠ | ✓ | ✓ | ⚠ |
| 22 | II.3.1 HKD – Địa chỉ kinh doanh thực tế | Số nhà, đường, phường/xã, quận/huyện, tỉnh/TP | ⚠ | ✓ | ✓ | ⚠ |
| 23 | II.3.1 HKD – Mặt bằng, trụ sở kinh doanh | "Thuê" / "Khách hàng sở hữu" | ⚠ | – | ✓ | ⚠ |
| 24 | II.3.1 HKD – Diện tích mặt bằng (m²) | | ⚠ | – | – | ⚠ |
| 25 | II.3.1 HKD – Doanh thu thuần | Số; thực tế có thể là `600.000.000 đ` so với kỳ vọng `600000000` | ✓ | – | ✓ | ⚠ |
| 26 | II.3.1 HKD – Giá vốn hàng bán | | ⚠ | – | ✓ | ⚠ |
| 27 | II.3.1 HKD – Lợi nhuận gộp | | ⚠ | – | ✓ | ⚠ |
| 28 | II.3.1 HKD – Tổng chi phí | | ✓ | – | ✓ | ⚠ |
| 29 | II.3.1 HKD – Lợi nhuận ròng | | ⚠ | – | ✓ | ⚠ |
| 30 | II.3.2 Kinh doanh buôn chuyến – Phương tiện vận tải | Chữ và số | – | – | – | – |
| 31 | II.3.2 Kinh doanh buôn chuyến – Lợi nhuận ròng | Chữ và số (file ghi nhãn "3.1") | – | – | – | – |
| 32 | II.3.3 Doanh nghiệp – Tên doanh nghiệp | Chữ và số | – | – | – | – |
| 33 | II.3.3 Doanh nghiệp – Số ĐKKD/MST | Chữ và số | – | – | – | – |
| 34 | II.3.3 Doanh nghiệp – Tỷ lệ góp vốn của KH | Số + `%` | – | – | – | – |
| 35 | II.3.3 Doanh nghiệp – Địa chỉ theo ĐKKD | Chữ và số | – | – | – | – |
| 36 | II.3.3 Doanh nghiệp – Kết quả kinh doanh năm gần nhất (VNĐ/năm) | Chỉ số | – | – | – | – |
| 37 | II.3.3 Doanh nghiệp – Lợi nhuận trung bình tháng | Chỉ số | – | – | – | – |

Các trường 6–17 và 30–37 có trong mẫu nhưng chưa được test ở bất kỳ hồ sơ nào, vì cả 4 hồ sơ đều là hộ kinh doanh.

### D2. Hợp đồng lao động – 4 trường (chưa có dữ liệu test)

Tên mẫu biểu ("HỢP ĐỒNG LAO ĐỘNG") · Công ty · Tên KH · Căn cước công dân (lấy toàn bộ số).

### D3. Giấy xác nhận lương – 4 trường (chưa có dữ liệu test)

Tên mẫu biểu ("GIẤY XÁC NHẬN LƯƠNG") · Tên KH · Căn cước công dân · Tổng thu nhập thực lãnh.

### D4. Chứng từ chỉ cần nhận diện loại và/hoặc trích ít trường (chưa có dữ liệu test)

| Chứng từ | Trường trích xuất theo file |
|---|---|
| Sao kê lương | Sổ phụ tài khoản/sổ chi tiết tài khoản (nhận diện loại chứng từ) |
| VSSID | Quá trình tham gia bảo hiểm xã hội (nhận diện loại chứng từ) |
| Giấy chứng nhận đăng ký hộ kinh doanh | Số · Tên HKD · Địa điểm kinh doanh · Ngành nghề · Người đại diện · Căn cước công dân (6) |
| Xác nhận kinh doanh của chính quyền địa phương | Xác nhận kinh doanh · Ngành nghề · Địa chỉ kinh doanh (3) |
| Chứng từ nộp thuế ("GIẤY NỘP TIỀN VÀO NGÂN SÁCH NHÀ NƯỚC") | Người nộp ngân sách nhà nước · Mã số thuế (2) |
| Sổ sách | Sổ sách bán hàng/nhập hàng (lấy toàn bộ chữ, kể cả viết tắt) |
| Hình ảnh HKD | Không có trường (chỉ nhận diện ảnh) |
| Đăng ký kinh doanh doanh nghiệp | Số ĐKKD · Tên công ty · Địa chỉ trụ sở · Người đại diện theo pháp luật (4) |
| Tờ khai thuế VAT (01/GTGT) | Kỳ tính thuế · Tên người nộp thuế (2) |
| Báo cáo kết quả hoạt động kinh doanh | Kỳ · Tên công ty (2) |
| Bảng cân đối kế toán | Kỳ · Tên công ty (2) |
| Hình ảnh doanh nghiệp KH làm chủ | Không có trường (chỉ nhận diện ảnh) |
| Biên bản hội đồng thành viên | Tên công ty · Họ và tên · Căn cước công dân (3) |
| Hợp đồng tín dụng (TCTD khác) | Số HĐ tín dụng · Ngày ký · Bên cho vay · Bên vay · Căn cước công dân · Số tiền vay · Mục đích · Thời hạn vay (8; lấy toàn bộ thông tin kể cả dấu và số) |
| CIC tài sản bảo đảm (không OCR, lấy dữ liệu từ IL) | Tên mẫu biểu · Ngày tra cứu · Họ tên · Mã CIC · Căn cước công dân · Danh sách TCTD khác đang quan hệ |

### D5. CIC KH – người đồng vay – chủ TSBĐ (mẫu S11A cho thể nhân; S11T cũng xuất hiện ở sheet check chéo HS4) – 10 trường

| # | Trường | Ghi chú | HS1 | HS2 | HS3 | HS4 |
|---|---|---|---|---|---|---|
| 1 | Tên mẫu biểu | "BÁO CÁO CHI TIẾT QUAN HỆ TÍN DỤNG", có thể có hậu tố "(Khách hàng thể nhân)" hoặc "TỨC THỜI" | ✗ | ✓ | ✓ | ⚠ |
| 2 | Ngày tra cứu | Có thể kèm giờ: `26/05/2026 19:40:00` (HS4: nhãn trên form là "Thời gian gửi báo cáo") | ✓ | ✓ | ✓ | ⚠ |
| 3 | Họ và tên | Không dấu, in hoa; HS4 CIC ghi `TRƯƠNG T MỸ LIÊN` | ✓ | ✓ | ✓ | ⚠ |
| 4 | Mã CIC | 10 chữ số | ✓ | ✓ | ✓ | ⚠ |
| 5 | Số CCCD/CMND | | ✓ | ✓ | ✓ | ⚠ |
| 6 | Kiểm tra nhóm nợ | "Nhóm 1 (Nợ đủ tiêu chuẩn)"; AI có thể trả `1`, `Nhóm 1` hoặc "Không có" | ✓ | ✗ | ✓ | ⚠ |
| 7 | Lịch sử nợ xấu trong 5 năm (mục 3.5) | | ✗ | ✓ ⚠ | ✓ | ✗ |
| 8 | Lịch sử chậm thanh toán thẻ trong 3 năm (mục 3.6) | | ✗ | ✓ ⚠ | ✓ | ✗ |
| 9 | Nợ cần chú ý trong 12 tháng (mục 3.7) | | ✗ | ✓ ⚠ | ✓ | ✗ |
| 10 | Danh sách TCTD tra cứu (1 năm gần nhất) | HS2 `8 // 12`, HS3 `31` và `23` (số lượng); HS4 trả danh sách tên | – | ✓ | ✓ | ⚠ |

Ba dòng 7–9 trong file nằm trong cùng một dòng "Lịch sử nợ xấu (5 năm) / chậm thanh toán thẻ (3 năm) / nợ cần chú ý (12 tháng)". Giả định G5: tách thành 3 trường riêng. Do đó tổng là 10 trường.

---

## Danh sách chi tiết các trường không khớp (kỳ vọng và thực tế)

Nguyên nhân:

- AI-miss: AI không đọc hoặc không nhận diện được.
- Sai dạng/Format: giá trị khác nhau về định dạng hoặc nội dung thừa/thiếu.
- Chính tả: AI đọc sai dấu hoặc chữ.
- Test-data: kỳ vọng của file test có vẻ sai hoặc không nhất quán (xem README §Lỗi dữ liệu).

### CCCD (A1)

| Hồ sơ | Đối tượng | Trường | Kỳ vọng | Thực tế (AIF) | Nhận xét | Nguyên nhân |
|---|---|---|---|---|---|---|
| HS3 | KH | Nơi thường trú | `185/1 Nguyễn Thị Đô, Phú Hòa Đông, Củ Chi, TP. HCM` | `185/1 Nguyễn Thị Đô, Phú Hòa Đông, Củ Chi, TP. HCM` | File ghi "không khớp (AI đọc sai chính tả)" nhưng hai ô giống hệt nhau. Sheet check chéo của cùng hồ sơ ghi tên đường là "Nguyễn Thị Đó" | Chính tả (+ Test-data: không lưu giá trị lệch thật) |
| HS3 | ĐV | Nơi thường trú | `8/5E Ngô Tất Tố, Phường 22, Bình Thạnh, TP. Hồ Chí Minh` | Giống hệt | Cùng đánh giá như trên | Chính tả (+ Test-data) |
| HS4 | KH | Họ và tên | `TRƯƠNG THỊ MỸ LIÊN` | `TRƯƠNG THỊ MỸ LIÊN` | Ghi chú: "Khớp tên KH nhưng không khớp tên người đồng vay (do AI đọc thiếu dấu)" | Chính tả |
| HS4 | ĐV | Họ và tên | `LỮ KIM AN` | `LỮ KIM AN` | Giá trị lệch thật không được lưu trong file | Chính tả (+ Test-data) |

### VNeID (A2)

| Hồ sơ | Đối tượng | Trường | Kỳ vọng | Thực tế (AIF) | Nhận xét | Nguyên nhân |
|---|---|---|---|---|---|---|
| HS2 | KH | Nơi thường trú | `Thôn Phạm Xá, xã Yên Cường , tỉnh Ninh Bình` | `Xóm 14, Yên Nhân, Ý Yên, Nam Định` | AI lấy địa chỉ cũ (in trên CCCD/QR) thay vì địa chỉ mới của VNeID | AI-miss (lấy sai nguồn) |
| HS1, HS4 | – | Cả chứng từ | Có chứng từ | AI không nhận diện (checklist) | Không có kết quả trích xuất | AI-miss |
| HS3 | – | Tên mẫu biểu | "Căn cước điện tử" | "Căn cước điện tử" | Checklist AI trả "Không", dù thông tin trích đúng ("tiêu đề không được nêu bật") | AI-miss (phân loại) |

### QR code (A3)

| Hồ sơ | Đối tượng | Trường | Kỳ vọng | Thực tế (AIF) | Nhận xét | Nguyên nhân |
|---|---|---|---|---|---|---|
| HS2 | KH | Tên mẫu biểu | `QR code` | `QR code` | Hai ô giống hệt nhưng bị đánh "Không khớp" | Test-data |
| HS3 | KH+ĐV | Tên mẫu biểu | `Thông tin căn cước công dân` | `0` | AI trả giá trị 0 | AI-miss |
| HS4 | KH | Tên mẫu biểu | `QR code` | `Căn cước công dân` | AI phân loại QR thành CCCD | AI-miss (phân loại) |
| HS4 | ĐV | Tên mẫu biểu | `QR code` | `căn cước công dân` | Như trên | AI-miss (phân loại) |
| HS4 | ĐV | Số CCCD / Số CMND 9 số | `096068009037` / `380733262` | (trống) | Thực tế trống nhưng file vẫn đánh "Khớp" | AI-miss (+ Test-data: đánh giá sai) |
| HS4 | ĐV | Họ và tên | `LỮ KIM AN` | (trống) | Ghi chú "không khớp tên người đồng vay (do AI đọc thiếu dấu)" | AI-miss |
| HS1, HS4 | – | Cả chứng từ | Có chứng từ | AI không nhận diện QR (checklist) | – | AI-miss |

### Xác nhận cư trú (A4) – HS4

| Đối tượng | Trường | Kỳ vọng | Thực tế (AIF) | Nhận xét | Nguyên nhân |
|---|---|---|---|---|---|
| KH + ĐV | Tên mẫu biểu | `Xác nhận thông tin về cư trú` | `Giấy chứng nhận kết hôn` | AI phân loại nhầm. Checklist cũng ghi AI không nhận diện "Xác nhận cư trú" | AI-miss (phân loại) |
| KH + ĐV | Họ và tên | `LỮ KIM AN` | `LỮ KIM AN` | "Không khớp tên (do AI đọc thiếu dấu)" | Chính tả |
| KH + ĐV | Nơi thường trú | `16b Lý Văn Lâm, Khóm 12, phường An Xuyên, tỉnh Cà Mau` | `AI không bắt được thông tin địa chỉ thường trú` | AI không lấy được trường | AI-miss |
| KH + ĐV | Nơi tạm trú / Nơi ở hiện tại | `16b Lý Văn Lâm, Khóm 12, phường An Xuyên, tỉnh Cà Mau` | `AI không bắt được thông tin địa chỉ thường trú` | Như trên | AI-miss |

### Đăng ký kết hôn (A8) – HS4

| Đối tượng | Trường | Kỳ vọng | Thực tế (AIF) | Nhận xét | Nguyên nhân |
|---|---|---|---|---|---|
| KH + ĐV | Họ và tên vợ/chồng | `TRƯƠNG THỊ MỸ LIÊN + LỮ KIM AN` | Cùng chuỗi trong file | "Khớp tên KH nhưng không khớp tên người đồng vay (do AI đọc thiếu dấu)" | Chính tả |

### Giấy đề nghị vay vốn (B1)

| Hồ sơ | Trường | Kỳ vọng | Thực tế (AIF) | Nhận xét | Nguyên nhân |
|---|---|---|---|---|---|
| HS1 | Tên mẫu biểu | `GIẤY ĐỀ NGHỊ VAY VỐN CÓ TÀI SẢN BẢO ĐẢM KIÊM PHƯƠNG ÁN SỬ DỤNG VỐN; GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG CẤP HẠN MỨC TÍN DỤNG THẺ…; GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ VÀ SỬ DỤNG TÀI KHOẢN THANH TOÁN…` | `GIẤY ĐỀ NGHỊ VAY VỐN CÓ TÀI SẢN BẢO ĐẢM KIÊM PHƯƠNG ÁN SỬ DỤNG VỐN` | AI chỉ trả tiêu đề đầu. Có comment "Trường này ko cần check nhé" ở dòng này (G3) | Sai dạng |
| HS1 | Tình trạng hôn nhân | `không có thông tin` | `Ly hôn` | Chứng từ A5 của HS1 xác nhận đã ly hôn nên kỳ vọng có vẻ sai | Test-data |
| HS1 | CCCD chủ sở hữu tài sản | `=C65` (công thức, giá trị = "không có thông tin") | `060079000317` | Công thức kỳ vọng trỏ nhầm ô. Giá trị đúng là `060079000317` | Test-data |
| HS1 | Mục đích vay vốn | `Phục vụ nhu cầu đời sống` | `Kinh doanh trồng và mua bán thanh long` | Cần xác nhận lại kỳ vọng, vì ngành nghề, nguồn trả nợ và bảng kê mua hàng đều là kinh doanh | Test-data (nghi ngờ) |
| HS1 | Lãi suất | `Áp dụng LC10 (11.19% - 6 tháng đầu), biểu HKD.3` | `Áp dụng LC10 (11.19% - 6 tháng đầu), biểu HKD.3, theo biểu lãi suất số 41-2026-BGA-TGD (và các thông báo thay đổi tại thời điểm giải ngân nếu có) (và các thông báo thay đổi tại thời điểm giải ngân nếu có)` | AI thừa nội dung và lặp cụm "(và các thông báo thay đổi …)" | Sai dạng |
| HS2 | Tên mẫu biểu (KH + ĐV) | `Giấy đề nghị vay vốn (mẫu VPBank)` | `Giấy đề nghị vay vốn (mẫu VPBank)` | Hai ô giống hệt nhau nhưng bị đánh "Không khớp" | Test-data |
| HS2 | Mục đích vay vốn | `Vay bổ sung vốn kinh doanh nhà hàng, dịch vụ ăn uống` | `Vay phục vụ hoạt động sản xuất kinh doanh của Hộ kinh doanh (HKD): Vay bổ sung vốn/mở rộng/phát triển kinh doanh` | AI lấy tên phương án in sẵn trên mẫu, chưa lấy nội dung cụ thể | Sai dạng |
| HS2 | Lãi suất | `QĐ 57/2026 PL BGA-TGĐ-LC7` | `"ko thể hiện"` | Không đọc được | AI-miss |
| HS2 | Mối quan hệ với người vay chính | `Mẹ đẻ` | `"ko thể hiện"` | Không đọc được | AI-miss |
| HS3 | Ngành nghề kinh doanh | `Bán buôn sỉ lẻ quần áo` | `Vay bổ sung vốn lưu động theo hạn mức kinh doanh` | AI điền mục đích vào ô ngành nghề | AI-miss (lấy nhầm trường) |
| HS3 | Mục đích vay vốn | `Vay kinh doanh- Vay bổ sung vốn lưu động theo hạn mức Bán buôn sỉ lẻ quần áo` | `Vay bổ sung vốn lưu động theo hạn mức kinh doanh` | Thiếu phần "Bán buôn sỉ lẻ quần áo" | Sai dạng |
| HS3 | Lãi suất | `91-2026-BGA-TGĐ-HKD3-LC9` | `0` | "AI không đọc được thông tin lãi suất trên file ĐNVV" | AI-miss |
| HS4 | Tên mẫu biểu | Cả 3 tiêu đề nối bằng `;` | Chỉ tiêu đề đầu | Checklist: "AI nhận diện chưa đúng tên mẫu biểu" | Sai dạng |
| HS4 | Tên chủ sở hữu TSBĐ | `Trương Thị Mỹ Liên và Lữ Kim An` | Cùng chuỗi trong file | "Không khớp tên người đồng vay (do AI đọc thiếu dấu)" | Chính tả |

### Giấy chứng nhận QSDĐ (C2.1)

| Hồ sơ | Trường | Kỳ vọng | Thực tế (AIF) | Nhận xét | Nguyên nhân |
|---|---|---|---|---|---|
| HS2 | Địa chỉ thửa đất | `Thôn Phạm Xá, xã Yên Cường, tỉnh Ninh Bình` | `xóm 14, xã Yên Nhân, huyện Ý Yên, tỉnh Nam Định` | GCN in địa chỉ cũ (trước sáp nhập đơn vị hành chính). Kỳ vọng dùng địa chỉ mới | Sai dạng (địa chỉ cũ/mới) |
| HS4 | Tên chủ sở hữu | `LỮ KIM AN + TRƯƠNG THỊ MỸ LIÊN` | Cùng chuỗi trong file | "Không khớp tên người đồng vay (do AI đọc thiếu dấu)" | Chính tả |

### Chứng thư thẩm định giá FARGO (C2.4) – HS2

| Trường | Kỳ vọng | Thực tế (AIF) | Nhận xét | Nguyên nhân |
|---|---|---|---|---|
| Hiện trạng thửa đất | `Nhà riêng lẻ 2 tầng ...` | `"ko thể hiện"` | Không đọc được | AI-miss |

### Bảng kê thu nhập (D1)

| Hồ sơ | Trường | Kỳ vọng | Thực tế (AIF) | Nhận xét | Nguyên nhân |
|---|---|---|---|---|---|
| HS1 | Vòng quay | `3` | `AI không nhận diện được vòng quay vốn` | | AI-miss |
| HS4 | Tên khách hàng vay/người đồng vay | Chỉ là mô tả "Khách hàng vay/ người đồng vay" | `Trương Thị Mỹ Liên/Lữ Kim An` | "Khớp tên KH nhưng không khớp tên người đồng vay (do AI đọc thiếu dấu)". Hai tên nằm chung một ô nên cần tách thành 2 người | Chính tả |
| HS4 | Loại nguồn thu | `Lợi nhuận từ Kinh doanh Mua bán thực phẩm tươi sống` | `Mua bán thực phẩm tươi sống` | Thiếu tiền tố "Lợi nhuận từ Kinh doanh". Có thể kỳ vọng đã lấy từ ĐNVV (nguồn trả nợ) | Sai dạng (+ Test-data nghi ngờ) |
| HS4 | Vòng quay | `4` | `AI không nhận diện được vòng quay vốn` | | AI-miss |
| HS4 | Hình thức kinh doanh | Ô tích: "Có cơ sở kinh doanh" / "Online" / "Cả 2 hình thức trên" | `AI không nhận diện được hình thức kinh doanh` | AI không đọc được ô tích | AI-miss |

### CIC (D5)

| Hồ sơ | Đối tượng | Trường | Kỳ vọng | Thực tế (AIF) | Nhận xét | Nguyên nhân |
|---|---|---|---|---|---|---|
| HS1 | KH | Tên mẫu biểu | `BÁO CÁO CHI TIẾT QUAN HỆ TÍN DỤNG` | `BÁO CÁO CHI TIẾT QUAN HỆ TÍN DỤNG( Khách hàng thể nhân)` | AI thêm hậu tố. Ở HS4 một chênh lệch tên mẫu tương tự ("TỨC THỜI" so với "(Khách hàng thể nhân)") lại được coi là "Khớp" | Sai dạng (đánh giá không nhất quán) |
| HS1 | KH | Nợ xấu 5 năm | `KH không có nợ xấu trong 5 năm gần nhất` | `AI không nhận diện được` | | AI-miss |
| HS1 | KH | Chậm thanh toán thẻ 3 năm | `KH không bị chậm thanh toán thẻ tín dụng trong 5 năm gần nhất` (file ghi 5 năm, mục form là 3 năm: nghi lỗi chữ) | `AI không nhận diện được` | | AI-miss (+ Test-data) |
| HS1 | KH | Nợ cần chú ý 12 tháng | `KH không có nợ cần chú ý trong 12 tháng gần nhất` | `AI không nhận diện được` | | AI-miss |
| HS2 | KH + ĐV | Kiểm tra nhóm nợ | `Nhóm 1 (Nợ đủ tiêu chuẩn)` | `Không có` | | AI-miss |
| HS4 | KH | Nợ xấu 5 năm (3.5) | `3.5 Lịch sử nợ xấu tín dụng trong 05 năm gần nhất` | `AI không nhận diện được` | Cột kỳ vọng chỉ là tên mục | AI-miss |
| HS4 | KH | Chậm thanh toán thẻ 3 năm (3.6) | `3.6 Lịch sử chậm thanh toán thẻ tín dụng trong vòng 03 năm gần nhất` | `AI không nhận diện được` | | AI-miss |
| HS4 | KH | Nợ cần chú ý 12 tháng (3.7) | `3.7 Nợ cần chú ý trong vòng 12 tháng gần nhất` | `AI không nhận diện được` | | AI-miss |

### Nhận diện chứng từ (checklist) liên quan tới trích xuất

| Hồ sơ | Chứng từ | Kỳ vọng | Thực tế (AIF) | Ghi chú |
|---|---|---|---|---|
| HS1 | Quét mã QR code | Có | Không | AI không nhận diện được |
| HS1 | Căn cước điện tử (VNeID) | Có | Không | AI không nhận diện được |
| HS1 | Giấy đề nghị vay vốn | Có | Có | AI nhận diện chưa đúng tên mẫu biểu |
| HS2 | Căn cước điện tử (VNeID) | Có | Không | AI không nhận diện được VNeID + thông tin cư trú |
| HS3 | Căn cước điện tử (VNeID) | Có | Không | Thông tin khớp nhưng tiêu đề không được nêu bật |
| HS4 | Quét mã QR code | Có | Không | AI không nhận diện được |
| HS4 | Căn cước điện tử (VNeID) | Có | Không | AI không nhận diện được |
| HS4 | Xác nhận cư trú | Có | Không | AI không nhận diện được |
| HS4 | Giấy đề nghị vay vốn | Có | Có | AI nhận diện chưa đúng tên mẫu biểu |

### Các trường lệch giá trị nhưng file vẫn đánh "Khớp" (cần rà soát lại đánh giá)

| Hồ sơ | Chứng từ | Trường | Kỳ vọng | Thực tế | Nhận xét |
|---|---|---|---|---|---|
| HS1 | Bảng kê thu nhập | Giá vốn hàng bán | `500000000` | `550.000.000 đ` | Lệch 50 triệu, không phải khác định dạng. Với doanh thu 600 triệu, kỳ vọng 500 triệu khớp lợi nhuận gộp 100 triệu, còn giá trị thực tế 550 triệu thì không |
| HS1 | Bảng kê thu nhập | Tên khách hàng vay/người đồng vay | `Trần Thanh Tuấn` | `Trương Thị Mỹ Liên/Lữ Kim An` | Tên của một hồ sơ khác (HS4) bị dán vào HS1 |
| HS1 | CIC | Kiểm tra nhóm nợ | `Nhóm 1 (Nợ đủ tiêu chuẩn)...` | `1` | Khác định dạng, có thể chấp nhận nếu có quy tắc chuẩn hóa |
| HS2 | CIC | Lịch sử nợ xấu/chậm thẻ/nợ cần chú ý | `Không có thông tin` | `"ko thể hiện"` | Cùng ý nghĩa "không có" nhưng chuỗi khác |
| HS3 | VNeID | Số CMND 9 số | `0` | `0` | VNeID không có CMND 9 số, nên kỳ vọng `0` thực chất nghĩa là "để trống" |
| HS4 | Báo cáo định giá BĐS và Bảng kê thu nhập | Nhiều trường | Chỉ là gợi ý vị trí/kiểu dữ liệu | Có giá trị | Không đối chiếu được |
| HS4 | QR | Số CCCD, Số CMND ĐV | Có giá trị | (trống) | Xem bảng QR |
