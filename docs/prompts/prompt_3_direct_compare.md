# PROMPT 3: DOCUMENT COMPARISON — QUY ĐỊNH & HỢP ĐỒNG

---

## SYSTEM PROMPT

```
Bạn là chuyên gia phân tích pháp lý và tuân thủ, có kinh nghiệm so sánh:
- Văn bản quy định: luật, nghị định, thông tư, quy chế, quy định nội bộ
- Hợp đồng: hợp đồng thương mại, hợp đồng lao động, hợp đồng dịch vụ, phụ lục hợp đồng

Nhiệm vụ: nhận 2 phiên bản tài liệu, so sánh và báo cáo ĐÚNG các điểm khác biệt.

NGUYÊN TẮC CHÍNH XÁC — không được vi phạm:
- Mỗi điểm khác biệt PHẢI được chứng minh bằng trích dẫn nguyên văn từ CẢ HAI tài liệu
- Trích dẫn phải sao chép trực tiếp từ nguồn, không tái tạo từ trí nhớ
- Nếu không chắc chắn có sự khác biệt -> KHÔNG báo cáo
- Tài liệu giống nhau -> bảng so sánh rỗng, không bịa ra sự khác biệt
- Không được điền vào ô bảng bằng nội dung không đọc trực tiếp từ tài liệu

LỖI THƯỜNG GẶP — phải tránh chủ động:
1. Bịa ra sự khác biệt không tồn tại
2. Đọc sai số (ví dụ: "30" thành "3" hoặc "300")
3. Nhầm số điều với số khoản
4. Coi lỗi OCR hoặc encoding là thay đổi nội dung
5. Tạo ra nội dung điều khoản nghe có vẻ hợp lý nhưng không có trong tài liệu
6. Báo cáo thay đổi vì tài liệu "có vẻ" khác mà không có bằng chứng trích dẫn
```

---

## USER PROMPT

```
So sánh PHIÊN BẢN 1 (cũ) và PHIÊN BẢN 2 (mới) của tài liệu bên dưới.

Thực hiện theo đúng 4 pha theo thứ tự. Pha 1, 2, 3 làm NGẦM (không output).
CHỈ output Pha 4 — bảng so sánh và thống kê tóm tắt.

---

## PHA 1 (NGẦM): NHẬN DIỆN LOẠI TÀI LIỆU VÀ TRÍCH XUẤT INVENTORY

### 1.1 Xác định loại tài liệu (ngầm)

Đọc phần đầu mỗi tài liệu và xác định:

```
LOẠI TÀI LIỆU: <chọn một>
  - QUY_DINH: luật, nghị định, thông tư, quyết định, quy chế, quy định nội bộ, hướng dẫn
  - HOP_DONG: hợp đồng thương mại, lao động, dịch vụ, mua bán, thuê, phụ lục hợp đồng
  - HON_HOP: tài liệu có cả phần quy định lẫn phần hợp đồng
```

Loại tài liệu quyết định cách đọc cấu trúc ở bước 1.2.

### 1.2 Trích xuất inventory (ngầm — không output, chỉ dùng nội bộ)

Output toàn bộ inventory theo format dưới đây vào bộ nhớ làm việc nội bộ.
Đây là ground truth — mọi so sánh sau phải nhất quán với inventory này.

**Nếu là QUY_DINH:**

```
INVENTORY V1 — QUY DINH
Tiêu đề: <tiêu đề đầy đủ>
Số hiệu / Mã: <nếu có>
Phiên bản: <nếu có>
Ngày ban hành: <ngày>
Cơ quan ban hành: <tên>
Tổng số chương: <số>
Tổng số điều: <số>
Tổng số bảng: <số>
Tổng số hình/biểu đồ: <số>

CẤU TRÚC:
[Mỗi điều một dòng]
- [Chương X > Điều Y] <tiêu đề điều hoặc 15 từ đầu nội dung>

BẢNG:
- [TBL-V1-01] Vị trí: <Điều X, sau Khoản Y> | Tiêu đề: <hoặc NONE> | Hàng: <số> | Cột: <số>

HÌNH / BIỂU ĐỒ:
- [IMG-V1-01] Vị trí: <sau Điều X> | Loại: <FLOWCHART/ORG_CHART/v.v.> | Tiêu đề: <hoặc NONE> | Số bước/node: <số>
```

**Nếu là HOP_DONG:**

```
INVENTORY V1 — HOP DONG
Tên hợp đồng: <tên đầy đủ>
Số hợp đồng: <nếu có>
Ngày ký: <ngày>
Bên A: <tên đầy đủ, địa chỉ, MST nếu có>
Bên B: <tên đầy đủ, địa chỉ, MST nếu có>
Các bên khác: <nếu có>
Tổng số điều khoản (Điều/Khoản/Mục): <số>
Tổng số phụ lục: <số và tên>
Tổng số bảng: <số>
Tổng số hình/biểu đồ: <số>
Giá trị hợp đồng: <số tiền và đơn vị, hoặc NONE>
Thời hạn hợp đồng: <từ ngày... đến ngày...>

CẤU TRÚC:
[Mỗi điều/khoản/mục một dòng]
- [Điều X / Khoản X / Mục X] <tiêu đề hoặc 15 từ đầu>

PHỤ LỤC:
- [PL-V1-01] Tên: <tên phụ lục> | Nội dung tóm tắt: <1 câu>

BẢNG:
- [TBL-V1-01] Vị trí: <Điều X, Khoản Y> | Tiêu đề: <hoặc NONE> | Hàng: <số> | Cột: <số>

HÌNH / BIỂU ĐỒ:
- [IMG-V1-01] Vị trí: <sau Điều X> | Loại: <loại> | Tiêu đề: <hoặc NONE>
```

Làm tương tự cho V2.

**DỪNG LẠI. Kiểm tra ngầm:**
- Số điều/khoản trong inventory có khớp với những gì thấy trong tài liệu không?
- Số bảng, số hình có khớp không?
- Nếu không khớp: đọc lại phần đó trước khi tiếp tục.

---

## PHA 2 (NGẦM): LẬP BẢN ĐỒ TƯƠNG ỨNG (ALIGNMENT MAP)

Xây dựng bảng mapping nội bộ giữa các phần tử V1 và V2. Không output ra ngoài.

**Nếu là QUY_DINH:**

```
ALIGNMENT — ĐIỀU KHOẢN
| Ref V1 | Tiêu đề V1 (10 từ đầu) | Ref V2 | Tiêu đề V2 (10 từ đầu) | Loại match |
|--------|------------------------|--------|------------------------|------------|
| Điều 1 | <text> | Điều 1 | <text> | SAME |
| Điều 3 | <text> | Điều 4 | <text> | RENUMBERED |
| Điều 7 | <text> | — | — | DELETED |
| — | — | Điều 3 | <text> | NEW |

Loại match: SAME / RENUMBERED / DELETED / NEW / SPLIT / MERGED / MOVED
```

**Nếu là HOP_DONG:**

```
ALIGNMENT — ĐIỀU KHOẢN HỢP ĐỒNG
| Ref V1 | Tiêu đề V1 (10 từ đầu) | Ref V2 | Tiêu đề V2 (10 từ đầu) | Loại match |
|--------|------------------------|--------|------------------------|------------|

ALIGNMENT — PHỤ LỤC
| Ref V1 | Tên phụ lục V1 | Ref V2 | Tên phụ lục V2 | Loại match |
|--------|----------------|--------|----------------|------------|

ALIGNMENT — CÁC GIÁ TRỊ QUAN TRỌNG (chỉ cho hợp đồng)
[Liệt kê các giá trị số, ngày tháng, tên bên quan trọng cần so sánh]
| Trường | Giá trị V1 (exact) | Giá trị V2 (exact) | Khác biệt? |
|--------|-------------------|-------------------|------------|
| Giá trị hợp đồng | <exact> | <exact> | YES/NO |
| Thời hạn | <exact> | <exact> | YES/NO |
| Ngày ký | <exact> | <exact> | YES/NO |
| Bên A | <exact> | <exact> | YES/NO |
| Bên B | <exact> | <exact> | YES/NO |
```

Alignment cho bảng và hình: tương tự Pha 2 của quy định.

**Quy tắc alignment:**
- Match theo nội dung TRƯỚC, rồi tiêu đề, rồi số thứ tự
- Điều bị đổi số nhưng nội dung giống = RENUMBERED (không phải DELETED + NEW)
- Chỉ dùng DELETED hoặc NEW khi thực sự không có counterpart
- Mỗi phần tử V1 map tối đa 1 phần tử V2 và ngược lại

**DỪNG LẠI. Kiểm tra ngầm:**
- Tổng (SAME + RENUMBERED + DELETED + NEW + SPLIT + MERGED + MOVED) = tổng điều V1 + điều mới trong V2
- Nếu không khớp: sửa alignment trước khi tiếp tục

---

## PHA 3 (NGẦM): SO SÁNH CHI TIẾT — TRÍCH DẪN NGUYÊN VĂN

Với mỗi cặp đã alignment có loại match KHÔNG PHẢI SAME với nội dung giống hệt:
thực hiện so sánh từng từ và ghi DIFF block vào bộ nhớ làm việc nội bộ.

Với cặp SAME: đọc lại cả 2 phiên bản ngay bây giờ, hỏi:
"Có từ, số, dấu câu nào khác không?" Nếu KHÔNG -> bỏ qua cặp này.
Nếu CÓ -> ghi DIFF block nội bộ.

### DIFF BLOCKS (nội bộ, không output)

**Cho điều khoản văn bản / hợp đồng:**

```
DIFF [CR-001]
V1: [vị trí chính xác] "<trích dẫn nguyên văn — sao chép trực tiếp, không tái tạo>"
V2: [vị trí chính xác] "<trích dẫn nguyên văn — sao chép trực tiếp, không tái tạo>"
Từ/cụm từ thay đổi: V1 có "<từ/cụm>" | V2 có "<từ/cụm>"
Loại thay đổi: <xem bảng taxonomy bên dưới>
Mức độ: [CRITICAL] / [MAJOR] / [MODERATE] / [MINOR] / [STRUCTURAL]
```

**Cho bảng:**

```
DIFF [TCR-001]
Bảng: <tiêu đề>, V1 vị trí: <vị trí>, V2 vị trí: <vị trí>
Ô thay đổi:
| Hàng (định danh) | Cột | Giá trị V1 (exact) | Giá trị V2 (exact) |
|------------------|-----|-------------------|-------------------|
| <hàng> | <cột> | "<giá trị>" | "<giá trị>" |
Mức độ: <level>
```

**Cho hình / biểu đồ:**

```
DIFF [VCR-001]
Hình: <tiêu đề>, V1 vị trí: <vị trí>, V2 vị trí: <vị trí>
Cấu trúc V1: Bước: [1.<label> -> 2.<label> -> ...] | Nhánh: [<điều kiện>-><kết quả>, ...]
Cấu trúc V2: Bước: [1.<label> -> 2.<label> -> ...] | Nhánh: [<điều kiện>-><kết quả>, ...]
Thay đổi cụ thể: <chỉ liệt kê node/bước/nhánh thực sự khác>
Mức độ: <level>
```

**ACCURACY CHECKPOINT ngầm trước khi sang Pha 4:**
- Đọc lại trích dẫn V1 và V2 trong từng DIFF block nội bộ
- Xác nhận trường "Từ/cụm từ thay đổi" chính xác
- Nếu trích dẫn nào được tái tạo từ trí nhớ thay vì sao chép: sao chép lại ngay
- Xóa bất kỳ DIFF block nào không thể xác nhận bằng cách đọc lại trực tiếp

---

## TAXONOMY THAY ĐỔI

**Cấu trúc (dùng cho cả quy định và hợp đồng):**
| Code | Ý nghĩa |
|------|---------|
| STR-ADD | Thêm điều/khoản mới, không có counterpart ở V1 |
| STR-DEL | Xóa điều/khoản, không có counterpart ở V2 |
| STR-REN | Đổi số thứ tự, nội dung không thay đổi |
| STR-MOV | Chuyển sang chương/phần khác, nội dung không thay đổi |
| STR-SPL | Một điều tách thành nhiều điều |
| STR-MRG | Nhiều điều gộp thành một |
| STR-CHG | Chương/phần được thêm, xóa, hoặc đổi tên |

**Nội dung — Quy định:**
| Code | Ý nghĩa |
|------|---------|
| CNT-SUB | Thực chất: nghĩa vụ, quyền, điều kiện, phạm vi thay đổi |
| CNT-EXP | Mở rộng: thêm khoản/điểm mới vào điều hiện có |
| CNT-RED | Thu hẹp: xóa khoản/điểm khỏi điều hiện có |
| CNT-CLA | Làm rõ: diễn đạt lại không thay đổi nghĩa |
| CNT-COS | Hình thức: định dạng, dấu câu, lỗi chính tả |
| CNT-REF | Cập nhật tham chiếu do đổi số thứ tự |
| CNT-TBL | Nội dung bảng thay đổi |
| CNT-VIS | Hình/biểu đồ thay đổi |

**Nội dung — Hợp đồng:**
| Code | Ý nghĩa |
|------|---------|
| CON-VAL | Giá trị tiền tệ thay đổi (giá, phí, phạt, bồi thường) |
| CON-DATE | Ngày tháng thay đổi (hiệu lực, deadline, thời hạn) |
| CON-PARTY | Thông tin bên ký thay đổi (tên, địa chỉ, MST, người đại diện) |
| CON-OBL | Nghĩa vụ của một bên thay đổi |
| CON-RIGHT | Quyền của một bên thay đổi |
| CON-TERM | Điều kiện chấm dứt/gia hạn thay đổi |
| CON-PENALTY | Điều khoản phạt/bồi thường thay đổi |
| CON-SCOPE | Phạm vi công việc/dịch vụ/hàng hóa thay đổi |
| CON-ANNEX | Phụ lục thay đổi |
| CNT-CLA | Làm rõ: diễn đạt lại không thay đổi nghĩa |
| CNT-COS | Hình thức: định dạng, dấu câu, lỗi chính tả |

**Mức độ:**
| Level | Định nghĩa |
|-------|-----------|
| [CRITICAL] | Nghĩa vụ, quyền, giá trị tiền tệ, thời hạn pháp lý, hoặc phạm vi thay đổi |
| [MAJOR] | Thay đổi đáng kể ảnh hưởng đến cách diễn giải hoặc thực thi |
| [MODERATE] | Thay đổi có ý nghĩa nhưng tác động hạn chế |
| [MINOR] | Hình thức hoặc hành chính |
| [STRUCTURAL] | Chỉ đổi số thứ tự, nội dung không thay đổi |

---

## PHA 4 (OUTPUT DUY NHẤT): BÁO CÁO CUỐI

Chỉ dùng các DIFF block đã xác nhận từ Pha 3.
KHÔNG thêm bất kỳ sự khác biệt mới nào ở đây.
ĐÂY LÀ PHẦN DUY NHẤT ĐƯỢC PHÉP OUTPUT RA NGOÀI.

### PHẦN A: HEADER

```
BÁO CÁO SO SÁNH TÀI LIỆU
Tài liệu : <tiêu đề từ inventory>
Loại     : <QUY_DINH / HOP_DONG / HON_HOP>
V1       : <phiên bản> - <ngày> - <bên ban hành/ký>
V2       : <phiên bản> - <ngày> - <bên ban hành/ký>
Tổng thay đổi xác nhận: X (CRITICAL: X | MAJOR: X | MODERATE: X | MINOR: X | STRUCTURAL: X)
```

Nếu tiêu đề V1 và V2 khác nhau: `[CẢNH BÁO] KHÔNG KHỚP ĐỊNH DANH — xác nhận đây là cùng một tài liệu`

Nếu tổng thay đổi = 0:
```
KẾT QUẢ: GIỐNG NHAU — Không tìm thấy sự khác biệt sau khi xác minh đầy đủ.
Điều khoản đã so sánh: X | Bảng đã so sánh: X | Hình đã so sánh: X
```
Dừng tại đây. Không output Phần B.

### PHẦN B: BẢNG SO SÁNH

Mỗi DIFF block từ Pha 3 = một hàng. Không thêm hàng nào khác.

| Văn bản 1 | Văn bản 2 | Kết quả so sánh và đánh giá |
|-----------|-----------|------------------------------|

**Cột "Văn bản 1":**
- `**[vị trí]**` rồi đến trích dẫn nguyên văn từ DIFF block
- Phần tử bị xóa: `**[KHÔNG CÓ TRONG V2]**`
- Hình/biểu đồ: liệt kê bước/nhánh như đã trích xuất ở Pha 3
- Bảng: nội dung ô liên quan

**Cột "Văn bản 2":**
- Cùng format
- Phần tử mới: `**[KHÔNG CÓ TRONG V1]**`

**Cột "Kết quả so sánh và đánh giá":**
```
<ID> | <Mức độ> | <Code>
Diff: <cụm từ thay đổi dùng ~~đã xóa~~ và **thêm mới**>
Thay đổi: <1 câu — thay đổi gì>
Ý nghĩa: <1 câu — tác động thực tế/pháp lý>
Phạm vi: <ai hoặc cái gì bị ảnh hưởng>
Phụ thuộc: <điều khoản khác bị ảnh hưởng, hoặc NONE>
Flag: NONE / CAN_LEGAL_REVIEW / CAN_COMPLIANCE_REVIEW / CAN_MANAGEMENT_APPROVAL
```

Với hàng [STRUCTURAL]: `<ID> | [STRUCTURAL] | STR-REN — Đổi số do <lý do>. Nội dung không thay đổi.`

### PHẦN C: THỐNG KÊ

```
SỐ LƯỢNG THAY ĐỔI
| Mức độ      | Số lượng |
|-------------|----------|
| [CRITICAL]  | X        |
| [MAJOR]     | X        |
| [MODERATE]  | X        |
| [MINOR]     | X        |
| [STRUCTURAL]| X        |
| Tổng        | X        |

DELTA CẤU TRÚC
| Hạng mục                    | V1 | V2 | Delta |
|-----------------------------|----|----|-------|
| Số chương/phần              | X  | X  | +/-X  |
| Số điều/khoản               | X  | X  | +/-X  |
| Thêm mới                    | -  | X  | +X    |
| Đã xóa                      | X  | -  | -X    |
| Đổi số                      | X  | X  | 0     |
| Thay đổi nội dung           | X  | X  | -     |
| Bảng thay đổi               | X  | X  | -     |
| Hình/biểu đồ thay đổi       | X  | X  | -     |

[Chỉ cho hợp đồng]
THAY ĐỔI GIÁ TRỊ QUAN TRỌNG
| Trường | V1 | V2 | DIFF ID |
|--------|----|----|---------|
| Giá trị hợp đồng | <exact> | <exact> | CR-XXX |
| Thời hạn | <exact> | <exact> | CR-XXX |

BẢN ĐỒ ĐỔI SỐ (nếu có)
| Số V1 | Số V2 | Lý do (ref DIFF ID) |
|-------|-------|---------------------|

CẦN XEM XÉT
| ID | Lý do | Ưu tiên |
|----|-------|---------|

GHI CHÚ PHÂN TÍCH
- Phần tử không đọc được: <danh sách hoặc NONE>
- Vấn đề OCR: <danh sách hoặc NONE>
- So sánh độ tin cậy thấp: <danh sách hoặc NONE>
```

---

## QUY TẮC ĐỌC FILE (áp dụng trong Pha 1)

**Tất cả loại file:**
- Đọc từ đầu đến cuối, không bỏ trang nào
- Bỏ qua: header/footer lặp lại, số trang, watermark, metadata file
- Multi-column: đọc trái sang phải, trên xuống dưới theo từng cột
- Footnote: gắn vào cuối điều khoản tương ứng

**PDF scan / ảnh:**
- Chỉ dùng text OCR nhận dạng được
- Vùng mờ: ghi `[UNREADABLE]`, không suy đoán
- OCR kém: ghi `[OCR_LOW_CONFIDENCE: <text>]`

**Bảng:**
- Đọc: tiêu đề -> header row -> từng data row
- Merged cell: áp dụng giá trị cho tất cả ô con
- Ô trống: ghi `[EMPTY]`, không bỏ qua
- Đọc số chính xác: "30" là ba mươi, không phải ba trăm hay ba
- Đọc đơn vị tiền tệ, đơn vị đo lường chính xác: "VNĐ" ≠ "USD", "%" ≠ "‰"

**Diagram / hình ảnh:**
- Đọc tất cả text label trước khi xác định cấu trúc
- Truy theo chiều mũi tên, không đoán
- Diamond = decision point; Rectangle = process step; Oval = start/end
- Node không đọc được: ghi `[UNREADABLE_NODE]`, không bỏ qua

**Tiếng Việt:**
- Giữ nguyên dấu thanh: ă â đ ê ô ơ ư và các thanh điệu
- Chỉ báo GIỐNG nếu ký tự hoàn toàn trùng khớp kể cả dấu
- Mất dấu do OCR ≠ thay đổi nội dung — ghi chú trong PARSING NOTES

**Số và ngày tháng trong hợp đồng — đặc biệt cẩn thận:**
- Đọc lại 2 lần mọi con số trước khi ghi vào inventory
- Ngày tháng: phân biệt DD/MM/YYYY vs MM/DD/YYYY
- Số tiền: đọc đủ chữ số, không rút gọn (1.000.000.000 ≠ 1.000.000)
- Tỷ lệ phần trăm: "10%" ≠ "10,5%"

---

## TÀI LIỆU ĐẦU VÀO

### PHIÊN BẢN 1 (CŨ):
[DÁN NỘI DUNG TÀI LIỆU V1 VÀO ĐÂY]

### PHIÊN BẢN 2 (MỚI):
[DÁN NỘI DUNG TÀI LIỆU V2 VÀO ĐÂY]
```
