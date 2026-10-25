# HỒ SƠ SYN-HKD-0004 · HKD · Vay hộ kinh doanh có TSBĐ (giả lập) · luồng FAST
Ký hiệu: [D#] chứng từ nguồn · P# người · B# hộ kinh doanh · A# tài sản · L# khoản vay đề nghị · G# phương án vốn · ⟨a | b⟩ chứng từ đọc ra nhiều giá trị · ≈n: n cách viết cùng nghĩa (địa chỉ so theo thôn/đường + xã + tỉnh, bỏ cấp huyện).
Chỉ chứa dữ liệu trích từ chứng từ; không có kết luận/kiểm tra của hệ thống.

## Chứng từ
D1 id_card · «CĂN CƯỚC» · số 001192012345 · cơ quan BỘ CÔNG AN · ngày 2024-08-20 · hiệu lực đến 2032-03-14 · khác: card_info.place_of_birth_registration=Xã Tân Lập, Thành phố Hà Nội · mục checklist: legal_id_card*
D2 qr_code_info · mục checklist: legal_qr_code_info
D3 vneid · «Thông tin cá nhân» · mục checklist: legal_vneid
D4 id_card · «CĂN CƯỚC CÔNG DÂN» · số 001090054321 · cơ quan Cục Cảnh sát quản lý hành chính về trật tự xã hội · ngày 2023-05-10 · hiệu lực đến 2030-07-02 · mục checklist: legal_id_card*
D5 marriage_certificate · «GIẤY CHỨNG NHẬN KẾT HÔN» · ngày 2023-04-15 · mục checklist: legal_marriage_certificate*
D6 loan_application · «GIẤY ĐỀ NGHỊ VAY VỐN CÓ TÀI SẢN BẢO ĐẢM» · ngày 2026-10-01 · ký: TRẦN THỊ MAI 2026-10-01 · mục checklist: loan_plan_loan_application*
D7 purchase_list · «BẢNG KÊ DANH MỤC HÀNG HOÁ CẦN NHẬP» · ngày 2026-10-01 · ký: TRẦN THỊ MAI 2026-10-01 · mục checklist: loan_plan_purchase_list*
D8 income_statement · «BẢNG KÊ THU NHẬP» · ngày 2026-10-01 · ký: TRẦN THỊ MAI 2026-10-01 · mục checklist: income_general_income_statement*
D9 land_use_certificate · «GIẤY CHỨNG NHẬN QUYỀN SỬ DỤNG ĐẤT» · ngày 2021-06-01 · mục checklist: collateral_real_estate_certificate*
D10 valuation_certificate · «CHỨNG THƯ THẨM ĐỊNH GIÁ» · cơ quan Công ty Thẩm định giá Mẫu · ngày 2026-09-25 · mục checklist: collateral_valuation_certificate*
D11 cic · «BÁO CÁO CHI TIẾT QUAN HỆ TÍN DỤNG» · cơ quan Trung tâm Thông tin tín dụng Quốc gia · mục checklist: credit_cic_report*
(* = mục bắt buộc)

## Người liên quan
P1 TRẦN THỊ MAI · CCCD 001192012345
  vai trò: HOLDER [D1,D2,D3,D11]; WIFE [D5]; BORROWER [D6]; CUSTOMER [D7,D8]; OWNER [D9]
  date_of_birth: 1992-03-14 [D1,D2,D3,D5,D6,D7,D8]
  gender: FEMALE [D1,D2,D3,D5,D6,D7,D8]
  nationality: Việt Nam [D1,D3,D5,D6]
  id_issue_date: 2024-08-20 [D1,D2,D6,D7,D8] | 2021-03-01 [D5]
  permanent_address: Thôn Đông, Xã Tân Lập, Huyện Đan Phượng, Thành phố Hà Nội [D1,D2,D3,D5,D6,D8] ≈4
  id_type: CAN_CUOC [D2,D3,D6,D8] | CCCD [D5]
  previous_id_numbers: 012345678 [D2,D6,D11]
  phone_number: 0912000001 [D3,D6,D7]
  id_issue_place: Cục Cảnh sát quản lý hành chính về trật tự xã hội [D5] | BỘ CÔNG AN [D6,D7,D8]
  current_address: Thôn Đông, Xã Tân Lập, Huyện Đan Phượng, Thành phố Hà Nội [D6,D11]
  marital_status: MARRIED [D6]
P2 LÊ VĂN HÙNG · CCCD 001090054321
  vai trò: HOLDER [D4]; HUSBAND [D5]; SPOUSE [D6]
  date_of_birth: 1990-07-02 [D4,D5,D6]
  gender: MALE [D4,D5,D6]
  nationality: Việt Nam [D4,D5]
  id_issue_date: 2023-05-10 [D4,D6] | 2020-11-11 [D5]
  permanent_address: Thôn Đông, Xã Tân Lập, Huyện Đan Phượng, Thành phố Hà Nội [D4,D5] ≈2
  id_type: CCCD [D5,D6]
  id_issue_place: Cục Cảnh sát quản lý hành chính về trật tự xã hội [D5,D6]
  current_address: Số 8 Ngõ 12 Phố Hoa, Phường Mai Dịch, Thành phố Hà Nội [D6]
  phone_number: 0912000002 [D6]
  marital_status: MARRIED [D6]

Liên kết mention → người (bằng chứng trong chứng từ):
  D1#0 HOLDER → P1 (cao: số CCCD, ngày sinh, giới tính) · loại P2: số CCCD khác, ngày sinh khác, giới tính khác
  D2#0 HOLDER → P1 (cao: ngày sinh, giới tính, ngày cấp giấy tờ, địa chỉ (đầy đủ)) · loại P2: ngày sinh khác, giới tính khác
  D3#0 HOLDER → P1 (cao: ngày sinh, giới tính, SĐT, địa chỉ (đầy đủ)) · loại P2: ngày sinh khác, giới tính khác
  D4#0 HOLDER → P2 (cao: số CCCD, ngày sinh, giới tính) · loại P1: số CCCD khác, ngày sinh khác, giới tính khác
  D5#0 WIFE → P1 (cao: ngày sinh, giới tính, địa chỉ (đầy đủ)) · loại P2: ngày sinh khác, giới tính khác
  D5#1 HUSBAND → P2 (cao: ngày sinh, giới tính, địa chỉ (đầy đủ))
  D6#0 BORROWER → P1 (cao: ngày sinh, giới tính, số CMND cũ, ngày cấp giấy tờ, địa chỉ (đầy đủ)) · loại P2: ngày sinh khác, giới tính khác
  D6#1 SPOUSE → P2 (cao: ngày sinh, giới tính, ngày cấp giấy tờ)
  D7#0 CUSTOMER → P1 (cao: ngày sinh, giới tính, SĐT, ngày cấp giấy tờ) · loại P2: ngày sinh khác, giới tính khác
  D8#0 CUSTOMER → P1 (cao: ngày sinh, giới tính, ngày cấp giấy tờ, địa chỉ (đầy đủ)) · loại P2: ngày sinh khác, giới tính khác
  D9#0 OWNER → P1 (trung bình: cùng số GCN, chủ sở hữu theo D6 «Bà TRẦN THỊ MAI»)
  D11#0 HOLDER → P1 (cao: số CMND cũ, địa chỉ (đầy đủ))

## Quan hệ
P1 -SPOUSE-> P2 [D5,D6] registration_date=2023-04-15; place=UBND Xã Tân Lập
P1 -APPLIES_FOR-> L1 [D6]
P1 -OWNS-> A1 [D6,D9] owner_names_raw=Bà TRẦN THỊ MAI (D6); ownership_form=Sử dụng chung (D9)
P1 -OWNS_BUSINESS-> B1 [D6,D8]
P1 -SUBMITS-> G1 [D7]
P2 -PARTICIPATES-> L1 [D6] role=SPOUSE
L1 -SECURED_BY-> A1 [D6] matched_by=số GCN AB123456; usage=COLLATERAL
L1 -FOR_BUSINESS-> B1 [D6]
L1 -USE_OF_FUNDS-> G1 [D7] matched_by=cùng người vay

## Khoản vay đề nghị L1 [D6]
  loan_info:
    borrower_type: Hộ kinh doanh
    requested_amount: 800.000.000
    bank_proposed_amount: 800.000.000
    loan_term_months: 36
    interest_rate_code: HKD-STD
    interest_rate_raw: Theo biểu lãi suất HKD-STD
    loan_purposes[0]: Bổ sung vốn lưu động kinh doanh
    loan_purpose_detail: Nhập hàng tạp hoá
    loan_purpose_categories[0]: WORKING_CAPITAL
    disbursement_method: Chuyển khoản
    principal_repayment_method: Trả gốc cuối kỳ
    interest_repayment_method: Trả lãi hàng tháng
  financial_info:
    total_income: 300.000.000
    total_income_period: ANNUAL
    repayment_source: Lợi nhuận từ kinh doanh
    has_existing_debt: không
    existing_monthly_debt_payment: 0
  officer_info:
    branch: Chi nhánh Mẫu
    decision_date: 2026-10-01
  collateral_summary:
    notes[0]: GCN QSDĐ số AB123456

## Hộ kinh doanh B1 Hộ Kinh Doanh Trần Thị Mai
  business_name: Hộ Kinh Doanh Trần Thị Mai [D6,D8]
  business_line: Bán lẻ tạp hoá [D6,D8]
  business_address: Thôn Đông, Xã Tân Lập, Thành phố Hà Nội [D6,D8]
  registration_number: 0100000001 [D6]
  operating_time_raw: 36 tháng [D8]
  premises_type_raw: Thuê [D8]
  premises_area_m2: 40 [D8]
  net_revenue_annual: 1.500.000.000 [D8]
  cogs_annual: 1.050.000.000 [D8]
  gross_profit_annual: 450.000.000 [D8]
  total_cost_annual: 150.000.000 [D8]
  net_profit_annual: 300.000.000 [D8]
  income_type: household_business [D8]
  source_label_raw: Thu nhập từ hoạt động kinh doanh của hộ kinh doanh [D8]

## Phương án sử dụng vốn G1 [D7] · tổng ghi trên chứng từ 800.000.000
  # | mặt hàng | ĐVT | SL | đơn giá | thành tiền
  1 | Gạo đóng túi 5kg | túi | 2.000 | 100.000 | 200.000.000
  2 | Dầu ăn 2l | chai | 4.000 | 75.000 | 300.000.000
  3 | Nước giải khát thùng 24 | thùng | 1.500 | 200.000 | 300.000.000

## Tài sản A1 real_estate · GCN AB123456
  asset_type: real_estate [D9]
  identifiers.certificate_number: AB 123456 [D9,D10] ≈2
  identifiers.certificate_book_number: CS 0001 [D9]
  identifiers.land_parcel_number: 101 [D9]
  identifiers.map_sheet_number: 7 [D9]
  address: Thôn Đông, Xã Tân Lập, Thành phố Hà Nội [D9]
  description: Thửa đất số: 101; tờ bản đồ số: 7 [D9]
  land_area_m2: 120.5 [D9]
  land_use_purpose: Đất ở tại nông thôn 120,5m2 [D9]
  land_use_term_raw: Đất ở tại nông thôn: Lâu dài [D9]
  ownership_form: Sử dụng chung [D9]
  owner_party_indexes[0]: 0 [D9]
  asset_value: 1.600.000.000 [D10]

## Báo cáo CIC [D11] · chủ thể: P1 (theo liên kết mention ở trên)
  report_datetime: 2026-10-10T09:00:00+07:00
  cic_code: 9000000001
  current_debt_group_raw: Hiện tại khách hàng không có dư nợ vay tại các TCTD.
  bad_debt_5y.has_records: không
  bad_debt_5y.records_raw: Không có nợ xấu 5 năm.
  queried_institutions_1y_count: 1
  tra cứu bởi Ngân hàng Mẫu: 2026-10-10
