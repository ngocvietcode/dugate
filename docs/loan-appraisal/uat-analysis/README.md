# Phân tích file test UAT – Tiếp nhận và hoàn thiện hồ sơ vay (luồng FAST)

Nguồn: `TestResults_CheckChecklist_2.xlsx` (đơn vị cung cấp). Đã đọc toàn bộ 14 sheet, gồm 2 sheet ẩn.

## Cấu trúc tài liệu

| File | Nội dung |
|---|---|
| [`01-field-extraction-by-form.md`](./01-field-extraction-by-form.md) | **Phần 1.** Danh sách đầy đủ trường cần trích xuất của từng mẫu biểu, kết quả test theo 4 hồ sơ, và bảng chi tiết từng trường không khớp (kỳ vọng so với thực tế) |
| [`02-cross-document-checks.md`](./02-cross-document-checks.md) | **Phần 2.** Nghiệp vụ check chéo giữa các chứng từ: quy tắc theo trường, kết quả test, tiêu chí Pass/Fail, các điểm cần chốt |
| `README.md` (file này) | Tổng quan file test, giả định, lỗi dữ liệu trong file test |

## Cấu trúc file test

| Sheet | Loại | Nội dung |
|---|---|---|
| `back up` (ẩn) | Dashboard | Bảng tổng hợp % chính xác và tình trạng xử lý lỗi theo 4 hạng mục. Các công thức tham chiếu 3 sheet chi tiết đã bị xóa (`#REF!`), chỉ phần "Đối chiếu chéo dữ liệu" còn hoạt động |
| `4. Đối chiếu chéo` (ẩn) | Khung log | 52 dòng log trống, mới điền 2 dòng mẫu. Luồng vay ghi là "FULL" |
| `OCR FAST …` ×4 | Kết quả trích xuất | Trường × (Kỳ vọng, Kết quả AIF, Đánh giá), theo từng mẫu biểu |
| `Checklist FAST …` ×4 | Nhận diện chứng từ | Danh mục chứng từ: Kỳ vọng "Có/Không" so với kết quả AIF |
| `Check chéo FAST …` ×4 | Check chéo | Ma trận trường × chứng từ nguồn |

Bốn hồ sơ test (HS1–HS4 dùng xuyên suốt các tài liệu):

| Mã | Mã hồ sơ | Người vay / Đồng vay | TSBĐ |
|---|---|---|---|
| HS1 | LN2605288322713 (MYNTH11) | Trần Thanh Tuấn | Động sản (ô tô KIA Carens) |
| HS2 | LN2610088913941 (NGOCTTP3) | Ngô Ngọc Hoàn + Nguyễn Thị Phương Thảo | BĐS |
| HS3 | LN2608218749371 (PHUONGNT13) | Võ Thị Cẩm Tiên + Tạ Viết Dũng | BĐS |
| HS4 | LN2609038780853 (HOACL) | Trương Thị Mỹ Liên + Lữ Kim An | BĐS |

Cả 4 hồ sơ đều là vay hộ kinh doanh, nên các mục lương, cho thuê, buôn chuyến, doanh nghiệp, hợp đồng lao động, hợp đồng mua bán xe/hàng hóa chưa có dữ liệu test. Các trường này vẫn được liệt kê đầy đủ ở `01`.

## Tóm tắt kết quả

### Trích xuất (Phần 1)

Số mẫu biểu và số trường đã liệt kê trong `01`:

| Nhóm | Mẫu biểu | Trường |
|---|---|---|
| A. Pháp lý | 9 | 54 (CCCD 8, VNeID 7, QR 4, Xác nhận cư trú 7, Xác nhận hôn nhân 9, Xác nhận CMND địa phương 6, Cam kết 4, Đăng ký kết hôn 5, Khai sinh 4) |
| B. Phương án vay vốn | 6 | 37 (Đề nghị vay vốn 18, Bảng kê mua hàng 3, HĐ mua bán hàng hóa 4, HĐ mua bán xe 5, GCN nhà xưởng 6, Tờ trình ngoại lệ 1) |
| C. TSBĐ | 11 (4 động sản, GCN, GCN căn hộ, báo cáo Thịnh Điền, 4 hãng thẩm định) | 66 (động sản 18, GCN 6, GCN căn hộ 5, Thịnh Điền 9, 4 hãng × 7 = 28) |
| D. Nguồn thu, tín dụng | 19 (2 loại chỉ là ảnh, không có trường) | 96 (Bảng kê thu nhập 37, CIC khách hàng 10, CIC TSBĐ 6, HĐ tín dụng 8, còn lại 35) |

Tổng: 45 mẫu biểu, 253 trường từ file test (đã tách theo G5 và G6), cộng thêm 8 trường `subject_name` [Bổ sung] (tên đối tượng cho các chứng từ chưa có trường tên: tờ trình ngoại lệ, báo giá tài sản, sao kê lương, VSSID, xác nhận kinh doanh, sổ sách, ảnh HKD, ảnh doanh nghiệp) = 261 trường, cộng 3 trường [Bổ sung] trên đề nghị vay vốn (`interest_rate_percent`, `has_existing_debt`, `existing_monthly_debt_payment`) để tính DSCR = 264 trường; 5 trường object (thông tin bên bán, bên mua, xe cần mua) của hợp đồng mua bán được tách thành 19 trường phẳng = 278 trường. Danh mục sạch theo từng mẫu biểu: [`03-field-catalog.md`](./03-field-catalog.md) và [`03-field-catalog.json`](./03-field-catalog.json).

Các điểm không khớp chính (chi tiết ở `01`):

- **Địa chỉ thường trú** là lỗi lớn nhất: AI lấy địa chỉ từ chứng từ không đáng tin (CCCD, QR, Đăng ký kết hôn, CIC) thay vì VNeID/Xác nhận cư trú. Xuất hiện ở cả 4 hồ sơ.
- **Không nhận diện được loại chứng từ**: VNeID (4/4 hồ sơ), QR (HS1, HS4), Xác nhận cư trú (HS4). AI phân loại QR thành "Căn cước công dân", Xác nhận cư trú thành "Giấy chứng nhận kết hôn".
- **Tên mẫu biểu của Giấy đề nghị vay vốn** (mẫu 3-trong-1) chỉ nhận được tiêu đề đầu.
- **Giấy đề nghị vay vốn**: Lãi suất (3/4 hồ sơ), Mục đích vay vốn (3/4), Mối quan hệ người tham chiếu (HS2), Ngành nghề (HS3, AI điền mục đích vào ô ngành nghề).
- **Bảng kê thu nhập**: Vòng quay (không nhận diện, HS1 và HS4), Hình thức kinh doanh (ô tích, HS4).
- **CIC**: ba chỉ tiêu nợ xấu/chậm thẻ/nợ cần chú ý không nhận diện (HS1, HS4); Kiểm tra nhóm nợ trả "Không có" (HS2).
- **Đọc thiếu dấu** tên người đồng vay `LỮ KIM AN` (HS4) ở nhiều chứng từ (CCCD, QR, Xác nhận cư trú, Đăng ký kết hôn, Đề nghị vay vốn, GCN, Bảng kê thu nhập).

### Check chéo (Phần 2)

Bảy trường check chéo cho mỗi đối tượng: Họ tên, CCCD, Ngày sinh, Địa chỉ thường trú, Ngành nghề, Số tờ bản đồ, Số thửa đất. Số dòng hệ thống ghi "Không khớp": HS1 = 2, HS2 = 3, HS3 = 6, HS4 = 7.

- Địa chỉ thường trú: không khớp ở cả 4 hồ sơ (nguyên nhân gốc là quy tắc nguồn địa chỉ).
- Báo sai (false positive): HS3 Ngành nghề, HS3 Chủ TSBĐ 2 Số CCCD, cảnh báo ngành nghề của Bảng kê mua hàng (HS2, HS3), cảnh báo thiếu GCN đăng ký HKD (HS3).
- Bỏ sót (false negative): HS2 Số tờ bản đồ/Số thửa đất (giá trị khác nhau nhưng hệ thống ghi "Khớp").

## Quy tắc địa chỉ thường trú

Đây là quy tắc nghiệp vụ duy nhất được ghi nhận lặp lại trong cả 4 sheet check chéo, nên được tách riêng. Đơn vị ghi (cột Đánh giá của dòng Địa chỉ thường trú):

> "AI vẫn chưa biết cách lấy đúng địa chỉ thường trú đúng KH chỗ nào, chỗ lấy đúng là trên chứng từ VNIED, hoặc xác nhận cư trú, những chứng từ khác không cần OCR vì không chính xác (Ví dụ Đăng ký kết hôn/CIC/QR/CCCD)."

Hệ quả cho cài đặt:

1. Địa chỉ thường trú chỉ trích và dùng làm giá trị chuẩn từ **VNeID** hoặc **Xác nhận cư trú**.
2. Với CCCD, QR, Đăng ký kết hôn, CIC thì không trích hoặc không dùng địa chỉ thường trú để kết luận sai lệch.
3. Cần xử lý khác biệt địa chỉ trước và sau sáp nhập đơn vị hành chính (HS2, HS3).

Chi tiết và các ngoại lệ trong `02` mục CC-04.

---

## Giả định

Đây là những điểm file không nói rõ, tôi đã giả định để tiếp tục. Mong đơn vị xác nhận.

| Mã | Giả định |
|---|---|
| G1 | Sheet check chéo: cột A là giá trị chuẩn (Kỳ vọng), cột B là giá trị hệ thống trích, cột C là đánh giá của đơn vị, **cột E là kết quả check chéo do hệ thống trả** |
| G2 | Sheet ẩn `4. Đối chiếu chéo` ghi luồng "FULL" nên coi là khung log chung. File chưa có dữ liệu check chéo của luồng FAST theo khung này, nên mục 5 của `02` chỉ mô tả quy tắc Pass/Fail |
| G3 | Hai comment "Trường này ko cần check nhé" ở ô `A59` (Giấy đề nghị vay vốn) và `A118` (GCN QSDĐ) của sheet HS1 nằm cùng dòng với trường "Tên mẫu biểu". Tôi hiểu là **bỏ qua trường Tên mẫu biểu** của hai chứng từ này. Nếu đúng, các lỗi "Tên mẫu biểu" của Giấy đề nghị vay vốn ở HS1, HS2, HS4 không còn là lỗi |
| G4 | Nhiều ô Kỳ vọng ở HS4 và một phần HS1 là gợi ý vị trí hoặc kiểu dữ liệu ("Lấy toàn bộ chữ và số…", "Ký tự bằng số") thay vì giá trị. Tôi đánh dấu ⚠ ở `01` và **không** coi là khớp |
| G5 | Dòng CIC "Lịch sử nợ xấu (5 năm) / chậm thanh toán thẻ (3 năm) / nợ cần chú ý (12 tháng)" gộp 3 chỉ tiêu. Tôi tách thành 3 trường riêng (mục 3.5, 3.6, 3.7 của CIC) |
| G6 | Dòng "Tờ bản đồ số / Địa chỉ thửa đất" của GCN làm nhà xưởng gộp 2 trường. Tôi tách thành 2 trường |
| G7 | Với chứng thư CITICS, vị trí lấy "Hạng tài sản" trong file là "Những điều khoản loại trừ và hạn chế". Có vẻ không đúng vị trí, nhưng tôi chép nguyên vì không có chứng thư gốc để đối chiếu |
| G8 | `"ko thể hiện"` và `AI không nhận diện được` do AI trả: nghĩa là AI không lấy được giá trị. Tôi tính là không khớp khi Kỳ vọng có giá trị, và là khớp khi Kỳ vọng cũng là "Không có thông tin" |
| G9 | Mức độ khớp "định dạng" (ví dụ `600000000` so với `600.000.000 đ`, `1` so với `Nhóm 1 (Nợ đủ tiêu chuẩn)`) được tính là khớp nếu đơn vị đã đánh "Khớp". Tôi không tự đánh giá lại |
| G10 | Với ô đánh giá ghi cho cả hai đối tượng (một ô gộp cho KH vay và đồng vay), tôi gán cho cả hai đối tượng |

Lưu ý về dữ liệu cá nhân: tài liệu chép nguyên họ tên, số CCCD và địa chỉ có trong file test. File không cho biết đây là dữ liệu thật hay giả lập. Nếu là dữ liệu thật, hãy thay bằng dữ liệu giả trước khi commit hoặc chia sẻ ngoài đội dự án.

---

## Lỗi dữ liệu trong file test (nên sửa trước khi dùng làm chuẩn)

| Mã | Vị trí | Vấn đề | Tác động |
|---|---|---|---|
| E1 | HS1 OCR, Bảng kê thu nhập, "Tên khách hàng vay": Kỳ vọng `Trần Thanh Tuấn`, Thực tế `Trương Thị Mỹ Liên/Lữ Kim An`, đánh giá "Khớp" | Tên của hồ sơ HS4 bị dán vào HS1 | Đánh giá sai |
| E2 | HS1 OCR, mục BĐS: GCN và Báo cáo định giá Thịnh Điền (chủ `LỮ KIM AN + TRƯƠNG THỊ MỸ LIÊN`, thửa 356, tờ 42, GCN `BQ 747032`, 323.532.887) | Là dữ liệu của HS4; HS1 là hồ sơ TSBĐ ô tô của chính KH | Toàn bộ khối BĐS của HS1 không dùng được |
| E3 | HS1 OCR, Giấy đề nghị vay vốn, "CCCD chủ sở hữu tài sản": Kỳ vọng `=C65` | Công thức trỏ nhầm sang ô Tình trạng hôn nhân; giá trị đúng là `060079000317` | Báo lỗi sai |
| E4 | HS1 OCR, "Tình trạng hôn nhân": Kỳ vọng `không có thông tin`, thực tế `Ly hôn` | Xác nhận tình trạng hôn nhân của chính hồ sơ cho thấy đã ly hôn | Kỳ vọng nhiều khả năng sai |
| E5 | HS2 QR Tên mẫu biểu và Đề nghị vay vốn Tên mẫu biểu; HS3 CCCD Nơi thường trú; HS4 các ô "đọc thiếu dấu" | Kỳ vọng và Thực tế **giống hệt nhau** nhưng bị đánh "Không khớp". Giá trị lệch thật không được lưu | Không xác định được nguyên nhân khi sửa lỗi |
| E6 | HS4 Bảng kê thu nhập, CIC, Báo cáo định giá BĐS, GCN căn hộ | Cột Kỳ vọng là tên nhãn/vị trí chứ không phải giá trị, nhưng đánh giá ghi "Khớp" | Không kiểm chứng được |
| E7 | HS1 Bảng kê thu nhập (8 ô: tên cơ sở, hình thức, thời gian, địa chỉ, mặt bằng, diện tích, lợi nhuận gộp, lợi nhuận ròng) | Kỳ vọng được gán bằng công thức `=cột thực tế` | Kỳ vọng không độc lập nên luôn khớp |
| E8 | Nhiều mục chưa có dữ liệu (Xác nhận hôn nhân HS4, Xác nhận CMND địa phương, Cam kết, HĐ mua bán hàng hóa/xe, GCN nhà xưởng, Tờ trình ngoại lệ…) | Cột Đánh giá đã điền sẵn "Khớp" | Làm sai tỷ lệ chính xác |
| E9 | HS3 check chéo: "Chủ TSBĐ 2" | Trùng hoàn toàn Võ Thị Cẩm Tiên; theo hồ sơ chủ TSBĐ thứ hai phải là Tạ Viết Dũng | Phép check chéo cho người này vô nghĩa |
| E10 | HS4 check chéo, dòng 24–35 | Dữ liệu của người không thuộc hồ sơ (Ngô Tấn Lợi, Nguyễn Thị Ngọc Thanh); các giá trị Sóc Trăng/Cần Thơ | Dữ liệu thừa từ hồ sơ khác; 4 dòng "không khớp" ở đây không có giá trị |
| E11 | HS2 check chéo, dòng 19–20 | Nhãn "Số tờ bản đồ" và "Số thửa đất" bị đảo. Giá trị `476` là số thửa, `15` là tờ bản đồ (theo sheet OCR) | Kỳ vọng sai nhãn |
| E12 | HS4 check chéo: địa chỉ khách hàng vay | Kỳ vọng lấy từ CCCD (`Khóm 3, Phường 1…`), trái với quy tắc dùng VNeID/Xác nhận cư trú (`16b Lý Văn Lâm, Khóm 12, phường An Xuyên…`); ghi chú còn liệt kê "xác nhận cư trú" vào nhóm không cần OCR | Mâu thuẫn quy tắc |
| E13 | Đánh giá không nhất quán cho cùng kiểu lệch: tên mẫu Giấy đề nghị vay vốn lệch giống nhau nhưng HS3 "Khớp" còn HS1, HS2, HS4 "Không khớp"; tên mẫu CIC thêm hậu tố bị "Không Khớp" ở HS1 nhưng "Khớp" ở HS4 | | Số liệu độ chính xác không so sánh được |
| E14 | Ngày tháng bị Excel tự đổi định dạng: Ngày sinh Võ Thị Cẩm Tiên `1992-03-05` (OCR) so với `03/05/1992` (check chéo); ngày tra cứu CIC của Thảo `2026-08-09 00:00:00` so với `9/9/2026` của người vay | Có thể nhầm tháng/ngày | Cần ghi định dạng cố định `dd/MM/yyyy` dạng text |
| E15 | HS1 CIC "chậm thanh toán thẻ": Kỳ vọng "5 năm gần nhất", mục trên form là "3 năm" | Nghi gõ nhầm | Kỳ vọng sai |
| E16 | Sheet `back up` | Công thức `#REF!` nên số liệu dashboard không đúng | Cần dựng lại công thức nếu dùng báo cáo tổng hợp |
| E17 | HS4 Checklist | Có 4 chứng từ (HĐ mua bán hàng hóa/xe, GCN làm nhà xưởng, Tờ trình ngoại lệ) kỳ vọng "Có" nhưng hồ sơ không có dữ liệu; nghi là giá trị mặc định chưa dọn | Kỳ vọng nhiều khả năng sai |

## Việc cần đơn vị xác nhận

1. Giả định G1, G3, G4 (ảnh hưởng nhiều nhất tới số lỗi).
2. Quy tắc nguồn địa chỉ thường trú: chỉ VNeID/Xác nhận cư trú? (`02` Q3, Q4)
3. Định nghĩa "khớp" cho từng loại trường: so không dấu, định dạng ngày, quy đổi CMND 9 số và CCCD qua QR (`02` Q2).
4. Dữ liệu chuẩn của các dòng ⚠ (lỗi E3, E4, E6, E7) để có kỳ vọng độc lập.
5. Xóa hoặc đính chính dữ liệu thừa (E1, E2, E9, E10).
