# HỒ SƠ SYN-HKD-0006 · HKD · Vay hộ kinh doanh có TSBĐ (giả lập) — ngữ cảnh thẩm định
Quy ước: chỉ có giá trị chuẩn (đã chọn theo thẩm quyền, hiệu lực thời gian, đa số nguồn độc lập). Lỗi đọc và lỗi lập hồ sơ do nhánh kiểm soát dữ liệu xử lý, KHÔNG đánh giá ở đây. Mục «Mâu thuẫn nội dung» là tín hiệu thẩm định. Mỗi kết luận phải trích F# (field) hoặc X# (mâu thuẫn).

## Chứng từ
D1 id_card «CĂN CƯỚC» 2024-08-20
D2 qr_code_info
D3 vneid «Thông tin cá nhân»
D4 marriage_certificate «GIẤY CHỨNG NHẬN KẾT HÔN» 2023-04-15
D5 loan_application «GIẤY ĐỀ NGHỊ VAY VỐN CÓ TÀI SẢN BẢO ĐẢM» 2026-10-01
D6 purchase_list «BẢNG KÊ DANH MỤC HÀNG HOÁ CẦN NHẬP» 2026-10-01
D7 income_statement «BẢNG KÊ THU NHẬP»
D8 land_use_certificate «GIẤY CHỨNG NHẬN QUYỀN SỬ DỤNG ĐẤT» 2021-06-01
D9 cic «BÁO CÁO CHI TIẾT QUAN HỆ TÍN DỤNG» 2026-10-10

## Người
P1 TRẦN THỊ MAI · vai trò trong chứng từ: HOLDER, WIFE, BORROWER, CUSTOMER, OWNER
  F2 date_of_birth: 1992-03-14 [D1,D2,D3,D4,D5,D6,D7]
  F3 gender: FEMALE [D1,D2,D3,D4,D5,D6,D7]
  F4 nationality: Việt Nam [D1,D3,D4,D5]
  F5 id_issue_date: 2024-08-20 [D1,D2,D5,D6,D7]
  F6 permanent_address: Thôn Đông, Xã Tân Lập, Thành phố Hà Nội [D1,D2,D3,D4,D5,D7]
  F7 id_type: CAN_CUOC [D1,D2,D3,D5,D7]
  F8 previous_id_numbers: 012345678 [D2,D5,D9]
  F9 phone_number: 0912000001 [D3,D5,D6]
  F10 id_issue_place: BỘ CÔNG AN [D1,D5,D6,D7]
  F11 current_address: Thôn Đông, Xã Tân Lập, Huyện Đan Phượng, Thành phố Hà Nội [D5,D9]
  F12 marital_status: MARRIED [D5]
  F24 national_id: 001192012345 [D1]
P2 LÊ VĂN HÙNG · vai trò trong chứng từ: HUSBAND, SPOUSE, CO_BORROWER
  F14 date_of_birth: 1990-07-02 [D4,D5,D7]
  F15 gender: MALE [D4,D5,D7]
  F16 nationality: Việt Nam [D4]
  F17 id_type: CCCD [D4,D5]
  F18 id_issue_date: 2020-11-11 [D4]
  F19 id_issue_place: Cục Cảnh sát quản lý hành chính về trật tự xã hội [D4,D5]
  F20 permanent_address: Thôn Đông, Xã Tân Lập, Huyện Đan Phượng, Thành phố Hà Nội [D4]
  F21 current_address: Số 8 Ngõ 12 Phố Hoa, Phường Mai Dịch, Thành phố Hà Nội [D5]
  F22 phone_number: 0912000002 [D5]
  F23 marital_status: MARRIED [D5]

## Quan hệ
P1 -SPOUSE-> P2 [D4,D5] registration_date=2023-04-15
P1 -APPLIES_FOR-> L1 [D5]
P1 -OWNS-> A1 [D5,D8] ownership_form=Sử dụng chung
P1 -OWNS_BUSINESS-> B1 [D5,D7]
P1 -SUBMITS-> G1 [D6]
P2 -PARTICIPATES-> L1 [D5] role=SPOUSE
L1 -SECURED_BY-> A1 [D5]
L1 -FOR_BUSINESS-> B1 [D5]
L1 -USE_OF_FUNDS-> G1 [D6]

## Khoản vay đề nghị L1
  F52 loan_info.borrower_type: Hộ kinh doanh [D5]
  F53 loan_info.requested_amount: 800.000.000 [D5] ⚠ X04
  F54 loan_info.bank_proposed_amount: 800.000.000 [D5]
  F55 loan_info.loan_term_months: 36 [D5]
  F56 loan_info.interest_rate_code: HKD-STD [D5]
  F57 loan_info.interest_rate_raw: Theo biểu lãi suất HKD-STD [D5]
  F58 loan_info.loan_purposes[0]: Bổ sung vốn lưu động kinh doanh [D5]
  F59 loan_info.loan_purpose_detail: Nhập hàng tạp hoá [D5]
  F60 loan_info.loan_purpose_categories[0]: WORKING_CAPITAL [D5]
  F61 loan_info.disbursement_method: Chuyển khoản [D5]
  F62 loan_info.principal_repayment_method: Trả gốc cuối kỳ [D5]
  F63 loan_info.interest_repayment_method: Trả lãi hàng tháng [D5]
  F64 financial_info.total_income: 300.000.000 [D5]
  F65 financial_info.total_income_period: ANNUAL [D5]
  F66 financial_info.repayment_source: Lợi nhuận từ kinh doanh [D5]
  F67 financial_info.has_existing_debt: không [D5]
  F68 financial_info.existing_monthly_debt_payment: 0 [D5]
  F69 officer_info.branch: Chi nhánh Mẫu [D5]
  F70 officer_info.decision_date: 2026-10-01 [D5]
  F71 collateral_summary.notes[0]: GCN QSDĐ số AB123456 [D5]

## Hộ kinh doanh B1
  F25 business_name: Hộ Kinh Doanh Trần Thị Mai [D5,D7]
  F26 business_line: Bán lẻ tạp hoá [D5,D7]
  F27 business_address: Thôn Đông, Xã Tân Lập, Thành phố Hà Nội [D5,D7]
  F28 registration_number: 0100000001 [D5]
  F29 operating_time_raw: 36 tháng [D7]
  F30 premises_type_raw: Thuê [D7]
  F31 premises_area_m2: 40 [D7]
  F32 net_revenue_annual: 1.500.000.000 [D7]
  F33 cogs_annual: 1.050.000.000 [D7]
  F34 gross_profit_annual: 450.000.000 [D7]
  F35 total_cost_annual: 150.000.000 [D7]
  F36 net_profit_annual: 300.000.000 [D7]
  F37 income_type: household_business [D7]
  F38 source_label_raw: Thu nhập từ hoạt động kinh doanh của hộ kinh doanh [D7]

## Phương án sử dụng vốn G1 [D6]
  F72 funding_plan.total: 850.000.000 [D6] ⚠ X04
  # | mặt hàng | ĐVT | SL | đơn giá | thành tiền
  1 | Gạo đóng túi 5kg | túi | 2.000 | 100.000 | 200.000.000
  2 | Dầu ăn 2l | chai | 4.000 | 75.000 | 350.000.000
  3 | Nước giải khát thùng 24 | thùng | 1.500 | 200.000 | 300.000.000

## Tài sản A1
  F39 asset_type: real_estate [D8]
  F40 identifiers.certificate_number: AB 123456 [D5,D8]
  F41 identifiers.certificate_book_number: CS 0001 [D8]
  F42 identifiers.land_parcel_number: 101 [D8]
  F43 identifiers.map_sheet_number: 7 [D8]
  F44 address: Thôn Đông, Xã Tân Lập, Thành phố Hà Nội [D8]
  F45 description: Thửa đất số: 101; tờ bản đồ số: 7 [D8]
  F46 land_area_m2: 120.5 [D8]
  F47 land_use_purpose: Đất ở tại nông thôn 120,5m2 [D8]
  F48 land_use_term_raw: Đất ở tại nông thôn: Lâu dài [D8]
  F49 ownership_form: Sử dụng chung [D8]
  F50 owner_party_indexes[0]: 0 [D8]
  F51 asset_value: 1.150.000.000 [case.assets] ⚠ không có chứng từ nguồn

## Báo cáo CIC [D9] · chủ thể P1
  F73 report_datetime: 2026-10-10T09:00:00+07:00 [D9]
  F74 cic_code: 9000000001 [D9]
  F75 current_debt_group_raw: Hiện tại khách hàng không có dư nợ vay tại các TCTD. [D9]
  F76 bad_debt_5y.has_records: không [D9]
  F77 bad_debt_5y.records_raw: Không có nợ xấu 5 năm. [D9]
  F78 queried_institutions_1y_count: 1 [D9]
  tra cứu bởi Ngân hàng Mẫu: 2026-10-10

## Mâu thuẫn nội dung (C) — tín hiệu thẩm định
X04 [F53, F72] Tổng phương án vốn 850.000.000 ≠ số tiền vay 800.000.000 — 
X07 [P2.role] P2: vai trò khác nhau giữa các chứng từ: SPOUSE [D5]; CO_BORROWER [D7] — vai trò quyết định nghĩa vụ và bộ chứng từ bắt buộc · giá trị chuẩn: SPOUSE (giấy đề nghị vay là bậc 1 cho đề nghị vay)

## Giới hạn dữ liệu (không đánh giá lỗi, chỉ để biết dữ liệu nào không có)
- F51 A1.asset_value: có giá trị nhưng không có chứng từ nguồn.
- P2 có vai trò CO_BORROWER, SPOUSE nhưng hồ sơ không có CCCD/Căn cước/VNeID.
