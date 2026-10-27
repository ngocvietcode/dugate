// lib/endpoints/presets.ts
// Extract type presets — default fields/schema + document identity for known types.
// Admin can extend these or override via ProfileEndpoint.profileParams.
//
// `fields`  → injected into ext-data-extractor's user_prompt ("Fields to extract: {{fields}}").
//             Compact nested notation:  obj{a, b} · arr[]{a, b} · arr[]
//             Each preset is a CONSOLIDATED SUPERSET covering every IDP OCR bot
//             mapped to that subcase. Docs fitting two subcases (e.g. vehicle
//             purchase contract → contract OR collateral; commercial invoice →
//             invoice OR lc) are covered by BOTH presets; the caller picks one.
// `identity`→ acceptance criteria describing WHAT the document must be. Used to
//             build a DOCUMENT TYPE GATE (see buildGuardedExtractFields) so the
//             model verifies the uploaded file truly belongs to the requested
//             type BEFORE extracting. Wrong-type files return a mismatch object
//             instead of fabricated fields.

export interface ExtractPreset {
  fields: string;       // Comma-separated field list passed to ext-data-extractor
  schema?: string;      // Optional JSON Schema for structured output
  identity?: string;    // What the document must be (acceptance criteria) for the type gate
  /**
   * Gợi ý VỊ TRÍ trường trên mẫu biểu (VD "dòng số 5 từ trên xuống", "mặt sau",
   * "góc phải trên cùng"). Tùy chọn; khi có, workflow có thể chèn vào prompt
   * trích xuất để model định vị đúng trường (US1 AC#2).
   */
  locationHints?: string;
  description: string;
}

/**
 * Prepend a DOCUMENT TYPE GATE to the field list so the extractor first verifies
 * the uploaded document belongs to the requested type/group. On mismatch it must
 * return ONLY the mismatch JSON and skip extraction entirely.
 */
export function buildGuardedExtractFields(type: string, preset: ExtractPreset): string {
  if (!preset.identity) return preset.fields;
  return [
    `[DOCUMENT TYPE GATE — chọn ĐÚNG loại tài liệu TRƯỚC khi trích xuất]`,
    `Yêu cầu của người dùng: chỉ trích xuất loại "${type}" — tức ${preset.identity}.`,
    `File tải lên CÓ THỂ chứa NHIỀU loại tài liệu khác nhau. Áp dụng các quy tắc sau:`,
    `1. Quét toàn bộ file, xác định (các) tài liệu/trang thuộc ĐÚNG loại "${type}" (dựa vào tiêu đề, cấu trúc, nội dung đặc trưng — KHÔNG dựa vào tên file).`,
    `2. CHỈ trích xuất phần thuộc loại "${type}"; BỎ QUA hoàn toàn mọi loại tài liệu khác trong file (tuyệt đối KHÔNG trộn thông tin của loại khác vào kết quả).`,
    `3. Nếu có NHIỀU tài liệu cùng thuộc loại "${type}": trả về JSON array, mỗi tài liệu là một object theo đúng schema field bên dưới.`,
    `4. Nếu KHÔNG tìm thấy bất kỳ tài liệu nào thuộc loại "${type}": KHÔNG trích xuất và KHÔNG suy đoán. Trả về DUY NHẤT JSON sau rồi dừng:`,
    `{"document_type_mismatch": true, "expected_type": "${type}", "detected_document": "<mô tả các loại tài liệu thực có trong file>", "message": "File không chứa tài liệu thuộc loại được chọn nên không trích xuất."}`,
    `Các trường cần trích xuất cho loại "${type}":`,
    preset.fields,
  ].join('\n');
}

/**
 * Optional BOUNDING BOX instruction appended to the extractor prompt when the
 * caller sets `return_bbox=true`. Works for any extract type (including `custom`).
 * Coordinates follow the Gemini convention: normalized 0–1000, [ymin, xmin, ymax, xmax].
 * If the model cannot localize (unsupported), it must still emit the entry with
 * box_2d/page = null (never fabricate coordinates).
 */
export function bboxInstruction(): string {
  return [
    `[BOUNDING BOX — tùy chọn định vị toạ độ]`,
    `Sau khi trích xuất, BỔ SUNG một mảng "_bounding_boxes" ở cấp cao nhất của JSON kết quả. Nếu kết quả là MẢNG nhiều tài liệu, đặt "_bounding_boxes" bên trong TỪNG object tài liệu.`,
    `Với MỖI giá trị đã trích xuất được (bỏ qua field rỗng / null / "n/A"), thêm một phần tử:`,
    `{"id": "bb_1", "field": "<đường dẫn field trong JSON kết quả, ví dụ personal_info.full_name>", "value": "<giá trị>", "page": <số trang chứa giá trị, 0-based>, "box_2d": [ymin, xmin, ymax, xmax]}`,
    `Quy tắc:`,
    `• "id" là chuỗi duy nhất (bb_1, bb_2, ...).`,
    `• "box_2d" là toạ độ CHUẨN HOÁ trong khoảng 0–1000 theo trang chứa giá trị, đúng thứ tự [ymin, xmin, ymax, xmax].`,
    `• "page" là chỉ số trang (0-based) trong file.`,
    `• Nếu model KHÔNG hỗ trợ định vị/không xác định được toạ độ: vẫn thêm phần tử nhưng đặt "box_2d": null và "page": null. TUYỆT ĐỐI KHÔNG bịa toạ độ.`,
    `• Nếu trả về document_type_mismatch thì KHÔNG cần "_bounding_boxes".`,
  ].join('\n');
}

export const EXTRACT_PRESETS: Record<string, ExtractPreset> = {
  // ── Hoá đơn & legacy ───────────────────────────────────────────────────────
  invoice: {
    description: 'Hóa đơn VAT / hóa đơn thương mại (gồm hóa đơn GTGT mua bán xe)',
    identity: 'Hóa đơn giá trị gia tăng (VAT) / hóa đơn bán hàng / hóa đơn điện tử, có người bán, người mua, dòng hàng hóa và tổng tiền',
    fields: 'invoice_serial, invoice_number, invoice_date, tax_authority_id, search_code, tax_rate, exchange_rate, seller{role, business_name, address, tax_id}, buyer{role, business_name, address, tax_id}, line_items[]{item_no, item_name, unit, brand, color, model_number, chassis_number, engine_number, quantity, unit_price, amount}, subtotal, vat_amount, total_payment, amount_in_words, currency, payment_method, bank_account, legal_info{doc_type, document_validity, issuing_authority, issue_date, signatories[]{full_name, position, organization, sign_date, seal}}',
  },

  contract: {
    description: 'Hợp đồng thương mại / lao động / mua bán (gồm HĐ mua bán xe)',
    identity: 'Hợp đồng (kinh tế, lao động, mua bán) có các bên ký kết, giá trị và điều khoản — bao gồm Hợp đồng mua bán xe ô tô',
    fields: 'contract_number, contract_date, sellers[]{role, business_name, tax_id, license_number, full_name, identification_details{id_number, issue_date, issuing_authority}, phone_number, date_of_birth, address, representative{full_name, position, bank_accounts[]{account_number, bank_name}, phone_number, address}}, buyers[]{role, business_name, tax_id, license_number, full_name, identification_details{id_number, issue_date, issuing_authority}, phone_number, date_of_birth, address, representative{full_name, position, bank_accounts[]{account_number, bank_name}, phone_number, address}}, vehicle_info[]{name, number_plate, brand, color, model_number, manufacture_year, condition, engine_number, chassis_number, technical_specifications, unit_price}, contract_value{price_total, price_total_in_text, note}, effective_date, expiry_date, payment_terms, terms[], obligations[], penalties[], governing_law, legal_info{doc_type, document_validity, issuing_authority, issue_date, issue_location, signatories[]{full_name, position, organization, sign_date, seal}}',
  },

  'id-card': {
    description: 'CMND / CCCD / Căn cước điện tử / VNeID / Hộ chiếu / Visa',
    identity: 'Giấy tờ tùy thân cá nhân: CMND, Căn cước công dân, Căn cước điện tử, VNeID, Hộ chiếu (Passport) hoặc Visa',
    fields: 'personal_info{full_name, date_of_birth, gender, residential_address, temporary_address, current_address, place_of_origin, nationality, expiry_date}, identification_details{identification_type, id_number, old_id_number_9digits, issue_date, issue_location, issuing_authority, chip_enabled}, passport_info{passport_number, visa_type, date_of_departure, date_of_arrival}, registered_phone_number, related_info, legal_info{doc_type, document_validity, signatories[]{full_name, position, organization, sign_date, seal}}',
    locationHints: 'CCCD: tên mẫu biểu ~dòng 5; số CCCD ngay dưới tên mẫu biểu; họ tên dưới số; ngày sinh/giới tính/nơi thường trú theo thứ tự; ngày-nơi cấp ở mặt sau. "Có giá trị đến": với CCCD nằm dưới ảnh chân dung, với CC (căn cước) nằm mặt sau dưới ngày cấp ("Ngày, tháng, năm đến hạn"). VNeID: số CMND 9 số (nếu có) ở gần cuối. Nơi tạm trú/nơi ở hiện tại nằm dưới nơi thường trú.',
  },

  receipt: {
    description: 'Biên lai bán lẻ / POS',
    identity: 'Biên lai bán lẻ hoặc hóa đơn máy POS của cửa hàng',
    fields: 'merchant_name, merchant_address, receipt_number, receipt_date, items[]{name, quantity, price}, subtotal, tax, total, payment_method',
  },

  // ── Tín dụng & Giải ngân ────────────────────────────────────────────────────
  disbursement: {
    description: 'Giải ngân / khế ước nhận nợ / HĐ cho vay / đề nghị giải ngân / phụ lục HĐCV / xác nhận thanh toán',
    identity: 'Chứng từ giải ngân/tín dụng: Hợp đồng cho vay, Khế ước nhận nợ, Giấy đề nghị giải ngân, phụ lục hợp đồng cho vay, xác nhận thanh toán',
    fields: 'document_type, contract_number, loan_contract_signing_date, security_contract_number, security_contract_signing_date, lender{name, business_code, address, representative{full_name, position}}, borrower{full_name, id_number, issue_place, issue_date, permanent_address, current_address, phone, email}, co_borrower{full_name, id_number, issue_place, issue_date, permanent_address, current_address, phone, email}, loan_terms{loan_amount{number, words}, disbursed_amount{number, words}, current_drawdown{number, words}, loan_term, tenor, purpose, disbursement_method, disbursement_conditions, drawdown_deadline}, interest{rate, margin, fixed_period, adjustment_frequency, base_rate_tenor}, repayment{principal_frequency, interest_frequency, first_principal_date, first_interest_date, principal_day, interest_day, grace_period, periodic_principal{number, words}, final_principal{number, words}, prepayment_fee}, disbursement_accounts[]{role, account_name, account_number, bank, branch, amount, content}, collateral{owner, real_estate, project, vehicle}, payment_confirmation{confirm_date, sale_purchase_contract_no, unit_code, customer_name, paid_amount}, legal_info{doc_type, signatories[]{full_name, position, organization, sign_date, seal}}',
  },
  guarantee: {
    description: 'Bảo lãnh / HĐ thế chấp (BĐS, xe) / phụ lục thế chấp / kết quả đăng ký GDĐB / thỏa thuận QL-PT TSBĐ',
    identity: 'Hồ sơ bảo đảm/bảo lãnh: Hợp đồng thế chấp (BĐS hoặc xe), phụ lục hợp đồng thế chấp, Kết quả/Phiếu yêu cầu đăng ký giao dịch bảo đảm, thỏa thuận quản lý/phong tỏa TSBĐ, thư bảo lãnh',
    fields: 'document_type, contract_number, contract_date, effective_date, mortgagors[]{full_name, id_number, identification_details{issue_date, issuing_authority}, address, phone_number}, mortgagee, secured_parties[], collateral_asset{asset_type, land_asset{land_lot_number, map_sheet_number, address, land_type, land_use_term, cert_info}, house{asset_name, use_area, own_type, own_term, address}, vehicle{brand, model_code, registration_cert_no, license_plate, chassis_number, engine_number}, project{project_name, project_address, unit_code}}, asset_value, credit_amount, registration{cert_method, cert_date}, notary{cert_date, notary_no, mortgagors[]{full_name, id_number}, mortgagee}, legal_info{doc_type, document_validity, issuing_authority, issue_date, signatories[]{full_name, position, organization, sign_date, seal}}',
  },
  approval: {
    description: 'Nghị quyết / tờ trình phê duyệt cấp tín dụng (Digital, CPCUW, AT team)',
    identity: 'Tờ trình kiêm nghị quyết phê duyệt cấp tín dụng / phê duyệt điều kiện sản phẩm',
    fields: 'document_type, case_code, decision_date, branch, dao_code, borrower{full_name, id_number, id_issued_place, id_issued_date, permanent_address, date_of_birth, marital_status, business_line}, co_borrower{full_name, id_number, id_issued_place, id_issued_date, permanent_address, date_of_birth, marital_status}, spouse{full_name, id_number, relationship}, collateral_owner{full_name, id_number, relationship_to_borrower}, reference_person{full_name, relationship_to_borrower, phone_number}, financial_info{total_income, repayment_source, income_details[]{source, amount}}, loan_info{borrower_type, loan_limit, loan_tenor, interest_rate, interest_margin, preferential_period, loan_purpose[], disbursement_method, principal_payment, interest_payment, principal_grace}, collateral{collateral_value, collateral_note[], collaterals[]{collateral_sub_type, vehicle_info{brand, model_code, chassis_number, engine_number}, real_estate_info{certificate_number, land_parcel_number, map_sheet_number, address}, project_property_info{unit_code}}}, officer_approval, ltv, legal_info{doc_type, document_validity, issuing_authority, issue_date, signatories[]{full_name, position, organization, sign_date, seal}}',
    locationHints: 'Giấy đề nghị vay vốn (mẫu VPBank): Tên KH + số CCCD ở Mục 2 THÔNG TIN CÁ NHÂN; tình trạng hôn nhân dòng ~16 Mục 2; người đồng vay ở Mục 5; chủ TSBĐ + quan hệ ở Mục 4.2/4.3; ngành nghề ở Mục 2 MÔ TẢ HOẠT ĐỘNG SXKD; số tiền/thời hạn/mục đích/lãi suất ở PHẦN DÀNH CHO NGÂN HÀNG Mục 3 ĐỀ XUẤT & CAM KẾT ĐVKD; nguồn trả nợ ở Mục 3 NGUỒN TRẢ NỢ; người tham chiếu ở Mục 7 Thông tin người tham khảo (họ tên, quan hệ, điện thoại).',
  },
  collateral: {
    description: 'TSBĐ: sổ đỏ/hồng (các loại GCN QSDĐ), báo cáo tư vấn giá, biên bản định giá, HĐ mua bán nhà dự án, HĐ mua bán TS có giấy chủ quyền, phiếu nhập kho TSBĐ',
    identity: 'Hồ sơ tài sản bảo đảm: Giấy chứng nhận QSDĐ/QSH nhà (sổ đỏ, sổ hồng), Báo cáo tư vấn giá / Biên bản định giá tài sản, Hợp đồng mua bán nhà dự án / BĐS / tài sản có giấy chủ quyền, Phiếu nhập kho TSBĐ',
    fields: 'document_type, owners[]{role, full_name, id_number, date_of_birth, permanent_address, identification_details{identification_type, id_number, issue_date, issuing_authority}}, borrower{full_name}, collateral{asset_type, asset_name, address, certificate_number, certificate_book_number, land_lot_number, map_sheet_number, area, frontage, adjacent_road, land_orientation, land_use_purpose[]{land_type, area}, land_use_term[]{land_type, land_usage_term}, land_origin[], land_noted[]}, property_details{property_name, property_type, structure, number_of_floors, floor_area, usage_area, house_ownership_form, completion_date, ownership_duration}, project_info{project_name, project_address, unit_code, building, floor_no, expected_delivery_date, contract_number, apartment_value, contract_value}, valuation{latest_consulting_value, latest_consulting_date, total_value, collateral_value_info[]{asset_name, collateral_value_detail}}, warehouse{warehouse_slip_no, warehouse_date, vault_location, cif, branch_name}, transactions[]{transaction_type, transaction_date, notary_office, transaction_status, contract_number, transaction_noted, beneficiary_info, mortgage}, legal_info{doc_type, document_validity, issuing_authority, issue_date, signatories[]{full_name, position, organization, sign_date, seal}}',
  },
  'credit-report': {
    description: 'Báo cáo CIC / BCTC / bảng kê nguồn thu / đề nghị cấp tín dụng',
    identity: 'Báo cáo CIC, Báo cáo tài chính (BCTC), Bảng kê nguồn thu / thu nhập, đơn đề nghị cấp tín dụng',
    fields: 'borrowers[]{role, full_name, identification_details{identification_type, id_number, issue_date, issuing_authority}, permanent_address, current_address, income_sources{employment_income{current_company{company_name, company_address, tax_code, business_type, industry, department, position, employment_contract{contract_type, employment_period, remaining_contract_duration_months, monthly_salary, payment_method, insurance_included, contract_number}}, previous_company{company_name, company_address, position, employment_contract{contract_type, employment_period, monthly_salary, payment_method}}}, rental_income[]{property_name, property_details{type, location, specification}, ownership_documents{document_type, owner_name, certificate_number}, tenant{tenant_name, contract_term, remaining_rental_duration_months, rental_purpose, monthly_rent, payment_method}}, business_income[]{role, business_name, business_type[], industry, license_number, tax_code, contribution_percentage, years_in_operation, registered_business_address, actual_business_address, branch_of_number, business_premises[]{ownership_type, business_area, business_location}, business_performance, net_revenue, cost_of_goods_sold, gross_profit, total_expenses, tax_paid, net_profit}]}}, cic_report{report_date, customer_name, cic_code, id_number, current_debt_group, bad_debt_history_5y[]{institution, debt_group, period}, late_card_payment_3y[]{institution, period, note}, attention_debt_12m[]{institution, period, note}, credit_institutions_queried_1y_count, credit_institutions_queried[]{institution, query_date}}, legal_info{doc_type, form_template_number, document_validity, issuing_authority, issue_date, signatories[]{full_name, position, organization, sign_date, seal}}',
    locationHints: 'CIC (Báo cáo chi tiết quan hệ tín dụng): tên mẫu biểu ~dòng 6, ngày tra cứu ~dòng 12, tên KH ~dòng 14, mã CIC ~dòng 15, số CCCD ~dòng 17; nhóm nợ ở mục 3.1; lịch sử nợ xấu 5 năm ở 3.5, chậm thẻ 3 năm ở 3.6, nợ chú ý 12 tháng ở 3.7; danh sách TCTD tra cứu ở mục 5.2. Bảng kê thu nhập: nguồn lương/cho thuê/HKD/doanh nghiệp theo cột KH vay và cột người đồng vay.',
  },

  // ── Thanh toán & Tài trợ Thương mại ─────────────────────────────────────────
  'payment-order': {
    description: 'Ủy nhiệm chi (UNC) / Lệnh chuyển tiền TTQT',
    identity: 'Ủy nhiệm chi (UNC) hoặc Lệnh chuyển tiền / lệnh chuyển tiền thanh toán quốc tế',
    fields: 'file_name, applicant{name, address{line1, line2, line3}}, account_information{cif_no, debit_account, debit_currency, fee_account, fee_currency}, remittance_instructions{amount, currency_after_amount, currency_transfer, payment_date, beneficiary_information{account_number, name, address{line1, line2, line3, country}, beneficiary_bank{swift_code, name}, intermediary_bank{swift_code, name}}, payment_details, fee_details}, commitment_and_signature{account_holder, chief_accountant, vpbank_signature_verified}, for_bank_use_only{reference_number, payment_fee, swift_fee, our_fee, spot_rate_mbnt, fee_exchange_rate, foreign_currency_source, debit_from_pending_account, dao, cv_kh, unit_leader}',
  },
  lc: {
    description: 'L/C, điện SWIFT, HĐ ngoại, hóa đơn TTQT, Bill of Lading, tờ khai hải quan, thông báo phí',
    identity: 'Chứng từ L/C & tài trợ thương mại: Thư tín dụng (L/C), điện SWIFT, Hợp đồng ngoại (Sales Contract), Hóa đơn thương mại (Commercial Invoice), Bill of Lading, Tờ khai hải quan, Thông báo phí',
    fields: 'file_name, document_info{document_number, document_validity, place_of_issue, issued_date, shipped_on_board_date}, parties{buyer_name, seller_name, seller_address, seller_country, exporter_name, carrier_name, shipper_exporter, consignee, notify_party, forwarding_agent}, items[]{commodity, unit_price, quantity}, pricing_and_totals{price_type, total_amount, currency, origin, manufacturer}, cargo_info{origin, total_gross_weight, total_measurement}, shipment{shipment_date, port_of_loading, place_of_receipt, port_of_discharge, place_of_delivery, vessel, transport_means}, payment{payment_terms}, beneficiary{beneficiary_name, beneficiary_address, beneficiary_country, beneficiary_account_number}, banking{intermediary_bank_swift_and_name, beneficiary_bank_swift_and_name}, declaration{declaration_number, declaration_year, import_license_number, importer_name, importer_business_code, invoice_number, invoice_total_value, invoice_currency, valuation_and_notes, inspection_completion_date, item_description}, services[]{service_content, period_from, period_to}, confirmation{seller_seal_or_signature, buyer_seal_or_signature, signed_as_carrier}',
  },

  // ── Onboarding & Pháp lý ────────────────────────────────────────────────────
  'business-license': {
    description: 'Giấy ĐKKD / ĐKDN / Mã số thuế / Giấy phép kinh doanh',
    identity: 'Giấy chứng nhận đăng ký doanh nghiệp / đăng ký kinh doanh / đăng ký hộ kinh doanh, Giấy phép kinh doanh hoặc đăng ký mã số thuế',
    fields: 'license_number, household_business_number, initial_registration_date, latest_amendment{change_number, change_date}, business_name, name_in_foreign_language, abbreviated_name, business_type, tax_id, business_status, registration_address{street, ward, district, city, country}, operation_address{street, ward, district, city, country}, contact_number, email, website, fax, business_activities[]{industry_name, industry_code, primary_industry}, charter_capital{amount, currency, amount_in_words, stock_information{par_value, total_shares}}, personal_info[]{role, position, full_name, date_of_birth, ethnicity, nationality, gender, residential_address, contact_address, identification_details{identification_type, id_number, issue_date, issuing_authority}}, capital_contributors[]{full_name, nationality, legal_document_number, contributed_capital, contribution_percentage, position, contact_address, note}, legal_info{doc_type, document_validity, issuing_authority, issue_date, signatories[]{full_name, position, organization, sign_date, seal}}',
  },
  'account-form': {
    description: 'Form mở/thay đổi tài khoản, hồ sơ CIF, các mẫu MB (MB03/04/07/08/09/10/13/14/15/16/17/18/19/49A/49B)',
    identity: 'Biểu mẫu ngân hàng mở/thay đổi tài khoản thanh toán, hồ sơ CIF, các mẫu MB (MB03/04/07/08/09/10/13/14/15/16/17/18/19/49A/49B)',
    fields: 'form_code, customer_info{business_name, name_in_foreign_language, abbreviated_name, registration_number, license_number, initial_registration_date, issuing_authority, change_number, latest_amendment, residential_state, registration_address_detail, transaction_address[], other_address, city, district, fix_phone_number, phone_number, email, last_year_revenue[], total_capital[], avg_social_insurance_employees[], is_women_owned_customer[]}, legal_representatives[]{representative_type[], full_name, gender[], date_of_birth, position, job, government_issued_identification, id_number, issue_date, issuing_authority, tax_id, phone_number, email, residential_state[], expiry_date, authorization_document_number, authorization_date}, authorized_users[]{full_name, gender[], date_of_birth, position, job, id_number, issue_date, issuing_authority, tax_id, phone_number, email, residential_state[], expiry_date, authorization_document_number, authorization_date}, chief_accountant{full_name, date_of_birth, position, id_number, issue_date, issuing_authority, tax_id, phone_number, email, residential_state[], expiry_date}, chief_accountant_authorized{full_name, date_of_birth, job, position, nationality, id_number, issue_date, issuing_authority, tax_id, expiry_date, authorization_document_number, authorization_date, phone_number, email, residential_state[]}, beneficial_owner{beneficial_owner_option[], owner_info[]{full_name, contribution_percentage, date_of_birth, nationality, job, phone_number, id_number, issue_date, issuing_authority, expiry_date, email, residential_address, residential_address_foreign, residential_state[]}}, account_services{sms_registration[], acc_state_invoice_registration[]{selected, details}}, vpbank_neobiz{maker[], approver[], inquiry_user, admin}, debit_card_registration{secret_question, card_pin_receive_method_info[]{method, details}, receiver_info{full_name, id_number, issue_date, issuing_authority, phone_number, email}}, branch_or_representative_office{branch_name, branch_certificate, initial_registration_date, change_number, latest_amendment, tax_id, branch_address_detail, transaction_address[], other_address, city, district, fix_phone_number, phone_number, email}',
  },
  'civil-doc': {
    description: 'Hộ tịch: kết hôn, xác nhận tình trạng hôn nhân, xác nhận cư trú (CT07/CT08), khai sinh',
    identity: 'Giấy tờ hộ tịch: Giấy chứng nhận kết hôn, Giấy xác nhận tình trạng hôn nhân, Giấy xác nhận thông tin về cư trú (CT07/CT08), Giấy khai sinh',
    fields: 'doc_type, registry_number, form_template_number, confirm_date, confirm_location, certificate_number, certificate_book_number, marital_status, marriage_registration_date, applicant{full_name, gender, date_of_birth, id_number, ethnicity, religion, nationality, place_of_origin, identification_details{id_number, issue_date, issuing_authority, expiry_date}}, subjects[]{role, full_name, gender, date_of_birth, id_number, ethnicity, religion, place_of_origin, residential_address, temporary_residence_address, current_address, birth_registration_place}, parents{father_name, father_date_of_birth, mother_name, mother_date_of_birth, child_name, child_date_of_birth}, household_info{full_name, id_number, relation_to_head}, household_members[]{full_name, date_of_birth, gender, id_number, relation_to_head}, confirmation_status[], purpose_of_use, note, confirmation_expiry_date, temporary_residence_duration, place_of_registration, legal_info{doc_type, document_validity, issuing_authority, issue_date, signatories[]{full_name, position, organization, sign_date, seal}}',
    locationHints: 'Xác nhận tình trạng hôn nhân: tên mẫu biểu ~dòng 4, tình trạng hôn nhân ~dòng 14 (chuẩn hóa: Độc thân / Đã kết hôn / Ly hôn), ngày cấp ngay dưới quốc hiệu → dùng confirm_date. Đăng ký kết hôn: họ tên vợ/chồng ~dòng 5, ngày đăng ký ~dòng 13 → marriage_registration_date. Giấy khai sinh: họ tên bố/mẹ/con. Xác nhận cư trú (CT07/CT08): thời hạn ở "Giấy này có giá trị đến..." → confirmation_expiry_date.',
  },

  // ── Tài sản & Bảo hiểm ──────────────────────────────────────────────────────
  'vehicle-doc': {
    description: 'Chứng từ xe: kiểm định, phiếu xuất xưởng, đăng ký xe/rơ moóc, giấy hẹn xe, biên bản kiểm tra hiện trạng, xác nhận showroom, biển số',
    identity: 'Chứng từ về xe: Chứng nhận đăng ký xe/rơ moóc, Phiếu kiểm tra chất lượng xuất xưởng, Giấy chứng nhận chất lượng an toàn kỹ thuật, Giấy chứng nhận kiểm định, Giấy hẹn xe, Biên bản kiểm tra hiện trạng xe, giấy xác nhận số khung/số máy',
    fields: 'document_type, certificate_number, registration_no, vehicle_info{brand, commercial_name, model_code, type_code, chassis_number, engine_number, license_plate, color, manufacture_year, country_of_manufacture, vehicle_status, seats, payload, gross_weight, import_declaration_number_date, valid_until_date, issued_date}, owner{owner_name, address, phone_number, role}, appointment{receiving_date, appointment_date, appointment_time, service_center, service_type}, inspection{owner_representative, signature, seal}, legal_info{doc_type, document_validity, issuing_authority, issue_date, signatories[]{full_name, position, organization, sign_date, seal}}',
  },
  insurance: {
    description: 'Giấy chứng nhận / hợp đồng bảo hiểm (nhà, xe)',
    identity: 'Giấy chứng nhận bảo hiểm hoặc Hợp đồng bảo hiểm (xe cơ giới hoặc nhà/tài sản)',
    fields: 'document_template, company_insurance, insurance_certificate_number, contract_number, issue_date, insured{full_name, address, id_number, phone_number, email}, buyer{full_name, address, id_number, phone_number, email}, beneficiary{full_name, address}, vehicle{number_plate, engine_number, chassis_number, model_type, model_code, brand, manufacture_year, payload, seats, usage_purpose, initial_registration_date, car_value, additional_value}, property{insured_location, business_field, insured_asset, asset_value}, insurance_amounts{insurance_amount, separate_insurance_amount, additional_insurance_amount}, fees{insurance_fee_excl_vat, vat_amount, insurance_fee_incl_vat, total_fee_excl_vat, total_fee_incl_vat}, deductible{deductible, deductible_separate}, additional_clause, flood_clause, insurance_period{start_date, end_date}, payment{payment_due_date, payment_amount}, benefits{insurance_benefit, insurance_type, contract_beneficiary_clause, policy_terms[], additional_terms[]}',
  },

  // ── Bổ sung theo US1 ────────────────────────────────────────────────────────
  'price-quote': {
    description: 'Báo giá tài sản (động sản: xe, máy móc, thiết bị)',
    identity: 'Báo giá tài sản / bảng báo giá cho tài sản là động sản (xe, máy móc, thiết bị)',
    fields: 'document_type, quote_number, quote_date, seller{name, address, tax_id, phone_number}, buyer{full_name, id_number}, assets[]{item_no, model, brand, manufacture_year, chassis_number, engine_number, specification, quantity, unit_price, amount}, asset_value, currency, validity, legal_info{doc_type, signatories[]{full_name, position, organization, sign_date, seal}}',
    locationHints: 'Tên mẫu biểu ~dòng 6 ("BÁO GIÁ TÀI SẢN"); loại/nhãn hiệu và năm sản xuất ở mục II Tài sản báo giá; giá trị ở mục IV sau "Giá trị của tài sản:".',
  },
  'salary-confirmation': {
    description: 'Giấy xác nhận lương / Sao kê lương / Sổ phụ tài khoản',
    identity: 'Giấy xác nhận lương của đơn vị sử dụng lao động, hoặc sao kê lương / sổ phụ tài khoản / sổ chi tiết tài khoản ngân hàng',
    fields: 'document_type, employer_name, employee{full_name, id_number, position, department}, net_income_monthly, gross_income_monthly, confirmation_date, statement_period{from, to}, account_info{account_number, bank_name}, transactions[]{date, description, credit, debit, balance}, total_credit, legal_info{doc_type, signatories[]{full_name, position, organization, sign_date, seal}}',
    locationHints: 'Giấy xác nhận lương: tên mẫu biểu ~dòng 3; tên KH ~dòng 4 và 6; tổng thu nhập thực lãnh ~dòng 18. Sao kê: dòng 1 là "Sổ phụ tài khoản/Sổ chi tiết tài khoản".',
  },
  'social-insurance': {
    description: 'VSSID / Quá trình tham gia bảo hiểm xã hội',
    identity: 'Ảnh chụp ứng dụng VSSID hoặc tờ Quá trình tham gia bảo hiểm xã hội của cá nhân',
    fields: 'document_type, full_name, social_insurance_number, id_number, participation_periods[]{from, to, employer, position, salary, note}, total_months, legal_info{doc_type}',
    locationHints: 'Tiêu đề "Quá trình tham gia bảo hiểm xã hội" ở dòng 1.',
  },
  'tax-doc': {
    description: 'Chứng từ thuế: giấy nộp tiền vào NSNN / tờ khai thuế GTGT (VAT)',
    identity: 'Giấy nộp tiền vào Ngân sách Nhà nước hoặc Tờ khai thuế giá trị gia tăng (mẫu 01/GTGT)',
    fields: 'document_type, taxpayer_name, tax_id, tax_period, reference_number, address, tax_authority, amount, items[]{content, amount}, total_amount, legal_info{doc_type, issue_date, signatories[]{full_name, position, organization, sign_date, seal}}',
    locationHints: 'Giấy nộp tiền NSNN: tên người nộp phía trên "Địa chỉ" / dưới "Số tham chiếu". Tờ khai VAT (01/GTGT): kỳ tính thuế và tên người nộp ~dòng 6, 8.',
  },
  'purchase-list': {
    description: 'Bảng kê mua hàng / bảng kê hàng hóa',
    identity: 'Bảng kê mua hàng hoặc Bảng kê hàng hóa (danh sách hàng, số lượng, đơn giá, tổng cộng)',
    fields: 'document_type, list_date, customer{full_name, id_number}, seller{name}, items[]{item_no, item_name, unit, quantity, unit_price, amount}, total_value, amount_in_words, legal_info{doc_type, signatories[]{full_name, position, organization, sign_date, seal}}',
    locationHints: 'Tiêu đề "BẢNG KÊ HÀNG HÓA/BẢNG KÊ MUA HÀNG" ở dòng 1; họ tên khách hàng sau "Họ và tên khách hàng"; tổng giá trị ở dòng "Tổng cộng" cuối bảng.',
  },
  'financial-report': {
    description: 'Báo cáo tài chính: bảng cân đối kế toán / báo cáo kết quả HĐKD',
    identity: 'Bảng cân đối kế toán hoặc Báo cáo kết quả hoạt động kinh doanh của doanh nghiệp',
    fields: 'document_type, company_name, tax_id, period, balance_sheet{total_assets, total_liabilities, owner_equity, current_assets, fixed_assets}, income_statement{net_revenue, cost_of_goods_sold, gross_profit, operating_expenses, financial_expenses, profit_before_tax, corporate_income_tax, net_profit}, legal_info{doc_type, signatories[]{full_name, position, organization, sign_date, seal}}',
    locationHints: 'Bảng cân đối kế toán: kỳ và tên công ty ~dòng 3,5,6. Báo cáo KQKD: kỳ và tên công ty ~dòng 3,4.',
  },
  'valuation-report': {
    description: 'Báo cáo/Chứng thư định giá TSBĐ (Thịnh Điền/Prosland hoặc công ty ngoài: SBA, CITICS, FARGO, VVFC)',
    identity: 'Báo cáo định giá tài sản / Chứng thư thẩm định giá cho TSBĐ (động sản hoặc BĐS). Nội bộ: "BÁO CÁO ĐỊNH GIÁ TÀI SẢN" (Thịnh Điền/Prosland). Công ty ngoài: SBA (CÔNG TY CỔ PHẦN TƯ VẤN QUY HOẠCH VÀ THẨM ĐỊNH GIÁ SBA), CITICS (CÔNG TY CỔ PHẦN CITICS), FARGO (CÔNG TY CP THẨM ĐỊNH GIÁ FARGO), VVFC (CÔNG TY CP ĐỊNH GIÁ VÀ DỊCH VỤ TÀI CHÍNH VIỆT NAM VVFC)',
    fields: 'document_type, appraisal_company, customer_name, asset_kind, asset_info, vehicle{license_plate, engine_number, chassis_number}, real_estate{certificate_number, land_lot_number, map_sheet_number, address, land_current_status}, asset_value, asset_rank, valuation_date, legal_info{doc_type, signatories[]{full_name, position, organization, sign_date, seal}}',
    locationHints: 'Nhận diện công ty định giá qua tiêu đề/góc trái trên cùng theo từng loại (SBA/CITICS/FARGO/VVFC/Thịnh Điền). Trường chung: tên KH yêu cầu, thông tin TSBĐ, số máy/biển số (động sản) hoặc số GCN/thửa đất+tờ bản đồ (BĐS), hiện trạng thửa đất, giá trị tài sản, hạng/xếp hạng tài sản.',
  },
};
