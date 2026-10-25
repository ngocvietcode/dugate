# HỒ SƠ SYN-HKD-0003 · HKD · Vay hộ kinh doanh có TSBĐ (giả lập) — ngữ cảnh thẩm định
Quy ước: chỉ có giá trị chuẩn (đã chọn theo thẩm quyền, hiệu lực thời gian, đa số nguồn độc lập). Lỗi đọc và lỗi lập hồ sơ do nhánh kiểm soát dữ liệu xử lý, KHÔNG đánh giá ở đây. Mục «Mâu thuẫn nội dung» là tín hiệu thẩm định. Mỗi kết luận phải trích F# (field) hoặc X# (mâu thuẫn).

## Chứng từ
D1 id_card «CĂN CƯỚC» 2024-08-20
D2 qr_code_info
D3 vneid «Thông tin cá nhân»
D4 id_card «CĂN CƯỚC CÔNG DÂN» 2023-05-10
D5 marriage_certificate «GIẤY CHỨNG NHẬN KẾT HÔN» 2023-04-15
D6 loan_application «GIẤY ĐỀ NGHỊ VAY VỐN CÓ TÀI SẢN BẢO ĐẢM» 2026-10-01
D7 purchase_list «BẢNG KÊ DANH MỤC HÀNG HOÁ CẦN NHẬP» 2026-10-01
D8 income_statement «BẢNG KÊ THU NHẬP» 2026-10-01
D9 land_use_certificate «GIẤY CHỨNG NHẬN QUYỀN SỬ DỤNG ĐẤT» 2021-06-01
D10 valuation_certificate «CHỨNG THƯ THẨM ĐỊNH GIÁ» 2026-09-25
D11 cic «BÁO CÁO CHI TIẾT QUAN HỆ TÍN DỤNG» 2026-10-10

## Người
P1 TRẦN THỊ MAI · vai trò trong chứng từ: HOLDER, WIFE, BORROWER, CUSTOMER, OWNER
  F2 date_of_birth: 1992-03-14 [D1,D2,D3,D5,D6,D7,D8]
  F3 gender: FEMALE [D1,D2,D3,D5,D6,D7,D8]
  F4 nationality: Việt Nam [D1,D3,D5,D6]
  F5 id_issue_date: 2024-08-20 [D1,D2,D6,D7,D8]
  F6 permanent_address: Thôn Đông, Xã Tân Lập, Thành phố Hà Nội [D1,D2,D3,D5,D6,D8]
  F7 id_type: CAN_CUOC [D1,D2,D3,D6,D8]
  F8 previous_id_numbers: 012345678 [D2,D6,D11]
  F9 phone_number: 0912000001 [D3,D6,D7]
  F10 id_issue_place: BỘ CÔNG AN [D1,D6,D7,D8]
  F11 current_address: Thôn Đông, Xã Tân Lập, Huyện Đan Phượng, Thành phố Hà Nội [D6,D11]
  F12 marital_status: MARRIED [D6]
  F24 national_id: 001192012345 [D1]
P2 LÊ VĂN HÙNG · vai trò trong chứng từ: HOLDER, HUSBAND, SPOUSE
  F14 date_of_birth: 1990-07-02 [D4,D5,D6]
  F15 gender: MALE [D4,D5,D6]
  F16 nationality: Việt Nam [D4,D5]
  F17 id_issue_date: 2023-05-10 [D4,D6]
  F18 permanent_address: Thôn Đông, Xã Tân Lập, Huyện Đan Phượng, Thành phố Hà Nội [D4,D5]
  F19 id_type: CCCD [D4,D5,D6]
  F20 id_issue_place: Cục Cảnh sát quản lý hành chính về trật tự xã hội [D4,D5,D6]
  F21 current_address: Số 8 Ngõ 12 Phố Hoa, Phường Mai Dịch, Thành phố Hà Nội [D6]
  F22 phone_number: 0912000002 [D6]
  F23 marital_status: MARRIED [D6]
  F25 national_id: 001090054321 [D4]

## Quan hệ
P1 -SPOUSE-> P2 [D5,D6] registration_date=2023-04-15
P1 -APPLIES_FOR-> L1 [D6]
P1 -OWNS-> A1 [D6,D9] ownership_form=Sử dụng chung
P1 -OWNS_BUSINESS-> B1 [D6,D8]
P1 -SUBMITS-> G1 [D7]
P2 -PARTICIPATES-> L1 [D6] role=SPOUSE
L1 -SECURED_BY-> A1 [D6]
L1 -FOR_BUSINESS-> B1 [D6]
L1 -USE_OF_FUNDS-> G1 [D7]

## Khoản vay đề nghị L1
  F53 loan_info.borrower_type: Hộ kinh doanh [D6]
  F54 loan_info.requested_amount: 800.000.000 [D6]
  F55 loan_info.bank_proposed_amount: 800.000.000 [D6]
  F56 loan_info.loan_term_months: 36 [D6]
  F57 loan_info.interest_rate_code: HKD-STD [D6]
  F58 loan_info.interest_rate_raw: Theo biểu lãi suất HKD-STD [D6]
  F59 loan_info.loan_purposes[0]: Bổ sung vốn lưu động kinh doanh [D6]
  F60 loan_info.loan_purpose_detail: Nhập hàng tạp hoá [D6]
  F61 loan_info.loan_purpose_categories[0]: WORKING_CAPITAL [D6]
  F62 loan_info.disbursement_method: Chuyển khoản [D6]
  F63 loan_info.principal_repayment_method: Trả gốc cuối kỳ [D6]
  F64 loan_info.interest_repayment_method: Trả lãi hàng tháng [D6]
  F65 financial_info.total_income: 300.000.000 [D6] ⚠ X01
  F66 financial_info.total_income_period: MONTHLY [D6]
  F67 financial_info.repayment_source: Lợi nhuận từ kinh doanh [D6]
  F68 financial_info.has_existing_debt: không [D6]
  F69 financial_info.existing_monthly_debt_payment: 0 [D6]
  F70 officer_info.branch: Chi nhánh Mẫu [D6]
  F71 officer_info.decision_date: 2026-10-01 [D6]
  F72 collateral_summary.notes[0]: GCN QSDĐ số AB123456 [D6]

## Hộ kinh doanh B1
  F26 business_name: Hộ Kinh Doanh Trần Thị Mai [D6,D8]
  F27 business_line: Bán lẻ tạp hoá [D6,D8]
  F28 business_address: Thôn Đông, Xã Tân Lập, Thành phố Hà Nội [D6,D8]
  F29 registration_number: 0100000001 [D6]
  F30 operating_time_raw: 36 tháng [D8]
  F31 premises_type_raw: Thuê [D8]
  F32 premises_area_m2: 40 [D8]
  F33 net_revenue_annual: 1.500.000.000 [D8]
  F34 cogs_annual: 1.050.000.000 [D8]
  F35 gross_profit_annual: 450.000.000 [D8]
  F36 total_cost_annual: 150.000.000 [D8]
  F37 net_profit_annual: 300.000.000 [D8] ⚠ X01
  F38 income_type: household_business [D8]
  F39 source_label_raw: Thu nhập từ hoạt động kinh doanh của hộ kinh doanh [D8]

## Phương án sử dụng vốn G1 [D7]
  F73 funding_plan.total: 800.000.000 [D7]
  # | mặt hàng | ĐVT | SL | đơn giá | thành tiền
  1 | Gạo đóng túi 5kg | túi | 2.000 | 100.000 | 200.000.000
  2 | Dầu ăn 2l | chai | 4.000 | 75.000 | 300.000.000
  3 | Nước giải khát thùng 24 | thùng | 1.500 | 200.000 | 300.000.000

## Tài sản A1
  F40 asset_type: real_estate [D9]
  F41 identifiers.certificate_number: AB 123456 [D6,D9,D10]
  F42 identifiers.certificate_book_number: CS 0001 [D9]
  F43 identifiers.land_parcel_number: 101 [D9]
  F44 identifiers.map_sheet_number: 7 [D9]
  F45 address: Thôn Đông, Xã Tân Lập, Thành phố Hà Nội [D9]
  F46 description: Thửa đất số: 101; tờ bản đồ số: 7 [D9]
  F47 land_area_m2: 120.5 [D9]
  F48 land_use_purpose: Đất ở tại nông thôn 120,5m2 [D9]
  F49 land_use_term_raw: Đất ở tại nông thôn: Lâu dài [D9]
  F50 ownership_form: Sử dụng chung [D9]
  F51 owner_party_indexes[0]: 0 [D9]
  F52 asset_value: 1.600.000.000 [D10]

## Báo cáo CIC [D11] · chủ thể P1
  F74 report_datetime: 2026-10-10T09:00:00+07:00 [D11]
  F75 cic_code: 9000000001 [D11]
  F76 current_debt_group_raw: Hiện tại khách hàng không có dư nợ vay tại các TCTD. [D11]
  F77 bad_debt_5y.has_records: không [D11]
  F78 bad_debt_5y.records_raw: Không có nợ xấu 5 năm. [D11]
  F79 queried_institutions_1y_count: 1 [D11]
  tra cứu bởi Ngân hàng Mẫu: 2026-10-10

## Mâu thuẫn nội dung (C) — tín hiệu thẩm định
X01 [F65, F37] Thu nhập: đơn vay 300.000.000/MONTHLY (= 3.600.000.000/năm), bảng kê lợi nhuận 300.000.000/năm — lệch 12 lần · giá trị chuẩn: 300.000.000/năm (giá trị thận trọng, bảng kê đứng trước đơn vay) · đúng hệ số 12: có thể là lỗi bóc tách kỳ (A3); chưa có ảnh nên giữ C

## Giới hạn dữ liệu (không đánh giá lỗi, chỉ để biết dữ liệu nào không có)
