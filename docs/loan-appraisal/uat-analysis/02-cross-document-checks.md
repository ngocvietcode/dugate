# 02 – Nghiệp vụ check chéo giữa các chứng từ

Nguồn: các sheet `Check chéo FAST …` (4 hồ sơ), sheet ẩn `4. Đối chiếu chéo` (khung log UAT) và ghi chú trong cột Đánh giá của file `TestResults_CheckChecklist_2.xlsx`. Mã hồ sơ HS1–HS4 dùng như trong [`01-field-extraction-by-form.md`](./01-field-extraction-by-form.md).

Phân loại nội dung trong tài liệu này:

- **[FILE]** Rút trực tiếp từ nội dung hoặc ghi chú của file test.
- **[SUY LUẬN]** Suy từ dữ liệu test, file không nêu thành quy tắc. Cần đơn vị xác nhận trước khi cài đặt.
- **[ĐỀ XUẤT]** Gợi ý bổ sung, không có trong file.

---

## 1. Cấu trúc của một phép check chéo trong file test [FILE]

Mỗi sheet `Check chéo …` là một ma trận: **dòng = (đối tượng × trường)**, **cột = chứng từ nguồn**.

| Cột | Ý nghĩa |
|---|---|
| A – Kỳ vọng | Giá trị chuẩn do đơn vị nhập |
| B – Kết quả AIF trả | Giá trị hệ thống trả cho trường đó |
| C – Đánh giá | Nhận xét của đơn vị (vd "Trả đúng kết quả", "Không đạt") |
| D – Đối tượng tham gia vay vốn | Khách hàng vay · Người đồng vay 1/2 · Chủ TSBĐ 1/2 |
| E – Kết quả (Khớp/Không khớp) | Kết luận check chéo của hệ thống giữa các chứng từ (giả định G1) |
| F – Tên trường cần đối chiếu | Danh sách trường (mục 2) |
| G… – Các cột chứng từ | Giá trị của trường đó ở từng chứng từ nguồn, gom theo 6 nhóm ở mục 3 |

Hàng 3 của mỗi sheet ("Mô tả trường và vị trí" / "ví dụ") là chỗ để mô tả vị trí lấy trường trên từng chứng từ, hiện chưa điền.

Bảy trường check chéo theo từng đối tượng:

| Đối tượng | Trường cần đối chiếu |
|---|---|
| Khách hàng vay, Người đồng vay 1, Người đồng vay 2 | Họ và tên · Số CCCD · Ngày tháng năm sinh · Địa chỉ thường trú · Ngành nghề kinh doanh · Số tờ bản đồ · Số thửa đất |
| Chủ TSBĐ 1, Chủ TSBĐ 2 | Họ và tên · Số CCCD · Ngày tháng năm sinh · Địa chỉ thường trú · Số tờ bản đồ · Số thửa đất (6 trường, không có ngành nghề) |

Mẫu có 2 khối người đồng vay và 2 khối chủ TSBĐ. Khi hồ sơ có người nào thì điền khối đó.

## 2. Nhóm chứng từ nguồn trong ma trận [FILE]

| Nhóm (dòng 1 của sheet) | Chứng từ (dòng 2) |
|---|---|
| Hồ sơ pháp lý | CCCD · QR code · VNeID (HS4: Xác nhận cư trú) · Giấy đăng ký kết hôn · Xác nhận tình trạng hôn nhân |
| Hồ sơ nguồn thu | Bảng kê thu nhập · Đăng ký kinh doanh · Xác nhận kinh doanh của chính quyền địa phương · Chứng từ nộp thuế (người nộp NSNN) |
| Hồ sơ PAVV (phương án vay vốn) | Đề nghị vay vốn · Bảng kê mua hàng · Hợp đồng mua bán hàng hóa · Hợp đồng mua bán xe |
| Hồ sơ TSBĐ là động sản | Chứng nhận đăng ký xe ô tô · Đăng kiểm xe · Báo giá tài sản · Báo cáo định giá động sản |
| Hồ sơ TSBĐ là bất động sản | Giấy chứng nhận QSDĐ · Báo cáo định giá/Chứng thư định giá |
| Hồ sơ tín dụng | CIC S11A (HS4: S11T/S11A) |

Tiêu đề cột ở HS1 và HS4 lệch một cột so với dữ liệu (vd HS1 ghi "Bảng kê thu nhập" ở cả cột M và N, dữ liệu chỉ ở N). Tài liệu này theo nội dung dữ liệu.

---

## 3. Quy tắc check chéo theo trường

Khi nào hai giá trị được coi là **Khớp** chưa được định nghĩa trong file. Điều kiện bên dưới là kết quả suy ra từ các cặp giá trị mà đơn vị đã đánh dấu "Khớp" trong dữ liệu test.

### CC-01 Họ và tên

- **Áp dụng cho**: mọi đối tượng.
- **Chứng từ so sánh** [FILE]: CCCD · QR · VNeID/Xác nhận cư trú · Đăng ký kết hôn · Xác nhận tình trạng hôn nhân · Bảng kê thu nhập · Đề nghị vay vốn · Bảng kê mua hàng · Báo giá tài sản · Báo cáo định giá (động sản và BĐS) · GCN · CIC. Với Chủ TSBĐ còn có Chứng nhận đăng ký xe và Đăng kiểm xe.
- **Điều kiện Khớp** [SUY LUẬN]:
  - Không phân biệt hoa/thường.
  - CIC được so sánh không dấu: `TRAN THANH TUAN` khớp `TRẦN THANH TUẤN` (HS1 dòng 4, kết quả "Khớp").
  - Tên viết tắt ở CIC (`TRƯƠNG T MỸ LIÊN`) vẫn được chấp nhận ở bước OCR (HS4).
  - GCN có thể chứa nhiều chủ, nối bằng "+" (`Trương Thị Mỹ Liên + Lữ Kim An`). Mỗi người phải được so riêng.
- **Khó**: ở bước OCR, việc đọc thiếu dấu là lỗi (HS4: `LỮ KIM AN` bị đọc thiếu dấu → "Không khớp"), còn ở bước check chéo, CIC không dấu lại được chấp nhận. Cần quy định rõ: so sánh có dấu với chứng từ gốc có dấu, so sánh không dấu khi một bên là CIC.

### CC-02 Số CCCD

- **Chứng từ so sánh** [FILE]: CCCD · QR · VNeID · Đăng ký kết hôn · Xác nhận tình trạng hôn nhân · Bảng kê thu nhập · Đề nghị vay vốn · Bảng kê mua hàng · GCN và Báo cáo định giá (cột có ghi số CCCD chủ tài sản) · CIC.
- **Điều kiện Khớp** [SUY LUẬN]:
  - Chuỗi 12 số phải khớp tuyệt đối. Một ký tự lệch là sai lệch (ví dụ trong khung log UAT: `049188001731` so với `049186001731` phải bị bắt).
  - Chứng từ ghi **CMND 9 số** (Đăng ký kết hôn, một số Xác nhận hôn nhân) phải được quy về CCCD của cùng người. HS2: Đăng ký kết hôn ghi `162859621`, CCCD ghi `036088008575`, hệ thống vẫn trả "Khớp". Cầu nối là **mã QR**, vì QR chứa cả hai số (`036088008575` và `162859621`).
  - HS3 có cùng cơ chế: QR chứa `079192003714` và `024730570`.
- **Ngoại lệ**: ký tự `'` đứng đầu (`'096175007418`) là do Excel, cần bỏ khi so sánh.

### CC-03 Ngày tháng năm sinh

- **Chứng từ so sánh** [FILE]: CCCD · QR · VNeID · Đăng ký kết hôn · Xác nhận tình trạng hôn nhân · Bảng kê thu nhập · Đề nghị vay vốn.
- **Điều kiện Khớp** [SUY LUẬN]: so sánh theo ngày thực, sau khi chuẩn hóa định dạng. Các định dạng thực tế trong file: `06/7/1979`, `06/07/1979`, `1992-03-05 00:00:00`, `29/02/1988`, chỉ năm `1975`.
- **Cảnh báo dữ liệu**:
  - Ngày sinh của Võ Thị Cẩm Tiên (HS3) là `1992-03-05` ở sheet OCR nhưng `03/05/1992` ở sheet check chéo. Đây có thể là nhầm tháng/ngày do Excel tự đổi định dạng.
  - Đăng ký kết hôn (HS4) chỉ ghi năm sinh (`1975 + 1968`), nên so sánh chỉ có thể dựa trên năm.

### CC-04 Địa chỉ thường trú

- **Chứng từ so sánh** [FILE] (các cột có giá trị): CCCD · QR · VNeID · Xác nhận cư trú · Đăng ký kết hôn · Xác nhận tình trạng hôn nhân · Bảng kê thu nhập · Đề nghị vay vốn · Bảng kê mua hàng · Báo cáo định giá · CIC.
- **Quy tắc nguồn địa chỉ** [FILE], lặp lại ở HS1, HS2, HS3, HS4: chỉ **VNeID** hoặc **Xác nhận cư trú** cho địa chỉ thường trú chính xác. Địa chỉ trích từ các chứng từ khác (**Đăng ký kết hôn, CIC, QR, CCCD**) "không cần OCR vì không chính xác". Đơn vị đánh giá "Không đạt" vì AI vẫn chưa biết lấy đúng địa chỉ thường trú của khách hàng ở chỗ nào.
- **Hệ quả cho check chéo** [SUY LUẬN]: địa chỉ thường trú cần có **nguồn chuẩn** (VNeID/Xác nhận cư trú) và các chứng từ khác chỉ được dùng để cảnh báo nhẹ hoặc bỏ qua. So sánh toàn bộ chéo theo cặp sẽ luôn cho "Không khớp", như kết quả test.
- **Ngoại lệ trong file** (cần quyết định):
  - HS4 dòng 7 và 14, cột Đánh giá liệt kê "xác nhận cư trú" vào nhóm chứng từ **không** cần OCR địa chỉ thường trú, trái với 3 hồ sơ còn lại.
  - HS4 dùng địa chỉ từ CCCD (`Khóm 3, Phường 1, TP Cà Mau`) làm Kỳ vọng, trong khi Xác nhận cư trú ghi `16b Lý Văn Lâm, Khóm 12, phường An Xuyên, tỉnh Cà Mau`.
- **Vấn đề chuẩn hóa** [SUY LUẬN]: cùng một địa chỉ tồn tại ở nhiều phiên bản: trước và sau sáp nhập đơn vị hành chính, có/không số nhà, viết tắt (`TPCHM`, `TPST`), không dấu (CIC), có lỗi chính tả. Ví dụ:

  | Hồ sơ | Phiên bản | Giá trị |
  |---|---|---|
  | HS2 | VNeID (mới) | `Thôn Phạm Xá, xã Yên Cường, tỉnh Ninh Bình` |
  | HS2 | CCCD/QR/Bảng kê mua hàng (cũ) | `Xóm 14, Yên Nhân, Ý Yên, Nam Định` |
  | HS2 | Đăng ký kết hôn (cũ, đầy đủ) | `Xã Yên Nhân,huyện Ý Yên,tỉnh Nam Định` |
  | HS2 | CIC (không dấu) | `TN-XA YEN NHAN-HUYEN Y YEN-TINH NAM DINH-VIET NAM` |
  | HS1 | Bảng kê mua hàng | `THÔN NAM THÀNH, Xã Hàm Thuận Nam, Tỉnh Lâm Đồng` (thiếu số nhà và đường) |
  | HS1 | CIC | `SN 213 TRẦN HƯNG ĐẠO NAM THÀNH THUẬN NAM` (thiếu tỉnh) |

### CC-05 Ngành nghề kinh doanh

- **Áp dụng cho**: Khách hàng vay và Người đồng vay.
- **Chứng từ so sánh** [FILE]: Bảng kê thu nhập · Đề nghị vay vốn. Khung cột còn có Đăng ký kinh doanh và Xác nhận kinh doanh của chính quyền địa phương, nhưng 4 hồ sơ test chưa có dữ liệu ở đó.
- **Điều kiện Khớp** [SUY LUẬN]: so sánh theo nghĩa, không theo chuỗi. `KD nhà hàng, dịch vụ ăn uống` (Bảng kê thu nhập) và `KD dịch vụ ăn uống` (Đề nghị vay vốn) được coi là Khớp (HS2).
- **Cảnh báo sai (false positive) cần loại bỏ** [FILE]:
  - HS2 và HS3 (ghi chú cột Đánh giá): AI cảnh báo "Bảng kê mua hàng không đúng ngành nghề kinh doanh ĐNVV". Nguyên nhân là AI đọc cụm "nhập các loại hàng để phục vụ kinh doanh" trên Bảng kê mua hàng thành ngành nghề kinh doanh rồi đem so sánh với mục đích vay.
  - Hệ quả: Bảng kê mua hàng **không phải nguồn ngành nghề**. Hệ thống không được so sánh ngành nghề với chứng từ này.
  - HS3 dòng 8: kết quả check chéo ghi "không khớp" dù Bảng kê thu nhập và Đề nghị vay vốn cùng ghi `Bán buôn sỉ lẻ quần áo`. Đây là báo sai.

### CC-06 Số tờ bản đồ và CC-07 Số thửa đất

- **Chứng từ so sánh** [FILE]: Giấy chứng nhận QSDĐ so với Báo cáo/Chứng thư định giá bất động sản.
- **Áp dụng cho**: Chủ TSBĐ (và khách hàng vay nếu cũng là chủ TSBĐ).
- **Điều kiện Khớp** [SUY LUẬN]: so sánh số chính xác. HS3: `17` và `682` ở cả GCN lẫn Báo cáo định giá. HS4: `42` và `356`.
- **Lưu ý khi test**:
  - Ghi chú cột Đánh giá (HS2, HS3): "AI chưa cập nhật được Thửa đất số và Tờ bản đồ số trong những trang cập nhật thông tin". Tức là GCN có trang biến động/cập nhật, AI chỉ lấy trang đầu.
  - HS2: nhãn dòng bị đảo (xem lỗi E11 trong README). Dòng "Số tờ bản đồ" có `476` (thực ra là số thửa đất theo sheet OCR) và dòng "Số thửa đất" có `15` (thực ra là tờ bản đồ).

---

## 4. Kết quả check chéo trong file test

Trong các bảng dưới, "Hệ thống" là cột E (kết quả check chéo).

### HS1 – LN2605288322713 (Trần Thanh Tuấn)

| Đối tượng | Trường | Hệ thống | Đánh giá của đơn vị |
|---|---|---|---|
| Khách hàng vay | Họ và tên · Số CCCD · Ngày sinh · Ngành nghề | Khớp | Trả đúng |
| Khách hàng vay | **Địa chỉ thường trú** | **Không khớp** | AI trả nhiều kết quả khác nhau; có cả những chứng từ không cần OCR địa chỉ thường trú (CIC); file `PHAP LY-O.S` scan nhiều chứng từ nhưng AI chưa nhận diện được trường địa chỉ thường trú |
| Chủ TSBĐ 1 | Họ và tên · Số CCCD · Ngày sinh | Khớp | Trả đúng |
| Chủ TSBĐ 1 | **Địa chỉ thường trú** | **Không khớp** | Như trên |

Ví dụ lệch của địa chỉ thường trú ở HS1 (Kỳ vọng so với từng chứng từ):

| Chứng từ | Giá trị |
|---|---|
| Kỳ vọng / CCCD / Bảng kê thu nhập | `SỐ NHÀ 213 ĐƯỜNG TRẦN HƯNG ĐẠO, THÔN NAM THÀNH, Xã Hàm Thuận Nam, Tỉnh Lâm Đồng` |
| Xác nhận tình trạng hôn nhân | `THÔN NAM THÀNH, Xã Hàm Thuận Nam, Tỉnh Lâm Đồng` (thiếu số nhà, đường) |
| Đề nghị vay vốn | `KP Nam Thành, thị trấn Thuận Nam, huyện Hàm Thuận Nam, tỉnh Bình Thuận (nay là SỐ NHÀ 213 …)` |
| Bảng kê mua hàng | `THÔN NAM THÀNH, Xã Hàm Thuận Nam, Tỉnh Lâm Đồng` |
| CIC | `SN 213 TRẦN HƯNG ĐẠO NAM THÀNH THUẬN NAM` |

### HS2 – LN2610088913941 (Ngô Ngọc Hoàn + Nguyễn Thị Phương Thảo)

| Đối tượng | Trường | Hệ thống | Kỳ vọng so với thực tế |
|---|---|---|---|
| Khách hàng vay | Họ tên · CCCD · Ngày sinh · Ngành nghề | Khớp | Đúng. Lưu ý: AI cảnh báo Bảng kê mua hàng không đúng ngành nghề (xem CC-05) |
| Khách hàng vay | **Địa chỉ thường trú** | **Không khớp** | `Thôn Phạm Xá, xã Yên Cường, tỉnh Ninh Bình` so với `Xóm 14, Yên Nhân, Ý Yên, Nam Định`. Đơn vị đánh "Không đạt" |
| Người đồng vay 1 | Họ tên · CCCD · Ngày sinh | Khớp | Đúng |
| Người đồng vay 1 | **Địa chỉ thường trú** | **Không khớp** | `Thôn 2,xã Trại Câu, tỉnh Thái Nguyên` so với `Tổ 5, Trại Cau, Đồng Hỷ, Thái Nguyên` |
| Chủ TSBĐ 1 | Họ tên · CCCD · Ngày sinh | Khớp | Đúng |
| Chủ TSBĐ 1 | **Địa chỉ thường trú** | **Không khớp** | Như khách hàng vay |
| Chủ TSBĐ 1 | **Số tờ bản đồ** | Khớp (⚠) | Kỳ vọng `476`, AIF `253`. Hệ thống "Khớp" nhưng giá trị khác nhau |
| Chủ TSBĐ 1 | **Số thửa đất** | Khớp (⚠) | Kỳ vọng `15`, AIF `11`. Cùng vấn đề |

Địa chỉ thường trú của khách hàng vay HS2 theo từng chứng từ: bản mới (VNeID, Đề nghị vay vốn, Báo cáo định giá) so với bản cũ (CCCD, QR, Bảng kê mua hàng, Đăng ký kết hôn, CIC), xem bảng ở CC-04.

### HS3 – LN2608218749371 (Võ Thị Cẩm Tiên + Tạ Viết Dũng)

| Đối tượng | Trường | Hệ thống | Kỳ vọng so với thực tế |
|---|---|---|---|
| Khách hàng vay | Họ tên · CCCD · Ngày sinh | Khớp | Đúng |
| Khách hàng vay | **Địa chỉ thường trú** | **Không khớp (đọc sai chính tả)** | Kỳ vọng và AIF cùng là `Số Nhà 185/1,Đường Nguyễn Thị Đó, Ấp Phú Hòa 2, Xã Phú Hòa Đông, TP HCM`. Đề nghị vay vốn ghi `Nguyễn Thị Đói`; QR ghi `Tổ 24, Ấp Phú Hòa`. Đơn vị đánh "Không đạt" |
| Khách hàng vay | **Ngành nghề** | **Không khớp (báo sai)** | Bảng kê thu nhập và Đề nghị vay vốn đều ghi `Bán buôn sỉ lẻ quần áo`. AI đang cảnh báo nhầm với Bảng kê mua hàng (CC-05) |
| Người đồng vay 1 | Họ tên · CCCD · Ngày sinh | Khớp | Đúng |
| Người đồng vay 1 | **Địa chỉ thường trú** | **Không khớp** | VNeID/CCCD/QR: `Số 01 Trần Thị Bọn, Ấp 8, Xã Phú Hòa Đông, TP HCM`. Đăng ký kết hôn và CIC ghi địa chỉ cũ `8/5E Ngô Tất Tố, …, Bình Thạnh`. Đề nghị vay vốn ghi địa chỉ của người vay (`185/1 Nguyễn Thị Đó…`) |
| Chủ TSBĐ 1 | Họ tên · CCCD · Ngày sinh · Tờ bản đồ (`17`) · Thửa đất (`682`) | Khớp | Đúng |
| Chủ TSBĐ 1 | **Địa chỉ thường trú** | **Không khớp (đọc sai chính tả)** | Như khách hàng vay |
| Chủ TSBĐ 2 | Họ tên · Ngày sinh · Tờ bản đồ · Thửa đất | Khớp | Đúng (nhưng xem lỗi E9) |
| Chủ TSBĐ 2 | **Số CCCD** | **Không khớp (báo sai)** | Mọi chứng từ ghi `079192003714` (giống nhau) nhưng hệ thống báo "không khớp" |
| Chủ TSBĐ 2 | **Địa chỉ thường trú** | **Không khớp (đọc sai chính tả)** | Như trên |

### HS4 – LN2609038780853 (Trương Thị Mỹ Liên + Lữ Kim An)

| Đối tượng | Trường | Hệ thống | Kỳ vọng so với thực tế |
|---|---|---|---|
| Khách hàng vay | Họ tên · CCCD · Ngày sinh | Khớp | Đúng |
| Khách hàng vay | **Địa chỉ thường trú** | **Không khớp** | Kỳ vọng `Khóm 3, Phường 1, Thành phố Cà Mau, Cà Mau` (lấy từ CCCD). Bảng kê thu nhập ghi `16B Lý Văn Lâm, Khóm 12, Phường Ăn Xuyên, Cà Mau`, Đề nghị vay vốn ghi `…Phường An Xuyên…`, Báo cáo định giá ghi `…khóm 3 Phường 1…` |
| Khách hàng vay | Ngành nghề · Tờ bản đồ (`42`) · Thửa đất (`356`) | (E trống) | Dữ liệu khớp nhau nhưng chưa có kết quả hệ thống |
| Người đồng vay 1 | **Họ và tên** | **Không khớp** | `LỮ KIM AN`: AI đọc thiếu dấu, đơn vị ghi "AI không đọc đúng tên KH do đọc thiếu dấu" |
| Người đồng vay 1 | CCCD · Ngày sinh | Khớp | Đúng |
| Người đồng vay 1 | **Địa chỉ thường trú** | **Không khớp** | Như khách hàng vay, thêm Đề nghị vay vốn (`R15`) ghi một địa chỉ vào dòng Ngành nghề (`435, đường 30/4, khu vực 15, Phường Phú Lợi, TP. Cần Thơ`) |
| Dòng 24–35 | Họ tên, CCCD, địa chỉ… | – | Chứa người không thuộc hồ sơ (Ngô Tấn Lợi, Nguyễn Thị Ngọc Thanh), xem lỗi E10 |

---

## 5. Quy tắc đánh giá Pass/Fail của khung log UAT [FILE]

Sheet ẩn `4. Đối chiếu chéo`: mỗi dòng là một cặp giá trị của **cùng một trường** ở **hai chứng từ khác nhau**. Đơn vị muốn test cả hai chiều: tạo sai lệch thật để kiểm tra bỏ sót (false negative) và dữ liệu khớp để kiểm tra báo nhầm (false positive).

| Có sai lệch thực tế? | AI có phát hiện sai lệch? | Kết quả |
|---|---|---|
| Có | Có | Pass |
| Không | Không | Pass |
| Có | Không | Fail (bỏ sót – false negative) |
| Không | Có | Fail (báo nhầm – false positive) |

Quy tắc [FILE]: "Pass khi cột AI có phát hiện sai lệch? khớp đúng với cột Có sai lệch thực tế?".

Các cột log: STT · Ngày test · Luồng vay · Trường đối chiếu · File nguồn 1 · Giá trị nguồn 1 · File nguồn 2 · Giá trị nguồn 2 · Có sai lệch thực tế? · AI có phát hiện? · Kết quả (Pass/Fail/N/A) · Mô tả lỗi · Trạng thái xử lý lỗi (Open/Fixed/Retest/Closed/Won't Fix) · Ghi chú.

Hai dòng mẫu có trong file (52 dòng log, chỉ điền 2):

| Trường | Nguồn 1 | Nguồn 2 | Sai lệch thực tế | AI phát hiện | Kết quả |
|---|---|---|---|---|---|
| Số tiền đề nghị vay | `DNVV(1).pdf` = 400.000.000 đ | `PhuongAn_DeNghiVay.docx` = 400.000.000 đ | Không | Không | Pass |
| Số CCCD người vay | `CCCD_ChuHo.pdf` = 049188001731 | `BANG_KE_THU_NHAP.pdf` = 049186001731 | Có (lệch 1 ký tự) | Không | Fail – Open. "Test cố ý tạo lệch 1 ký tự số CCCD giữa 2 chứng từ nhưng hệ thống không phát hiện ra, cross-check bỏ sót" |

Áp dụng cùng quy tắc cho kết quả ở mục 4: các dòng "báo sai" (HS3 Ngành nghề, HS3 Chủ TSBĐ 2 – Số CCCD) là **Fail dạng báo nhầm**. Các dòng HS2 Tờ bản đồ/Thửa đất ("Khớp" nhưng giá trị khác nhau) là **Fail dạng bỏ sót**.

---

## 6. Các kiểm tra khác thể hiện trong file test

### 6.1 Nhất quán chủ tài sản [FILE]

Mỗi sheet Checklist có dòng "Chủ tài sản" với kỳ vọng:

| Hồ sơ | Kỳ vọng |
|---|---|
| HS1 | Chủ TSBĐ chính là KH |
| HS2, HS3, HS4 | Chủ TSBĐ chính là vợ chồng KH |

Điều kiện cần kiểm tra [SUY LUẬN], dựa trên các dòng của Đề nghị vay vốn (Tên chủ sở hữu TSBĐ, CCCD chủ sở hữu tài sản, Quan hệ với khách hàng vay), GCN (Tên chủ sở hữu) và Đăng ký kết hôn:

- Tên và CCCD chủ sở hữu trên Đề nghị vay vốn phải trùng với chủ trên GCN.
- Khi quan hệ là "Vợ chồng", cặp tên trên GCN phải trùng với cặp vợ chồng trên Đăng ký kết hôn.
- Khi chủ TSBĐ chính là KH, quan hệ ghi "Chính chủ"/"Chính người vay".

### 6.2 Điều kiện có/không có chứng từ (checklist) [FILE + SUY LUẬN]

Phần Checklist đối chiếu danh mục chứng từ kỳ vọng với kết quả AIF. Quy tắc có thể suy ra từ dữ liệu:

- Đăng ký kết hôn chỉ cần "nếu đã kết hôn". HS1 đã ly hôn nên checklist không có dòng này, mà có Xác nhận tình trạng hôn nhân (độc thân/ly hôn/góa).
- GCN đăng ký hộ kinh doanh: kỳ vọng "Không" ở HS2, HS3. HS3 ghi AI **vẫn cảnh báo thiếu chứng từ này** (báo sai).
- Hợp đồng mua bán hàng hóa, Hợp đồng mua bán xe, GCN QSDĐ làm nhà xưởng, Tờ trình phê duyệt ngoại lệ: ở HS4 kỳ vọng "Có" và AI trả "Có", nhưng không có dữ liệu trích xuất nào, và hồ sơ là vay kinh doanh thực phẩm 266 triệu nên khả năng đây là giá trị mặc định chưa dọn (xem README).
- Kết quả checklist trong file: HS1/HS4 AI không nhận diện QR, HS1–HS4 không nhận diện VNeID, HS4 không nhận diện Xác nhận cư trú (chi tiết ở `01`).

### 6.3 Kiểm tra bổ sung gợi ý [ĐỀ XUẤT – không có trong file]

Dựa trên dữ liệu test, các ràng buộc sau đều đúng với cả 4 hồ sơ hoặc gần đúng, nên có thể làm quy tắc cảnh báo. **Cần đơn vị xác nhận trước khi cài đặt.**

| Mã | Kiểm tra | Dữ liệu minh họa |
|---|---|---|
| X-01 | Số tiền vay ≤ Tổng giá trị bảng kê mua hàng | HS1 425 triệu ≤ 450 triệu; HS2 990 triệu ≤ 1.187 triệu; HS3 3,7 tỷ ≤ 3,865 tỷ; HS4 266 triệu = 266 triệu |
| X-02 | Số tiền vay so với giá trị TSBĐ (tỷ lệ cho vay/giá trị tài sản) | HS2 990 triệu / 1,654 tỷ; HS3 3,7 tỷ / 4,572 tỷ |
| X-03 | Doanh thu − Giá vốn = Lợi nhuận gộp; Lợi nhuận gộp − Chi phí = Lợi nhuận ròng (trong Bảng kê thu nhập) | HS3 đúng (2,5 tỷ − 1,9 tỷ = 600 triệu; 600 triệu − 110 triệu = 490 triệu). HS1: 600 triệu − 550 triệu (AI) = 50 triệu nhưng ghi 100 triệu. HS4: 50 triệu − 50 triệu = 0 nhưng ghi 40 triệu |
| X-04 | Lợi nhuận ròng so với Nguồn trả nợ trong Đề nghị vay vốn | HS3: 490.000.000 ở cả hai |
| X-05 | Ngày tra cứu CIC nằm trong thời hạn cho phép so với ngày hồ sơ (file chưa nêu thời hạn) | Ngày tra cứu CIC trong file: 26/05/2026 (HS1), 09/09/2026 và 09/08/2026 (HS2), 03/08/2026 (HS3), 15/08/2026 (HS4) |

---

## 7. Điểm chưa rõ và giả định

| Mã | Điểm chưa rõ | Giả định đang dùng | Cần xác nhận |
|---|---|---|---|
| Q1 | "Khớp/Không khớp" ở cột E là kết quả của hệ thống hay kỳ vọng của đơn vị? | Là kết quả của hệ thống (G1). Cơ sở: có dòng hệ thống ghi "Khớp" dù dữ liệu lệch (HS2 tờ bản đồ) và dòng ghi "không khớp" dù dữ liệu giống nhau (HS3 CCCD Chủ TSBĐ 2). Hai trường hợp này chỉ giải thích được nếu cột E là đầu ra của hệ thống chứ không phải kỳ vọng | Đơn vị |
| Q2 | Định nghĩa "Khớp" cho từng loại trường (so chuỗi, so không dấu, so ngày…) | Theo mục 3 (suy luận từ dữ liệu) | Đơn vị |
| Q3 | Địa chỉ thường trú: có check chéo hay chỉ lấy một nguồn (VNeID/Xác nhận cư trú)? | Chỉ lấy một nguồn chuẩn; các chứng từ khác không dùng để kết luận sai lệch | Đơn vị |
| Q4 | HS4 coi Xác nhận cư trú là nguồn không cần OCR địa chỉ, trái với 3 hồ sơ còn lại | Coi là ghi chú nhầm, giữ quy tắc ở Q3 | Đơn vị |
| Q5 | Cách xử lý địa chỉ trước/sau sáp nhập đơn vị hành chính | Cần bảng ánh xạ địa danh cũ → mới nếu muốn so sánh | Đơn vị |
| Q6 | Với Chủ TSBĐ nhiều người, mỗi người check riêng hay check cả cụm "A + B"? | Mỗi người một khối (Chủ TSBĐ 1, 2) | Đơn vị |
| Q7 | Khi chứng từ không có thông tin của người đó (vd HS4 không có VNeID), bỏ qua hay báo thiếu? | Bỏ qua, chỉ so sánh giữa các chứng từ có giá trị | Đơn vị |
| Q8 | Cột "Mô tả trường và vị trí" (hàng 3) còn trống | Chưa có vị trí lấy trường, nên chưa mô tả được | Đơn vị bổ sung |
