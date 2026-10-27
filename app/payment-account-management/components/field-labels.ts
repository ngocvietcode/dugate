// app/payment-account-management/components/field-labels.ts
// UI-owned label map for the payment-account-management extracted fields.
//
// This DUPLICATES the labels declared on the backend schema
// (lib/pipelines/workflows/payment-account-management/shared/extract-schemas.ts)
// on purpose: the frontend must not import from the pipeline module to keep the
// app/lib layering clean and the client bundle free of server-only code. Both
// maps are the source of truth for their own consumer, and drift is acceptable
// — when the UI doesn't have a label for a key, `getFieldLabel` falls back to
// the raw key so the app never crashes on a schema change.
//
// Add mappings here as new document codes / fields are supported. The keys must
// match the JSON output produced by the extractor for each document code.

/** Person-record labels — reused across MB01's two people lists. */
const PERSON_RECORD_LABELS: Record<string, string> = {
  full_name: 'Họ và tên',
  sex: 'Giới tính',
  date_of_birth: 'Ngày sinh',
  occupation: 'Nghề nghiệp',
  position: 'Chức vụ',
  nationality: 'Quốc tịch',
  tax_code: 'Mã số thuế cá nhân',
  identification_info: 'Thông tin định danh',
  id_document_type: 'Loại giấy tờ tùy thân',
  id_no: 'Số giấy tờ tùy thân',
  date_of_issue: 'Ngày cấp',
  place_of_issue: 'Nơi cấp',
  date_of_expiry: 'Có giá trị đến',
  phone: 'Điện thoại',
  email: 'Email',
  residency_status: 'Tình trạng cư trú',
};

// ── MB02 shared sub-block label maps ──────────────────────────────────────
// Mirrors the maps of the same names in
// lib/pipelines/workflows/payment-account-management/shared/extract-schemas.ts.
// Kept as a separate copy here per the file-level design note above: the app/
// layer must not import from lib/ to keep app/lib layering clean.

/** MB02 person sub-keys that don't exist in PERSON_RECORD_LABELS. */
const MB02_PERSON_EXTRA_LABELS: Record<string, string> = {
  is_legal_representative: 'Là Đại diện hợp pháp của Chủ TK',
  role_label: 'Vai trò trên biểu mẫu',
  permanent_address: 'Địa chỉ thường trú',
  permanent_address_street: 'Địa chỉ thường trú — Số nhà, tên đường',
  permanent_address_ward: 'Địa chỉ thường trú — Phường/Xã/Thị trấn',
  permanent_address_district: 'Địa chỉ thường trú — Quận/Huyện',
  permanent_address_province: 'Địa chỉ thường trú — Tỉnh/Thành phố',
  current_address: 'Nơi ở hiện tại khác',
  current_address_street: 'Nơi ở hiện tại — Số nhà, tên đường',
  current_address_ward: 'Nơi ở hiện tại — Phường/Xã/Thị trấn',
  current_address_district: 'Nơi ở hiện tại — Quận/Huyện',
  current_address_province: 'Nơi ở hiện tại — Tỉnh/Thành phố',
  foreign_id_no: 'Số định danh người nước ngoài',
  foreign_residence_abroad_address: 'Địa chỉ nơi ĐK cư trú ở nước ngoài',
  foreign_residence_vietnam_address: 'Địa chỉ nơi ĐK cư trú ở Việt Nam',
  second_nationality: 'Quốc tịch thứ hai',
  second_passport_no: 'Số Hộ chiếu (quốc tịch còn lại)',
  second_passport_issue_date: 'Ngày cấp (quốc tịch còn lại)',
  second_passport_place_of_issue: 'Nơi cấp (quốc tịch còn lại)',
  second_passport_expiry_date: 'Ngày hết hạn (quốc tịch còn lại)',
  second_country_residence_address: 'Địa chỉ cư trú tại quốc gia mang quốc tịch còn lại',
};

/** MB02 online-banking sub-block (VI persons only). */
const MB02_ONLINE_BANKING_SUB_LABELS: Record<string, string> = {
  online_banking_registered: 'Đăng ký Ngân hàng trực tuyến',
  online_banking_function: 'Chức năng',
  online_banking_pin: 'Mã PIN',
  online_banking_approval_order: 'Thứ tự phê duyệt',
  online_banking_approval_limit: 'Hạn mức phê duyệt',
  online_banking_admin_type: 'Loại quản trị viên',
  online_banking_other: 'Ghi chú khác',
};

/** MB02 debit-card sub-block (all four MB02 people lists). */
const MB02_DEBIT_CARD_SUB_LABELS: Record<string, string> = {
  debit_card_registered: 'Đăng ký Thẻ ghi nợ',
  debit_card_role: 'Vai trò sử dụng Thẻ',
  debit_card_embossed_name: 'Tên in nổi trên Thẻ',
  debit_card_secret_question: 'Câu hỏi bí mật',
  debit_card_purposes: 'Mục đích sử dụng Thẻ',
  debit_card_fatca_us_person: 'Đối tượng Hoa Kỳ (FATCA)',
  debit_card_us_tin: 'Mã số thuế Hoa Kỳ (U.S. TIN)',
  debit_card_beneficial_owner: 'Chủ sở hữu hưởng lợi',
  debit_card_is_trust_beneficiary: 'Bên nhận ủy thác trong thỏa thuận pháp lý',
};

/** MB02 authorization sub-block (the two "delegated" lists: VI.2 + VII.2). */
const MB02_AUTHORIZATION_SUB_LABELS: Record<string, string> = {
  authorization_scope: 'Phạm vi và Thời hạn ủy quyền',
  authorization_poa_no: 'Số văn bản ủy quyền',
  authorization_poa_date: 'Ngày văn bản ủy quyền',
  authorization_poa_grantor: 'Bên ủy quyền',
};

// ── MB03 shared sub-block label maps ──────────────────────────────────────
// Mirrors the maps of the same names in
// lib/pipelines/workflows/payment-account-management/shared/extract-schemas.ts.
// Kept as a separate copy here so the app/ layer never imports from lib/.

/**
 * MB03's "Profile Block" — the 19 personal-basics fields every people-list
 * entry carries (Section 4 role blocks, Section 5 V.2 new users, Section 6
 * cardholders).
 */
const MB03_PROFILE_BLOCK_LABELS: Record<string, string> = {
  full_name: 'Họ và tên',
  date_of_birth: 'Ngày sinh',
  sex: 'Giới tính',
  occupation: 'Nghề nghiệp',
  position: 'Chức vụ',
  nationality: 'Quốc tịch',
  tax_code: 'Mã số thuế cá nhân',
  id_document_type: 'Loại giấy tờ tùy thân',
  id_no: 'Số giấy tờ tùy thân',
  date_of_issue: 'Ngày cấp',
  place_of_issue: 'Nơi cấp',
  date_of_expiry: 'Có giá trị đến',
  phone: 'Điện thoại',
  email: 'Email',
  residency_status: 'Tình trạng cư trú',
  permanent_address: 'Địa chỉ thường trú',
  permanent_address_street: 'Địa chỉ thường trú — Số nhà, tên đường',
  permanent_address_ward: 'Địa chỉ thường trú — Phường/Xã/Thị trấn',
  permanent_address_district: 'Địa chỉ thường trú — Quận/Huyện',
  permanent_address_province: 'Địa chỉ thường trú — Tỉnh/Thành phố',
  visa_no: 'Số thị thực',
  visa_place_of_issue: 'Nơi cấp thị thực',
  visa_expiry_date: 'Ngày hết hạn thị thực',
};

/** MB03 Section 4 role-specific tick fields (superset — not every role has every key). */
/** MB03 Section 4.I "Đại diện theo pháp luật" role tick fields.
 * Only Section 4.I is a structured object[] — Sections 4.II, 4.III, and 4.V
 * return raw text and do NOT use these labels. */
const MB03_SECTION4_ROLE_LABELS: Record<string, string> = {
  action_type: 'Loại yêu cầu (ĐK/Thay đổi/Hủy)',
  is_legal_authorized_rep: 'Là Người ĐD hợp pháp của Chủ TK',
};

/** MB03 Section 5 V.1 "existing user" sub-block. */
const MB03_ONLINE_BANKING_EXISTING_USER_LABELS: Record<string, string> = {
  action_type: 'Loại yêu cầu (ĐK/Thay đổi/Hủy)',
  full_name: 'Họ và tên',
  id_no: 'Số giấy tờ tùy thân',
  function: 'Chức năng',
  approval_order: 'Thứ tự phê duyệt',
  approval_limit: 'Hạn mức phê duyệt',
  admin_type: 'Loại quản trị viên',
};

/** MB03 Section 5 V.2 "new user" sub-block — Profile Block + config keys. */
const MB03_ONLINE_BANKING_NEW_USER_LABELS: Record<string, string> = {
  ...MB03_PROFILE_BLOCK_LABELS,
  action_type: 'Loại yêu cầu (ĐK mới)',
  function: 'Chức năng',
  approval_order: 'Thứ tự phê duyệt',
  pin: 'Mã PIN',
  approval_limit: 'Hạn mức phê duyệt',
  admin_type: 'Loại quản trị viên',
  other: 'Ghi chú khác',
  authorization_scope: 'Phạm vi ủy quyền (raw text)',
  authorization_period: 'Thời hạn ủy quyền (raw text)',
};

/** MB03 Section 6 cardholder sub-block — Profile Block + card-specific keys. */
const MB03_CARDHOLDER_LABELS: Record<string, string> = {
  ...MB03_PROFILE_BLOCK_LABELS,
  embossed_name_on_card: 'Tên in nổi trên Thẻ',
  card_authorization: 'Ủy quyền sử dụng thẻ',
  card_purposes: 'Mục đích sử dụng Thẻ',
  fatca_us_person: 'Đối tượng Hoa Kỳ (FATCA)',
  us_tin: 'Mã số thuế Hoa Kỳ (U.S. TIN)',
  beneficial_owner: 'Chủ sở hữu hưởng lợi',
  legal_agreement: 'Thỏa thuận pháp lý',
  dlcn_consent: 'Xác nhận bảo vệ DLCN',
};

// ── MB04 shared sub-block label maps ──────────────────────────────────────
// Mirrors the maps of the same names in
// lib/pipelines/workflows/payment-account-management/shared/extract-schemas.ts.
// Kept as a separate copy here so the app/ layer never imports from lib/.

/**
 * MB04's Profile Block — 19 personal-basics fields (same as MB03's Profile Block).
 * Every one of MB04's 8 people-list entries (4 per CTK side) uses this block.
 */
const MB04_PROFILE_BLOCK_LABELS: Record<string, string> = {
  full_name: 'Họ và tên',
  date_of_birth: 'Ngày sinh',
  sex: 'Giới tính',
  occupation: 'Nghề nghiệp',
  position: 'Chức vụ',
  nationality: 'Quốc tịch',
  tax_code: 'Mã số thuế cá nhân',
  id_document_type: 'Loại giấy tờ tùy thân',
  id_no: 'Số giấy tờ tùy thân',
  date_of_issue: 'Ngày cấp',
  place_of_issue: 'Nơi cấp',
  date_of_expiry: 'Có giá trị đến',
  phone: 'Điện thoại',
  email: 'Email',
  residency_status: 'Tình trạng cư trú',
  permanent_address: 'Địa chỉ thường trú',
  permanent_address_street: 'Địa chỉ thường trú — Số nhà, tên đường',
  permanent_address_ward: 'Địa chỉ thường trú — Phường/Xã/Thị trấn',
  permanent_address_district: 'Địa chỉ thường trú — Quận/Huyện',
  permanent_address_province: 'Địa chỉ thường trú — Tỉnh/Thành phố',
  visa_no: 'Số thị thực',
  visa_place_of_issue: 'Nơi cấp thị thực',
  visa_expiry_date: 'Ngày hết hạn thị thực',
};

/** MB04 role-specific tick fields (superset for the four people-list roles). */
const MB04_ROLE_TICK_LABELS: Record<string, string> = {
  is_legal_authorized_rep: 'Là Người ĐD hợp pháp của Chủ TK',
  is_authorized_account_user: 'Là Người được UQ sử dụng TK',
};

/** MB04 legal-representative record labels (Profile Block + 1 role tick). */
const MB04_LEGAL_REP_LABELS: Record<string, string> = {
  ...MB04_PROFILE_BLOCK_LABELS,
  is_legal_authorized_rep: MB04_ROLE_TICK_LABELS.is_legal_authorized_rep,
};

/** MB04 authorized-representative record labels (Profile Block + 2 role ticks). */
const MB04_AUTH_REP_LABELS: Record<string, string> = {
  ...MB04_PROFILE_BLOCK_LABELS,
  ...MB04_ROLE_TICK_LABELS,
};

/** MB04 chief-accountant record labels (Profile Block only — no role ticks). */
const MB04_CHIEF_ACCOUNTANT_LABELS: Record<string, string> = {
  ...MB04_PROFILE_BLOCK_LABELS,
};

/** MB04 authorized-by-CA record labels (Profile Block only). */
const MB04_AUTH_CHIEF_ACCOUNTANT_LABELS: Record<string, string> = {
  ...MB04_PROFILE_BLOCK_LABELS,
};

/**
 * Build the top-level FIELD_LABELS row for one MB04 CTK side. Both CTK1 and
 * CTK2 declare the SAME 29 org fields, differing only in the `_ctk1` / `_ctk2`
 * suffix and the Vietnamese holder-name prefix in the label. This helper
 * stamps out one flat map per side; the caller spreads them into the main
 * FIELD_LABELS['MB04'] block.
 */
function buildMb04OrgLabelRow(
  side: 'ctk1' | 'ctk2',
  holder: string,
): Record<string, string> {
  const s = `_${side}`;
  const p = `${holder} — `;
  return {
    [`org_name_vi${s}`]: `${p}Tên tổ chức (tiếng Việt)`,
    [`org_name_foreign${s}`]: `${p}Tên tổ chức (tiếng nước ngoài)`,
    [`org_short_name${s}`]: `${p}Tên viết tắt`,
    [`business_registration_no${s}`]: `${p}Số ĐKDN/QĐTL`,
    [`establishment_date${s}`]: `${p}Ngày ĐK / thành lập`,
    [`registration_place${s}`]: `${p}Nơi cấp`,
    [`establishment_country${s}`]: `${p}Quốc gia thành lập`,
    [`tax_code${s}`]: `${p}Mã số thuế`,
    [`org_identification_no${s}`]: `${p}Số định danh của tổ chức`,
    [`state_budget_relation_code${s}`]: `${p}Mã ĐV có QH với NSNN`,
    [`residency_status${s}`]: `${p}Tình trạng cư trú`,
    [`head_office_address${s}`]: `${p}Địa chỉ trụ sở chính`,
    [`transaction_address_type${s}`]: `${p}Loại địa chỉ giao dịch`,
    [`other_address_line${s}`]: `${p}Địa chỉ khác (toàn dòng)`,
    [`other_address_street${s}`]: `${p}Địa chỉ khác — Số nhà / Tầng / Tòa nhà, tên đường`,
    [`other_address_ward${s}`]: `${p}Địa chỉ khác — Phường/Xã/Thị trấn`,
    [`other_address_district${s}`]: `${p}Địa chỉ khác — Quận/Huyện`,
    [`other_address_province${s}`]: `${p}Địa chỉ khác — Tỉnh/TP`,
    [`phone${s}`]: `${p}Số điện thoại`,
    [`email${s}`]: `${p}Email`,
    [`main_business_sector${s}`]: `${p}Tên ngành`,
    [`business_sector_code${s}`]: `${p}Mã ngành (cấp 5)`,
    [`sme_micro_enterprise${s}`]: `${p}Quy mô doanh nghiệp siêu nhỏ`,
    [`sme_previous_year_revenue${s}`]: `${p}Doanh thu năm trước (tỷ đồng)`,
    [`sme_total_capital${s}`]: `${p}Tổng nguồn vốn (tỷ đồng)`,
    [`sme_social_insurance_employees${s}`]: `${p}Số lao động BHXH (người)`,
    [`sme_woman_owned${s}`]: `${p}Sở hữu bởi phụ nữ`,
    [`fatca_us_tax_code${s}`]: `${p}Mã số thuế Hoa Kỳ`,
    [`fatca_classification${s}`]: `${p}Phân loại FATCA`,
    [`relationship_purposes${s}`]: `${p}Mục đích quan hệ với VPBank`,
    [`relationship_purpose_other${s}`]: `${p}Mục đích khác (nêu rõ)`,
  };
}

/** MB04 CTK1 people-list top-level labels (4 lists). */
const MB04_PEOPLE_LABELS_CTK1: Record<string, string> = {
  legal_representatives_ctk1: 'Chủ Tài Khoản Thứ Nhất — Đại diện pháp luật (1.1)',
  authorized_representatives_ctk1: 'Chủ Tài Khoản Thứ Nhất — Đại diện ủy quyền (1.2)',
  chief_accountants_ctk1: 'Chủ Tài Khoản Thứ Nhất — Kế toán trưởng / PTKT (2.1)',
  authorized_by_chief_accountants_ctk1: 'Chủ Tài Khoản Thứ Nhất — Người được KTT ủy quyền (2.2)',
};

/** MB04 CTK2 people-list top-level labels (4 lists). */
const MB04_PEOPLE_LABELS_CTK2: Record<string, string> = {
  legal_representatives_ctk2: 'Chủ Tài Khoản Thứ Hai — Đại diện pháp luật (1.1)',
  authorized_representatives_ctk2: 'Chủ Tài Khoản Thứ Hai — Đại diện ủy quyền (1.2)',
  chief_accountants_ctk2: 'Chủ Tài Khoản Thứ Hai — Kế toán trưởng / PTKT (2.1)',
  authorized_by_chief_accountants_ctk2: 'Chủ Tài Khoản Thứ Hai — Người được KTT ủy quyền (2.2)',
};

/**
 * Top-level field labels keyed by document code, then by field key.
 * A missing entry (unknown code OR unknown key) → fall back to the raw key.
 */
const FIELD_LABELS: Record<string, Record<string, string>> = {
  can_cuoc_cong_dan: {
    id_no: 'Số CCCD',
    full_name: 'Họ và tên',
    date_of_birth: 'Ngày sinh',
    sex: 'Giới tính',
    nationality: 'Quốc tịch',
    place_of_residence: 'Nơi thường trú',
    date_of_expiry: 'Có giá trị đến',
    date_of_issue: 'Ngày cấp',
    title: 'Loại tài liệu',
    place_of_issue: 'Nơi cấp',
  },
  can_cuoc: {
    id_no: 'Số định danh cá nhân',
    full_name: 'Họ và tên',
    date_of_birth: 'Ngày sinh',
    sex: 'Giới tính',
    nationality: 'Quốc tịch',
    place_of_residence: 'Nơi thường trú',
    date_of_issue: 'Ngày cấp',
    date_of_expiry: 'Ngày hết hạn',
    title: 'Loại tài liệu',
    place_of_issue: 'Nơi cấp',
  },
  passport: {
    id_no: 'Số hộ chiếu',
    full_name: 'Họ và tên',
    sex: 'Giới tính',
    date_of_birth: 'Ngày sinh',
    nationality: 'Quốc tịch',
    date_of_issue: 'Ngày cấp',
    date_of_expiry: 'Ngày hết hạn',
    place_of_issue: 'Nơi cấp',
    title: 'Loại tài liệu',
  },
  thi_thuc: {
    full_name: 'Họ và tên',
    id_no: 'Số thị thực',
    valid_from: 'Có giá trị từ',
    valid_to: 'Có giá trị đến',
    title: 'Loại tài liệu',
  },
  the_tam_tru: {
    full_name: 'Họ và tên',
    id_no: 'Số thẻ',
    passport_no: 'Số hộ chiếu',
    nationality: 'Quốc tịch',
    date_of_issue: 'Ngày cấp',
    date_of_expiry: 'Thẻ có giá trị đến',
    title: 'Loại tài liệu',
  },
  cam_ket_khong_co_ktt: {
    commitment_content: 'Nội dung cam kết',
    title: 'Loại tài liệu',
  },
  bien_ban_giao_nhan: {
    handover_party_name: 'Bên giao - Họ và tên',
    handover_party_roles: 'Bên giao - Vai trò',
    title: 'Loại tài liệu',
  },
  dieu_le: {
    company_name: 'Tên tổ chức',
    title: 'Loại tài liệu',
  },
  tracuu_1414: {
    full_name: 'Họ và tên',
    id_no: 'Số giấy tờ',
    date_of_birth: 'Ngày sinh',
    subscriber_type: 'Loại thuê bao',
    activated_at: 'Ngày kích hoạt',
    registered_phone_numbers: 'Danh sách số thuê bao',
    title: 'Loại tài liệu',
  },
  MB01: {
    // Section I — organization
    org_name_vi: 'Tên tổ chức (tiếng Việt)',
    org_name_foreign: 'Tên tổ chức (tiếng nước ngoài)',
    org_short_name: 'Tên viết tắt',
    business_registration_no: 'Số ĐKDN/ĐKKD/QĐTL',
    establishment_date: 'Ngày đăng ký thành lập',
    registration_place: 'Nơi cấp',
    establishment_country: 'Quốc gia thành lập',
    tax_code: 'Mã số thuế / Mã số doanh nghiệp',
    org_identification_no: 'Số định danh của tổ chức',
    state_budget_relation_code: 'Mã số ĐV có quan hệ với NSNN',
    residency_status: 'Tình trạng cư trú',
    transaction_address: 'Địa chỉ giao dịch',
    transaction_address_type: 'Loại địa chỉ giao dịch',
    transaction_address_street: 'Địa chỉ giao dịch — Số nhà / Tầng / Tòa nhà, tên đường',
    transaction_address_ward: 'Địa chỉ giao dịch — Phường/Xã/Thị trấn',
    transaction_address_district: 'Địa chỉ giao dịch — Quận/Huyện',
    transaction_address_province: 'Địa chỉ giao dịch — Tỉnh/Thành phố',
    other_address: 'Địa chỉ khác',
    phone: 'Số điện thoại',
    email: 'Email',
    main_business_sector: 'Lĩnh vực kinh doanh chính',
    business_sector_code: 'Mã ngành (cấp 5)',
    // Section II / III — repeating people lists
    legal_representatives: 'Người đại diện hợp pháp',
    chief_accountants: 'Kế toán trưởng / Phụ trách kế toán',
    // Section V / VI — FATCA + purpose
    fatca_classification: 'Phân loại FATCA',
    relationship_purpose: 'Mục đích quan hệ với VPBank',
    vpbank_signature_confirmation: 'Xác nhận chữ ký VPBank',
    // Fixed
    title: 'Loại tài liệu',
  },
  // ── MB02 — GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ VÀ SỬ DỤNG TKTT, DỊCH VỤ ─────
  // 85 top-level fields split into 4 groups (see extract-schemas.ts). Order
  // below matches the group order in the schema for easy side-by-side review.
  MB02: {
    // ── Group 1: Organization info (I.1) ─────────────────────────────────
    org_name_vi: 'Tên tổ chức (tiếng Việt)',
    org_name_foreign: 'Tên tổ chức (tiếng nước ngoài)',
    org_short_name: 'Tên viết tắt',
    business_registration_no: 'Số ĐKDN/ĐKKD/QĐTL',
    establishment_date: 'Ngày đăng ký thành lập',
    registration_place: 'Nơi cấp',
    establishment_country: 'Quốc gia thành lập',
    tax_code: 'Mã số thuế / Mã số doanh nghiệp',
    org_identification_no: 'Số định danh của tổ chức',
    state_budget_relation_code: 'Mã số ĐV có quan hệ với NSNN',
    residency_status: 'Tình trạng cư trú',
    head_office_address: 'Địa chỉ trụ sở chính',
    transaction_address_type: 'Loại địa chỉ giao dịch',
    other_address: 'Địa chỉ khác',
    other_address_street: 'Địa chỉ khác — Số nhà / Tầng / Tòa nhà, tên đường',
    other_address_ward: 'Địa chỉ khác — Phường/Xã/Thị trấn',
    other_address_district: 'Địa chỉ khác — Quận/Huyện',
    other_address_province: 'Địa chỉ khác — Tỉnh/Thành phố',
    phone: 'Số điện thoại',
    fax: 'Số fax',
    email: 'Email',
    website: 'Trang thông tin điện tử',
    main_business_sector: 'Lĩnh vực kinh doanh chính',
    business_sector_code: 'Mã ngành (cấp 5)',
    authorized_representative_summary: 'Đại diện hợp pháp (dòng khai báo trên đầu trang)',
    // ── Group 1: SME extras (I.1 tail) ───────────────────────────────────
    sme_micro_enterprise: 'Quy mô doanh nghiệp siêu nhỏ',
    sme_previous_year_revenue: 'Doanh thu năm trước (tỷ đồng)',
    sme_total_capital: 'Tổng nguồn vốn (tỷ đồng)',
    sme_social_insurance_employees: 'Số lao động BHXH (người)',
    sme_woman_owned: 'Sở hữu bởi phụ nữ',
    // ── Group 1: Branch info (I.2) ───────────────────────────────────────
    branch_name: 'Tên Chi nhánh/VPĐD',
    branch_registration_no: 'GCN ĐKHĐ Chi nhánh/VPĐD',
    branch_establishment_date: 'Ngày đăng ký / thành lập (chi nhánh)',
    branch_tax_code: 'Mã số thuế chi nhánh',
    branch_head_office_address: 'Địa chỉ chi nhánh/VPĐD',
    branch_transaction_address_type: 'Loại địa chỉ giao dịch (chi nhánh)',
    branch_other_address: 'Địa chỉ khác (chi nhánh)',
    branch_other_address_street: 'Địa chỉ khác (chi nhánh) — Số nhà / Tầng / Tòa nhà, tên đường',
    branch_other_address_ward: 'Địa chỉ khác (chi nhánh) — Phường/Xã/Thị trấn',
    branch_other_address_district: 'Địa chỉ khác (chi nhánh) — Quận/Huyện',
    branch_other_address_province: 'Địa chỉ khác (chi nhánh) — Tỉnh/Thành phố',
    branch_phone: 'Số điện thoại (chi nhánh)',
    branch_fax: 'Số fax (chi nhánh)',
    branch_email: 'Email (chi nhánh)',
    branch_website: 'Trang thông tin điện tử (chi nhánh)',
    branch_main_business_sector: 'Lĩnh vực hoạt động chính (chi nhánh)',
    branch_business_sector_code: 'Mã ngành (cấp 5) - chi nhánh',
    // ── Group 2: FATCA (I.3) ─────────────────────────────────────────────
    fatca_us_tax_code: 'Mã số thuế Hoa Kỳ của tổ chức',
    fatca_us_exempt_code: 'Mã số miễn trừ báo cáo FATCA',
    fatca_classification: 'Phân loại FATCA',
    fatca_us_controlling_persons: 'Cá nhân có quyền kiểm soát là người Hoa Kỳ',
    // ── Group 2: Purpose + registered services (I.4 + II) ────────────────
    relationship_purpose: 'Mục đích quan hệ với VPBank',
    registered_services: 'Dịch vụ đăng ký',
    // ── Group 2: TKTT info (III.1) ───────────────────────────────────────
    tktt_accounts: 'TKTT — Danh sách tài khoản (III.1)',
    // ── Group 2: Statement + SMS + QLDT (III.2 – III.4) ──────────────────
    statement_frequency: 'Tần suất nhận sổ phụ / hóa đơn điện tử',
    statement_delivery_methods: 'Hình thức nhận sổ phụ / hóa đơn điện tử',
    statement_email: 'Email nhận sổ phụ / hóa đơn điện tử',
    sms_banking_phones: 'Danh sách số điện thoại SMS Banking',
    qldt_package: 'Gói QLDT (SME)',
    // ── Group 2: Online banking (IV) ─────────────────────────────────────
    online_banking_account_choice: 'Ngân hàng trực tuyến — Tài khoản đăng ký',
    online_banking_account_other: 'Ngân hàng trực tuyến — Khác',
    online_banking_daily_limit: 'Ngân hàng trực tuyến — Hạn mức giao dịch/ngày',
    online_banking_daily_limit_details: 'Ngân hàng trực tuyến — Chi tiết hạn mức',
    online_banking_approval_mechanism: 'Cơ chế phê duyệt',
    online_banking_approval_details: 'Chi tiết cơ chế phê duyệt',
    // ── Group 2: Debit card (V) ──────────────────────────────────────────
    debit_card_account_choice: 'Thẻ ghi nợ — Tài khoản gắn Thẻ',
    debit_card_account_other: 'Thẻ ghi nợ — Tài khoản khác',
    debit_card_type: 'Loại thẻ phát hành',
    debit_card_type_other: 'Loại thẻ khác',
    debit_card_embossed_name: 'Tên in nổi trên thẻ',
    debit_card_delivery_method: 'Hình thức nhận Thẻ và PIN',
    debit_card_delivery_address: 'Địa chỉ nhận Thẻ và PIN',
    // ── Group 2: Card & PIN receiver (V.5) ───────────────────────────────
    card_receiver_full_name: 'Người nhận Thẻ và PIN — Họ tên',
    card_receiver_id_type: 'Người nhận Thẻ và PIN — Loại GTTT',
    card_receiver_id_no: 'Người nhận Thẻ và PIN — Số GTTT',
    card_receiver_id_issue_date: 'Người nhận Thẻ và PIN — Ngày cấp',
    card_receiver_id_place_of_issue: 'Người nhận Thẻ và PIN — Nơi cấp',
    card_receiver_phone: 'Người nhận Thẻ và PIN — Điện thoại',
    card_receiver_email: 'Người nhận Thẻ và PIN — Email',
    // ── Group 2: Personal-data consent + VPBank confirmation ─────────────
    personal_data_consents: 'Đồng ý xử lý DLCN',
    vpbank_signature_confirmation: 'Xác nhận chữ ký VPBank',
    // ── Group 3: Signatures — Group 1 (VI) ───────────────────────────────
    legal_representatives: 'Người đại diện hợp pháp (VI.1)',
    authorized_representatives: 'Đại diện theo ủy quyền / Người được ủy quyền sử dụng TKTT (VI.2)',
    // ── Group 4: Signatures — Group 2 (VII) ──────────────────────────────
    chief_accountants: 'Kế toán trưởng / Phụ trách kế toán (VII.1)',
    authorized_by_chief_accountants: 'Người được KTT / PTKT ủy quyền (VII.2)',
    // Fixed
    title: 'Loại tài liệu',
  },
  // ── MB03 — GIẤY ĐỀ NGHỊ CẬP NHẬT THÔNG TIN VÀ DỊCH VỤ ─────────────────
  // Multi-call schema, 6 groups. Every checkbox field returns a string[]
  // of ticked-option labels (see extract-schemas.ts MB03 header comment).
  MB03: {
    // ── Group 1: Section 1 top-level service-selection tick groups ───────
    requested_services_org_info_changes: 'Nhóm dịch vụ: Thay đổi thông tin tổ chức',
    requested_services_accounts: 'Nhóm dịch vụ: TK thanh toán & dịch vụ TK',
    requested_services_personal_info: 'Nhóm dịch vụ: Thay đổi thông tin cá nhân',
    requested_services_kyc_online: 'Nhóm dịch vụ: Gói sản phẩm KYC Online',
    requested_services_online_banking: 'Nhóm dịch vụ: DV Ngân hàng trực tuyến',
    requested_services_debit_card: 'Nhóm dịch vụ: Dịch vụ Thẻ ghi nợ',
    requested_services_email: 'Nhóm dịch vụ: Dịch vụ Email',
    requested_services_fax: 'Nhóm dịch vụ: Dịch vụ Fax',
    // ── Group 1: Section 2 organization info updates ─────────────────────
    org_name_new_vi: 'Tên tổ chức mới (tiếng Việt)',
    org_name_new_foreign: 'Tên tổ chức mới (tiếng nước ngoài)',
    org_name_new_abbr: 'Tên viết tắt mới',
    head_office_address_new: 'Địa chỉ trụ sở chính mới',
    transaction_address_new: 'Địa chỉ giao dịch mới',
    transaction_address_new_street: 'Địa chỉ giao dịch mới — Số nhà / Tầng / Tòa nhà, tên đường',
    transaction_address_new_ward: 'Địa chỉ giao dịch mới — Phường/Xã/Thị trấn',
    transaction_address_new_district: 'Địa chỉ giao dịch mới — Quận/Huyện',
    transaction_address_new_province: 'Địa chỉ giao dịch mới — Tỉnh/Thành phố',
    phone_new: 'Số điện thoại mới',
    email_new: 'Email mới',
    seal_change_note: 'Ghi chú thay đổi mẫu dấu',
    org_other_changes_note: 'Nội dung thay đổi khác (tổ chức)',
    // ── Group 2: Section 3.I Mở thêm TKTT ────────────────────────────────
    new_tktt_accounts: 'Mở TKTT — Danh sách tài khoản',
    // ── Group 2: Section 3.II Gói QLDT ───────────────────────────────────
    qldt_actions: 'QLDT SME — Loại yêu cầu',
    qldt_new_package: 'QLDT SME — Gói đăng ký mới',
    qldt_current_package: 'QLDT SME — Gói hiện tại',
    qldt_target_package: 'QLDT SME — Gói mới (chuyển đổi)',
    qldt_cancel_package: 'QLDT SME — Gói hủy',
    qldt_fee_account: 'QLDT SME — Số TK thu phí',
    // ── Group 2: Section 3.III Phong tỏa TKTT ────────────────────────────
    block_account_no: 'Phong tỏa TKTT — Số TK',
    block_amount_number: 'Phong tỏa TKTT — Số tiền (số)',
    block_amount_text: 'Phong tỏa TKTT — Số tiền (bằng chữ)',
    block_reason: 'Phong tỏa TKTT — Lý do',
    block_payment_instruction: 'Phong tỏa TKTT — Chỉ dẫn thanh toán',
    block_duration_options: 'Phong tỏa TKTT — Thời hạn (tick)',
    block_duration_from: 'Phong tỏa TKTT — Từ ngày',
    block_duration_to: 'Phong tỏa TKTT — Đến ngày',
    // ── Group 2: Section 3.IV Chấm dứt phong tỏa ─────────────────────────
    unblock_account_no: 'Chấm dứt phong tỏa — Số TK',
    unblock_amount_number: 'Chấm dứt phong tỏa — Số tiền (số)',
    unblock_amount_text: 'Chấm dứt phong tỏa — Số tiền (bằng chữ)',
    unblock_reason: 'Chấm dứt phong tỏa — Lý do',
    // ── Group 2: Section 3.V Sổ phụ / HĐĐT (6 sub-fields) ────────────────
    statement_action: 'Sổ phụ — Loại yêu cầu',
    statement_frequency: 'Sổ phụ — Tần suất',
    statement_delivery_methods: 'Sổ phụ — Hình thức nhận',
    einvoice_action: 'HĐĐT — Loại yêu cầu',
    einvoice_delivery_methods: 'HĐĐT — Hình thức nhận',
    einvoice_email: 'HĐĐT — Email nhận',
    // ── Group 2: Section 3.VI Giao nhận hồ sơ ────────────────────────────
    document_handover_action: 'Giao nhận hồ sơ — Loại yêu cầu',
    // ── Group 2: Section 3.VII SMS Banking ───────────────────────────────
    sms_banking_account_no: 'SMS Banking — Số TK',
    sms_banking_phone: 'SMS Banking — SĐT nhận biến động',
    sms_banking_action: 'SMS Banking — Loại yêu cầu',
    // ── Group 2: Section 3.VIII Đóng TKTT ────────────────────────────────
    close_tktt_account_nos: 'Đóng TKTT — Danh sách số TK',
    // ── Group 2: KYC + Email + Fax + consent ─────────────────────────────
    kyc_online_upgrade: 'Gói KYC Online — Yêu cầu',
    email_service_action: 'Dịch vụ Email — Loại yêu cầu',
    email_service_address: 'Dịch vụ Email — Địa chỉ Email',
    fax_service_action: 'Dịch vụ Fax — Loại yêu cầu',
    fax_service_number: 'Dịch vụ Fax — Số Fax',
    personal_data_consents: 'Đồng ý xử lý DLCN',
    vpbank_signature_confirmation: 'Xác nhận chữ ký VPBank',
    // ── Group 3: Section 4.I / II / III people lists ─────────────────────
    legal_representatives: 'Đại diện theo pháp luật (Section 4.I)',
    authorized_representatives: 'ĐD hợp pháp — Ủy quyền (Section 4.II)',
    authorized_account_users: 'Người UQ sử dụng TK (Section 4.III)',
    // ── Group 4: Section 4.IV / V people lists ───────────────────────────
    chief_accountants: 'Kế toán trưởng / PTKT (Section 4.IV)',
    authorized_by_chief_accountants: 'Ủy quyền KTT / PTKT (Section 4.V)',
    // ── Group 5: Section 5 online banking service fields ─────────────────
    online_banking_actions: 'NHTT — Loại yêu cầu chung',
    online_banking_account_choice: 'NHTT — Tài khoản đăng ký',
    online_banking_account_other: 'NHTT — TK khác',
    online_banking_fee_account_no: 'NHTT — Số TK thu phí',
    online_banking_daily_limit_choice: 'NHTT — Hạn mức giao dịch',
    online_banking_daily_limit_details: 'NHTT — Chi tiết hạn mức',
    online_banking_approval_mechanism: 'NHTT — Cơ chế phê duyệt',
    online_banking_approval_details: 'NHTT — Chi tiết cơ chế phê duyệt',
    // ── Group 5: Section 5 user lists ────────────────────────────────────
    online_banking_existing_users: 'NHTT — V.1 Người dùng đã có TT',
    online_banking_new_users: 'NHTT — V.2 Người dùng chưa có TT',
    // ── Group 6: Section 6 debit card service fields ─────────────────────
    debit_card_account_choice: 'Thẻ ghi nợ — Tài khoản gắn thẻ',
    debit_card_account_other: 'Thẻ ghi nợ — TK khác',
    debit_card_type: 'Thẻ ghi nợ — Loại thẻ',
    debit_card_type_other: 'Thẻ ghi nợ — Loại thẻ khác',
    debit_card_embossed_name: 'Thẻ ghi nợ — Tên in nổi (service-level)',
    debit_card_delivery_method: 'Thẻ ghi nợ — Hình thức nhận Thẻ & PIN',
    debit_card_delivery_address: 'Thẻ ghi nợ — Địa chỉ nhận',
    debit_card_receiver_name: 'Thẻ ghi nợ — Người nhận (nếu có)',
    debit_card_supplementary_condition: 'Thẻ phụ — Điều kiện mở',
    debit_card_supplementary_open_together_note: 'Thẻ phụ — Ghi chú "Đồng thời cùng thẻ chính"',
    debit_card_supplementary_main_card_no: 'Thẻ phụ — Số thẻ chính đã có',
    debit_card_supplementary_main_card_embossed_name: 'Thẻ phụ — Tên in nổi trên thẻ chính đã có',
    // ── Group 6: Section 6 cardholder lists ──────────────────────────────
    debit_card_main_holders: 'Thẻ ghi nợ — Người sử dụng thẻ chính (I.6)',
    debit_card_supplementary_holders: 'Thẻ ghi nợ — Chủ thẻ phụ (II.1 và tiếp theo)',
    // Fixed
    title: 'Loại tài liệu',
  },
  // ── MB04 — GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ VÀ SỬ DỤNG TKTT CHUNG ────────
  // Joint payment account (2 holders). Every top-level key that varies by
  // holder side carries a `_ctk1` / `_ctk2` suffix; per-record sub-keys are
  // side-agnostic (see RECORD_LABELS below).
  MB04: {
    // ── Group 1 + 2: Organization info for both CTK sides ────────────────
    ...buildMb04OrgLabelRow('ctk1', 'Chủ Tài Khoản Thứ Nhất'),
    ...buildMb04OrgLabelRow('ctk2', 'Chủ Tài Khoản Thứ Hai'),
    // ── Group 3: Section IV joint services ───────────────────────────────
    joint_tktt_currencies: 'TKTT chung — Loại tiền',
    joint_tktt_currency_other: 'TKTT chung — Loại tiền khác',
    joint_tktt_beautiful_number: 'TKTT chung — Tài khoản số đẹp',
    joint_tktt_account_no: 'TKTT chung — Số tài khoản',
    statement_frequency: 'Sổ phụ / HĐĐT — Tần suất',
    statement_delivery_methods: 'Sổ phụ / HĐĐT — Hình thức nhận',
    statement_delivery_email_or_address: 'Sổ phụ / HĐĐT — Email / Địa chỉ nhận',
    sms_banking_phones: 'SMS Banking — Danh sách số điện thoại',
    // ── Group 4 + 5: People lists per CTK side ───────────────────────────
    ...MB04_PEOPLE_LABELS_CTK1,
    ...MB04_PEOPLE_LABELS_CTK2,
    // ── Group 6: Seals + handover + DLCN consent ─────────────────────────
    seal_registration_options: 'Mẫu dấu — Đăng ký',
    seal_other_principle: 'Mẫu dấu — Nguyên tắc khác',
    seal_image_note: 'Mẫu dấu — Ghi chú vùng đóng dấu',
    document_handover_note: 'Giao nhận hồ sơ — Ghi chú',
    personal_data_consents: 'Đồng ý xử lý DLCN',
    vpbank_signature_confirmation: 'Xác nhận chữ ký VPBank',
    // Fixed
    title: 'Loại tài liệu',
  },
  van_ban_uy_quyen: {
    // Grantor block
    grantor_full_name: 'Bên ủy quyền — Họ và tên',
    grantor_id_no: 'Bên ủy quyền — Số giấy tờ tùy thân',
    grantor_id_issue_date: 'Bên ủy quyền — Ngày cấp',
    grantor_position: 'Bên ủy quyền — Chức vụ',
    grantor_account_holder_name: 'Chủ tài khoản — Tên',
    grantor_head_office_address: 'Chủ tài khoản — Địa chỉ trụ sở',
    grantor_enterprise_code: 'Chủ tài khoản — Mã số doanh nghiệp',
    grantor_enterprise_issued_by: 'Chủ tài khoản — Nơi cấp MSDN',
    grantor_enterprise_issue_date: 'Chủ tài khoản — Ngày cấp MSDN',
    grantor_phone: 'Chủ tài khoản — Điện thoại',
    grantor_email: 'Chủ tài khoản — Email',
    // Delegate block
    delegate_full_name: 'Bên được ủy quyền — Họ và tên',
    delegate_id_no: 'Bên được ủy quyền — Số giấy tờ tùy thân',
    delegate_id_issue_date: 'Bên được ủy quyền — Ngày cấp',
    delegate_position: 'Bên được ủy quyền — Chức vụ',
    delegate_additional_info: 'Bên được ủy quyền — Thông tin bổ sung',
    // Fixed
    title: 'Loại tài liệu',
  },
  // ── VNeID (Định danh điện tử mức 2) ─────────────────────────────────────
  vneid: {
    full_name: 'Họ và tên',
    phone: 'Số điện thoại',
    id_no: 'Số định danh cá nhân',
    place_of_residence: 'Địa chỉ thường trú',
    nationality: 'Quốc tịch',
    date_of_expiry: 'Ngày hết hạn',
    date_of_issue: 'Ngày cấp',
    place_of_issue: 'Cơ quan cấp',
    date_of_birth: 'Ngày sinh',
    sex: 'Giới tính',
    title: 'Loại tài liệu',
  },
  // ── QĐ bổ nhiệm KTT/PTKT ────────────────────────────────────────────────
  quyet_dinh_bo_nhiem_ktt: {
    company_name: 'Tên công ty',
    business_type: 'Loại hình công ty',
    full_name: 'Họ và tên',
    id_no: 'Số GTTT',
    date_of_birth: 'Ngày sinh',
    position: 'Chức vụ',
    signer_department: 'Chức danh và con dấu',
    title: 'Loại tài liệu',
  },
  // ── Check webca ──────────────────────────────────────────────────────────
  webca: {
    entries: 'Danh sách người ký',
    title: 'Loại tài liệu',
  },
  // ── Phiếu thu phí dịch vụ ───────────────────────────────────────────────
  phieu_thu_phi: {
    full_name: 'Tên khách hàng',
    amount: 'Số tiền',
    company_name: 'Tên công ty (từ nội dung)',
    title: 'Loại tài liệu',
  },
  // ── Đăng ký kinh doanh ───────────────────────────────────────────────────
  dang_ky_kinh_doanh: {
    // Issuing authority
    issuing_authority: 'Cơ quan cấp',
    business_type: 'Loại hình doanh nghiệp',
    registration_no: 'Mã số doanh nghiệp / Mã số hộ kinh doanh',
    initial_registration: 'Đăng ký kinh doanh lần đầu',
    change_registration_no: 'Đăng ký thay đổi lần thứ',
    change_date: 'Ngày thay đổi',
    company_name_vi: 'Tên công ty (tiếng Việt)',
    company_name_foreign: 'Tên công ty (tiếng nước ngoài)',
    company_name_abbr: 'Tên công ty viết tắt',
    // Registered address
    registered_address: 'Địa chỉ trụ sở chính',
    registered_address_street: 'Trụ sở — Số nhà / Tầng / Tòa nhà, tên đường',
    registered_address_ward: 'Trụ sở — Phường/Xã/Thị trấn/Thị xã',
    registered_address_district: 'Trụ sở — Quận/Huyện',
    registered_address_province: 'Trụ sở — Tỉnh/Thành phố/Đặc khu',
    // Repeating lists
    legal_representatives: 'Người đại diện pháp luật',
    shareholders: 'Danh sách thành viên góp vốn',
    owner: 'Thông tin chủ sở hữu',
    // Charter capital
    charter_capital: 'Vốn điều lệ',
    // Signer
    signer_name: 'Tên người ký',
    signer_department: 'Phòng ban ký số',
    // Fixed
    title: 'Loại tài liệu',
  },
};

/**
 * Sub-record labels for repeating-list fields, keyed by the parent field's
 * name (e.g. "legal_representatives"). Not scoped by document code — a parent
 * field name is expected to mean the same thing wherever it appears. Add a
 * per-code layer here if that assumption ever breaks.
 *
 * NOTE: `legal_representatives` is a superset covering both MB01 (visa sub-keys,
 * occupation) and DKKD (ethnicity, permanent_address). Extra keys are simply
 * ignored when rendering a record that doesn't have them.
 */
const RECORD_LABELS: Record<string, Record<string, string>> = {
  // MB01 legal reps + DKKD legal reps + MB02 legal reps (VI.1) + MB03 legal
  // reps (Section 4.I) — superset. The union covers four docs with disjoint
  // extra sub-keys; the renderer simply ignores keys a given record doesn't
  // have.
  legal_representatives: {
    ...PERSON_RECORD_LABELS,
    // MB01-specific
    visa_no: 'Số thị thực',
    visa_place_of_issue: 'Nơi cấp thị thực',
    visa_expiry_date: 'Ngày hết hạn thị thực',
    // DKKD-specific
    ethnicity: 'Dân tộc',
    permanent_address: 'Địa chỉ thường trú',
    permanent_address_street: 'Địa chỉ thường trú — Số nhà, tên đường',
    permanent_address_ward: 'Địa chỉ thường trú — Phường/Xã/Thị trấn',
    permanent_address_district: 'Địa chỉ thường trú — Quận/Huyện',
    permanent_address_province: 'Địa chỉ thường trú — Tỉnh/Thành phố',
    contact_address: 'Địa chỉ liên lạc',
    contact_address_street: 'Địa chỉ liên lạc — Số nhà, tên đường',
    contact_address_ward: 'Địa chỉ liên lạc — Phường/Xã/Thị trấn',
    contact_address_district: 'Địa chỉ liên lạc — Quận/Huyện',
    contact_address_province: 'Địa chỉ liên lạc — Tỉnh/Thành phố',
    id_document_type: 'Loại giấy tờ pháp lý',
    id_no: 'Số giấy tờ pháp lý',
    // MB02-specific — person extras + online-banking + debit-card sub-blocks
    ...MB02_PERSON_EXTRA_LABELS,
    ...MB02_ONLINE_BANKING_SUB_LABELS,
    ...MB02_DEBIT_CARD_SUB_LABELS,
    // MB03-specific — role tick fields (Section 4.I)
    ...MB03_SECTION4_ROLE_LABELS,
  },
  // MB02 authorized reps (VI.2) — sub-key record labels for the object[] field.
  // MB03 authorized reps (Section 4.II) returns raw text — no sub-keys needed.
  // The MB03_SECTION4_ROLE_LABELS spread below is MB02-only (action_type is a
  // sub-key on the MB02 VI.2 person block).
  authorized_representatives: {
    ...PERSON_RECORD_LABELS,
    visa_no: 'Số thị thực',
    visa_place_of_issue: 'Nơi cấp thị thực',
    visa_expiry_date: 'Ngày hết hạn thị thực',
    ...MB02_PERSON_EXTRA_LABELS,
    ...MB02_ONLINE_BANKING_SUB_LABELS,
    ...MB02_DEBIT_CARD_SUB_LABELS,
    ...MB02_AUTHORIZATION_SUB_LABELS,
  },
  // MB03-only — Section 4.III "Người UQ sử dụng TK" people list. Returns raw
  // text — no sub-key record labels needed.
  authorized_account_users: {},
  // MB01 chief accountants + MB02 chief accountants (VII.1) + MB03 CAs
  // (Section 4.IV). MB02 CAs do NOT register online banking on this form —
  // the online-banking sub-block is intentionally omitted here.
  chief_accountants: {
    ...PERSON_RECORD_LABELS,
    visa_no: 'Số thị thực',
    visa_place_of_issue: 'Nơi cấp thị thực',
    visa_expiry_date: 'Ngày hết hạn thị thực',
    ...MB02_PERSON_EXTRA_LABELS,
    ...MB02_DEBIT_CARD_SUB_LABELS,
    ...MB03_SECTION4_ROLE_LABELS,
  },
  // MB02 authorized by CA (VII.2) — sub-key record labels for the object[] field.
  // MB03 authorized by CA (Section 4.V) returns raw text — no sub-keys needed.
  authorized_by_chief_accountants: {
    ...PERSON_RECORD_LABELS,
    visa_no: 'Số thị thực',
    visa_place_of_issue: 'Nơi cấp thị thực',
    visa_expiry_date: 'Ngày hết hạn thị thực',
    ...MB02_PERSON_EXTRA_LABELS,
    ...MB02_DEBIT_CARD_SUB_LABELS,
    ...MB02_AUTHORIZATION_SUB_LABELS,
  },
  // MB03 online-banking users (Section 5.V.1 + 5.V.2) and debit-card holders
  // (Section 6.I.6 + Section 6.II). Each has its own sub-key composition,
  // pre-composed in the label maps above.
  online_banking_existing_users: {
    ...MB03_ONLINE_BANKING_EXISTING_USER_LABELS,
  },
  online_banking_new_users: {
    ...MB03_ONLINE_BANKING_NEW_USER_LABELS,
  },
  // MB02 + MB03 Section III.1 / Section 3.I — each element is one TKTT row.
  tktt_accounts: {
    account_type:         'Loại tài khoản',
    currencies:           'Loại tiền',
    other_currency:       'Tiền khác',
    quantity:             'Số lượng',
    beautiful_account_no: 'Tài khoản số đẹp — Số tài khoản',
    beautiful_fee:        'Tài khoản số đẹp — Phí (chưa VAT)',
  },
  // MB03 Section 3.I — same shape, separate key for MB03-specific label.
  new_tktt_accounts: {
    account_type:         'Loại tài khoản',
    currencies:           'Loại tiền',
    quantity:             'Số lượng',
    beautiful_account_no: 'Tài khoản số đẹp — Số tài khoản',
    beautiful_fee:        'Tài khoản số đẹp — Phí (chưa VAT)',
  },
  debit_card_main_holders: {
    ...MB03_CARDHOLDER_LABELS,
  },
  debit_card_supplementary_holders: {
    ...MB03_CARDHOLDER_LABELS,
  },
  // ── MB04 people-list record labels — 8 parent keys (4 lists × 2 CTK sides) ──
  // MB04 uses side-suffixed parent keys so each list gets its own entry in
  // RECORD_LABELS. All four role compositions are side-agnostic (a legal rep
  // looks the same whether they belong to CTK1 or CTK2) — the same MB04_*
  // record-label maps are reused across sides.
  legal_representatives_ctk1: { ...MB04_LEGAL_REP_LABELS },
  legal_representatives_ctk2: { ...MB04_LEGAL_REP_LABELS },
  authorized_representatives_ctk1: { ...MB04_AUTH_REP_LABELS },
  authorized_representatives_ctk2: { ...MB04_AUTH_REP_LABELS },
  chief_accountants_ctk1: { ...MB04_CHIEF_ACCOUNTANT_LABELS },
  chief_accountants_ctk2: { ...MB04_CHIEF_ACCOUNTANT_LABELS },
  authorized_by_chief_accountants_ctk1: { ...MB04_AUTH_CHIEF_ACCOUNTANT_LABELS },
  authorized_by_chief_accountants_ctk2: { ...MB04_AUTH_CHIEF_ACCOUNTANT_LABELS },
  // DKKD — capital contributors (Công ty TNHH 2TV / hợp danh)
  shareholders: {
    full_name: 'Tên thành viên',
    nationality: 'Quốc tịch',
    contact_address: 'Địa chỉ liên lạc / Địa chỉ trụ sở chính',
    contact_address_street: 'Địa chỉ liên lạc — Số nhà, tên đường',
    contact_address_ward: 'Địa chỉ liên lạc — Phường/Xã/Thị trấn',
    contact_address_district: 'Địa chỉ liên lạc — Quận/Huyện',
    contact_address_province: 'Địa chỉ liên lạc — Tỉnh/Thành phố',
    capital_contribution: 'Phần vốn góp',
    ownership_ratio: 'Tỷ lệ (%)',
    id_or_registration_no: 'Số GTPL cá nhân / Mã số DN / Số GCNĐKDN',
    note: 'Ghi chú',
  },
  // DKKD — single owner block (Công ty TNHH MTV) — stored as object, not array,
  // but reusing RECORD_LABELS allows the same getRecordLabel helper to work.
  owner: {
    full_name: 'Họ và tên',
    date_of_birth: 'Sinh ngày',
    sex: 'Giới tính',
    nationality: 'Quốc tịch',
    id_document_type: 'Loại giấy tờ pháp lý',
    id_no: 'Số giấy tờ pháp lý',
    date_of_issue: 'Ngày cấp',
    place_of_issue: 'Nơi cấp',
    permanent_address: 'Địa chỉ thường trú',
    permanent_address_street: 'Địa chỉ thường trú — Số nhà, tên đường',
    permanent_address_ward: 'Địa chỉ thường trú — Phường/Xã/Thị trấn',
    permanent_address_district: 'Địa chỉ thường trú — Quận/Huyện',
    permanent_address_province: 'Địa chỉ thường trú — Tỉnh/Thành phố',
    contact_address: 'Địa chỉ liên lạc',
    contact_address_street: 'Địa chỉ liên lạc — Số nhà, tên đường',
    contact_address_ward: 'Địa chỉ liên lạc — Phường/Xã/Thị trấn',
    contact_address_district: 'Địa chỉ liên lạc — Quận/Huyện',
    contact_address_province: 'Địa chỉ liên lạc — Tỉnh/Thành phố',
  },
  // WebCA — signer rows inside the `entries` array
  entries: {
    full_name: 'Tên',
    signer_department: 'Phòng ban',
    status: 'Trạng thái',
    signature: 'Chữ ký',
  },
  // MB02 — US controlling persons table under FATCA section I.3.2
  fatca_us_controlling_persons: {
    sequence_no: 'STT',
    full_name: 'Họ và tên',
    address: 'Địa chỉ',
    us_tin: 'Mã số thuế Hoa Kỳ (TIN)',
  },
};

/**
 * Resolve the display label for a top-level field key. Falls back to the raw
 * key when either the doc code or the key is unmapped, so the UI never blanks
 * out for unknown data.
 */
export function getFieldLabel(docCode: string | undefined, key: string): string {
  if (!docCode) return key;
  return FIELD_LABELS[docCode]?.[key] ?? key;
}

/**
 * Resolve the display label for a sub-key inside a repeating-list record.
 * Falls back to the raw sub-key when unmapped.
 */
export function getRecordLabel(parentKey: string, key: string): string {
  return RECORD_LABELS[parentKey]?.[key] ?? key;
}

// ─── Form templates (mẫu biểu) ──────────────────────────────────────────────

/**
 * VPBank application forms — the "mẫu biểu" a dossier is built around.
 *
 * These are listed explicitly rather than matched on an `MB` name prefix, because
 * the property that matters is structural, not nominal: MB02/MB03/MB04 are
 * declared as `MultiCallExtractSchema` in extract-schemas.ts — multi-group forms
 * carrying ~200 potential sub-fields plus 10 repeating people lists each, which
 * need full page width to stay readable. An identity document is a handful of
 * flat fields and reads fine at half width.
 *
 * MB01 is included even though its schema is single-call: it is a form the same
 * way the others are, and a "Mẫu biểu" group that silently omitted one of the
 * four MB documents would read as a bug to a reviewer.
 *
 * The UI keeps its own copy (rather than importing the schemas) for the same
 * reason field-labels does — no server-only code chained into the client bundle.
 */
const FORM_TEMPLATE_CODES = new Set(['MB01', 'MB02', 'MB03', 'MB04']);

/**
 * True when a classification code is a VPBank application form. Drives the
 * full-width "Mẫu biểu" section in the result grid.
 */
export function isFormTemplate(code: string | undefined | null): boolean {
  return code != null && FORM_TEMPLATE_CODES.has(code);
}

// ─── List field kinds ───────────────────────────────────────────────────────

/**
 * How a list-valued field should be presented. A list is not automatically a set
 * of checkbox ticks — the three kinds carry different claims about the data, and
 * showing one as another asserts something untrue:
 *
 *  - 'ticks'    Options ticked on the form. An unordered SET, so numbering it
 *               would invent a sequence, and `[]` means "nothing ticked" rather
 *               than "no data". MB03's convention is that EVERY checkbox field
 *               returns an array of the ticked labels (see extract-schemas.ts
 *               "Convention baked into MB03").
 *  - 'ordered'  Position carries real meaning — sms_banking_phones is read from
 *               the "ĐTDĐ 1/2/3" rows in reading order. Numbered.
 *  - 'items'    A plain collection: documents attached, account numbers, free-text
 *               detail lines. Order is incidental and nothing was ticked, so it
 *               gets neither numbers nor tick marks — just a bulleted list.
 *
 * 'items' is the DEFAULT for anything unrecognized. That matters: an unknown list
 * shown as ticks would claim a checkbox was marked, and shown as ordered would
 * claim a sequence. A neutral bulleted list claims neither, so a schema field
 * added later renders honestly with no edit here.
 *
 * Keys match across doc codes — the same key means the same thing in every schema
 * that declares it (sms_banking_phones appears in both MB02 and MB03).
 */
export type ListFieldKind = 'ticks' | 'ordered' | 'items';

/** Position carries meaning → numbered. */
const ORDERED_LIST_KEYS = new Set([
  'registered_phone_numbers',           // tra cứu 1414 — one element per number
  'sms_banking_phones',                 // "ĐTDĐ 1/2/3" rows, in reading order
]);

/** Plain collections — neither ticked nor ordered. */
const ITEM_LIST_KEYS = new Set([
  'close_tktt_account_nos',             // account numbers to close
  'online_banking_approval_details',    // free-text detail lines
  'online_banking_daily_limit_details', // free-text detail lines
]);

/**
 * Tick groups, listed explicitly rather than inferred as "everything else". An
 * empty tick group arrives as bare `null` — indistinguishable from any other
 * absent field — so the renderer needs a POSITIVE signal before it says "nothing
 * was ticked", or that message would land on every unmapped null field.
 */
const TICK_GROUP_KEYS = new Set([
  'relationship_purpose',
  'registered_services',
  'statement_delivery_methods',
  'einvoice_delivery_methods',
  'joint_tktt_currencies',
  'joint_tktt_beautiful_number',
  'block_duration_options',
  'seal_registration_options',
  'statement_frequency',
  'debit_card_type',
  'debit_card_delivery_method',
  'debit_card_supplementary_condition',
  'kyc_online_upgrade',
  'vpbank_signature_confirmation',
  'personal_data_consents',
  'online_banking_approval_mechanism',
]);

/**
 * Stems marking a checkbox field by MB03's own naming convention, so new tick
 * groups are picked up without editing the list above. Deliberately narrow —
 * a stem that could match a non-checkbox field would mislabel it as ticked.
 */
const TICK_GROUP_SUFFIXES = [
  '_choice',
  '_action',
  '_actions',
  '_options',
  '_consents',
  '_mechanism',
];

/**
 * Classify a list-valued field. Explicit keys win, then MB03's tick-field naming
 * convention, then the neutral 'items' default (see ListFieldKind on why the
 * fallback must be the neutral one).
 */
export function getListFieldKind(key: string): ListFieldKind {
  if (ORDERED_LIST_KEYS.has(key)) return 'ordered';
  if (ITEM_LIST_KEYS.has(key)) return 'items';
  if (TICK_GROUP_KEYS.has(key)) return 'ticks';
  if (key.startsWith('requested_services_')) return 'ticks';
  if (TICK_GROUP_SUFFIXES.some((s) => key.endsWith(s))) return 'ticks';
  return 'items';
}
