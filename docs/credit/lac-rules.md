> Nguồn: tài liệu "Quy tắc giá trị chuẩn, phân loại sai lệch và kiểm tra Loan Application Context" (Bùi Ngọc Việt, 24/10/2026), mục 1–9. Phụ lục ví dụ trên hồ sơ thật đã được lược bỏ; các ví dụ có dữ liệu cá nhân được thay bằng giá trị giả. Bản gốc là nguồn sự thật cho nghiệp vụ; khi bản gốc đổi, cập nhật file này trong cùng thay đổi.

# Quy tắc giá trị chuẩn, phân loại sai lệch và kiểm tra Loan Application Context

Oct 24, 2026 · @Bùi Ngọc Việt

## 1. Phạm vi và nguyên tắc

Tài liệu này là bộ quy tắc của **Giai đoạn 2 · Integrity** trong giải pháp [Loan Application Context](https://claude.ai/artifact/EfCwYNY4bm1MqrTW6L1BmN). Nó quy định bốn việc: chọn giá trị chuẩn cho từng thông tin, phát hiện và phân loại sai lệch, xếp mức độ nghiêm trọng, và kiểm tra chéo giữa các vùng thông tin. Mọi quy tắc ở đây chạy bằng code tất định, không dùng AI. Các bảng tham số do nghiệp vụ sở hữu và có version.

Năm nguyên tắc xuyên suốt:

1. **Không sửa chứng từ gốc.** Giá trị chuẩn là một lớp bên trên, có ghi nguồn và quy tắc đã dùng. Mọi giá trị đọc được vẫn được giữ.
2. **Giấy tờ có thẩm quyền đứng trước, đa số chỉ phân xử khi cùng bậc.** Đa số chỉ đếm nguồn độc lập, nên các chứng từ chép từ nhau không thể làm một con số sai thành đúng.
3. **Nghi ngờ thì xếp mâu thuẫn (C).** Xếp nhầm lỗi đọc thành C chỉ tốn một lần chạy lại; xếp nhầm C thành lỗi đọc thì mất một tín hiệu rủi ro.
4. **Không tự sửa số tiền, số định danh, chủ sở hữu** khi có lệch thật.
5. **Mỗi kết luận phải truy được về nguồn:** thông tin có mã F#, sai lệch có mã X#, kết luận thẩm định trích các mã đó.

Phạm vi trong quy trình: các quy tắc chạy sau khi hồ sơ qua cổng Giai đoạn 1 (đúng loại, đúng người, còn hiệu lực) và sau khi LAC được dựng (gán người, liên kết). Kết quả đi vào hai nhánh song song như sơ đồ dưới.

(Sơ đồ luồng hai nhánh: xem docs/enterprise/LAC_INTEGRATION.md §3)

Mọi điểm lệch đi vào nhánh 1; nhánh 2 chỉ nhận giá trị chuẩn và các mâu thuẫn loại C. Bước ghép chạy lại phần thẩm định bị ảnh hưởng khi nhánh 1 đổi phân loại.

## 2. Chiến lược hai nhánh

Nhánh 1 bảo đảm dữ liệu không sai sót, kể cả chính tả và typo. Nhánh 2 thẩm định trên giá trị chuẩn và **bỏ qua lỗi đọc (A) và lỗi lập hồ sơ (B)**, vì đó là việc của nhánh 1. Nhánh 2 **không bỏ qua mâu thuẫn nội dung (C)**: thu nhập lệch 12 lần là tín hiệu thẩm định, không phải lỗi nhập liệu. Khi hai nhánh chạy song song, nhánh 1 chưa xác nhận xong, nên phân loại sơ bộ bằng code (mục 4.2) quyết định điểm nào đi sang nhánh 2.

| Loại vấn đề | Ví dụ | Nhánh 1 · soát dữ liệu | Nhánh 2 · thẩm định |
| --- | --- | --- | --- |
| N · biến thể cách viết, giá trị cũ | "Tân Lập, Đan Phượng, Hà Nội" và "xã Tân Lập, thành phố Hà Nội" | Chuẩn hoá, không báo lỗi | Chỉ thấy giá trị chuẩn |
| A · lỗi đọc | Thời hạn sử dụng đất bị cắt chuỗi | Đọc lại ảnh, sửa, ghi log | Bỏ qua, dùng giá trị chuẩn |
| B · lỗi lập hồ sơ | Bảng kê ghi nơi cấp khác thẻ Căn cước | Yêu cầu khách hàng hoặc RM sửa | Bỏ qua; riêng thiếu dữ liệu được ghi ở mục "giới hạn dữ liệu" |
| C · mâu thuẫn nội dung | Thu nhập 180 tr/tháng ở đơn vay, 180 tr/năm ở bảng kê | Xác nhận đây không phải A hoặc B | Đánh giá như tín hiệu rủi ro |
| Tín hiệu chéo vùng | GCN cấp sau kết hôn nhưng ghi sở hữu riêng | Không xử lý: dữ liệu khớp nhau | Đánh giá, kèm chỉ số tính sẵn |
| Nhận định nghiệp vụ | Hàng nhập 1,67 tỷ so với mặt bằng thuê 55 m² | Không xử lý | Toàn quyền đánh giá |

Hợp đồng dữ liệu giữa hai nhánh:

- **Đầu vào chung:** LAC với bảng giá trị chuẩn chọn theo mục 3. Mỗi thông tin có mã F# để cả hai nhánh trích dẫn.
- **Nhánh 1 nhận:** mọi sai lệch, mỗi sai lệch có mã X#, mã F# liên quan, giá trị theo nguồn, loại (mục 4), mức (mục 5), trạng thái xác nhận.
- **Nhánh 2 nhận:** bản trích LAC gồm giá trị chuẩn, liên kết, chỉ số tính sẵn, các mâu thuẫn C, tín hiệu chéo vùng (mục 7) và mục "giới hạn dữ liệu".
- **Nhánh 2 trả về:** các kết luận, mỗi kết luận liệt kê F# và X# đã dùng.
- **Bước ghép bằng code** nối hai phía qua mã F# (mục 10).

## 3. Quy tắc chọn giá trị chuẩn

Mỗi thông tin được gắn về đúng đối tượng trước (3.1), rồi đi qua bốn bước theo thứ tự: chuẩn hoá (3.2), lọc theo hiệu lực thời gian (3.3), lấy nguồn thẩm quyền cao nhất (3.4), rồi đa số nguồn độc lập (3.5). Đa số chỉ phân xử giữa các nguồn cùng bậc, hoặc khi thông tin không có nguồn thẩm quyền.

### 3.1 Gán người trước khi chọn giá trị

Mỗi lần một người được nhắc trên chứng từ được gán cho một người cụ thể bằng điểm bằng chứng, không theo cách DU gán cả bản ghi.

| Bằng chứng | Khớp | Lệch |
| --- | --- | --- |
| Số CCCD trên thẻ | +5 | −6 |
| Ngày sinh | +4 | −6 |
| Số CMND cũ | +4 | −3 |
| Số điện thoại | +3 | 0 |
| Ngày cấp giấy tờ | +2 | 0 |
| Địa chỉ (số nhà, đường, xã, tỉnh) | +2 | 0 |
| Giới tính | +1 | −4 |

- Gán khi đạt từ 2 điểm và hơn ứng viên thứ hai ít nhất 2 điểm. Không đạt thì tạo người chưa xác định (U#) và báo nhánh 1.
- Từ 4 điểm là mức **cao**. Dưới 4 là mức **trung bình**: mọi sai lệch dựa trên liên kết này có trạng thái "chờ xác nhận", không được "chốt theo quy tắc".
- Chủ sở hữu trên GCN không đủ điểm thì dùng thêm nguồn đối chiếu: đơn vay ghi tên chủ tài sản và số GCN trùng.

### 3.2 Chuẩn hoá

Bỏ các khác biệt không mang nghĩa. Hai giá trị bằng nhau sau bước này là loại N, không phải lỗi.

| Khác biệt | Quy tắc | Ví dụ |
| --- | --- | --- |
| Hoa thường, dấu | So trên chuỗi bỏ dấu, chữ thường; riêng họ tên, khác dấu khi cả hai bên có dấu thì xét B1 | Phạm Tuấn Đạt = PHAM TUAN DAT |
| Khoảng trắng, ký tự phân cách trong mã số | Bỏ trước khi so | AA 08798136 = AA08798136 |
| Tiền tố hành chính | Bỏ "xã, phường, thị trấn, huyện, tỉnh, thành phố" khi so | "Tỉnh Bắc Ninh" = "Bắc Ninh" |
| Cấp huyện sau sáp nhập 2025 | So địa chỉ theo khoá số nhà/thôn, xã, tỉnh; bỏ cấp huyện; quy đổi xã, tỉnh cũ sang mới theo bảng địa danh | "Tân Lập, Đan Phượng, Hà Nội" = "xã Tân Lập, thành phố Hà Nội" |
| Viết tắt cơ quan | Theo từ điển viết tắt: CS, QLHC, TTXH, BCA, UBND, TP | "QLHC về TTXH" = "Quản lý hành chính về trật tự xã hội" |
| Rút gọn | Một giá trị là phần đầu có nghĩa của giá trị kia | "Cục cảnh sát" so với tên đầy đủ của Cục |
| Định dạng số và ngày | Quy về số nguyên và ngày ISO trước khi so | 1.670.000.000 = 1670000000; 15/07/2026 = 2026-07-15 |
| Kỳ của số tài chính | Quy về năm để so, nhưng giữ kỳ gốc; khác kỳ không phải là N | 180 tr/tháng = 2,16 tỷ/năm |

### 3.3 Hiệu lực thời gian

Thông tin thay đổi theo thời gian chỉ so giữa các chứng từ cùng thời kỳ. Chứng từ cũ ghi giá trị cũ là lịch sử, không phải mâu thuẫn.

| Nhóm | Thông tin | Cách so |
| --- | --- | --- |
| Thay đổi theo thời gian | Loại, ngày, nơi cấp giấy tờ; địa chỉ thường trú và hiện tại; tình trạng hôn nhân; số điện thoại; chủ sở hữu; dư nợ | Giấy tờ tùy thân: giá trị ghi trên chứng từ lập trước ngày cấp thẻ hiện tại là lịch sử. Cư trú, hôn nhân, điện thoại: chứng từ cũ hơn 365 ngày so với chứng từ mới nhất là thời kỳ trước |
| Bất biến | Ngày sinh, giới tính, quê quán, số CMND cũ, số định danh cá nhân | So trên mọi chứng từ |

Ví dụ: giấy kết hôn 2023 ghi CCCD cấp 07/09/2022, còn thẻ Căn cước hiện tại cấp 12/12/2024. Giá trị 2022 là lịch sử (N).

### 3.4 Bậc thẩm quyền

Lấy giá trị trên chứng từ bậc cao nhất, mới nhất nếu có nhiều bản cùng bậc. Bậc 0 là nội dung in sẵn trên mặt giấy tờ (tiêu đề thẻ, cơ quan cấp in trên thẻ), đứng trên các trường được trích ra từ cùng giấy tờ.

| Nhóm thông tin | Bậc 1 | Bậc 2 | Bậc 3 · tự khai |
| --- | --- | --- | --- |
| Nhân thân: họ tên, số định danh, ngày sinh, giới tính, quê quán | Căn cước hoặc CCCD (mặt thẻ, chip, QR), VNeID | Giấy kết hôn, GCN, CIC | Đơn vay, bảng kê |
| Giấy tờ tùy thân: loại, ngày cấp, nơi cấp | Mặt thẻ (bậc 0), chip, QR, VNeID | Giấy kết hôn, GCN, CIC | Đơn vay, bảng kê |
| Cư trú: thường trú, nơi ở hiện tại | VNeID, xác nhận cư trú | Địa chỉ trên thẻ (tại ngày cấp), giấy kết hôn | Đơn vay, bảng kê |
| Hôn nhân, quan hệ vợ chồng | Giấy kết hôn; xác nhận tình trạng hôn nhân còn hạn | — | Đơn vay |
| Tài sản: số GCN, thửa, tờ, diện tích, mục đích, thời hạn, chủ sở hữu, hình thức sở hữu | GCN, kể cả trang đăng ký biến động | Xác nhận của văn phòng đăng ký đất đai | Đơn vay |
| Giá trị tài sản bảo đảm (luôn kèm ngày định giá) | Chứng thư thẩm định giá, biên bản định giá của ngân hàng | — | Đơn vay |
| Đề nghị vay: số tiền, kỳ hạn, lãi suất, mục đích, cách trả, vai trò các bên | Giấy đề nghị vay đã ký | — | — |
| Phương án vốn | Hợp đồng mua bán, hoá đơn | Bảng kê hàng hoá | Đơn vay |
| Doanh thu, chi phí, lợi nhuận (luôn kèm kỳ và loại nguồn) | Tờ khai hoặc thông báo thuế, sao kê tài khoản | Sổ sách kế toán của HKD | Bảng kê thu nhập, sau đó đến đơn vay |
| Đăng ký kinh doanh: tên, số, ngành, địa chỉ | Giấy chứng nhận đăng ký HKD | Thông báo thuế | Bảng kê thu nhập, sau đó đến đơn vay |
| Lịch sử tín dụng, dư nợ | Báo cáo CIC còn hiệu lực, đúng chủ thể | — | Khai trong đơn vay |
| Liên lạc: số điện thoại, email | — | VNeID | Đơn vay, bảng kê; chọn theo đa số |

### 3.5 Nhóm nguồn độc lập và đa số

Đa số đếm theo nhóm nguồn, không đếm bản sao. Mỗi nhóm chỉ có một phiếu.

| Nhóm nguồn | Chứng từ | Lý do gộp |
| --- | --- | --- |
| Dân cư | Căn cước hoặc CCCD, thông tin QR, VNeID | Cùng lấy từ Cơ sở dữ liệu quốc gia về dân cư |
| Tự khai | Đơn vay, bảng kê hàng, bảng kê thu nhập | Cùng người lập, thường cùng ngày, chép từ nhau |
| Mỗi giấy tờ do cơ quan khác cấp | Giấy kết hôn, GCN, CIC, chứng thư định giá | Mỗi giấy tờ là một nguồn riêng |

### 3.6 Khi các nguồn lệch nhau

- **Nguồn thẩm quyền lệch đa số theo kiểu lỗi đọc** (tối đa 2 ký tự trên mã số cùng độ dài, hoán đổi ngày và tháng): tạm lấy giá trị đa số, gắn A cho bản đọc của nguồn thẩm quyền, nhánh 1 đọc lại ảnh. Thẩm quyền thuộc về giấy tờ, còn lỗi nằm ở bản đọc.
- **Lệch có nghĩa:** lấy giá trị của nguồn thẩm quyền. Nguồn thấp hơn ghi khác: B4 nếu là thông tin giấy tờ tự khai, C nếu là nội dung.
- **Chỉ có nguồn tự khai và chúng lệch nhau:** với số tài chính, lấy giá trị thận trọng (thu nhập, doanh thu thấp hơn; nợ cao hơn; tài sản thấp hơn) và gắn C. Với thông tin khác, để "chưa xác định" và gắn B6 vì thiếu chứng từ.
- **Giá trị hiện tại chỉ có nguồn tự khai, chứng từ cũ ghi khác:** "chưa xác định", gắn B6. Thông tin đã "chưa xác định" thì chỉ sinh một sai lệch B6, không sinh thêm sai lệch so chéo.
- **Không chứng từ nào chứa giá trị** (ví dụ giá trị tài sản chỉ có ở dữ liệu tổng hợp của hồ sơ): giữ giá trị, gắn cờ "không có nguồn" và B6.

## 4. Phân loại sai lệch

Có bốn loại N, A, B, C, và chỉ C đi sang nhánh thẩm định. Với nhánh thẩm định, phân biệt A với B không quan trọng vì cả hai đều là việc của nhánh soát dữ liệu. Ranh giới cần giữ chặt là giữa nhóm A, B và nhóm C.

### 4.1 Bảng phân loại

| Mã | Tên | Định nghĩa | Ví dụ |
| --- | --- | --- | --- |
| N | Không phải lỗi | Cùng nghĩa, khác cách viết; hoặc giá trị cũ trên chứng từ cũ | "Huyện Đan Phượng" có hoặc không sau sáp nhập |
| A1 | Sai ký tự | Máy đọc nhầm 1–2 ký tự trong số, mã, tên | 0901234567 đọc thành 09012345Z7 |
| A2 | Sai ngày | Hoán đổi ngày và tháng, sai năm, ngày không tồn tại | Ngày tra cứu CIC 03/12/2026 sau ngày lập báo cáo |
| A3 | Sai đơn vị hoặc kỳ do bóc tách | Ảnh ghi một đơn vị, trường ra đơn vị khác | Ảnh ghi "/năm", trường ra MONTHLY |
| A4 | Gán sai hoặc nhiều ứng viên | Giá trị gán nhầm trường, nhầm người, hoặc trường ra nhiều ứng viên | Nơi cấp thẻ ra hai ứng viên |
| A5 | Bỏ sót hoặc cắt chuỗi | Ảnh có nội dung nhưng trường thiếu hoặc bị cắt | Thời hạn sử dụng đất mất cụm "Đất ở tại nông thôn" |
| B1 | Chính tả, typo trên chứng từ | Người lập viết sai trên giấy | Tên khách hàng sai dấu trên bảng kê |
| B2 | Thiếu yếu tố hình thức | Thiếu chữ ký, dấu, ngày ký; sai mẫu biểu | Bảng kê thu nhập không có ngày |
| B3 | Sai số học trong chứng từ | Số lượng × đơn giá ≠ thành tiền; tổng dòng ≠ tổng | Doanh thu − giá vốn ≠ lãi gộp |
| B4 | Ghi sai loại giấy tờ hoặc cơ quan cấp | Thông tin giấy tờ tự khai không đúng giấy tờ thật | Ghi CCCD cho thẻ Căn cước cấp 2024 |
| B5 | Chứng từ hết hiệu lực | Quá thời hạn sử dụng theo quy định | CIC lập quá số ngày cho phép |
| B6 | Thiếu chứng từ, thiếu nguồn hoặc sai chủ thể | Thiếu chứng từ bắt buộc, thông tin không có nguồn, hoặc chứng từ của người khác | CIC của người chồng; không có chứng thư định giá |
| C1 | Lệch giá trị có nghĩa | Cùng thuộc tính, cùng thời kỳ, khác nghĩa giữa các nguồn độc lập | Thu nhập lệch 12 lần |
| C2 | Lệch vai trò hoặc quan hệ | Cùng một người, vai trò khác nhau giữa các chứng từ | Chồng là SPOUSE ở đơn vay, CO\_BORROWER ở bảng kê |
| C3 | Lệch tổng hợp giữa chứng từ | Hai chứng từ mô tả cùng một đại lượng nhưng không khớp | Tổng phương án vốn ≠ số tiền vay |
| A\|B | Chưa tách được | Không phân biệt được lỗi đọc với lỗi trên giấy khi chưa có ảnh; ghi kèm mã con dự kiến | Bảng kê không thấy chữ ký: thiếu thật (B2) hay trích xuất bỏ sót (A5) |

B6 "sai chủ thể" là việc của nhánh soát dữ liệu, nhưng nhánh thẩm định vẫn thấy đúng sự thật nhờ LAC: CIC được gắn cho người được tra cứu, nên người vay hiện ra là "chưa có dữ liệu CIC" trong mục giới hạn dữ liệu.

### 4.2 Phân loại sơ bộ bằng code

Chạy trước khi tách hai nhánh, xét theo thứ tự, khớp quy tắc nào thì dừng:

1. Bằng nhau sau chuẩn hoá, hoặc khác thời kỳ với thông tin thay đổi theo thời gian: **N**.
2. Thiếu chứng từ bắt buộc, hết hạn, sai chủ thể, thông tin không có nguồn: **B**.
3. Lỗi nội tại một chứng từ (ngày không hợp lệ, ngày sau ngày lập, số học sai, thiếu chữ ký trên bản trích xuất): **A|B**, chờ đọc lại ảnh để tách.
4. Trường có nhiều ứng viên mà ứng viên này chứa ứng viên kia: **A5**, lấy bản đầy đủ. Nhiều ứng viên, một ứng viên khớp giá trị chuẩn: **A4**.
5. Giấy tờ nhà nước bậc 1 ghi khác bậc 0 của chính nó: **A4**. Chứng từ tự khai ghi thông tin giấy tờ khác giấy tờ thật: **A|B** (B4).
6. Mã số hoặc tên cùng độ dài lệch tối đa 2 ký tự, hoặc tên chỉ khác dấu: **A|B**.
7. Khác người, khác vai trò, khác tỉnh hoặc xã, số tiền lệch theo hệ số (×12, ×10^k) hoặc lệch quá ngưỡng: **C**.
8. Còn lại: **C**.

**Nghi ngờ thì xếp C.** Ví dụ thu nhập lệch đúng hệ số 12 vẫn xếp C, và chỉ hạ về A3 khi ảnh đơn vay thật sự ghi "/năm".

## 5. Mức độ nghiêm trọng

Mức độ = độ trọng yếu của thông tin × loại sai lệch, rồi áp các quy tắc ghi đè. Mỗi mức gắn với một hành động cụ thể:

| Mức | Tên | Hành động | Ảnh hưởng tới kết quả thẩm định |
| --- | --- | --- | --- |
| S1 | Chặn | Không chuyển phê duyệt hoặc ký hợp đồng cho đến khi xử lý | Cả hồ sơ ở trạng thái "chờ bổ sung" |
| S2 | Trọng yếu | Xử lý trước khi phê duyệt | Kết luận dựa vào thông tin đó bị gắn "tạm thời" |
| S3 | Cần sửa | Sửa trước khi in hợp đồng hoặc nhập hệ thống lõi | Không đổi |
| S4 | Ghi nhận | Không cần hành động | Không đổi |

Độ trọng yếu của thông tin:

- **K1 · sai là sai người, sai tài sản hoặc sai hợp đồng:** số định danh, số CMND cũ, họ tên, ngày sinh, giới tính; chủ thể CIC; chữ ký bên vay; số GCN, thửa, tờ và chủ sở hữu tài sản; số tiền và kỳ hạn vay.
- **K2 · sai là đổi kết quả đánh giá:** doanh thu, giá vốn, chi phí, lợi nhuận, thu nhập, nợ hiện có; giá trị, diện tích, mục đích, thời hạn, hình thức sở hữu tài sản; vai trò và quan hệ các bên; tình trạng hôn nhân; địa chỉ thường trú; số đăng ký và địa chỉ kinh doanh; mục đích vay, cách trả gốc; tổng phương án vốn; giấy tờ nhân thân của người tham gia khoản vay.
- **K3 · thông tin phụ:** liên lạc, loại và nơi cấp giấy tờ, mô tả, số mẫu biểu, nơi lập chứng từ, ngày tra cứu CIC.

| Loại | K1 | K2 | K3 |
| --- | --- | --- | --- |
| N | S4 | S4 | S4 |
| A · lỗi đọc | S2 | S2 nếu chỉ có một nguồn và quy tắc không chọn được giá trị; còn lại S3 | S3 |
| B · lỗi lập hồ sơ | S1 | S2 | S3 |
| C · mâu thuẫn nội dung | S1 | S2 | S3 |
| A\|B | Theo loại nặng hơn (B) | Theo loại nặng hơn (B) | S3 |

Quy tắc ghi đè, ưu tiên hơn ma trận:

- **Thiếu hoặc hết hạn chứng từ bắt buộc, thiếu chữ ký của bên vay hoặc bên bảo đảm:** luôn S1. Hạ mức nếu ảnh cho thấy có chữ ký.
- **Sai chính tả trên chứng từ khách hàng ký** (đơn vay, cam kết): tối thiểu S2 vì phải ký lại. Cùng lỗi đó trên chứng từ không ký: theo ma trận.
- **Lệch số tài chính (C1 trên K2):** S2 khi chênh quá ngưỡng, hoặc khi đổi giá trị làm một chỉ tiêu chính sách (LTV, DSCR, tỷ lệ vay/doanh thu) vượt ngưỡng. Dưới ngưỡng: S3.
- **Người tham gia khoản vay thiếu giấy tờ nhân thân:** S2; nâng S1 khi xác định người đó là đồng vay hoặc bảo lãnh.
- **Sai lệch dựa trên liên kết người mức trung bình:** giữ mức theo ma trận nhưng trạng thái luôn là "chờ xác nhận".

## 6. Danh mục quy tắc phát hiện sai lệch

Các quy tắc dưới đây đã có trong PoC `validate_case.py`. Mỗi sai lệch sinh ra mang mã quy tắc, loại, độ trọng yếu và mức. Cột cuối là ví dụ tình huống quy tắc bắt được.

| Mã | Kiểm tra gì | Loại mặc định | Ví dụ |
| --- | --- | --- | --- |
| R-CROSS | Cùng thông tin của cùng đối tượng, khác giá trị giữa các nguồn; phân loại theo mục 4.2 | N, A, A\|B, B, C | Chứng từ tự khai ghi loại giấy tờ khác thẻ |
| R-NORM | Các cách viết bằng nhau sau chuẩn hoá | N | Địa chỉ có và không có cấp huyện |
| R-ONEOF | Trường bị đọc ra nhiều ứng viên | A4, A5 | Nơi cấp thẻ ra hai ứng viên |
| R-INCOME | Thu nhập trên đơn vay so với bảng kê, sau khi quy về năm; lệch quá ngưỡng hoặc theo hệ số | C1 | Thu nhập theo tháng và theo năm lệch đúng 12 lần |
| R-ROLE | Vai trò của cùng một người trên các chứng từ khoản vay | C2 | Vợ/chồng ở đơn vay, đồng vay ở bảng kê |
| R-CROSS-DOC | Tổng phương án vốn so với số tiền vay | C3 | Tổng bảng kê hàng khác số vay đề nghị |
| R-CIC-SUBJECT | Chủ thể báo cáo CIC là người vay | B6 | CIC có số CMND cũ khác người vay |
| R-CIC-AGE | Báo cáo CIC còn trong số ngày hiệu lực | B5 | CIC lập quá 30 ngày |
| R-DATE | Ngày hợp lệ; không sau ngày lập chứng từ; không ở tương lai | A\|B (A2) | Lượt tra cứu CIC ghi sau ngày lập báo cáo |
| R-ID-FORMAT | Cấu trúc số CCCD 12 số: mã tỉnh nơi đăng ký khai sinh, mã thế kỷ và giới tính, năm sinh; CMND cũ 9 hoặc 12 số | A\|B (A1) | Mã giới tính trong số CCCD khác giới tính trên thẻ |
| R-ID-EXPIRY | Thẻ còn hạn; hạn thẻ khớp mốc đổi thẻ theo tuổi 25, 40, 60 | B5; A\|B (A2) | Hạn thẻ không trùng mốc tuổi |
| R-FORMAT | Định dạng số điện thoại, số GCN, số đăng ký kinh doanh | A\|B (A1) | Số điện thoại có 9 chữ số |
| R-ARITH | Số lượng × đơn giá = thành tiền; tổng dòng = tổng; doanh thu − giá vốn = lãi gộp; lãi gộp − chi phí = lợi nhuận | A\|B (B3) | Tổng các dòng bảng kê khác tổng ghi cuối bảng |
| R-FORM | Chữ ký và ngày trên chứng từ tự khai | A\|B (B2) | Bảng kê thu nhập không có chữ ký |
| R-NAME | Tên người ký hoặc chủ hộ kinh doanh khớp người vay: khác dấu là B1, khác người là C1 | A\|B (B1), C1 | Tên chủ hộ sai dấu trên bảng kê |
| R-SOURCE | Thông tin không có chứng từ nguồn; người tham gia khoản vay không có giấy tờ nhân thân bậc 1 | B6 | Giá trị tài sản không có chứng thư định giá |
| R-REQUIRED | Mục checklist bắt buộc thiếu | B6 | Thiếu báo cáo CIC của người vay |

Mỗi quy tắc ghi một trong hai trạng thái: **chốt theo quy tắc** (đủ căn cứ từ dữ liệu) hoặc **chờ xác nhận** (cần ảnh, cần người, hoặc dựa trên liên kết mức trung bình).

## 7. Kiểm tra chéo giữa các vùng thông tin

Các quy tắc này chạy trên liên kết của LAC và trên lớp chỉ số tính sẵn. Chúng không tìm lỗi dữ liệu mà sinh **tín hiệu thẩm định** (mã T#) cho nhánh 2, kèm số liệu và công thức. Tín hiệu không có mức S và không chặn hồ sơ; nhánh 2 và chuyên viên đánh giá. Trạng thái: đã đặc tả, chưa có trong PoC. Ngưỡng là đề xuất, chờ quản lý rủi ro chốt.

| Mã | Kết hợp | Quy tắc | Ngưỡng đề xuất |
| --- | --- | --- | --- |
| R-X-MARITAL-ASSET | Tài sản × Quan hệ | Tài sản xác lập sau ngày kết hôn mà ghi sở hữu riêng: cần căn cứ tài sản riêng hoặc ý kiến của vợ hoặc chồng. Ngày cấp GCN có thể là ngày cấp đổi, nên tín hiệu ghi "cần xác minh" | Mọi trường hợp |
| R-X-LTV-MARGIN | Khoản vay × Tài sản | LTV sát trần chính sách, hoặc giá trị tài sản không có nguồn hay không có ngày định giá | Trong 1 điểm % dưới trần |
| R-X-PLAN-COGS | Phương án vốn × Kinh doanh | Giá trị hàng nhập so với giá vốn cả năm; kèm diện tích và hình thức mặt bằng | Hàng nhập lớn hơn 50% giá vốn năm |
| R-X-BULLET | Khoản vay × Tài chính | Gốc trả cuối kỳ so với lợi nhuận tích luỹ trong kỳ vay | Gốc lớn hơn lợi nhuận cả kỳ |
| R-X-LOAN-REVENUE | Khoản vay × Kinh doanh | Số vay so với doanh thu năm | Lớn hơn 1 lần |
| R-X-INCOME-USE | Tài chính × Khoản vay | Chỉ số khả năng trả nợ phải dùng giá trị thu nhập chuẩn (thận trọng) và ghi cờ nếu thu nhập đang có mâu thuẫn C | Khi thu nhập có X# loại C |
| R-X-METRIC-INPUT | Chỉ số × Nguồn | Chỉ số thiếu đầu vào thì ghi "chưa tính được" và nêu đầu vào thiếu, không ước lượng | DSCR thiếu lãi suất bằng số |

Lớp chỉ số tính sẵn. Chỉ số thiếu đầu vào ghi “chưa tính được” kèm đầu vào thiếu; thông tin đang có mâu thuẫn C thì dùng giá trị thận trọng và gắn cờ:

| Chỉ số | Công thức | Đầu vào |
| --- | --- | --- |
| LTV | Số vay / giá trị tài sản bảo đảm phân bổ | Số vay; giá trị trên liên kết tài sản – khoản vay |
| DSCR | Dòng tiền trả nợ / nghĩa vụ trả nợ năm | Lợi nhuận hoặc thu nhập năm; lãi suất bằng số; lịch trả gốc; nợ hiện có |
| Số vay / doanh thu năm | Số vay / doanh thu thuần năm | Số vay; doanh thu kèm kỳ |
| Phương án / giá vốn năm | Tổng phương án vốn / giá vốn năm | Tổng phương án; giá vốn kèm kỳ |
| Gốc cuối kỳ / lợi nhuận cả kỳ | Gốc trả cuối kỳ / (lợi nhuận năm × số năm vay) | Cách trả gốc; kỳ hạn; lợi nhuận năm |
| Biên lợi nhuận | Lợi nhuận / doanh thu | Lợi nhuận và doanh thu cùng kỳ |

## 8. Tham số chờ quyết định

Các giá trị dưới đây đang tạm đặt để PoC chạy được. Trước khi dùng thật, đơn vị ghi ở cột cuối cần chốt.

| Tham số | Giá trị tạm | Dùng ở | Ai chốt |
| --- | --- | --- | --- |
| Số ngày hiệu lực báo cáo CIC | 30 ngày | R-CIC-AGE | Quản lý rủi ro |
| Ngưỡng lệch số tài chính | 10% | R-INCOME, ghi đè mức C1 | Quản lý rủi ro |
| Ngưỡng "chứng từ cũ" với cư trú, hôn nhân, điện thoại | 365 ngày | Mục 3.3 | Sản phẩm |
| Biên cảnh báo LTV sát trần | 1 điểm % | R-X-LTV-MARGIN | Quản lý rủi ro |
| Ngưỡng hàng nhập / giá vốn năm | 50% | R-X-PLAN-COGS | Quản lý rủi ro, BU |
| Ngưỡng số vay / doanh thu năm | 1 lần | R-X-LOAN-REVENUE | Quản lý rủi ro |
| Điểm gán người và ngưỡng 2 / 4 điểm | Bảng mục 3.1 | Mục 3.1 | Kiến trúc, sau khi đo trên 50–100 hồ sơ |
| Danh mục mã tỉnh trên CCCD | 63 tỉnh trước sáp nhập | R-ID-FORMAT | Pháp chế đối chiếu văn bản |
| Mốc đổi thẻ theo tuổi | 25, 40, 60; cấp trong vòng 2 năm trước mốc thì dùng mốc kế tiếp | R-ID-EXPIRY | Pháp chế đối chiếu văn bản |
| Độ trọng yếu K1, K2, K3 của từng thông tin | Danh sách mục 5 | Ma trận mức độ | Quản lý rủi ro, Sản phẩm |
| Bảng thẩm quyền và nhóm nguồn | Bảng mục 3.4, 3.5 | Mục 3 | Sản phẩm |

## 9. Bước ghép kết quả và việc cần làm

Bước ghép chạy bằng code. Nó nối sai lệch của nhánh soát dữ liệu với kết luận của nhánh thẩm định qua mã F#, rồi cho ra một trong ba trạng thái: đủ điều kiện trình, tạm thời kèm điều kiện, hoặc chờ bổ sung.

1. Còn điểm S1 chưa xử lý: hồ sơ ở trạng thái **chờ bổ sung**. Kết quả thẩm định vẫn giữ để tham khảo.
2. Kết luận trích thông tin đang có S2 chưa xử lý: kết luận đó bị gắn **tạm thời**, kèm điều kiện cần xác minh.
3. Không còn S1 và không kết luận nào vướng S2: **đủ điều kiện trình**.
4. Nhánh soát dữ liệu đổi phân loại sau khi đọc lại ảnh:
   - C thành A hoặc B: rút mâu thuẫn khỏi nhánh thẩm định, chạy lại các kết luận có trích thông tin đó.
   - A hoặc B thành C: thêm mâu thuẫn vào nhánh thẩm định, chạy lại các kết luận liên quan.
   - Giá trị chuẩn thay đổi sau khi sửa lỗi A: tính lại chỉ số và tín hiệu chéo vùng liên quan, chạy lại các kết luận có trích thông tin đó.
5. Chỉ chạy lại phần bị ảnh hưởng. Bản trích LAC cho nhánh thẩm định khoảng 2.600 token mỗi hồ sơ, nên chi phí chạy lại thấp.


Việc đã làm trong PoC:

- [x] Gán mã F# và giá trị chuẩn cho từng thông tin
- [x] Code hoá bảng thẩm quyền, nhóm nguồn độc lập, danh sách thông tin thay đổi theo thời gian
- [x] Code hoá phân loại sơ bộ, ma trận mức độ và các quy tắc ở mục 6
- [x] Xuất bản trích LAC cho nhánh thẩm định, có mục giới hạn dữ liệu

Việc cần làm tiếp:

- [ ] Code hoá kiểm tra chéo vùng (mục 7) và lớp chỉ số tính sẵn
- [ ] Thêm vùng Phương án vốn và Tài chính có kỳ, loại nguồn vào LAC
- [ ] Bổ sung từ điển viết tắt và bảng địa danh sau sáp nhập 2025 đầy đủ
- [ ] DU trả về trang, toạ độ vùng và độ tin cậy cho mỗi trường để nhánh soát dữ liệu đọc lại đúng vùng ảnh
- [ ] Các đơn vị chốt tham số ở mục 8
- [ ] Schema đầu ra của nhánh thẩm định và script ghép
- [ ] Đo độ chính xác gán người và phân loại trên 50–100 hồ sơ đã thẩm định

