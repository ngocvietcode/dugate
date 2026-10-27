# MB02 — Bảng mô tả trường dữ liệu cho UI

Tài liệu này liệt kê toàn bộ các trường mà extractor trả về cho biểu mẫu **MB02
— Giấy đề nghị kiêm hợp đồng mở và sử dụng tài khoản thanh toán, dịch vụ**, phục
vụ tích hợp UI.

Mỗi bảng mô tả một khối (section) trong biểu mẫu. Cột:

- **Field** — key ở top-level trong JSON output.
- **Subfield** — với các trường mảng, đây là key con trong từng phần tử. Bỏ trống với trường vô hướng.
- **Type** — kiểu dữ liệu (chính là `type` khai báo trong schema; xem bảng kiểu bên dưới).
- **Title** — nhãn tiếng Việt (chính là `label` khai báo trong schema).
- **Mô tả** — giải thích trường tiếng Việt, tập trung vào **khi nào trường có giá trị** và các trường dễ nhầm lẫn.

Quy ước giá trị mặc định (áp dụng cho toàn bộ MB02):

- Trường không có trên biểu mẫu → `null`.
- **Nhóm checkbox cho phép tick nhiều ô** (kiểu `string[]`) → mảng chuỗi, mỗi ô
  được tick là một phần tử. Không tick ô nào → `null` (KHÔNG phải `[]`, không
  phải `""`).
- **Nhóm checkbox chỉ chọn một ô** (kiểu `string`) → nhãn của ô được tick. Không
  tick ô nào → `null`.
- Trường mảng bản ghi (kiểu `object[]`, VD `legal_representatives`) khi phần đó
  của biểu mẫu trống → `[]`.
- Mọi giá trị chuỗi trả về ở dạng **VIẾT HOA KHÔNG DẤU** (theo header của XLSX).

### Kiểu dữ liệu (`type`) và độ tin cậy (`confidence`)

Mỗi trường khai báo một `type` trong schema (`extract-schemas.ts`); mặc định là
`string` nếu không ghi. Các kiểu dùng trong MB02: `string`, `boolean`,
`string[]`, `object[]`.

Sau khi xử lý, mỗi giá trị được bọc kèm độ tin cậy:

| Kiểu | Shape trả về cho UI |
|---|---|
| `string`, `boolean` | `{ "value": <giá trị>, "confidence": 0.95 }` |
| `string[]` | `{ "value": ["A", "B"], "confidence": 0.92 }` — **một** `confidence` cho cả trường (trung bình của từng phần tử), không phải mỗi phần tử một giá trị |
| `string[]` không có dữ liệu | `null` |
| `object[]` | mảng thường, `confidence` nằm ở từng leaf bên trong mỗi bản ghi |

---

## Nhóm 1 — Thông tin tổ chức + Chi nhánh (`org_and_branch`)

### I.1 Thông tin tổ chức

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `org_name_vi` |  | `string` | Tên tổ chức (tiếng Việt) | Luôn có giá trị. Đọc tại "Tên tiếng Việt" phần I.1. |
| `org_name_foreign` |  | `string` | Tên tổ chức (tiếng nước ngoài) | Chỉ có giá trị nếu tổ chức khai tên nước ngoài; null nếu để trống. |
| `org_short_name` |  | `string` | Tên viết tắt | Chỉ có giá trị nếu tổ chức khai tên viết tắt; null nếu để trống. |
| `business_registration_no` |  | `string` | Số ĐKDN/ĐKKD/QĐTL | Luôn có giá trị. Số ĐKDN / ĐKKD / QĐTL của tổ chức. |
| `establishment_date` |  | `string` | Ngày đăng ký thành lập | Luôn có giá trị nếu form được điền đúng. |
| `registration_place` |  | `string` | Nơi cấp | Cơ quan cấp giấy ĐKDN/ĐKKD/QĐTL. |
| `establishment_country` |  | `string` | Quốc gia thành lập | Quốc gia thành lập tổ chức. |
| `tax_code` |  | `string` | Mã số thuế / Mã số doanh nghiệp | Luôn có giá trị. |
| `org_identification_no` |  | `string` | Số định danh của tổ chức | Chỉ có giá trị nếu tổ chức có số định danh (ít gặp); null nếu không. |
| `state_budget_relation_code` |  | `string` | Mã số ĐV có quan hệ với NSNN | Chỉ có giá trị nếu tổ chức có quan hệ với NSNN; null nếu không. |
| `residency_status` |  | `string` | Tình trạng cư trú | Nhãn của checkbox được tick: "Cư trú" hoặc "Không cư trú". |
| `head_office_address` |  | `string` | Địa chỉ trụ sở chính | Thường là dòng chuẩn "Theo ghi nhận tại ĐKDN/ĐKKD/QĐTL nêu trên". |
| `transaction_address_type` |  | `string` | Loại địa chỉ giao dịch | Nhãn checkbox tick: "Giống địa chỉ trụ sở chính" hoặc "Khác". Cặp với `other_address` bên dưới. |
| `other_address` |  | `string` | Địa chỉ khác | **Chỉ có giá trị khi `transaction_address_type = "Khác"`**; là toàn bộ dòng địa chỉ (đã gồm phường/xã + tỉnh/thành). null trong các trường hợp khác. |
| `phone` |  | `string` | Số điện thoại | Số điện thoại tổ chức. |
| `fax` |  | `string` | Số fax | Chỉ có giá trị nếu tổ chức khai; null nếu để trống. |
| `email` |  | `string` | Email | Email tổ chức nhận thông báo VPBank. |
| `website` |  | `string` | Trang thông tin điện tử | Chỉ có giá trị nếu khai (mục "nếu có"); null nếu để trống. |
| `main_business_sector` |  | `string` | Lĩnh vực kinh doanh chính | Tên ngành nghề chính. |
| `business_sector_code` |  | `string` | Mã ngành (cấp 5) | Mã ngành cấp 5. |
| `authorized_representative_summary` |  | `string` | Đại diện hợp pháp (dòng khai báo trên đầu trang) | Dòng tự do "Đại diện hợp pháp: …" ghi ngay đầu Section I (thường gồm tên + số văn bản ủy quyền + ngày + tổ chức ủy quyền). null nếu form không có dòng này. |

### I.1 (tiếp) — Khối doanh nghiệp SME

Chỉ xuất hiện ở bản biểu mẫu dành cho khách hàng SME. Nếu form không phải bản
SME, cả 5 trường dưới đây đều `null`.

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `sme_micro_enterprise` |  | `boolean` | Quy mô doanh nghiệp siêu nhỏ | `true`/`false` theo trạng thái checkbox "Quy mô doanh nghiệp siêu nhỏ và áp dụng chế độ kế toán đơn giản"; `null` nếu dòng này không có trên form. |
| `sme_previous_year_revenue` |  | `string` | Doanh thu năm trước (tỷ đồng) | Nhãn dải doanh thu được tick (`"<=3"`, `"trên 3-10"`, …); null nếu không tick. |
| `sme_total_capital` |  | `string` | Tổng nguồn vốn (tỷ đồng) | Nhãn dải vốn được tick (`"<=3"`, `"3-20"`, `"20-50"`, `"50-100"`, `">100"`); null nếu không tick. |
| `sme_social_insurance_employees` |  | `string` | Số lao động BHXH (người) | Nhãn dải lao động được tick (`"<=10"`, `"10-50"`, `"50-100"`, `"100-200"`, `">200"`); null nếu không tick. |
| `sme_woman_owned` |  | `string` | Sở hữu bởi phụ nữ | Toàn bộ nội dung được tick / phần trả lời tự do; null nếu để trống. |

### I.2 Thông tin Chi nhánh/VPĐD

**Toàn bộ** trường trong bảng dưới **chỉ có giá trị khi biểu mẫu khai Chi nhánh/VPĐD** (Section I.2 được điền). Nếu Section I.2 để trống → tất cả `branch_*` đều `null`.

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `branch_name` |  | `string` | Tên Chi nhánh/VPĐD | Tên đầy đủ của chi nhánh/VPĐD. |
| `branch_registration_no` |  | `string` | GCN ĐKHĐ Chi nhánh/VPĐD | Số Giấy chứng nhận đăng ký hoạt động Chi nhánh/VPĐD. |
| `branch_establishment_date` |  | `string` | Ngày đăng ký / thành lập (chi nhánh) | Ngày đăng ký/thành lập chi nhánh. |
| `branch_tax_code` |  | `string` | Mã số thuế chi nhánh | Chỉ có giá trị nếu chi nhánh có MST; null nếu để trống. |
| `branch_head_office_address` |  | `string` | Địa chỉ chi nhánh/VPĐD | Thường là dòng chuẩn "Theo ghi nhận tại GCN ĐKHĐ Chi nhánh/VPĐD nêu trên". |
| `branch_transaction_address_type` |  | `string` | Loại địa chỉ giao dịch (chi nhánh) | Nhãn checkbox: "Địa chỉ Chi nhánh/VPĐD" hoặc "Khác". Cặp với `branch_other_address`. |
| `branch_other_address` |  | `string` | Địa chỉ khác (chi nhánh) | **Chỉ có giá trị khi `branch_transaction_address_type = "Khác"`**; null trong các trường hợp khác. |
| `branch_phone` |  | `string` | Số điện thoại (chi nhánh) | Số điện thoại chi nhánh. |
| `branch_fax` |  | `string` | Số fax (chi nhánh) | Chỉ có giá trị nếu khai; null nếu để trống. |
| `branch_email` |  | `string` | Email (chi nhánh) | Email chi nhánh nhận thông báo VPBank. |
| `branch_website` |  | `string` | Trang thông tin điện tử (chi nhánh) | Chỉ có giá trị nếu khai; null nếu để trống. |
| `branch_main_business_sector` |  | `string` | Lĩnh vực hoạt động chính (chi nhánh) | Tên ngành nghề chính của chi nhánh. |
| `branch_business_sector_code` |  | `string` | Mã ngành (cấp 5) - chi nhánh | Mã ngành cấp 5 của chi nhánh. |

---

## Nhóm 2 — Dịch vụ + Sản phẩm (`services_and_products`)

### I.3 FATCA

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `fatca_us_tax_code` |  | `string` | Mã số thuế Hoa Kỳ của tổ chức | **Chỉ có giá trị khi tổ chức là pháp nhân theo luật Hoa Kỳ** (mục 3.1); null trong các trường hợp khác. |
| `fatca_us_exempt_code` |  | `string` | Mã số miễn trừ báo cáo FATCA | Chỉ có giá trị nếu tổ chức có mã miễn trừ báo cáo FATCA (mục 3.1); null nếu không có. |
| `fatca_classification` |  | `string` | Phân loại FATCA | Nhãn đầy đủ của option được tick tại mục 3.2 (VD: "Tổ chức phi tài chính chủ động", "Tổ chức phi tài chính bị động không có Cá nhân có quyền kiểm soát hoặc Có cá nhân có quyền kiểm soát không phải là người Hoa Kỳ", …). null nếu không tick option nào. |
| `fatca_us_controlling_persons` |  | `object[]` | Cá nhân có quyền kiểm soát là người Hoa Kỳ | **Mảng — chỉ populated khi option "Tổ chức phi tài chính bị động và có Cá nhân có quyền kiểm soát là người Hoa Kỳ, vui lòng điền thông tin" tại mục 3.2 được tick** (một bảng con hiện dưới option đó). `[]` trong các trường hợp khác. |
| `fatca_us_controlling_persons` | `sequence_no` | `string` | STT | Số thứ tự dòng trong bảng con FATCA (cột "STT"). |
| `fatca_us_controlling_persons` | `full_name` | `string` | Họ và tên | Họ tên đầy đủ của cá nhân có quyền kiểm soát. |
| `fatca_us_controlling_persons` | `address` | `string` | Địa chỉ | Địa chỉ của cá nhân. |
| `fatca_us_controlling_persons` | `us_tin` | `string` | Mã số thuế Hoa Kỳ (TIN) | US TIN của cá nhân. |

### I.4 Mục đích quan hệ với VPBank

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `relationship_purpose` |  | `string[]` | Mục đích quan hệ với VPBank | Mỗi option được tick là một phần tử (VD: `["Sử dụng dịch vụ thu, chi hộ", "Thanh toán, chuyển tiền, kinh doanh trong nước"]`). Nếu tick "Khác" thì phần tử đó là văn bản tự do sau dấu ":". `null` nếu không tick option nào. |

### II Đăng ký dịch vụ

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `registered_services` |  | `string[]` | Dịch vụ đăng ký | Mỗi dịch vụ được tick là một phần tử (VD: `["Dịch vụ mở, sử dụng tài khoản thanh toán", "Dịch vụ Thẻ ghi nợ"]`). `null` nếu không tick option nào. |

### III.1 TKTT (Tài khoản thanh toán)

Section III.1 có hai hàng: **TKTT thông thường** và **TKTT đặc biệt**. Nếu khách hàng chỉ mở một loại, các trường của loại còn lại sẽ `null`.

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `tktt_normal_currencies` |  | `string[]` | TKTT thông thường — Loại tiền | Mỗi loại tiền được tick trên hàng "TKTT thông thường" là một phần tử (từ VND, USD, EURO, Khác). `null` nếu không tick. |
| `tktt_normal_other_currency` |  | `string` | TKTT thông thường — Tiền khác | **Chỉ có giá trị khi "Khác" được tick** trên hàng "TKTT thông thường"; null trong các trường hợp khác. |
| `tktt_normal_beautiful_number` |  | `boolean` | TKTT thông thường — Tài khoản số đẹp | `true`/`false` theo checkbox "Tài khoản số đẹp" trên hàng "TKTT thông thường". |
| `tktt_normal_number` |  | `string` | TKTT thông thường — Số tài khoản | Số tài khoản điền sau "Số:"; null nếu chưa cấp hoặc KH không mở TKTT thông thường. |
| `tktt_normal_fee` |  | `string` | TKTT thông thường — Phí (chưa VAT) | Phí chưa VAT điền sau "Phí (chưa VAT):"; null nếu chưa điền. |
| `tktt_special_type` |  | `string` | TKTT đặc biệt — Loại TK | Loại TK đặc biệt điền sau "TKTT đặc biệt (Nêu rõ loại TK):"; null nếu KH không mở TKTT đặc biệt. |
| `tktt_special_currencies` |  | `string[]` | TKTT đặc biệt — Loại tiền | Tương tự `tktt_normal_currencies` nhưng cho hàng "TKTT đặc biệt". `null` nếu không tick. |
| `tktt_special_other_currency` |  | `string` | TKTT đặc biệt — Tiền khác | Chỉ có giá trị khi "Khác" được tick trên hàng "TKTT đặc biệt". |
| `tktt_special_beautiful_number` |  | `boolean` | TKTT đặc biệt — Tài khoản số đẹp | `true`/`false` theo checkbox "Tài khoản số đẹp" trên hàng "TKTT đặc biệt". |
| `tktt_special_number` |  | `string` | TKTT đặc biệt — Số tài khoản | Số tài khoản; null nếu KH không mở TKTT đặc biệt. |
| `tktt_special_fee` |  | `string` | TKTT đặc biệt — Phí (chưa VAT) | Phí chưa VAT; null nếu chưa điền. |

### III.2 Sổ phụ / Hóa đơn điện tử

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `statement_frequency` |  | `string` | Tần suất nhận sổ phụ / hóa đơn điện tử | Giá trị của option được tick (VD: "Hàng tháng"); null nếu không tick. |
| `statement_delivery_methods` |  | `string[]` | Hình thức nhận sổ phụ / hóa đơn điện tử | Mỗi hình thức được tick là một phần tử, đã bao gồm địa chỉ/email/fax ghi cạnh (VD: `["Qua email: HOADON.HATEXCO@GMAIL.COM"]`). `null` nếu không tick. |

### III.3 SMS Banking

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `sms_banking_phones` |  | `string[]` | Danh sách số điện thoại SMS Banking | Tối đa 3 số điện thoại lấy từ "ĐTDĐ 1", "ĐTDĐ 2", "ĐTDĐ 3". Bỏ qua hàng trống. `null` nếu cả 3 hàng đều trống. |

### III.4 QLDT (Gói SME)

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `qldt_package` |  | `string` | Gói QLDT (SME) | Nhãn gói QLDT được tick ("Lựa chọn 1"/"Lựa chọn 2"/"Lựa chọn 3"/"Lựa chọn 4"). null nếu không tick / KH không đăng ký QLDT. |

### IV Ngân hàng trực tuyến

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `online_banking_account_choice` |  | `string` | Ngân hàng trực tuyến — Tài khoản đăng ký | Nhãn option được tick tại IV.1. Cặp với `online_banking_account_other`. |
| `online_banking_account_other` |  | `string` | Ngân hàng trực tuyến — Khác | **Chỉ có giá trị khi `online_banking_account_choice = "Khác"`**; null trong các trường hợp khác. |
| `online_banking_daily_limit` |  | `string` | Ngân hàng trực tuyến — Hạn mức giao dịch/ngày | Nhãn option được tick tại IV.2. Cặp với `online_banking_daily_limit_details`. |
| `online_banking_daily_limit_details` |  | `string[]` | Ngân hàng trực tuyến — Chi tiết hạn mức | **chỉ có giá trị khi `online_banking_daily_limit = "Khác"`**; mỗi dòng chi tiết là một phần tử. `null` trong các trường hợp khác. |
| `online_banking_approval_mechanism` |  | `string[]` | Cơ chế phê duyệt | Mỗi cơ chế được tick tại IV.4 là một phần tử ("Một cấp vừa lập lệnh vừa duyệt lệnh", "Một cấp phê duyệt", "Nhiều cấp phê duyệt", "Phê duyệt đồng cấp", "Phê duyệt có thứ tự", "Khác"). `null` nếu không tick. |
| `online_banking_approval_details` |  | `string[]` | Chi tiết cơ chế phê duyệt | Chi tiết bổ sung cho IV.4 (số người tham gia / số cấp / nội dung khi "Khác"), mỗi chi tiết là một phần tử. `null` nếu không có. |

### V Thẻ ghi nợ doanh nghiệp

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `debit_card_account_choice` |  | `string` | Thẻ ghi nợ — Tài khoản gắn Thẻ | Nhãn option được tick tại V.1 ("Là TKTT mở theo Giấy đề nghị này" hoặc "Khác"). |
| `debit_card_account_other` |  | `string` | Thẻ ghi nợ — Tài khoản khác | **Chỉ có giá trị khi `debit_card_account_choice = "Khác"`**; null trong các trường hợp khác. |
| `debit_card_type` |  | `string` | Loại thẻ phát hành | Nhãn loại thẻ được tick tại V.2. |
| `debit_card_type_other` |  | `string` | Loại thẻ khác | **Chỉ có giá trị khi `debit_card_type = "Khác"`**; null trong các trường hợp khác. |
| `debit_card_embossed_name` |  | `string` | Tên in nổi trên thẻ | Chuỗi ký tự đọc từ hàng ô chữ tại V.3 (tối đa ~20 ký tự); null nếu để trống. |
| `debit_card_delivery_method` |  | `string` | Hình thức nhận Thẻ và PIN | Nhãn phương thức được tick tại V.4 ("Khách hàng nhận trực tiếp tại quầy giao dịch của VPBank" / "Nhận trực tiếp tại địa chỉ của Khách hàng" / "Gửi chuyển phát nhanh/đảm bảo đến địa chỉ"). |
| `debit_card_delivery_address` |  | `string` | Địa chỉ nhận Thẻ và PIN | Địa chỉ / chi nhánh ghi cạnh phương thức được tick tại V.4 (VD: "VPBANK THANH DO"); null nếu để trống. |

### V.5 Người nhận Thẻ và PIN

**Toàn bộ trường trong bảng dưới chỉ có giá trị khi KH đăng ký người nhận Thẻ và PIN** (Section V.5 được điền). null nếu để trống.

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `card_receiver_full_name` |  | `string` | Người nhận Thẻ và PIN — Họ tên | Họ tên người nhận. |
| `card_receiver_id_type` |  | `string` | Người nhận Thẻ và PIN — Loại GTTT | Loại giấy tờ tùy thân (VD: "Thẻ CCCD"). |
| `card_receiver_id_no` |  | `string` | Người nhận Thẻ và PIN — Số GTTT | Số giấy tờ tùy thân. |
| `card_receiver_id_issue_date` |  | `string` | Người nhận Thẻ và PIN — Ngày cấp | Ngày cấp GTTT. |
| `card_receiver_id_place_of_issue` |  | `string` | Người nhận Thẻ và PIN — Nơi cấp | Nơi cấp GTTT. |
| `card_receiver_phone` |  | `string` | Người nhận Thẻ và PIN — Điện thoại | Số điện thoại liên hệ. |
| `card_receiver_email` |  | `string` | Người nhận Thẻ và PIN — Email | Email liên hệ. |

### Xác nhận đồng ý bảo vệ dữ liệu cá nhân + Xác nhận chữ ký VPBank

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `personal_data_consents` |  | `string[]` | Đồng ý xử lý DLCN | Mỗi option đồng ý được tick tại khối "III. XÁC NHẬN ĐỒNG Ý VỚI HOẠT ĐỘNG BẢO VỆ, XỬ LÝ DỮ LIỆU CÁ NHÂN" ở cuối form là một phần tử. `null` nếu không tick. |
| `vpbank_signature_confirmation` |  | `string` | Xác nhận chữ ký VPBank | Nhãn được tick ("Xác nhận chứng kiến Khách hàng ký") nếu checkbox được tick; `null` nếu không tick. |

---

## Nhóm 3 — Chữ ký nhóm 1 (VI) — `signatures_group1`

Section VI có 2 mảng: **VI.1 Đại diện hợp pháp** và **VI.2 Đại diện theo ủy quyền / Người được ủy quyền sử dụng TKTT**. Cả hai có thể có nhiều người → mỗi phần tử mảng là một người.

### VI.1 `legal_representatives`

**Giá trị**: `[]` nếu Section VI.1 trống; ngược lại một object per person block.

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `legal_representatives` |  | `object[]` | Người đại diện hợp pháp (VI.1) | Mảng người đại diện hợp pháp. Sub-key đầy đủ ở các dòng dưới. |
| `legal_representatives` | `full_name` | `string` | Họ và tên | Họ và tên người đại diện. |
| `legal_representatives` | `sex` | `string` | Giới tính | Nhãn được tick: "Nam" hoặc "Nữ". |
| `legal_representatives` | `date_of_birth` | `string` | Ngày sinh | Ngày sinh. |
| `legal_representatives` | `occupation` | `string` | Nghề nghiệp | Nghề nghiệp; null nếu không khai. |
| `legal_representatives` | `position` | `string` | Chức vụ | Chức vụ trong tổ chức. |
| `legal_representatives` | `nationality` | `string` | Quốc tịch | Quốc tịch. |
| `legal_representatives` | `tax_code` | `string` | Mã số thuế cá nhân | Chỉ có giá trị nếu người này có MST; null nếu không. |
| `legal_representatives` | `id_document_type` | `string` | Loại giấy tờ tùy thân | Loại GTTT (VD: "Thẻ CCCD", "Hộ chiếu"). |
| `legal_representatives` | `id_no` | `string` | Số giấy tờ tùy thân | Số GTTT. |
| `legal_representatives` | `date_of_issue` | `string` | Ngày cấp | Ngày cấp GTTT. |
| `legal_representatives` | `place_of_issue` | `string` | Nơi cấp | Nơi cấp GTTT. |
| `legal_representatives` | `date_of_expiry` | `string` | Có giá trị đến | Ngày hết hạn GTTT. |
| `legal_representatives` | `phone` | `string` | Điện thoại | SĐT cá nhân. |
| `legal_representatives` | `email` | `string` | Email | Email cá nhân. |
| `legal_representatives` | `residency_status` | `string` | Tình trạng cư trú | Nhãn được tick: "Cư trú" hoặc "Không cư trú". |
| `legal_representatives` | `is_legal_representative` | `boolean` | Là Đại diện hợp pháp của Chủ TK | **Boolean**. `true` nếu checkbox "Là Đại diện hợp pháp của Chủ TK" ở đầu block được tick; `false` nếu không. **Khác với `role_label` bên dưới**: field này chỉ là trạng thái tick của **1 checkbox cụ thể**, trong khi `role_label` là **văn bản đầy đủ của nhãn** ở đầu block. |
| `legal_representatives` | `role_label` | `string` | Vai trò trên biểu mẫu | **Chuỗi**. Toàn bộ văn bản nhãn của checkbox vai trò được tick ở đầu block. Trên VI.1 giá trị thường trùng ngữ nghĩa với `is_legal_representative` (vì chỉ có 1 option) nhưng vẫn giữ nguyên văn để UI hiển thị. `""` nếu không tick. |
| `legal_representatives` | `permanent_address` | `string` | Địa chỉ thường trú | Địa chỉ thường trú. |
| `legal_representatives` | `current_address` | `string` | Nơi ở hiện tại khác | Chỉ có giá trị nếu người khai có nơi ở hiện tại khác thường trú; null nếu không. |
| `legal_representatives` | `visa_no` | `string` | Số thị thực | **Chỉ có giá trị với người nước ngoài** cần thị thực; null với người Việt Nam. |
| `legal_representatives` | `visa_place_of_issue` | `string` | Nơi cấp thị thực | Chỉ có giá trị với người nước ngoài; null với người Việt Nam. |
| `legal_representatives` | `visa_expiry_date` | `string` | Ngày hết hạn thị thực | Chỉ có giá trị với người nước ngoài; null với người Việt Nam. |
| `legal_representatives` | `foreign_id_no` | `string` | Số định danh người nước ngoài | Chỉ có giá trị với người nước ngoài. |
| `legal_representatives` | `foreign_residence_abroad_address` | `string` | Địa chỉ nơi ĐK cư trú ở nước ngoài | Chỉ có giá trị với người nước ngoài. |
| `legal_representatives` | `foreign_residence_vietnam_address` | `string` | Địa chỉ nơi ĐK cư trú ở Việt Nam | Chỉ có giá trị với người nước ngoài. |
| `legal_representatives` | `second_nationality` | `string` | Quốc tịch thứ hai | **Chỉ có giá trị với người có 2 quốc tịch**; null nếu chỉ 1 quốc tịch. |
| `legal_representatives` | `second_passport_no` | `string` | Số Hộ chiếu (quốc tịch còn lại) | Chỉ có giá trị với người có 2 quốc tịch. |
| `legal_representatives` | `second_passport_issue_date` | `string` | Ngày cấp (quốc tịch còn lại) | Chỉ có giá trị với người có 2 quốc tịch. |
| `legal_representatives` | `second_passport_place_of_issue` | `string` | Nơi cấp (quốc tịch còn lại) | Chỉ có giá trị với người có 2 quốc tịch. |
| `legal_representatives` | `second_passport_expiry_date` | `string` | Ngày hết hạn (quốc tịch còn lại) | Chỉ có giá trị với người có 2 quốc tịch. |
| `legal_representatives` | `second_country_residence_address` | `string` | Địa chỉ cư trú tại quốc gia mang quốc tịch còn lại | Chỉ có giá trị với người có 2 quốc tịch. |
| `legal_representatives` | `online_banking_registered` | `boolean` | Đăng ký Ngân hàng trực tuyến | `true`/`false` theo checkbox "Đăng ký sử dụng dịch vụ Ngân hàng trực tuyến" trong block. **Cờ điều kiện cho toàn bộ nhóm `online_banking_*` bên dưới**. |
| `legal_representatives` | `online_banking_function` | `string` | Chức năng | **Chỉ có giá trị khi `online_banking_registered = true`** (VD: "Duyệt lệnh", "Lập lệnh"). |
| `legal_representatives` | `online_banking_pin` | `string` | Mã PIN | Chỉ có giá trị khi `online_banking_registered = true`. |
| `legal_representatives` | `online_banking_approval_order` | `string` | Thứ tự phê duyệt | Chỉ có giá trị khi `online_banking_registered = true` và cơ chế cần thứ tự. |
| `legal_representatives` | `online_banking_approval_limit` | `string` | Hạn mức phê duyệt | Chỉ có giá trị khi `online_banking_registered = true`. |
| `legal_representatives` | `online_banking_admin_type` | `string` | Loại quản trị viên | Chỉ có giá trị khi `online_banking_registered = true`. |
| `legal_representatives` | `online_banking_other` | `string` | Ghi chú khác | Văn bản tự do sau "Khác:"; null nếu để trống. |
| `legal_representatives` | `debit_card_registered` | `boolean` | Đăng ký Thẻ ghi nợ | `true`/`false` theo checkbox "Thông tin đăng ký sử dụng Thẻ ghi nợ" trong block. **Cờ điều kiện cho toàn bộ nhóm `debit_card_*` bên dưới**. |
| `legal_representatives` | `debit_card_role` | `string` | Vai trò sử dụng Thẻ | **Chỉ có giá trị khi `debit_card_registered = true`**: "Thẻ chính" hoặc "Thẻ phụ". |
| `legal_representatives` | `debit_card_embossed_name` | `string` | Tên in nổi trên Thẻ | Chỉ có giá trị khi `debit_card_registered = true`. |
| `legal_representatives` | `debit_card_secret_question` | `string` | Câu hỏi bí mật | Chỉ có giá trị khi `debit_card_registered = true`. Mặc định là ngày cấp GTTT dạng yyyymmdd. |
| `legal_representatives` | `debit_card_purposes` | `string[]` | Mục đích sử dụng Thẻ | Chỉ có giá trị khi `debit_card_registered = true`; mỗi option được tick là một phần tử ("Nhận lương", "Quản lý dòng tiền", "Thanh toán, chuyển tiền trong nước", "Thanh toán, chuyển tiền quốc tế", "Mục đích khác phục vụ đời sống", "Khác"). |
| `legal_representatives` | `debit_card_fatca_us_person` | `string` | Đối tượng Hoa Kỳ (FATCA) | Chỉ có giá trị khi `debit_card_registered = true`: "Có" hoặc "Không". |
| `legal_representatives` | `debit_card_us_tin` | `string` | Mã số thuế Hoa Kỳ (U.S. TIN) | **Chỉ có giá trị khi `debit_card_fatca_us_person = "Có"`**; null trong các trường hợp khác. |
| `legal_representatives` | `debit_card_beneficial_owner` | `string` | Chủ sở hữu hưởng lợi | Chỉ có giá trị khi `debit_card_registered = true`. Nhãn được tick. |
| `legal_representatives` | `debit_card_is_trust_beneficiary` | `string` | Bên nhận ủy thác trong thỏa thuận pháp lý | Chỉ có giá trị khi `debit_card_registered = true`: "Có" hoặc "Không". |

### VI.2 `authorized_representatives`

**Cùng schema với VI.1** cộng thêm khối uỷ quyền ở cuối. Toàn bộ sub-key ở VI.1 áp dụng ở đây; dưới đây chỉ liệt kê **các sub-key bổ sung**.

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `authorized_representatives` |  | `object[]` | Đại diện theo ủy quyền / Người được ủy quyền sử dụng TKTT (VI.2) | Mảng người được ủy quyền. Full schema = VI.1 + 4 sub-key ủy quyền dưới đây. |
| `authorized_representatives` | `role_label` | `string` | Vai trò trên biểu mẫu | **Trên VI.2 mang thông tin phân biệt** (khác VI.1): nhãn được tick là "Là Đại diện hợp pháp của chủ TK - đại diện theo ủy quyền" **hoặc** "Người được ủy quyền sử dụng TKTT". Trên VI.2 field này KHÔNG trùng ngữ nghĩa với `is_legal_representative`. |
| `authorized_representatives` | `authorization_scope` | `string` | Phạm vi và Thời hạn ủy quyền | Nhãn option được tick về phạm vi ủy quyền: hoặc "Mặc định áp dụng theo Mục X của Giấy đề nghị này", hoặc cụm chỉ định dùng văn bản ủy quyền riêng. |
| `authorized_representatives` | `authorization_poa_no` | `string` | Số văn bản ủy quyền | **Chỉ có giá trị khi `authorization_scope` không phải "Mặc định …"** (tức có văn bản ủy quyền riêng); null trong các trường hợp khác. |
| `authorized_representatives` | `authorization_poa_date` | `string` | Ngày văn bản ủy quyền | Chỉ có giá trị khi có văn bản ủy quyền riêng; null nếu không khai. |
| `authorized_representatives` | `authorization_poa_grantor` | `string` | Bên ủy quyền | Chỉ có giá trị khi có văn bản ủy quyền riêng; null nếu không khai. |

*(Các sub-key khác giống VI.1 — xem bảng phía trên. Người ở VI.2 vẫn có đầy đủ khối `online_banking_*` và `debit_card_*`.)*

---

## Nhóm 4 — Chữ ký nhóm 2 (VII) — `signatures_group2`

Section VII có 2 mảng: **VII.1 Kế toán trưởng / Phụ trách kế toán** và **VII.2 Người được KTT/PTKT ủy quyền**. Cả hai có thể có nhiều người.

**Khác biệt so với Nhóm 3 (VI)**: người ở VII **KHÔNG đăng ký Ngân hàng trực tuyến** — toàn bộ nhóm `online_banking_*` không tồn tại trên hai mảng này.

### VII.1 `chief_accountants`

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `chief_accountants` |  | `object[]` | Kế toán trưởng / Phụ trách kế toán (VII.1) | Mảng KTT/PTKT. `[]` nếu Section VII.1 trống. |
| `chief_accountants` | `full_name` | `string` | Họ và tên | Họ và tên KTT/PTKT. |
| `chief_accountants` | `sex` | `string` | Giới tính | "Nam"/"Nữ" theo checkbox. |
| `chief_accountants` | `date_of_birth` | `string` | Ngày sinh | Ngày sinh. |
| `chief_accountants` | `occupation` | `string` | Nghề nghiệp | Nghề nghiệp; null nếu không khai. |
| `chief_accountants` | `position` | `string` | Chức vụ | Chức vụ (thường là "Kế toán trưởng" hoặc "Phụ trách kế toán"). |
| `chief_accountants` | `nationality` | `string` | Quốc tịch | Quốc tịch. |
| `chief_accountants` | `tax_code` | `string` | Mã số thuế cá nhân | Chỉ có giá trị nếu có MST; null nếu không. |
| `chief_accountants` | `id_document_type` | `string` | Loại giấy tờ tùy thân | Loại GTTT. |
| `chief_accountants` | `id_no` | `string` | Số giấy tờ tùy thân | Số GTTT. |
| `chief_accountants` | `date_of_issue` | `string` | Ngày cấp | Ngày cấp GTTT. |
| `chief_accountants` | `place_of_issue` | `string` | Nơi cấp | Nơi cấp GTTT. |
| `chief_accountants` | `date_of_expiry` | `string` | Có giá trị đến | Ngày hết hạn GTTT. |
| `chief_accountants` | `phone` | `string` | Điện thoại | SĐT cá nhân. |
| `chief_accountants` | `email` | `string` | Email | Email cá nhân. |
| `chief_accountants` | `residency_status` | `string` | Tình trạng cư trú | "Cư trú" / "Không cư trú" theo checkbox. |
| `chief_accountants` | `is_legal_representative` | `boolean` | Là Đại diện hợp pháp của Chủ TK | **Luôn `false`** — KTT không phải Đại diện hợp pháp của chủ TK. Field vẫn được giữ để UI dùng chung layout với VI. |
| `chief_accountants` | `role_label` | `string` | Vai trò trên biểu mẫu | **Luôn `""`** — Section VII không có hàng checkbox vai trò như VI. |
| `chief_accountants` | `permanent_address` | `string` | Địa chỉ thường trú | Địa chỉ thường trú. |
| `chief_accountants` | `current_address` | `string` | Nơi ở hiện tại khác | Chỉ có giá trị nếu người khai có nơi ở hiện tại khác thường trú. |
| `chief_accountants` | `visa_no` | `string` | Số thị thực | Chỉ có giá trị với người nước ngoài. |
| `chief_accountants` | `visa_place_of_issue` | `string` | Nơi cấp thị thực | Chỉ có giá trị với người nước ngoài. |
| `chief_accountants` | `visa_expiry_date` | `string` | Ngày hết hạn thị thực | Chỉ có giá trị với người nước ngoài. |
| `chief_accountants` | `foreign_id_no` | `string` | Số định danh người nước ngoài | Chỉ có giá trị với người nước ngoài. |
| `chief_accountants` | `foreign_residence_abroad_address` | `string` | Địa chỉ nơi ĐK cư trú ở nước ngoài | Chỉ có giá trị với người nước ngoài. |
| `chief_accountants` | `foreign_residence_vietnam_address` | `string` | Địa chỉ nơi ĐK cư trú ở Việt Nam | Chỉ có giá trị với người nước ngoài. |
| `chief_accountants` | `second_nationality` | `string` | Quốc tịch thứ hai | Chỉ có giá trị với người có 2 quốc tịch. |
| `chief_accountants` | `second_passport_no` | `string` | Số Hộ chiếu (quốc tịch còn lại) | Chỉ có giá trị với người có 2 quốc tịch. |
| `chief_accountants` | `second_passport_issue_date` | `string` | Ngày cấp (quốc tịch còn lại) | Chỉ có giá trị với người có 2 quốc tịch. |
| `chief_accountants` | `second_passport_place_of_issue` | `string` | Nơi cấp (quốc tịch còn lại) | Chỉ có giá trị với người có 2 quốc tịch. |
| `chief_accountants` | `second_passport_expiry_date` | `string` | Ngày hết hạn (quốc tịch còn lại) | Chỉ có giá trị với người có 2 quốc tịch. |
| `chief_accountants` | `second_country_residence_address` | `string` | Địa chỉ cư trú tại quốc gia mang quốc tịch còn lại | Chỉ có giá trị với người có 2 quốc tịch. |
| `chief_accountants` | `debit_card_registered` | `boolean` | Đăng ký Thẻ ghi nợ | `true`/`false` theo checkbox. Cờ điều kiện cho nhóm `debit_card_*`. |
| `chief_accountants` | `debit_card_role` | `string` | Vai trò sử dụng Thẻ | Chỉ có giá trị khi `debit_card_registered = true`. |
| `chief_accountants` | `debit_card_embossed_name` | `string` | Tên in nổi trên Thẻ | Chỉ có giá trị khi `debit_card_registered = true`. |
| `chief_accountants` | `debit_card_secret_question` | `string` | Câu hỏi bí mật | Chỉ có giá trị khi `debit_card_registered = true`. |
| `chief_accountants` | `debit_card_purposes` | `string[]` | Mục đích sử dụng Thẻ | Chỉ có giá trị khi `debit_card_registered = true`; mỗi option được tick là một phần tử. |
| `chief_accountants` | `debit_card_fatca_us_person` | `string` | Đối tượng Hoa Kỳ (FATCA) | Chỉ có giá trị khi `debit_card_registered = true`. |
| `chief_accountants` | `debit_card_us_tin` | `string` | Mã số thuế Hoa Kỳ (U.S. TIN) | Chỉ có giá trị khi `debit_card_fatca_us_person = "Có"`. |
| `chief_accountants` | `debit_card_beneficial_owner` | `string` | Chủ sở hữu hưởng lợi | Chỉ có giá trị khi `debit_card_registered = true`. |
| `chief_accountants` | `debit_card_is_trust_beneficiary` | `string` | Bên nhận ủy thác trong thỏa thuận pháp lý | Chỉ có giá trị khi `debit_card_registered = true`. |

### VII.2 `authorized_by_chief_accountants`

**Cùng schema với VII.1** cộng thêm khối ủy quyền. Dưới đây chỉ liệt kê **các sub-key bổ sung**.

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `authorized_by_chief_accountants` |  | `object[]` | Người được KTT / PTKT ủy quyền (VII.2) | Mảng người được KTT/PTKT ủy quyền. `[]` nếu Section VII.2 trống. |
| `authorized_by_chief_accountants` | `authorization_scope` | `string` | Phạm vi và Thời hạn ủy quyền | Nhãn option được tick về phạm vi ủy quyền của KTT/PTKT. |
| `authorized_by_chief_accountants` | `authorization_poa_no` | `string` | Số văn bản ủy quyền | Chỉ có giá trị khi có văn bản ủy quyền riêng; null trong các trường hợp khác. |
| `authorized_by_chief_accountants` | `authorization_poa_date` | `string` | Ngày văn bản ủy quyền | Chỉ có giá trị khi có văn bản ủy quyền riêng. |
| `authorized_by_chief_accountants` | `authorization_poa_grantor` | `string` | Bên ủy quyền | Chỉ có giá trị khi có văn bản ủy quyền riêng. |

*(Các sub-key khác giống VII.1 — xem bảng phía trên. Người ở VII.2 vẫn có đầy đủ khối `debit_card_*` nhưng KHÔNG có `online_banking_*`.)*

---

## Trường cố định (không AI đọc)

| Field | Subfield | Type | Title | Mô tả |
|---|---|---|---|---|
| `title` |  | `string` | Loại tài liệu | Luôn có giá trị cố định `"GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ VÀ SỬ DỤNG TÀI KHOẢN THANH TOÁN, DỊCH VỤ"`. Code điền, không đọc từ file. |
