// lib/pipelines/workflows/payment-account-management/shared/extract-schemas.ts
// Extraction schemas for payment-account-management document types, keyed by `code`.
// Shared across modes (open / update / ...) — extraction uses the same schemas.
//
// Each entry uses the shared ExtractSchema shape:
//   - aiFields:    fields the AI reads from the document
//   - fixedFields: fields the code fills with a constant (not read from the file)
//
// Every field carries three orthogonal pieces of information:
//   - `desc`:  AI-prompt copy — what to look for in the document
//   - `label`: Vietnamese UI copy — what a reviewer sees in the results card
//   - `recordLabels` (only on repeating-list fields): sub-key labels for each
//     record inside the array
//
// Add one entry per document code as we support more document types.
//
// Large forms (MB02 in particular) use MultiCallExtractSchema instead — the
// same registry accepts either shape via AnyExtractSchema. Multi-call schemas
// split their fields into named groups; see mb02.md and MB02_SCHEMA below.

import type {
  ExtractSchema,
  ExtractSchemaGroup,
  ExtractSchemaRegistry,
  MultiCallExtractSchema,
} from './schemas';
import { validateGroupKeyUniqueness } from './schemas';
import { removeVietnameseDiacritics } from './utils';

// Standard issuing-authority line printed on a Căn cước công dân card.
// Stored with real Vietnamese diacritics for readability, then normalized to
// plain ASCII at load time (the business requires the value without accents).
const CCCD_ISSUING_AUTHORITY = removeVietnameseDiacritics(
  'CỤC TRƯỞNG CỤC CẢNH SÁT QUẢN LÝ HÀNH CHÍNH VỀ TRẬT TỰ XÃ HỘI',
);

// ── Shared address street-level desc ────────────────────────────────────────
// Used on every *_street field across all schemas.
//
// Rule: capture EVERYTHING in the address that comes BEFORE the ward/commune
// (Phường/Xã/Thị trấn), concatenated in printed order as one string — regardless
// of how many sub-parts are present (room, floor, building, lot, house number,
// road, industrial zone, alley, etc.).
const STREET_LEVEL_DESC =
  'Street-level component of the address — everything that appears BEFORE the ' +
  'ward/commune (Phường/Xã/Thị trấn), concatenated in printed order into one string. ' +
  'Include every sub-part present before the ward; stop at the ward/commune. ' +
  'Return exactly as printed; null if not identifiable.';

// Administrative-level desc constants — LLM must return the full name
// including the administrative prefix (e.g. "Phường Bến Thủy", not "Bến Thủy").
const WARD_LEVEL_DESC =
  'Ward / commune / township of the address — the "Phường/Xã/Thị trấn" component. ' +
  'Return the FULL name including the administrative prefix ' +
  '(e.g. "Phường Bến Thủy", "Xã Ea Tân", "Thị trấn Cầu Giát"). ' +
  'null if not identifiable.';

const DISTRICT_LEVEL_DESC =
  'District / county of the address — the "Quận/Huyện/Thị xã" component. ' +
  'Return the FULL name including the administrative prefix ' +
  '(e.g. "Quận Hồng Bàng", "Huyện Nghĩa Đàn", "Thị xã Thái Hòa"). ' +
  'null if not identifiable.';

const PROVINCE_LEVEL_DESC =
  'Province / municipality of the address — the "Tỉnh/Thành phố" component. ' +
  'Return the FULL name including the administrative prefix ' +
  '(e.g. "Thành phố Hà Nội", "Tỉnh Nghệ An"). ' +
  'null if not identifiable.';

// ── Shared sub-record label maps ────────────────────────────────────────────
// MB01 has two repeating people lists (legal representatives and chief
// accountants). Most sub-keys are identical between them, so we share one map
// and let each list override where it differs (legal reps also carry visa info).
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

/** Schema for "Căn cước công dân" (Citizen Identity Card). */
const CITIZEN_IDENTITY_CARD_SCHEMA: ExtractSchema = {
  aiFields: [
    { key: 'id_no', label: 'Số CCCD', desc: 'Personal identification number / CCCD number (labeled "Số / No." — a 12-digit number, printed on the front)' },
    { key: 'full_name', label: 'Họ và tên', desc: 'Full name, kept exactly as printed on the document (labeled "Họ và tên / Full name")' },
    { key: 'date_of_birth', label: 'Ngày sinh', desc: 'Date of birth (labeled "Ngày, tháng, năm sinh / Date of birth"). Return in DD/MM/YYYY format.' },
    { key: 'sex', label: 'Giới tính', enum: ['Nam', 'Nữ'], desc: 'Sex (labeled "Giới tính / Sex")' },
    { key: 'nationality', label: 'Quốc tịch', desc: 'Nationality (labeled "Quốc tịch / Nationality")' },
    { key: 'place_of_residence', label: 'Nơi thường trú', desc: 'Place of permanent residence (labeled "Nơi thường trú / Place of residence" or "Nơi cư trú")' },
    { key: 'date_of_expiry', label: 'Có giá trị đến', desc: 'Date of expiry / valid until (labeled "Có giá trị đến / Date of expiry"). Return in DD/MM/YYYY format.' },
    { key: 'date_of_issue', label: 'Ngày cấp', desc: 'Date of issue (printed on the back near the signature/seal, often as "..., ngày ... tháng ... năm ..." above "CỤC TRƯỞNG CỤC CẢNH SÁT QUẢN LÝ HÀNH CHÍNH VỀ TRẬT TỰ XÃ HỘI"). Return in DD/MM/YYYY format.' },
  ],
  fixedFields: [
    // Fixed values — not read from the document.
    { key: 'title', label: 'Loại tài liệu', value: 'CĂN CƯỚC CÔNG DÂN' },
    { key: 'place_of_issue', label: 'Nơi cấp', value: CCCD_ISSUING_AUTHORITY },
  ],
};

/** Schema for "Căn cước" (Identity Card — new form from 07/2024). */
const IDENTITY_CARD_SCHEMA: ExtractSchema = {
  aiFields: [
    { key: 'id_no', label: 'Số định danh cá nhân', desc: 'Personal identification number (labeled "Số định danh cá nhân / Personal identification number" or "Số / No." — a 12-digit number on the front)' },
    { key: 'full_name', label: 'Họ và tên', desc: 'Full name, kept exactly as printed on the document (labeled "Họ, chữ đệm và tên khai sinh / Full name" or "Họ và tên / Full name")' },
    { key: 'date_of_birth', label: 'Ngày sinh', desc: 'Date of birth (labeled "Ngày, tháng, năm sinh / Date of birth"). Return in DD/MM/YYYY format.' },
    { key: 'sex', label: 'Giới tính', enum: ['Nam', 'Nữ'], desc: 'Sex (labeled "Giới tính / Sex")' },
    { key: 'nationality', label: 'Quốc tịch', desc: 'Nationality (labeled "Quốc tịch / Nationality")' },
    { key: 'place_of_residence', label: 'Nơi thường trú', desc: 'Place of permanent residence (labeled "Nơi thường trú / Place of residence" or "Nơi cư trú")' },
    { key: 'date_of_issue', label: 'Ngày cấp', desc: 'Date of issue (labeled "Ngày, tháng, năm cấp / Date of issue"). Return in DD/MM/YYYY format.' },
    { key: 'date_of_expiry', label: 'Ngày hết hạn', desc: 'Date of expiry (labeled "Ngày, tháng, năm hết hạn / Date of expiry" or "Có giá trị đến / Date of expiry"). Return in DD/MM/YYYY format.' },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'CĂN CƯỚC' },
    { key: 'place_of_issue', label: 'Nơi cấp', value: 'BỘ CÔNG AN' },
  ],
};

/** Schema for "Hộ chiếu" (Passport). */
const PASSPORT_SCHEMA: ExtractSchema = {
  aiFields: [
    { key: 'id_no', label: 'Số hộ chiếu', desc: 'Passport number (labeled "Số hộ chiếu / Passport No." or "Số / No.")' },
    { key: 'full_name', label: 'Họ và tên', desc: 'Full name = surname followed by given name, as printed (labeled "Họ và tên / Full name", or "Họ / Surname" combined with "Tên / Given names")' },
    { key: 'sex', label: 'Giới tính', enum: ['Nam', 'Nữ'], desc: 'Sex (labeled "Giới tính / Sex"); normalize "M" to "Nam" and "F" to "Nữ"' },
    { key: 'date_of_birth', label: 'Ngày sinh', desc: 'Date of birth (labeled "Ngày sinh / Date of birth" or "Sinh ngày"). Return in DD/MM/YYYY format.' },
    { key: 'nationality', label: 'Quốc tịch', desc: 'Nationality (labeled "Quốc tịch / Nationality")' },
    { key: 'date_of_issue', label: 'Ngày cấp', desc: 'Date of issue (labeled "Ngày cấp / Date of issue"). Return in DD/MM/YYYY format.' },
    { key: 'date_of_expiry', label: 'Ngày hết hạn', desc: 'Date of expiry (labeled "Có giá trị đến / Date of expiry" or "Ngày hết hạn"). Return in DD/MM/YYYY format.' },
    { key: 'place_of_issue', label: 'Nơi cấp', desc: 'Issuing authority / place of issue (labeled "Nơi cấp / Place of issue")' },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'PASSPORT' },
  ],
};

/** Schema for "Thị thực" (Visa). */
const VISA_SCHEMA: ExtractSchema = {
  aiFields: [
    { key: 'full_name', label: 'Họ và tên', desc: 'Full name, kept exactly as printed on the document (labeled "Họ và tên / Full name" or "Họ tên")' },
    { key: 'id_no', label: 'Số thị thực', desc: 'Visa number (labeled "Số / No.")' },
    { key: 'valid_from', label: 'Có giá trị từ', desc: 'Good-for-entry validity start date — valid from (labeled "Có giá trị từ / From" or the start date in the "Có giá trị nhập cảnh từ ngày ... đến ngày ..." phrase). Return in DD/MM/YYYY format.' },
    { key: 'valid_to', label: 'Có giá trị đến', desc: 'Good-for-entry validity end date — valid to (labeled "đến / To" or the end date in the "Có giá trị nhập cảnh từ ngày ... đến ngày ..." phrase). Return in DD/MM/YYYY format.' },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'Thị thực' },
  ],
};

/**
 * Schema for "Thẻ tạm trú" (Temporary Residence Card).
 *
 * NOTE: this card has TWO different numbers — keep them distinct:
 *   - id_no       = the card's own number, labeled "Số thẻ/No" (right after the title)
 *   - passport_no = the passport number, labeled "Số/No" (below "Mang hộ chiếu của/Passport for")
 * The descriptions below pin each field to its exact printed label + location so
 * the AI does not swap them.
 */
const TEMPORARY_RESIDENCE_CARD_SCHEMA: ExtractSchema = {
  aiFields: [
    { key: 'full_name', label: 'Họ và tên', desc: 'Full name, kept exactly as printed on the document (labeled "Họ tên / Full name" or "Họ và tên")' },
    { key: 'id_no', label: 'Số thẻ', desc: 'Card number — the value labeled "Số thẻ / No.", shown right after the title' },
    { key: 'passport_no', label: 'Số hộ chiếu', desc: 'Passport number — the value labeled "Số / No." shown below "Mang hộ chiếu của / Passport for"' },
    { key: 'nationality', label: 'Quốc tịch', desc: 'Nationality (labeled "Quốc tịch / Nationality")' },
    { key: 'date_of_issue', label: 'Ngày cấp', desc: 'Date of issue — the value labeled "Ngày cấp / Date of Issue". Return in DD/MM/YYYY format.' },
    { key: 'date_of_expiry', label: 'Thẻ có giá trị đến', desc: 'Date of expiry — the value labeled "Thẻ có giá trị đến / This card is valid until". Return in DD/MM/YYYY format.' },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'Thẻ tạm trú' },
  ],
};

/** Schema for "Cam kết chưa có KTT/PTKT" (commitment: no chief accountant). */
const COMMITMENT_NO_CHIEF_ACCOUNTANT_SCHEMA: ExtractSchema = {
  aiFields: [
    { key: 'commitment_content', label: 'Nội dung cam kết', desc: 'The text in the document that commits/states there is no chief accountant signature ("cam kết chưa có chữ ký của kế toán trưởng"): return the referenced content as written' },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'Cam kết chưa có KTT/PTKT' },
  ],
};

/** Schema for "Biên bản giao nhận" (Handover record). */
const HANDOVER_RECORD_SCHEMA: ExtractSchema = {
  aiFields: [
    // "Bên giao" — full name of the person handing over the dossier.
    { key: 'handover_party_name', label: 'Bên giao - Họ và tên', desc: 'Full name of the person listed under "Bên giao" / "Họ và tên" in the handover record' },
    // Tick-box(es) under "Bên giao" — return the label of EVERY ticked checkbox as an array element.
    { key: 'handover_party_roles', label: 'Bên giao - Vai trò', type: 'string[]', desc: 'Labels of the checkbox(es) that are ticked under "Bên giao" (e.g. "Là đại diện hợp pháp", "Là người giao nhận đã được đăng ký", "Là người giao nhận chưa được đăng ký") — one array element per ticked option; return [] if nothing is ticked' },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'Biên bản giao nhận' },
  ],
};

/** Schema for "Điều lệ" (Charter / internal operating regulation). */
const CHARTER_SCHEMA: ExtractSchema = {
  aiFields: [
    { key: 'company_name', label: 'Tên tổ chức', desc: 'Name of the organization the charter belongs to (typically found in the header near "ĐIỀU LỆ ... CỦA ..." / "ĐIỀU LỆ CÔNG TY ..." / "TÊN CÔNG TY" / "Tên doanh nghiệp", or in Article 1 "Điều 1. Tên công ty / Tên doanh nghiệp")' },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'Điều lệ' },
  ],
};

/**
 * Schema for "VNeID" (Định danh điện tử mức 2 — Level-2 Electronic Identity).
 *
 * Source: ảnh chụp/bản in từ ứng dụng VNeID, phần "Định danh mức 2".
 * Quy tắc trích xuất: trả kết quả tiếng Việt viết hoa không dấu (VIET HOA KHONG DAU).
 * Lấy giá trị sau các tiêu đề tên trường trên form.
 */
const VNEID_SCHEMA: ExtractSchema = {
  aiFields: [
    {
      key: 'full_name',
      label: 'Họ và tên',
      desc: 'Full name of the individual — read from the field labeled "Họ tên" in the "Định danh mức 2" section, taken from the text that appears after that heading. Return in Vietnamese UPPERCASE without diacritics (VIET HOA KHONG DAU).',
    },
    {
      key: 'phone',
      label: 'Số điện thoại',
      desc: 'Mobile phone number — read from the field labeled "Số điện thoại" in the "Định danh mức 2" section. Return the digits exactly as shown (no formatting changes).',
    },
    {
      key: 'id_no',
      label: 'Số định danh cá nhân',
      desc: 'Personal identification number — a 12-digit number read from the field labeled "Số định danh cá nhân" in the "Định danh mức 2" section. Return only the 12 digits, no spaces or hyphens.',
    },
    {
      key: 'place_of_residence',
      label: 'Địa chỉ thường trú',
      desc: 'Permanent residential address — read from the field labeled "Nơi thường trú" or "Địa chỉ thường trú" in the "Định danh mức 2" section. Return in Vietnamese UPPERCASE without diacritics (VIET HOA KHONG DAU).',
    },
    {
      key: 'nationality',
      label: 'Quốc tịch',
      desc: 'Nationality — read from the field labeled "Quốc tịch" in the "Định danh mức 2" section. Return in Vietnamese UPPERCASE without diacritics (VIET HOA KHONG DAU).',
    },
    {
      key: 'date_of_expiry',
      label: 'Ngày hết hạn',
      desc: 'Expiry date of the VNeID credential — read from the field labeled "Ngày hết hạn" or "Có giá trị đến" in the "Định danh mức 2" section. Return in DD/MM/YYYY format.',
    },
    {
      key: 'date_of_issue',
      label: 'Ngày cấp',
      desc: 'Issue date of the VNeID credential — read from the field labeled "Ngày cấp" in the "Định danh mức 2" section. Return in DD/MM/YYYY format.',
    },
    {
      key: 'place_of_issue',
      label: 'Cơ quan cấp',
      desc: 'Issuing authority — read from the field labeled "Cơ quan cấp" or "Nơi cấp" in the "Định danh mức 2" section. Return in Vietnamese UPPERCASE without diacritics (VIET HOA KHONG DAU).',
    },
    {
      key: 'date_of_birth',
      label: 'Ngày sinh',
      desc: 'Date of birth — read from the field labeled "Ngày sinh" in the "Định danh mức 2" section. Return in DD/MM/YYYY format.',
    },
    {
      key: 'sex',
      // VNeID returns UPPERCASE-no-diacritics values, so this enum differs from
      // the "Nam"/"Nữ" used on the ID-card schemas.
      label: 'Giới tính',
      enum: ['NAM', 'NU'],
      desc: 'Gender / sex — read from the field labeled "Giới tính" in the "Định danh mức 2" section. Return in Vietnamese UPPERCASE without diacritics.',
    },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'VNEID' },
  ],
};

/** Schema for "Tra cứu 1414" (mobile subscriber lookup via the 1414 hotline). */
const TRACUU_1414_SCHEMA: ExtractSchema = {
  aiFields: [
    { key: 'full_name', label: 'Họ và tên', desc: 'Full name of the subscriber (labeled "Họ tên" / "Ho ten")' },
    { key: 'id_no', label: 'Số giấy tờ', desc: 'Identity document number. Read it from the reply message where it may be labeled "Số giấy tờ" / "So giay to", or appear right after "TTTB" / "Thông tin thuê bao" / "Thong tin thue bao". If the reply does not include it, extract the id_no from the sender\'s outgoing request message (the user sends the id_no to 1414 to query subscriber info; the fact that a successful reply is returned confirms the id_no is valid)' },
    { key: 'date_of_birth', label: 'Ngày sinh', desc: 'Date of birth of the subscriber (labeled "Ngày sinh" / "Ngay sinh" / "Năm sinh" / "Nam sinh"); return in DD/MM/YYYY format' },
    { key: 'subscriber_type', label: 'Loại thuê bao', enum: ['Trả trước', 'Trả sau'], desc: 'Subscription type (labeled "Loại thuê bao" / "Loai thue bao" / "Hình thức thuê bao" / "Hinh thuc thue bao"); normalize accent-free variants like "Tra truoc" / "Tra sau" back to the accented form' },
    { key: 'activated_at', label: 'Ngày kích hoạt', desc: 'Subscriber activation date (labeled "Ngày kích hoạt" / "Ngay kich hoat" / "Ngày hòa mạng" / "Ngay hoa mang"); return in DD/MM/YYYY format' },
    { key: 'registered_phone_numbers', label: 'Danh sách số thuê bao', type: 'string[]', desc: 'List of registered subscriber phone numbers (labeled "Danh sách số thuê bao" / "Danh sach so thue bao" / "Số thuê bao" / "So thue bao") — one array element per number' },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'Tra cứu 1414' },
  ],
};

/**
 * Schema for "MB01.HDM-TT.DT.TK/02" — GIẤY ĐĂNG KÝ THIẾT LẬP QUAN HỆ
 * (Relationship Establishment Registration form).
 *
 * This form is richer than the ID-document schemas: it has an organization block,
 * plus two REPEATING people lists (a company may have several legal representatives
 * and several chief accountants). The shared ExtractSchema shape is flat (scalar
 * fields only), so we represent each list as ONE field whose value is a JSON array
 * of objects — the AI is told the exact sub-keys to put in each array element.
 * Several fields are checkbox choices: the desc tells the AI to return the ticked
 * label (single choice) or join ticked labels with ";" (multi-choice).
 */
const RELATIONSHIP_ESTABLISHMENT_SCHEMA: ExtractSchema = {
  aiFields: [
    // ── Section I: organization info (scalar) ──────────────────────────────
    { key: 'org_name_vi', label: 'Tên tổ chức (tiếng Việt)', desc: 'Full organization name in Vietnamese (labeled "Tên tiếng Việt", under section "I. THÔNG TIN TỔ CHỨC")' },
    { key: 'org_name_foreign', label: 'Tên tổ chức (tiếng nước ngoài)', desc: 'Full organization name in a foreign language (labeled "Tên tiếng nước ngoài", under section I)' },
    { key: 'org_short_name', label: 'Tên viết tắt', desc: 'Organization abbreviation / short name (labeled "Tên viết tắt", under section I)' },
    { key: 'business_registration_no', label: 'Số ĐKDN/ĐKKD/QĐTL', desc: 'Enterprise / business registration or establishment decision number (labeled "ĐKDN/ĐKKD/QĐTL số")' },
    { key: 'establishment_date', label: 'Ngày đăng ký thành lập', desc: 'Establishment registration date (labeled "Ngày đăng ký thành lập"). Return in DD/MM/YYYY format.' },
    { key: 'registration_place', label: 'Nơi cấp', desc: 'Issuing authority or place of registration (labeled "Nơi cấp")' },
    { key: 'establishment_country', label: 'Quốc gia thành lập', desc: 'Country of establishment (labeled "Quốc gia thành lập")' },
    { key: 'tax_code', label: 'Mã số thuế / Mã số doanh nghiệp', desc: 'Enterprise code / tax code (labeled "Mã số doanh nghiệp/Mã số thuế")' },
    { key: 'org_identification_no', label: 'Số định danh của tổ chức', desc: 'Organization identification number, if present (labeled "Số định danh của tổ chức")' },
    { key: 'state_budget_relation_code', label: 'Mã số ĐV có quan hệ với NSNN', desc: 'Code of a unit having a relationship with the state budget, if present (labeled "Mã số đơn vị có quan hệ với NSNN")' },
    { key: 'residency_status', label: 'Tình trạng cư trú', enum: ['Cư trú', 'Không cư trú'], desc: 'Residency status checkbox — the ticked label (labeled "Tình trạng cư trú")' },
    { key: 'transaction_address', label: 'Địa chỉ giao dịch', desc: 'Full transaction address as a single line exactly as written (labeled "Địa chỉ giao dịch"); null if blank.' },
    { key: 'transaction_address_type', label: 'Loại địa chỉ giao dịch', enum: ['Giống địa chỉ trụ sở chính', 'Địa chỉ khác'], desc: 'Transaction-address type checkbox — the ticked label (labeled "Loại địa chỉ giao dịch")' },
    { key: 'transaction_address_street', label: 'Địa chỉ giao dịch — Số nhà / Tầng / Tòa nhà, tên đường', desc: STREET_LEVEL_DESC },
    { key: 'transaction_address_ward', label: 'Địa chỉ giao dịch — Phường/Xã/Thị trấn', desc: WARD_LEVEL_DESC + ' null if blank or if "Giống địa chỉ trụ sở chính" is ticked.' },
    { key: 'transaction_address_district', label: 'Địa chỉ giao dịch — Quận/Huyện', desc: DISTRICT_LEVEL_DESC + ' null if blank or if "Giống địa chỉ trụ sở chính" is ticked.' },
    { key: 'transaction_address_province', label: 'Địa chỉ giao dịch — Tỉnh/Thành phố', desc: PROVINCE_LEVEL_DESC + ' null if blank or if "Giống địa chỉ trụ sở chính" is ticked.' },
    { key: 'other_address', label: 'Địa chỉ khác', desc: 'If "Địa chỉ khác" is ticked, the ENTIRE declared other address as a single line exactly as written (labeled "Địa chỉ khác"); otherwise null.' },
    { key: 'phone', label: 'Số điện thoại', desc: 'Organization phone number (labeled "Số điện thoại", under section I)' },
    { key: 'email', label: 'Email', desc: 'Organization email (labeled "Email", under section I)' },
    { key: 'main_business_sector', label: 'Lĩnh vực kinh doanh chính', desc: 'Main business sector name (labeled "Lĩnh vực kinh doanh chính - Tên ngành")' },
    { key: 'business_sector_code', label: 'Mã ngành (cấp 5)', desc: 'Business sector code, level 5 (labeled "Mã ngành (cấp 5)")' },

    // ── Section II: legal representatives (repeating list → JSON array) ─────
    {
      key: 'legal_representatives',
      label: 'Người đại diện hợp pháp',
      type: 'object[]',
      // Legal reps carry additional visa-related sub-fields on top of the shared
      // person shape (used when the rep is a foreigner).
      recordLabels: {
        ...PERSON_RECORD_LABELS,
        visa_no: 'Số thị thực',
        visa_place_of_issue: 'Nơi cấp thị thực',
        visa_expiry_date: 'Ngày hết hạn thị thực',
      },
      desc:
        'Section "II. THÔNG TIN NGƯỜI ĐẠI DIỆN HỢP PHÁP" — a company may have one or MORE legal representatives, so return a JSON array with one object per person. ' +
        'Each object has these keys: full_name (Họ và tên), sex (Giới tính checkbox: "Nam"/"Nữ"), date_of_birth (Ngày sinh — DD/MM/YYYY), occupation (Nghề nghiệp), position (Chức vụ), nationality (Quốc tịch), tax_code (Mã số thuế cá nhân), identification_info (Thông tin định danh, full text), id_document_type (Loại GTTT), id_no (Số GTTT), date_of_issue (Ngày cấp — DD/MM/YYYY), place_of_issue (Nơi cấp), date_of_expiry (Có giá trị đến — DD/MM/YYYY), phone (Điện thoại), email (Email), residency_status (Tình trạng cư trú checkbox), visa_no (Số thị thực), visa_place_of_issue (Nơi cấp thị thực), visa_expiry_date (Ngày hết hạn thị thực — DD/MM/YYYY). ' +
        'Use null for any sub-key not on the document. Return [] if this section is empty.',
    },

    // ── Section III: chief accountants (repeating list → JSON array) ───────
    {
      key: 'chief_accountants',
      label: 'Kế toán trưởng / Phụ trách kế toán',
      type: 'object[]',
      // Chief accountants use the shared person shape without the visa sub-keys.
      recordLabels: { ...PERSON_RECORD_LABELS },
      desc:
        'Section "III. THÔNG TIN KẾ TOÁN TRƯỞNG/PHỤ TRÁCH KẾ TOÁN" — may have one or MORE people, so return a JSON array with one object per person. ' +
        'Each object has these keys: full_name (Họ tên), sex (Giới tính), date_of_birth (Ngày sinh — DD/MM/YYYY), occupation (Nghề nghiệp), nationality (Quốc tịch), position (Chức vụ), tax_code (MST), identification_info (Thông tin định danh), id_document_type (Loại GTTT), id_no (Số GTTT), date_of_issue (Ngày cấp — DD/MM/YYYY), place_of_issue (Nơi cấp), date_of_expiry (Có giá trị đến — DD/MM/YYYY), phone (Điện thoại), email (Email), residency_status (Tình trạng cư trú). ' +
        'Use null for any sub-key not on the document. Return [] if this section is empty.',
    },

    // ── Section V: FATCA ───────────────────────────────────────────────────
    { key: 'fatca_classification', label: 'Phân loại FATCA', desc: 'FATCA classification — return the ticked checkbox content exactly as written (section "V. THÔNG TIN FATCA", labeled "Phân loại FATCA")' },

    // ── Section VI: purpose & signature confirmation ───────────────────────
    { key: 'relationship_purpose', label: 'Mục đích quan hệ với VPBank', type: 'string[]', desc: 'Purpose of the relationship with VPBank — one array element per ticked option (section "VI", labeled "Mục đích quan hệ với VPBank")' },
    { key: 'vpbank_signature_confirmation', label: 'Xác nhận chữ ký VPBank', desc: 'VPBank signature confirmation — return the ticked label; null if nothing is ticked (labeled "VPBank xác nhận chữ ký")' },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'GIẤY ĐĂNG KÝ THIẾT LẬP QUAN HỆ' },
  ],
};

/**
 * Schema for "Văn bản ủy quyền" (Power of Attorney / Letter of Authorization).
 *
 * The form has TWO fixed parties, flattened with a party prefix:
 *   - grantor_*  : BÊN ỦY QUYỀN — the legal representative of the account holder.
 *                  Carries BOTH the representative person (name/ID/position) AND the
 *                  account-holder company block (customer name, head-office address,
 *                  enterprise code + issuer + issue date, phone, email).
 *   - delegate_* : BÊN ĐƯỢC ỦY QUYỀN — the authorized person (basic info only, not
 *                  split by role).
 *
 * Per the form's General Rule, every extracted value must be returned in
 * Vietnamese UPPERCASE WITHOUT diacritics (VIẾT HOA KHÔNG DẤU); that rule is
 * repeated in each field desc so the AI applies it consistently.
 */
const POWER_OF_ATTORNEY_SCHEMA: ExtractSchema = {
  aiFields: [
    // ── BÊN ỦY QUYỀN — legal representative of the account holder ───────────
    { key: 'grantor_full_name', label: 'Bên ủy quyền — Họ và tên', desc: 'Full name of the account holder\'s legal representative (BÊN ỦY QUYỀN — "Ông/Bà"). Return in Vietnamese UPPERCASE, no diacritics.' },
    { key: 'grantor_id_no', label: 'Bên ủy quyền — Số giấy tờ tùy thân', desc: 'ID document number of the account holder\'s legal representative ("Giấy tờ tùy thân"). Return in UPPERCASE, no diacritics.' },
    { key: 'grantor_id_issue_date', label: 'Bên ủy quyền — Ngày cấp', desc: 'Issue date of that ID document ("Ngày cấp"). Return in DD/MM/YYYY format.' },
    { key: 'grantor_position', label: 'Bên ủy quyền — Chức vụ', desc: 'Position / title of the account holder\'s legal representative ("Chức vụ"). Return in UPPERCASE, no diacritics.' },
    // Account-holder (company) info declared under BÊN ỦY QUYỀN.
    { key: 'grantor_account_holder_name', label: 'Chủ tài khoản — Tên', desc: 'Customer / account holder name — the organization the representative acts for ("Tên khách hàng" / "Tên chủ tài khoản"). Return in UPPERCASE, no diacritics.' },
    { key: 'grantor_head_office_address', label: 'Chủ tài khoản — Địa chỉ trụ sở', desc: 'Head-office address of the account holder ("Địa chỉ trụ sở"). Return in UPPERCASE, no diacritics.' },
    { key: 'grantor_enterprise_code', label: 'Chủ tài khoản — Mã số doanh nghiệp', desc: 'Enterprise code of the account holder ("Mã số doanh nghiệp"). Return in UPPERCASE, no diacritics.' },
    { key: 'grantor_enterprise_issued_by', label: 'Chủ tài khoản — Nơi cấp MSDN', desc: 'Authority that issued the enterprise code ("do ... cấp"). Return in UPPERCASE, no diacritics.' },
    { key: 'grantor_enterprise_issue_date', label: 'Chủ tài khoản — Ngày cấp MSDN', desc: 'Issue date of the enterprise code ("cấp ngày"). Return in DD/MM/YYYY format.' },
    { key: 'grantor_phone', label: 'Chủ tài khoản — Điện thoại', desc: 'Phone number declared for the account holder ("Điện thoại").' },
    { key: 'grantor_email', label: 'Chủ tài khoản — Email', desc: 'Email declared for the account holder ("Email"). Return in UPPERCASE, no diacritics.' },

    // ── BÊN ĐƯỢC ỦY QUYỀN — the authorized person (basic info, not split) ───
    { key: 'delegate_full_name', label: 'Bên được ủy quyền — Họ và tên', desc: 'Full name of the authorized person (BÊN ĐƯỢC ỦY QUYỀN — "Họ và tên"). Return in UPPERCASE, no diacritics.' },
    { key: 'delegate_id_no', label: 'Bên được ủy quyền — Số giấy tờ tùy thân', desc: 'ID document number of the authorized person ("Giấy tờ tùy thân"). Return in UPPERCASE, no diacritics.' },
    { key: 'delegate_id_issue_date', label: 'Bên được ủy quyền — Ngày cấp', desc: 'Issue date of that ID document ("Ngày cấp"). Return in DD/MM/YYYY format.' },
    { key: 'delegate_position', label: 'Bên được ủy quyền — Chức vụ', desc: 'Position / title of the authorized person ("Chức vụ"). Return in UPPERCASE, no diacritics.' },
    { key: 'delegate_additional_info', label: 'Bên được ủy quyền — Thông tin bổ sung', desc: 'Any supplementary information declared for the authorized person ("Thông tin bổ sung"), if present. Return in UPPERCASE, no diacritics; null if empty.' },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'VAN BAN UY QUYEN' },
  ],
};

// ── Sub-record label maps for DKKD ──────────────────────────────────────────

/** Sub-key labels shared across legal-representative records in DKKD. */
const DKKD_LEGAL_REP_RECORD_LABELS: Record<string, string> = {
  full_name: 'Họ và tên',
  position: 'Chức danh',
  date_of_birth: 'Ngày sinh',
  ethnicity: 'Dân tộc',
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
};

/** Sub-key labels for shareholder/capital-contributor records in DKKD. */
const DKKD_SHAREHOLDER_RECORD_LABELS: Record<string, string> = {
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
};

/** Sub-key labels for the single owner block in a single-member LLC (TNHH MTV). */
const DKKD_OWNER_RECORD_LABELS: Record<string, string> = {
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
};

/**
 * Schema for "Đăng ký kinh doanh" (Business Registration Certificate).
 *
 * APPROACH: flat fields — every piece of information is extracted as an
 * independent field. A downstream rules-based layer is responsible for grouping
 * flat fields back into logical groups (e.g. combining all legal-rep sub-fields
 * into a single representative object). That grouping does NOT happen here.
 *
 * REPEATING LISTS: three list fields return JSON arrays — the AI is told the
 * exact sub-keys for each element so the output is structured from the start:
 *   - legal_representatives: all legal reps (required — every DKKD has at least one)
 *   - shareholders:          capital contributors (only for 2-member LLC / partnership)
 *   - owner:                 single owner block (only for single-member LLC)
 *
 * BUSINESS TYPE CODES (loai_hinh):
 *   Công ty cổ phần, Công ty TNHH MTV, Công ty TNHH hai thành viên,
 *   Công ty hợp danh, Doanh nghiệp tư nhân, Hộ kinh doanh.
 *
 * SIGNER INFO: lấy từ khu vực đóng dấu / ký tên cuối văn bản.
 */
const BUSINESS_REGISTRATION_SCHEMA: ExtractSchema = {
  aiFields: [
    // ── Cơ quan cấp ──────────────────────────────────────────────────────
    {
      key: 'issuing_authority',
      label: 'Cơ quan cấp (Sở Tài chính)',
      desc:
        'The authority that issued the certificate — typically a "Sở Tài chính" ' +
        'of a province or city, labeled "Cơ quan cấp", "Nơi cấp", or found in the header/stamp area. ' +
        'Return the full name exactly as printed (e.g. "Sở Tài chính Thành phố Hồ Chí Minh"); ' +
        'null if not identifiable.',
    },

    // ── Loại hình ────────────────────────────────────────────────────────
    {
      key: 'business_type',
      label: 'Loại hình doanh nghiệp',
      enum: [
        'Công ty cổ phần',
        'Công ty TNHH một thành viên',
        'Công ty TNHH hai thành viên trở lên',
        'Công ty hợp danh',
        'Doanh nghiệp tư nhân',
        'Hộ kinh doanh',
      ],
      desc:
        'Type of business entity as printed on the certificate. ' +
        'Do not translate or abbreviate.',
    },

    // ── Mã số ────────────────────────────────────────────────────────────
    {
      key: 'registration_no',
      label: 'Mã số doanh nghiệp / Mã số hộ kinh doanh',
      desc:
        'Enterprise registration number / household business registration number / ' +
        'household business registration code — labeled ' +
        '"Mã số doanh nghiệp", "Mã số hộ kinh doanh", or "Mã số đăng ký hộ kinh doanh". ' +
        'Return only the digits/characters of the code, no labels.',
    },

    // ── Lần đăng ký ──────────────────────────────────────────────────────
    {
      key: 'initial_registration',
      label: 'Đăng ký kinh doanh lần đầu',
      desc:
        'Initial business registration — labeled "Đăng ký kinh doanh lần đầu" or ' +
        '"Đăng ký lần đầu". Return the date shown next to this label in DD/MM/YYYY format, ' +
        'or null if not present.',
    },
    {
      key: 'change_registration_no',
      label: 'Đăng ký thay đổi lần thứ',
      desc:
        'Change registration sequence — labeled "Đăng ký thay đổi lần thứ". ' +
        'Return the ordinal number (e.g. "5") shown next to this label, ' +
        'or null if this is an initial registration.',
    },
    {
      key: 'change_date',
      label: 'Ngày thay đổi',
      desc:
        'Date of the most recent change registration — labeled "Ngày thay đổi". ' +
        'Return in DD/MM/YYYY format, or null if not present.',
    },

    // ── Tên công ty ───────────────────────────────────────────────────────
    {
      key: 'company_name_vi',
      label: 'Tên công ty (tiếng Việt)',
      desc:
        'Full company name in Vietnamese — labeled "Tên công ty viết bằng tiếng Việt" or ' +
        '"Tên doanh nghiệp" or "Tên hộ kinh doanh". Return exactly as printed.',
    },
    {
      key: 'company_name_foreign',
      label: 'Tên công ty (tiếng nước ngoài)',
      desc:
        'Full company name in a foreign language — labeled "Tên công ty viết bằng tiếng nước ngoài" ' +
        'or "Tên nước ngoài". Return exactly as printed, or null if absent.',
    },
    {
      key: 'company_name_abbr',
      label: 'Tên công ty viết tắt',
      desc:
        'Company abbreviated name — labeled "Tên công ty viết tắt" or "Tên viết tắt". ' +
        'Return exactly as printed, or null if absent.',
    },

    // ── Địa chỉ trụ sở chính ─────────────────────────────────────────────
    {
      key: 'registered_address',
      label: 'Địa chỉ trụ sở chính',
      desc:
        'Full registered office address — labeled "Địa chỉ trụ sở chính" (mục 10 on the certificate). ' +
        'Return the entire address line exactly as printed (e.g. "Số 12, Đường Lý Tự Trọng, Phường Bến Nghé, Quận 1, Thành phố Hồ Chí Minh"); null if absent.',
    },
    {
      key: 'registered_address_street',
      label: 'Địa chỉ trụ sở chính — Số nhà / Tầng / Tòa nhà, tên đường',
      desc: STREET_LEVEL_DESC,
    },
    {
      key: 'registered_address_ward',
      label: 'Địa chỉ trụ sở chính — Phường/Xã/Thị trấn/Thị xã',
      desc: WARD_LEVEL_DESC,
    },
    {
      key: 'registered_address_district',
      label: 'Địa chỉ trụ sở chính — Quận/Huyện',
      desc: DISTRICT_LEVEL_DESC,
    },
    {
      key: 'registered_address_province',
      label: 'Địa chỉ trụ sở chính — Tỉnh/Thành phố/Đặc khu',
      desc: PROVINCE_LEVEL_DESC,
    },

    // ── Người đại diện pháp luật (repeating list → JSON array) ───────────
    {
      key: 'legal_representatives',
      label: 'Người đại diện pháp luật',
      type: 'object[]',
      recordLabels: DKKD_LEGAL_REP_RECORD_LABELS,
      desc:
        'ALL legal representatives listed on the certificate — labeled ' +
        '"Người đại diện pháp luật" (one or more). ' +
        'Return a JSON array; each element has these keys: ' +
        'full_name (Họ và tên), position (Chức danh), date_of_birth (Ngày sinh — DD/MM/YYYY), ' +
        'ethnicity (Dân tộc), nationality (Quốc tịch), ' +
        'id_document_type (Loại giấy tờ pháp lý của cá nhân), ' +
        'id_no (Số giấy tờ pháp lý của cá nhân), ' +
        'date_of_issue (Ngày cấp — DD/MM/YYYY), place_of_issue (Nơi cấp), ' +
        'permanent_address (Địa chỉ thường trú), permanent_address_street (' + STREET_LEVEL_DESC + '), permanent_address_ward (' + WARD_LEVEL_DESC + '), permanent_address_district (' + DISTRICT_LEVEL_DESC + '), permanent_address_province (' + PROVINCE_LEVEL_DESC + '), ' +
        'contact_address (Địa chỉ liên lạc), contact_address_street (' + STREET_LEVEL_DESC + '), contact_address_ward (' + WARD_LEVEL_DESC + '), contact_address_district (' + DISTRICT_LEVEL_DESC + '), contact_address_province (' + PROVINCE_LEVEL_DESC + '). ' +
        'Set missing sub-keys to null. Return null if none found.',
    },

    // ── Danh sách thành viên góp vốn (only for 2-member LLC / partnership) ─
    {
      key: 'shareholders',
      label: 'Danh sách thành viên góp vốn',
      type: 'object[]',
      recordLabels: DKKD_SHAREHOLDER_RECORD_LABELS,
      desc:
        'List of capital contributors — labeled "Danh sách thành viên góp vốn" or ' +
        '"Danh sách thành viên". ONLY present for "Công ty TNHH hai thành viên" and ' +
        '"Công ty hợp danh"; return [] for all other business types. ' +
        'Each element has: full_name (Tên thành viên), nationality (Quốc tịch), ' +
        'contact_address (Địa chỉ liên lạc đối với cá nhân / Địa chỉ trụ sở chính đối với tổ chức), contact_address_street (' + STREET_LEVEL_DESC + '), contact_address_ward (' + WARD_LEVEL_DESC + '), contact_address_district (' + DISTRICT_LEVEL_DESC + '), contact_address_province (' + PROVINCE_LEVEL_DESC + '), ' +
        'capital_contribution (Phần vốn góp), ownership_ratio (Tỷ lệ %), ' +
        'id_or_registration_no (Số GTPL cá nhân / Mã số DN / Số GCNĐKDN tương đương), ' +
        'note (Ghi chú). Set missing sub-keys to null.',
    },

    // ── Thông tin chủ sở hữu (only for single-member LLC) ────────────────
    {
      key: 'owner',
      label: 'Thông tin chủ sở hữu',
      type: 'object',
      recordLabels: DKKD_OWNER_RECORD_LABELS,
      desc:
        'Owner information — labeled "Thông tin chủ sở hữu" or "Chủ sở hữu công ty". ' +
        'ONLY present for "Công ty TNHH một thành viên"; return null for all other types. ' +
        'Return an object (not an array) with: ' +
        'full_name (Họ và tên), date_of_birth (Sinh ngày — DD/MM/YYYY), sex (Giới tính), ' +
        'nationality (Quốc tịch), id_document_type (Loại giấy tờ pháp lý), ' +
        'id_no (Số giấy tờ pháp lý), date_of_issue (Ngày cấp — DD/MM/YYYY), ' +
        'place_of_issue (Nơi cấp), permanent_address (Địa chỉ thường trú), permanent_address_street (' + STREET_LEVEL_DESC + '), permanent_address_ward (' + WARD_LEVEL_DESC + '), permanent_address_district (' + DISTRICT_LEVEL_DESC + '), permanent_address_province (' + PROVINCE_LEVEL_DESC + '), ' +
        'contact_address (Địa chỉ liên lạc), contact_address_street (' + STREET_LEVEL_DESC + '), contact_address_ward (' + WARD_LEVEL_DESC + '), contact_address_district (' + DISTRICT_LEVEL_DESC + '), contact_address_province (' + PROVINCE_LEVEL_DESC + '). Set missing sub-keys to null.',
    },

    // ── Vốn điều lệ ──────────────────────────────────────────────────────
    {
      key: 'charter_capital',
      label: 'Vốn điều lệ',
      desc:
        'Total charter capital amount — labeled "Vốn điều lệ" on the certificate. ' +
        'Return ONLY the numeric value as a string (digits and separators as printed, ' +
        'e.g. "10.000.000.000" or "5000000000"); do NOT include the currency unit. ' +
        'Return null if not present.',
    },

    // ── Thông tin người ký / khu vực đóng dấu ────────────────────────────
    {
      key: 'signer_name',
      label: 'Tên người ký',
      desc:
        'Name of the person who signed the certificate — found in the signing area / ' +
        'stamp section at the bottom of the document (khu vực đóng dấu / ký tên). ' +
        'Return the name exactly as printed (e.g. "Đỗ Thị Hoa"), or null if not legible.',
    },
    {
      key: 'signer_department',
      label: 'Phòng ban ký số',
      desc:
        'Name of the department or unit shown inside the official stamp / digital-signature ' +
        'block (con dấu / khu vực đóng dấu) at the bottom of the document — e.g. ' +
        '"Phòng đăng ký kinh doanh". Return the text exactly as printed, or null if absent.',
    },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'ĐĂNG KÝ KINH DOANH' },
  ],
};

// ── Sub-record label map for WEBCA ──────────────────────────────────────────

/** Sub-key labels for each signer row in a WEBCA table. */
const WEBCA_ENTRY_RECORD_LABELS: Record<string, string> = {
  full_name: 'Tên',
  signer_department: 'Phòng ban',
  status: 'Trạng thái',
  signature: 'Chữ ký',
};

/**
 * Schema for "Check webca" (Bảng kết quả kiểm tra chữ ký số — WebCA).
 *
 * Bảng webca chứa NHIỀU dòng, mỗi dòng là một người ký. Toàn bộ kết quả
 * trả về là MỘT field duy nhất `entries` kiểu JSON array — mỗi phần tử là
 * một object đại diện cho một dòng trong bảng.
 *
 * Sub-keys tái sử dụng key đã có trong codebase:
 *   - full_name        → tái sử dụng (tên người ký, VD: "LE HOANG HUYNH")
 *   - signer_department → tái sử dụng từ dang_ky_kinh_doanh (phòng ban / CA,
 *                         VD: "PHÒNG ĐĂNG KÝ KINH DOANH")
 *   - status           → key mới (trạng thái chữ ký, VD: "Hợp lệ" / "Không hợp lệ")
 *   - signature        → key mới (kết quả xác thực chữ ký, VD: "Hợp lệ")
 */
const WEBCA_SCHEMA: ExtractSchema = {
  aiFields: [
    {
      key: 'entries',
      label: 'Danh sách người ký',
      type: 'object[]',
      recordLabels: WEBCA_ENTRY_RECORD_LABELS,
      desc:
        'The full list of signers in the WebCA digital-signature verification table. ' +
        'Each row in the table becomes ONE object in the JSON array. ' +
        'Each object has these keys: ' +
        'full_name (the signer\'s name — labeled "Tên" / "Name", e.g. "LE HOANG HUYNH"), ' +
        'signer_department (the department or CA organization shown in the "DN" / "CA" column, ' +
        'e.g. "PHÒNG ĐĂNG KÝ KINH DOANH"), ' +
        'status (the signature status shown in the "Trạng thái" / "Status" column, ' +
        'e.g. "Hợp lệ" / "Valid" / "Không hợp lệ"), ' +
        'signature (the signature verification result shown in the "Chữ ký" / "Signature" column, ' +
        'e.g. "Hợp lệ" / "Valid"). ' +
        'Set a sub-key to null if it cannot be read for a given row. ' +
        'Return null if the table is empty or cannot be read.',
    },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'Check webca' },
      ],
};

// ═══════════════════════════════════════════════════════════════════════════
// MB02 — GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ VÀ SỬ DỤNG TÀI KHOẢN THANH TOÁN, DỊCH VỤ
// ═══════════════════════════════════════════════════════════════════════════
//
// MB02 carries ~85 top-level fields (organization + branch + FATCA + purpose +
// registered services + accounts + statement + SMS + QLDT + online banking +
// debit card + 4 repeating people lists + consent + VPBank confirmation).
//
// Extracting all of that in a single LLM call degraded quality, so MB02 uses
// the MultiCallExtractSchema shape: the fields are split into 4 named groups,
// each extracted with its own LLM call in parallel (see extract-engine.ts).
//
// Full field-by-field analysis and rationale live in mb02.md — the `desc`
// strings below are the "Notes" column of that document transcribed 1:1.
//
// Global rules from mb02.md §5 apply to every field and are enforced by the
// prompt's system header + PAM_OUTPUT_FORMAT_HINT — not repeated per field:
//   - Vietnamese UPPERCASE without diacritics for every string value.
//   - Numbers / dates / emails / codes keep their printed form.
//   - Missing values → null; empty checkbox groups → "" unless noted.
//   - Every string carries a trailing ⟨conf:0.NN⟩ confidence marker.

// ── MB02 shared sub-key label maps (for the 4 repeating people arrays) ─────

// Base person sub-keys — 18 aligned with MB01's PERSON_RECORD_LABELS
// (full_name, sex, date_of_birth, occupation, position, nationality, tax_code,
// id_document_type, id_no, date_of_issue, place_of_issue, date_of_expiry,
// phone, email, residency_status, visa_no, visa_place_of_issue, visa_expiry_date)
// plus 13 MB02-only person basics that don't exist on MB01.
const MB02_PERSON_BASE_LABELS: Record<string, string> = {
  // 18 keys reused verbatim from MB01
  ...PERSON_RECORD_LABELS,
  // MB01 legal-rep list also uses these three visa keys; declare them here
  // so section-VII people (which do NOT inherit MB01's visa fields on MB01)
  // still get labels for their foreign-national block on MB02.
  visa_no: 'Số thị thực',
  visa_place_of_issue: 'Nơi cấp thị thực',
  visa_expiry_date: 'Ngày hết hạn thị thực',

  // 13 MB02-only sub-keys
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

// Online-banking sub-block — present on VI.1 + VI.2 persons ONLY (VII persons
// register debit card only per the XLSX).
const MB02_ONLINE_BANKING_SUB_LABELS: Record<string, string> = {
  online_banking_registered: 'Đăng ký Ngân hàng trực tuyến',
  online_banking_function: 'Chức năng',
  online_banking_pin: 'Mã PIN',
  online_banking_approval_order: 'Thứ tự phê duyệt',
  online_banking_approval_limit: 'Hạn mức phê duyệt',
  online_banking_admin_type: 'Loại quản trị viên',
  online_banking_other: 'Ghi chú khác',
};

// Debit-card sub-block — present on all four MB02 people lists.
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

// Authorization sub-block — present on VI.2 + VII.2 persons ONLY (the two
// "delegated" lists).
const MB02_AUTHORIZATION_SUB_LABELS: Record<string, string> = {
  authorization_scope: 'Phạm vi và Thời hạn ủy quyền',
  authorization_poa_no: 'Số văn bản ủy quyền',
  authorization_poa_date: 'Ngày văn bản ủy quyền',
  authorization_poa_grantor: 'Bên ủy quyền',
};

// Composed record labels — one per list. Order of spread doesn't matter for
// labels (no key overlap between sub-blocks by design).
const MB02_LEGAL_REP_LABELS: Record<string, string> = {
  ...MB02_PERSON_BASE_LABELS,
  ...MB02_ONLINE_BANKING_SUB_LABELS,
  ...MB02_DEBIT_CARD_SUB_LABELS,
};
const MB02_AUTH_REP_LABELS: Record<string, string> = {
  ...MB02_LEGAL_REP_LABELS,
  ...MB02_AUTHORIZATION_SUB_LABELS,
};
const MB02_CHIEF_ACCOUNTANT_LABELS: Record<string, string> = {
  ...MB02_PERSON_BASE_LABELS,
  ...MB02_DEBIT_CARD_SUB_LABELS,
};
const MB02_AUTH_CHIEF_ACCOUNTANT_LABELS: Record<string, string> = {
  ...MB02_CHIEF_ACCOUNTANT_LABELS,
  ...MB02_AUTHORIZATION_SUB_LABELS,
};

// ── Group 1 — Organization + Branch ─────────────────────────────────────────
const MB02_GROUP_ORG_AND_BRANCH: ExtractSchemaGroup = {
  name: 'org_and_branch',
  contextHint:
    'Focus ONLY on Section "I. THÔNG TIN KHÁCH HÀNG" — subsection 1 (Thông tin tổ chức, including the SME-extras rows) and subsection 2 (Thông Tin Chi Nhánh/Văn Phòng Đại Diện). Do NOT read any other section of the form.',
  aiFields: [
    // Section I.1 — organization info (21)
    { key: 'org_name_vi', label: 'Tên tổ chức (tiếng Việt)', desc: 'Full organization name in Vietnamese, labeled "Tên tiếng Việt" under section "I. THÔNG TIN KHÁCH HÀNG > 1. Thông tin tổ chức".' },
    { key: 'org_name_foreign', label: 'Tên tổ chức (tiếng nước ngoài)', desc: 'Full organization name in a foreign language, labeled "Tên tiếng nước ngoài" under section I.1.' },
    { key: 'org_short_name', label: 'Tên viết tắt', desc: 'Organization abbreviation / short name, labeled "Tên viết tắt".' },
    { key: 'business_registration_no', label: 'Số ĐKDN/ĐKKD/QĐTL', desc: 'Enterprise / business registration / establishment-decision number, labeled "ĐKDN/ĐKKD/QĐTL số".' },
    { key: 'establishment_date', label: 'Ngày đăng ký thành lập', desc: 'Establishment registration date, labeled "Ngày đăng ký thành lập". Return in DD/MM/YYYY format.' },
    { key: 'registration_place', label: 'Nơi cấp', desc: 'Issuing authority / place of registration, labeled "Nơi cấp".' },
    { key: 'establishment_country', label: 'Quốc gia thành lập', desc: 'Country of establishment, labeled "Quốc gia thành lập".' },
    { key: 'tax_code', label: 'Mã số thuế / Mã số doanh nghiệp', desc: 'Enterprise code / tax code, labeled "Mã số doanh nghiệp/Mã số thuế".' },
    { key: 'org_identification_no', label: 'Số định danh của tổ chức', desc: 'Organization identification number, labeled "Số định danh của tổ chức" (if present).' },
    { key: 'state_budget_relation_code', label: 'Mã số ĐV có quan hệ với NSNN', desc: 'Code of a unit having a relationship with the state budget, labeled "Mã số đơn vị có quan hệ với NSNN" (if present).' },
    { key: 'residency_status', label: 'Tình trạng cư trú', enum: ['Cư trú', 'Không cư trú'], desc: 'Residency-status checkbox — the ticked label (labeled "Tình trạng cư trú").' },
    { key: 'head_office_address', label: 'Địa chỉ trụ sở chính', desc: 'Head-office address, labeled "Địa chỉ trụ sở chính". Often the boilerplate "Theo ghi nhận tại ĐKDN/ĐKKD/QĐTL nêu trên" — return as written.' },
    { key: 'transaction_address_type', label: 'Loại địa chỉ giao dịch', enum: ['Giống địa chỉ trụ sở chính', 'Khác'], desc: 'Transaction-address-type checkbox under "Địa chỉ giao dịch" — the ticked label.' },
    { key: 'other_address', label: 'Địa chỉ khác', desc: 'If "Khác" is ticked, the ENTIRE declared other address as a single line exactly as written (labeled "Khác, vui lòng điền rõ"); otherwise null.' },
    { key: 'other_address_street', label: 'Địa chỉ khác — Số nhà, tên đường', desc: STREET_LEVEL_DESC },
    { key: 'other_address_ward', label: 'Địa chỉ khác — Phường/Xã/Thị trấn', desc: WARD_LEVEL_DESC + ' null if "Khác" is not ticked or blank.' },
    { key: 'other_address_district', label: 'Địa chỉ khác — Quận/Huyện', desc: DISTRICT_LEVEL_DESC + ' null if "Khác" is not ticked or blank.' },
    { key: 'other_address_province', label: 'Địa chỉ khác — Tỉnh/Thành phố', desc: PROVINCE_LEVEL_DESC + ' null if "Khác" is not ticked or blank.' },
    { key: 'phone', label: 'Số điện thoại', desc: 'Organization phone number, labeled "Số điện thoại" under section I.1.' },
    { key: 'fax', label: 'Số fax', desc: 'Organization fax number, labeled "Số fax" under section I.1.' },
    { key: 'email', label: 'Email', desc: 'Organization email used to receive VPBank notifications, labeled "Email" under section I.1.' },
    { key: 'website', label: 'Trang thông tin điện tử', desc: 'Organization website, labeled "Trang thông tin điện tử (nếu có)"; null if absent.' },
    { key: 'main_business_sector', label: 'Lĩnh vực kinh doanh chính', desc: 'Main business sector name, labeled "Lĩnh vực kinh doanh chính: Tên ngành".' },
    { key: 'business_sector_code', label: 'Mã ngành (cấp 5)', desc: 'Business sector code, level 5, labeled "Mã ngành (cấp 5)".' },
    { key: 'authorized_representative_summary', label: 'Đại diện hợp pháp (dòng khai báo trên đầu trang)', desc: 'The top-of-page authorization-declaration line, labeled "Đại diện hợp pháp: …". Return the full free-text line as written (name + POA number + POA date + granting org), or null if absent.' },

    // SME-only tail (5)
    { key: 'sme_micro_enterprise', label: 'Quy mô doanh nghiệp siêu nhỏ', type: 'boolean', desc: 'Return true if the checkbox "Quy mô doanh nghiệp siêu nhỏ và áp dụng chế độ kế toán đơn giản" is ticked, false if not ticked, null if the row is absent.' },
    { key: 'sme_previous_year_revenue', label: 'Doanh thu năm trước (tỷ đồng)', enum: ['<=3', 'trên 3-10', 'trên 10-20', 'trên 20-30', 'trên 30-50', 'trên 50-100', 'trên 100-200', 'trên 200-300', 'trên 300-400', 'trên 400'], desc: 'Previous-year revenue band under "Doanh thu năm trước (tỷ đồng)" — the ticked band label; null if nothing ticked.' },
    { key: 'sme_total_capital', label: 'Tổng nguồn vốn (tỷ đồng)', enum: ['<=3', '3-20', '20-50', '50-100', '>100'], desc: 'Total-capital band under "Tổng nguồn vốn (tỷ đồng)" — the ticked band label; null if nothing ticked.' },
    { key: 'sme_social_insurance_employees', label: 'Số lao động BHXH (người)', enum: ['<=10', '10-50', '50-100', '100-200', '>200'], desc: 'Social-insurance-employees band under "Số lượng lao động tham gia bảo hiểm xã hội bình quân năm (người)" — the ticked band label; null if nothing ticked.' },
    { key: 'sme_woman_owned', label: 'Sở hữu bởi phụ nữ', desc: 'Woman-owned declaration under "KH có được sở hữu bởi phụ nữ không" — return the full text of the ticked option (or the free-text answer) exactly as written; null if empty.' },

    // Section I.2 — branch info (13)
    { key: 'branch_name', label: 'Tên Chi nhánh/VPĐD', desc: 'Full name of the branch / representative office, labeled "Tên Chi nhánh/VPĐD" under section I.2. Null when section I.2 is blank.' },
    { key: 'branch_registration_no', label: 'GCN ĐKHĐ Chi nhánh/VPĐD', desc: 'Branch operating-registration certificate number, labeled "Giấy chứng nhận đăng ký hoạt động Chi nhánh/VPĐD".' },
    { key: 'branch_establishment_date', label: 'Ngày đăng ký / thành lập (chi nhánh)', desc: 'Branch establishment date, labeled "Ngày đăng ký/thành lập" under section I.2. Return in DD/MM/YYYY format.' },
    { key: 'branch_tax_code', label: 'Mã số thuế chi nhánh', desc: 'Branch tax code, labeled "Mã số thuế (nếu có)" under section I.2; null if absent.' },
    { key: 'branch_head_office_address', label: 'Địa chỉ chi nhánh/VPĐD', desc: 'Branch address, labeled "Địa chỉ chi nhánh/VPĐD" under section I.2. Often the boilerplate "Theo ghi nhận tại Giấy chứng nhận đăng ký hoạt động Chi nhánh/VPĐD nêu trên" — return as written.' },
    { key: 'branch_transaction_address_type', label: 'Loại địa chỉ giao dịch (chi nhánh)', enum: ['Địa chỉ Chi nhánh/VPĐD', 'Khác'], desc: 'Branch transaction-address-type checkbox under section I.2 "Địa chỉ giao dịch" — the ticked label.' },
    { key: 'branch_other_address', label: 'Địa chỉ khác (chi nhánh)', desc: 'If "Khác" is ticked in the branch section, the entire declared other address as a SINGLE line exactly as written (labeled "Khác, vui lòng điền rõ"); otherwise null.' },
    { key: 'branch_other_address_street', label: 'Địa chỉ khác (chi nhánh) — Số nhà, tên đường', desc: STREET_LEVEL_DESC },
    { key: 'branch_other_address_ward', label: 'Địa chỉ khác (chi nhánh) — Phường/Xã/Thị trấn', desc: WARD_LEVEL_DESC + ' null if "Khác" is not ticked or blank.' },
    { key: 'branch_other_address_district', label: 'Địa chỉ khác (chi nhánh) — Quận/Huyện', desc: DISTRICT_LEVEL_DESC + ' null if "Khác" is not ticked or blank.' },
    { key: 'branch_other_address_province', label: 'Địa chỉ khác (chi nhánh) — Tỉnh/Thành phố', desc: PROVINCE_LEVEL_DESC + ' null if "Khác" is not ticked or blank.' },
    { key: 'branch_phone', label: 'Số điện thoại (chi nhánh)', desc: 'Branch phone number, labeled "Số điện thoại" under section I.2.' },
    { key: 'branch_fax', label: 'Số fax (chi nhánh)', desc: 'Branch fax number, labeled "Số fax" under section I.2.' },
    { key: 'branch_email', label: 'Email (chi nhánh)', desc: 'Branch email used to receive VPBank notifications, labeled "Email" under section I.2.' },
    { key: 'branch_website', label: 'Trang thông tin điện tử (chi nhánh)', desc: 'Branch website, labeled "Trang thông tin điện tử (nếu có)" under section I.2; null if absent.' },
    { key: 'branch_main_business_sector', label: 'Lĩnh vực hoạt động chính (chi nhánh)', desc: 'Branch main business sector name, labeled "Lĩnh vực hoạt động, kinh doanh chính: Tên ngành" under section I.2.' },
    { key: 'branch_business_sector_code', label: 'Mã ngành (cấp 5) - chi nhánh', desc: 'Branch business sector code, level 5, labeled "Mã ngành (cấp 5)" under section I.2.' },
  ],
};

// Section 3.I TKTT table row labels (shared with MB02 tktt_accounts).
const TKTT_ACCOUNT_ROW_LABELS: Record<string, string> = {
  account_type:         'Loại tài khoản',
  currencies:           'Loại tiền',
  other_currency:       'Tiền khác',
  quantity:             'Số lượng',
  beautiful_account_no: 'Tài khoản số đẹp — Số tài khoản',
  beautiful_fee:        'Tài khoản số đẹp — Phí (chưa VAT)',
};

// ── Group 2 — Services + Products + Consent + VPBank confirmation ──────────
const MB02_GROUP_SERVICES: ExtractSchemaGroup = {
  name: 'services_and_products',
  contextHint:
    'Focus ONLY on: Section "I.3 Thông tin FATCA", "I.4 Mục đích, bản chất mối quan hệ kinh doanh của KH với VPBank", "II. ĐỀ NGHỊ ĐĂNG KÝ DỊCH VỤ CỦA KHÁCH HÀNG", "III. ĐĂNG KÝ LOẠI, DỊCH VỤ MỞ, SỬ DỤNG TÀI KHOẢN THANH TOÁN" (subsections 1–4), "IV. ĐĂNG KÝ DỊCH VỤ NGÂN HÀNG TRỰC TUYẾN DÀNH CHO TỔ CHỨC", "V. ĐĂNG KÝ DỊCH VỤ THẺ GHI NỢ DOANH NGHIỆP" (including the receiver block V.5), the bottom "III. XÁC NHẬN ĐỒNG Ý VỚI HOẠT ĐỘNG BẢO VỆ, XỬ LÝ DỮ LIỆU CÁ NHÂN" block, and the "VPBank xác nhận chữ ký" block. Do NOT read the signature-registration sections (VI, VII).',
  aiFields: [
    // Section I.3 FATCA (3)
    { key: 'fatca_us_tax_code', label: 'Mã số thuế Hoa Kỳ của tổ chức', desc: 'US tax code of the organization, labeled "Mã số thuế Hoa Kỳ của tổ chức" under FATCA section 3.1. Only present when the customer is a US-law entity; otherwise null.' },
    { key: 'fatca_us_exempt_code', label: 'Mã số miễn trừ báo cáo FATCA', desc: 'FATCA reporting-exemption code, labeled "Mã số miễn trừ báo cáo FATCA" under section 3.1. Null if absent.' },
    // No `enum` here on purpose: MB02_Field_Definition.xlsx truncates the 3.2
    // option list mid-sentence and mb02.md only gives an "e.g." sample, so the
    // full set of options is not authoritatively recorded anywhere. Listing a
    // guessed subset would risk the model snapping a real option onto a wrong
    // one — the desc keeps telling it to read the label as written.
    { key: 'fatca_classification', label: 'Phân loại FATCA', desc: 'FATCA classification under section 3.2 — return the ticked option\'s full label text exactly as written (e.g. "Tổ chức phi tài chính chủ động", "Tổ chức phi tài chính bị động không có Cá nhân có quyền kiểm soát hoặc Có cá nhân có quyền kiểm soát không phải là người Hoa Kỳ", "Tổ chức tài chính, vui lòng cung cấp thông tin theo Mẫu biểu W-8BEN-E"). Null if nothing ticked.' },
    {
      key: 'fatca_us_controlling_persons',
      label: 'Cá nhân có quyền kiểm soát là người Hoa Kỳ',
      type: 'object[]',
      recordLabels: {
        sequence_no: 'STT',
        full_name: 'Họ và tên',
        address: 'Địa chỉ',
        us_tin: 'Mã số thuế Hoa Kỳ (TIN)',
      },
      desc:
        'The list of US controlling persons declared under section I.3.2 — ONLY present when ' +
        'the "Tổ chức phi tài chính bị động và có Cá nhân có quyền kiểm soát là người Hoa Kỳ, ' +
        'vui lòng điền thông tin" option is ticked (a table appears beneath it). ' +
        'Return a JSON array with one object per row of that table; each object has these keys: ' +
        'sequence_no (STT — the digits shown in the "STT" column exactly), ' +
        'full_name (Họ và tên), address (Địa chỉ), us_tin (Mã số thuế Hoa Kỳ / TIN). ' +
        'Set any missing sub-key to null. Return null when the option is not ticked or the table is empty.',
    },

    // Section I.4 purpose (1)
    {
      key: 'relationship_purpose',
      label: 'Mục đích quan hệ với VPBank',
      type: 'string[]',
      enum: [
        'Sử dụng dịch vụ thu, chi hộ',
        'Thanh toán, chuyển tiền, kinh doanh trong nước',
        'Thanh toán, chuyển tiền, kinh doanh quốc tế',
        'Quản lý dòng tiền',
        'Các mục đích khác phục vụ cho hoạt động vận hành tổ chức',
        'Khác',
      ],
      desc: 'Purpose of the relationship with VPBank under section I.4 — one array element per ticked option. If "Khác" is ticked, return that element as the free-text detail written after the colon instead of the bare word "Khác".',
    },

    // Section II registered services (1)
    {
      key: 'registered_services',
      label: 'Dịch vụ đăng ký',
      type: 'string[]',
      enum: [
        'Dịch vụ mở, sử dụng tài khoản thanh toán',
        'Dịch vụ Ngân hàng trực tuyến',
        'Dịch vụ Thẻ ghi nợ',
        'Giao dịch qua Email',
        'Giao dịch qua Fax',
        'Gói quản lý dòng tiền dành cho KH SME',
      ],
      desc: 'Requested services under section "II. ĐỀ NGHỊ ĐĂNG KÝ DỊCH VỤ CỦA KHÁCH HÀNG" — one array element per ticked service.',
    },

    // Section III.1 TKTT (1 object[] thay cho 11 flat keys)
    {
      key: 'tktt_accounts',
      label: 'TKTT — Danh sách tài khoản (III.1)',
      type: 'object[]',
      recordLabels: TKTT_ACCOUNT_ROW_LABELS,
      desc:
        'Section III.1 "THÔNG TIN ĐĂNG KÝ DỊCH VỤ MỞ, SỬ DỤNG TÀI KHOẢN THANH TOÁN" — return a JSON array with ONE object per row in the table. ' +
        'MB02 has exactly two rows: "TKTT thông thường" and "TKTT đặc biệt". ' +
        'Each object has: ' +
        'account_type (the row label exactly as printed — "TKTT thông thường" or "TKTT đặc biệt (Nêu rõ loại TK): …" including the special-type text filled in after the colon), ' +
        'currencies (JSON array of the ticked currency checkboxes on that row — each element is exactly one of "VND", "USD", "EURO", "Khác"; null if nothing is ticked), ' +
        'other_currency (when "Khác" is ticked, return the raw text written after "Khác" on that row EXACTLY as printed, verbatim and unmodified — e.g. "01 VND, 02USD, 01 JPY" — do not normalize, split, reorder, or drop any characters; null otherwise), ' +
        'beautiful_account_no (account number written after "Số:" inside the "Tài khoản số đẹp" column for that row; null if blank), ' +
        'beautiful_fee (pre-VAT fee written after "Phí (chưa VAT):" inside the "Tài khoản số đẹp" column for that row; null if blank). ' +
        'Return null if Section III.1 is entirely blank.',
    },

    // Section III.2 statement / e-invoice (3)
    { key: 'statement_frequency', label: 'Tần suất nhận sổ phụ / hóa đơn điện tử', desc: 'Statement/e-invoice frequency under section III.2 "Tần suất" — return ONLY the ticked value (e.g. "Hàng tháng"); null if nothing ticked.' },
    {
      key: 'statement_delivery_methods',
      label: 'Hình thức nhận sổ phụ / hóa đơn điện tử',
      type: 'string[]',
      enum: [
        'Trực tiếp tại VPBank',
        'Qua bưu điện',
        'Qua email',
        'Qua fax',
        'Nhận điện',
      ],
      desc: 'Delivery methods ticked under section III.2 "Hình thức nhận" — one array element per ticked label only (do NOT append emails inline); null if nothing ticked.',
    },
    { key: 'statement_email', label: 'Email nhận sổ phụ / hóa đơn điện tử', desc: 'The email address written next to "Qua email" under section III.2 "Hình thức nhận" — return exactly as written (e.g. "HOADON.HATEXCO@GMAIL.COM"); null if "Qua email" is not ticked or the email field is blank.' },

    // Section III.3 SMS Banking (1)
    { key: 'sms_banking_phones', label: 'Danh sách số điện thoại SMS Banking', type: 'string[]', desc: 'Up to 3 phone numbers taken from the "ĐTDĐ 1", "ĐTDĐ 2", "ĐTDĐ 3" rows in section III.3, in reading order. Skip any row that is blank.' },

    // Section III.4 QLDT (1)
    { key: 'qldt_package', label: 'Gói QLDT (SME)', desc: 'Selected QLDT package under section III.4 "Lựa chọn gói" — read the exact text of the selected/ticked option from the dropdown or list as it appears in the document (e.g. "VPSMEVIP1", "VPSMEVIP3"); null if nothing is selected.' },

    // Section IV online banking (6)
    // The first option's text is quoted from the form as printed — it contains a
    // typo ("các tài TKTT"), kept verbatim so a match is exact.
    { key: 'online_banking_account_choice', label: 'Ngân hàng trực tuyến — Tài khoản đăng ký', enum: ['TKTT được mở theo Giấy đề nghị này và các tài TKTT được mở mới sau này của Khách hàng tại VPBank', 'Khác'], desc: 'The ticked option under section IV.1.' },
    { key: 'online_banking_account_other', label: 'Ngân hàng trực tuyến — Khác', desc: 'If "Khác" is ticked in section IV.1, the free-text detail written after "Khác: …"; null otherwise.' },
    { key: 'online_banking_daily_limit', label: 'Ngân hàng trực tuyến — Hạn mức giao dịch/ngày', enum: ['Không giới hạn đối với tất cả các loại giao dịch', 'Khác'], desc: 'The ticked option under section IV.2.' },
    { key: 'online_banking_daily_limit_details', label: 'Ngân hàng trực tuyến — Chi tiết hạn mức', type: 'string[]', desc: 'If "Khác" is ticked in section IV.2, the free-text limit detail(s) written after "Hạn mức cụ thể: …" — one array element per detail line. Null otherwise.' },
    {
      key: 'online_banking_approval_mechanism',
      label: 'Cơ chế phê duyệt',
      type: 'string[]',
      enum: [
        'Một cấp vừa lập lệnh vừa duyệt lệnh',
        'Một cấp phê duyệt',
        'Nhiều cấp phê duyệt',
        'Phê duyệt đồng cấp',
        'Phê duyệt có thứ tự',
        'Khác',
      ],
      desc: 'Approval mechanism(s) ticked under section IV.4 "Cơ chế phê duyệt, Phương thức xác thực" — one array element per ticked mechanism.',
    },
    { key: 'online_banking_approval_details', label: 'Chi tiết cơ chế phê duyệt', type: 'string[]', desc: 'Complementary detail for section IV.4: number of participants after "số lượng người tham gia", number of levels after "số lượng cấp", or the free text after "Khác (vui lòng ghi rõ):" — one array element per detail.' },

    // Section V debit card (7)
    { key: 'debit_card_account_choice', label: 'Thẻ ghi nợ — Tài khoản gắn Thẻ', enum: ['Là TKTT mở theo Giấy đề nghị này', 'Khác'], desc: 'The ticked option under section V.1.' },
    { key: 'debit_card_account_other', label: 'Thẻ ghi nợ — Tài khoản khác', desc: 'If "Khác" is ticked in section V.1, the free-text account written after "Khác: …"; null otherwise.' },
    { key: 'debit_card_type', label: 'Loại thẻ phát hành', enum: ['Thẻ ghi nợ quốc tế VPBIZ DEBIT CASHBACK', 'Khác'], desc: 'The ticked card type under section V.2.' },
    { key: 'debit_card_type_other', label: 'Loại thẻ khác', desc: 'If "Khác" is ticked in section V.2, the free-text card type written after "Khác: …"; null otherwise.' },
    { key: 'debit_card_embossed_name', label: 'Tên in nổi trên thẻ', desc: 'The embossed name under section V.3 "Tên in nổi trên thẻ" — up to ~20 characters read from the row of letter checkboxes. Return the letters concatenated as printed; null if blank.' },
    { key: 'debit_card_delivery_method', label: 'Hình thức nhận Thẻ và PIN', enum: ['Khách hàng nhận trực tiếp tại quầy giao dịch của VPBank', 'Nhận trực tiếp tại địa chỉ của Khách hàng', 'Gửi chuyển phát nhanh/đảm bảo đến địa chỉ'], desc: 'The ticked delivery method under section V.4.' },
    { key: 'debit_card_delivery_address', label: 'Địa chỉ nhận Thẻ và PIN', desc: 'The address/branch written next to the ticked V.4 method (e.g. "VPBANK THANH DO" or a delivery address); null if blank.' },

    // Section V.5 card receiver (7)
    { key: 'card_receiver_full_name', label: 'Người nhận Thẻ và PIN — Họ tên', desc: 'Full name of the Card/PIN receiver under section V.5 "Đăng ký người nhận Thẻ và PIN", labeled "Họ tên".' },
    { key: 'card_receiver_id_type', label: 'Người nhận Thẻ và PIN — Loại GTTT', desc: 'Receiver\'s ID document type under section V.5, labeled "Loại GTTT" (e.g. "Thẻ CCCD").' },
    { key: 'card_receiver_id_no', label: 'Người nhận Thẻ và PIN — Số GTTT', desc: 'Receiver\'s ID document number under section V.5, labeled "Số GTTT".' },
    { key: 'card_receiver_id_issue_date', label: 'Người nhận Thẻ và PIN — Ngày cấp', desc: 'Receiver\'s ID issue date under section V.5, labeled "Ngày cấp". Return in DD/MM/YYYY format.' },
    { key: 'card_receiver_id_place_of_issue', label: 'Người nhận Thẻ và PIN — Nơi cấp', desc: 'Receiver\'s ID place of issue under section V.5, labeled "Nơi cấp".' },
    { key: 'card_receiver_phone', label: 'Người nhận Thẻ và PIN — Điện thoại', desc: 'Receiver\'s contact phone under section V.5, labeled "Điện thoại liên hệ".' },
    { key: 'card_receiver_email', label: 'Người nhận Thẻ và PIN — Email', desc: 'Receiver\'s contact email under section V.5, labeled "Email".' },

    // Bottom personal-data consent (1)
    {
      key: 'personal_data_consents',
      label: 'Đồng ý xử lý DLCN',
      type: 'string[]',
      desc: 'Data-protection consent options ticked under the bottom "III. XÁC NHẬN ĐỒNG Ý VỚI HOẠT ĐỘNG BẢO VỆ, XỬ LÝ DỮ LIỆU CÁ NHÂN" block — one array element per ticked option, using each option\'s leading short phrase (e.g. "Để cung cấp và bảo đảm việc cung cấp các SPDV …", "Để CTDL, Khách hàng được chủ động sử dụng …").',
    },

    // VPBank confirmation (1)
    { key: 'vpbank_signature_confirmation', label: 'Xác nhận chữ ký VPBank', enum: ['Xác nhận chứng kiến Khách hàng ký'], desc: 'VPBank signature confirmation — the ticked label; null if the checkbox is not ticked.' },
  ],
};

// ── Group 3 — Signatures Group 1 (legal reps + authorized reps) ────────────
const MB02_GROUP_SIG1: ExtractSchemaGroup = {
  name: 'signatures_group1',
  contextHint:
    'Focus ONLY on Section "VI. THÔNG TIN ĐĂNG KÝ, MẪU CHỮ KÝ CỦA ĐẠI DIỆN HỢP PHÁP, NGƯỜI ĐƯỢC ỦY QUYỀN SỬ DỤNG TKTT (NHÓM CHỮ KÝ THỨ NHẤT)" — subsection 1 (legal representatives) and subsection 2 (authorized representatives). Both lists may repeat (one entry per person block). Do NOT read Section VII (chief accountants) or any other part of the form.',
  aiFields: [
    {
      key: 'legal_representatives',
      label: 'Người đại diện hợp pháp (VI.1)',
      type: 'object[]',
      recordLabels: MB02_LEGAL_REP_LABELS,
      desc:
        'Section VI.1 "THÔNG TIN ĐĂNG KÝ, MẪU CHỮ KÝ CỦA NGƯỜI ĐẠI DIỆN PHÁP LUẬT" — the company may declare one OR MORE legal representatives, so return a JSON array with one object per person block. ' +
        'Each object has these keys (set any missing key to null): ' +
        'full_name (Họ và tên), sex (Giới tính — return ticked "Nam" or "Nữ"), date_of_birth (Ngày sinh — DD/MM/YYYY), occupation (Nghề nghiệp), position (Chức vụ), nationality (Quốc tịch), tax_code (Mã số thuế nếu có), ' +
        'id_document_type (Loại GTTT), id_no (Số GTTT), date_of_issue (Ngày cấp — DD/MM/YYYY), place_of_issue (Nơi cấp), date_of_expiry (Có giá trị đến — DD/MM/YYYY), phone (Điện thoại), email (Email), ' +
        'residency_status (Tình trạng cư trú — return ticked "Cư trú" or "Không cư trú"), ' +
        'is_legal_representative (true if "Là Đại diện hợp pháp của Chủ TK" checkbox is ticked, else false), ' +
        'role_label (full label text of whichever role checkbox is ticked at the top of the block; empty string if none), ' +
        'permanent_address (Địa chỉ thường trú), permanent_address_street (' + STREET_LEVEL_DESC + '), permanent_address_ward (' + WARD_LEVEL_DESC + '), permanent_address_district (' + DISTRICT_LEVEL_DESC + '), permanent_address_province (' + PROVINCE_LEVEL_DESC + '), ' +
        'current_address (Nơi ở hiện tại khác — null if absent), current_address_street (' + STREET_LEVEL_DESC + ' — null if absent), current_address_ward (' + WARD_LEVEL_DESC + ' — null if absent), current_address_district (' + DISTRICT_LEVEL_DESC + ' — null if absent), current_address_province (' + PROVINCE_LEVEL_DESC + ' — null if absent), ' +
        'visa_no (Số thị thực — null if not foreign), visa_place_of_issue (Nơi cấp thị thực — null if not foreign), visa_expiry_date (Ngày hết hạn thị thực — DD/MM/YYYY, null if not foreign), ' +
        'foreign_id_no (Số định danh người nước ngoài), foreign_residence_abroad_address (Địa chỉ nơi ĐK cư trú ở nước ngoài), foreign_residence_vietnam_address (Địa chỉ nơi ĐK cư trú ở Việt Nam), ' +
        'second_nationality (Quốc tịch — dual-citizenship block), second_passport_no (Số Hộ chiếu), second_passport_issue_date (Ngày cấp — DD/MM/YYYY), second_passport_place_of_issue (Nơi cấp), second_passport_expiry_date (Ngày hết hạn hiệu lực — DD/MM/YYYY), second_country_residence_address (Địa chỉ cư trú tại quốc gia mang quốc tịch còn lại), ' +
        'online_banking_registered (true if "Đăng ký sử dụng dịch vụ Ngân hàng trực tuyến" checkbox is ticked, else false), online_banking_function (Chức năng — e.g. "Duyệt lệnh"/"Lập lệnh"), online_banking_pin (Mã PIN), online_banking_approval_order (Thứ tự phê duyệt), online_banking_approval_limit (Hạn mức phê duyệt), online_banking_admin_type (Loại quản trị viên), online_banking_other (free text after "Khác:"), ' +
        'debit_card_registered (true if "Thông tin đăng ký sử dụng Thẻ ghi nợ" checkbox is ticked, else false), debit_card_role (ticked "Thẻ chính" or "Thẻ phụ"), debit_card_embossed_name (Tên in nổi trên Thẻ), debit_card_secret_question (Câu hỏi bí mật — default is ID issue date yyyymmdd), debit_card_purposes (multi-tick joined by ";" — "Nhận lương", "Quản lý dòng tiền", "Thanh toán, chuyển tiền trong nước", "Thanh toán, chuyển tiền quốc tế", "Mục đích khác phục vụ đời sống", "Khác"), debit_card_fatca_us_person (ticked "Không" or "Có"), debit_card_us_tin (US TIN written when "Có" is ticked), debit_card_beneficial_owner (ticked "Chủ sở hữu hưởng lợi chính là Người được ủy quyền sử dụng thẻ" or "Chủ sở hữu hưởng lợi là người khác: đề nghị cung cấp thông tin theo mẫu biểu của VPBank"), debit_card_is_trust_beneficiary (ticked "Không" or the "Có" variant). ' +
        'Return [] if the section is empty.',
    },
    {
      key: 'authorized_representatives',
      label: 'Đại diện theo ủy quyền / Người được ủy quyền sử dụng TKTT (VI.2)',
      type: 'object[]',
      recordLabels: MB02_AUTH_REP_LABELS,
      desc:
        'Section VI.2 "THÔNG TIN ĐĂNG KÝ, MẪU CHỮ KÝ CỦA ĐẠI DIỆN THEO ỦY QUYỀN / NGƯỜI ĐƯỢC ỦY QUYỀN SỬ DỤNG TKTT" — the company may declare one OR MORE persons, so return a JSON array with one object per person block. ' +
        'Each object uses the SAME sub-keys as legal_representatives (person basics, address block, foreign block, dual-citizenship block, online-banking sub-block, debit-card sub-block) — see that field\'s description for details — PLUS the following authorization-scope sub-keys: ' +
        'authorization_scope (ticked "Phạm vi và Thời hạn ủy quyền" option — either "Mặc định áp dụng theo Mục X của Giấy đề nghị này" or the phrase indicating a specific POA is used), ' +
        'authorization_poa_no (POA number written after "Văn bản ủy quyền số"; null if not declared), ' +
        'authorization_poa_date (POA date written after "ngày"; null if not declared), ' +
        'authorization_poa_grantor (granting entity written after "của …"; null if not declared). ' +
        'The role_label sub-key\'s ticked option here is "Là Đại diện hợp pháp của chủ TK - đại diện theo ủy quyền" OR "Người được ủy quyền sử dụng TKTT". ' +
        'Set any missing sub-key to null. Return [] if the section is empty.',
    },
  ],
};

// ── Group 4 — Signatures Group 2 (chief accountants + delegates) ──────────
const MB02_GROUP_SIG2: ExtractSchemaGroup = {
  name: 'signatures_group2',
  contextHint:
    'Focus ONLY on Section "VII. THÔNG TIN ĐĂNG KÝ, MẪU CHỮ KÝ CỦA KẾ TOÁN TRƯỞNG/ PHỤ TRÁCH KẾ TOÁN, NGƯỜI ĐƯỢC KẾ TOÁN TRƯỞNG/ PHỤ TRÁCH KẾ TOÁN ỦY QUYỀN (NHÓM CHỮ KÝ THỨ HAI)" — subsection 1 (chief accountants / PTKT) and subsection 2 (people delegated by the CA). Both lists may repeat. Do NOT read Section VI or any other part of the form. Note: Section VII does NOT include an online-banking sub-block — omit those keys entirely.',
  aiFields: [
    {
      key: 'chief_accountants',
      label: 'Kế toán trưởng / Phụ trách kế toán (VII.1)',
      type: 'object[]',
      recordLabels: MB02_CHIEF_ACCOUNTANT_LABELS,
      desc:
        'Section VII.1 "THÔNG TIN ĐĂNG KÝ, MẪU CHỮ KÝ CỦA KẾ TOÁN TRƯỞNG/PHỤ TRÁCH KẾ TOÁN" — the company may declare one OR MORE chief accountants, so return a JSON array with one object per person block. ' +
        'Each object has these keys (set any missing key to null): ' +
        'full_name, sex (ticked "Nam"/"Nữ"), date_of_birth (Ngày sinh — DD/MM/YYYY), occupation, position, nationality, tax_code, id_document_type, id_no, date_of_issue (Ngày cấp — DD/MM/YYYY), place_of_issue, date_of_expiry (Có giá trị đến — DD/MM/YYYY), phone, email, ' +
        'residency_status (ticked "Cư trú"/"Không cư trú"), ' +
        'is_legal_representative (this sub-key is ALWAYS false for chief accountants — they are not the legal rep of the account holder), ' +
        'role_label (empty string — Section VII persons do not have the same role-checkbox row as VI), ' +
        'permanent_address, permanent_address_street (' + STREET_LEVEL_DESC + '), permanent_address_ward, permanent_address_district, permanent_address_province, ' +
        'current_address, current_address_street (' + STREET_LEVEL_DESC + '), current_address_ward, current_address_district, current_address_province, ' +
        'visa_no, visa_place_of_issue, visa_expiry_date (DD/MM/YYYY), foreign_id_no, foreign_residence_abroad_address, foreign_residence_vietnam_address, second_nationality, second_passport_no, second_passport_issue_date (DD/MM/YYYY), second_passport_place_of_issue, second_passport_expiry_date (DD/MM/YYYY), second_country_residence_address, ' +
        'debit_card_registered (true if "Thông tin đăng ký sử dụng Thẻ ghi nợ" is ticked in this person\'s block), debit_card_role (ticked "Thẻ chính"/"Thẻ phụ"), debit_card_embossed_name, debit_card_secret_question, debit_card_purposes (multi-tick joined by ";"), debit_card_fatca_us_person (ticked "Không"/"Có"), debit_card_us_tin, debit_card_beneficial_owner, debit_card_is_trust_beneficiary. ' +
        'DO NOT include any online-banking sub-key here — Section VII persons do not register online banking on this form. ' +
        'Return [] if the section is empty.',
    },
    {
      key: 'authorized_by_chief_accountants',
      label: 'Người được KTT / PTKT ủy quyền (VII.2)',
      type: 'object[]',
      recordLabels: MB02_AUTH_CHIEF_ACCOUNTANT_LABELS,
      desc:
        'Section VII.2 "THÔNG TIN ĐĂNG KÝ, MẪU CHỮ KÝ CỦA NGƯỜI ĐƯỢC KTT/PHỤ TRÁCH KẾ TOÁN ỦY QUYỀN" — one OR MORE persons the chief accountant has delegated, so return a JSON array with one object per person block. ' +
        'Each object uses the SAME sub-keys as chief_accountants (person basics, address block, foreign block, dual-citizenship block, debit-card sub-block; NO online-banking sub-block) — see that field\'s description for details — PLUS the following authorization-scope sub-keys: ' +
        'authorization_scope (ticked "Phạm vi và Thời hạn ủy quyền" option), ' +
        'authorization_poa_no (POA number after "Văn bản ủy quyền số"; null if not declared), ' +
        'authorization_poa_date (POA date after "ngày"; null if not declared), ' +
        'authorization_poa_grantor (granting entity after "của …"; null if not declared). ' +
        'Set any missing sub-key to null. Return [] if the section is empty.',
    },
  ],
};

/**
 * MB02 — GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ VÀ SỬ DỤNG TÀI KHOẢN THANH TOÁN, DỊCH VỤ.
 * Multi-call schema: 4 groups extracted in parallel (see extract-engine.ts).
 */
const MB02_SCHEMA: MultiCallExtractSchema = {
  groups: [
    MB02_GROUP_ORG_AND_BRANCH,
    MB02_GROUP_SERVICES,
    MB02_GROUP_SIG1,
    MB02_GROUP_SIG2,
  ],
  fixedFields: [
    {
      key: 'title',
      label: 'Loại tài liệu',
      value: 'GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ VÀ SỬ DỤNG TÀI KHOẢN THANH TOÁN, DỊCH VỤ',
    },
  ],
};

// Fail fast at module load if a field key was accidentally declared in more
// than one group — the engine merges group outputs with Object.assign and
// otherwise a duplicate would silently let one group's answer clobber another.
validateGroupKeyUniqueness(MB02_SCHEMA);

// ═══════════════════════════════════════════════════════════════════════════
// MB03 — GIẤY ĐỀ NGHỊ CẬP NHẬT THÔNG TIN VÀ DỊCH VỤ
// ═══════════════════════════════════════════════════════════════════════════
//
// MB03 is a mixed "update-existing-account" form. Unlike MB02 (open new
// account), every subsection is OPTIONAL: the customer first ticks which
// service groups they want to update in Section 1 (8 top-level tick groups),
// then fills in ONLY the corresponding detail sections below. The form
// therefore carries ~200 potential sub-fields split across 6 detail sections,
// most of which will be blank on any given submission.
//
// Convention baked into MB03 by design: EVERY checkbox field returns an ARRAY
// of the ticked option labels (string[]) — never a single string or boolean.
// Even single-select checkboxes return a one-element array. Empty selections
// return []. This differs from MB02 where some tick fields were joined with
// ";" and some were single strings — MB03 is uniform. Downstream consumers
// can therefore always treat any *_choice / *_action / *_options / _consents
// field as a list, no per-field special-casing needed.
//
// Extracting ~200 fields plus 5+2+3=10 repeating people lists in a single LLM
// call is infeasible, so MB03 uses the same MultiCallExtractSchema shape as
// MB02, split into 6 groups (one more than MB02) to keep each call focused on
// a coherent slice of the form:
//   1. service_selection_and_org  — Section 1 (8 tick groups) + Section 2 (org info)
//   2. accounts_and_ancillary     — Section 3 (accounts) + KYC + Email + Fax + consent
//   3. personal_info_reps         — Section 4.I / 4.II / 4.III people lists
//   4. personal_info_accountants  — Section 4.IV / 4.V people lists
//   5. online_banking_service     — Section 5 service fields + V.1 + V.2 people
//   6. debit_card_service         — Section 6 service fields + main + supplementary holders
//
// Global rules from PAM_SYSTEM_PROMPT_HEADER + PAM_OUTPUT_FORMAT_HINT apply as
// with MB02: Vietnamese UPPERCASE without diacritics for strings; numbers and
// dates keep printed form; missing → null; empty checkbox groups → []; every
// string carries a trailing ⟨conf:0.NN⟩ marker.

// ── MB03 shared sub-key label maps (many people lists reuse the same Profile Block) ─

// The "Profile Block" MB03's spec calls out — 19 personal-basics fields that
// every people-list entry carries. Section 4 role blocks are essentially a
// Profile Block + a couple of role-specific tick fields; Section 5 V.2 new
// users and Section 6 cardholders repeat the same Profile Block too.
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

// Section 4 role-specific tick fields — the union of the four tick columns
// that appear across the 5 role blocks. Not every role has every sub-key
// (e.g. is_legal_authorized_rep only appears on I. and III.), but the label
// map is a superset so any renderer stays trivial.
const MB03_SECTION4_ROLE_LABELS: Record<string, string> = {
  action_type: 'Loại yêu cầu (ĐK/Thay đổi/Hủy)',
  is_legal_authorized_rep: 'Là Người ĐD hợp pháp của Chủ TK',
  // "Phạm vi và Thời hạn ủy quyền" tách rõ thành các trường con.
  // Khối mặc định: "…tại văn bản đăng ký mở và sử dụng TKTT số: … ngày …".
  authorization_default_tktt_no: 'Ủy quyền mặc định — Số TKTT',
  authorization_default_tktt_date: 'Ủy quyền mặc định — Ngày',
  // Khối "Trường hợp khác": "…áp dụng theo Văn bản ủy quyền số: … ngày … của …".
  authorization_other_poa_no: 'Trường hợp khác — Số văn bản ủy quyền',
  authorization_other_poa_date: 'Trường hợp khác — Ngày văn bản ủy quyền',
  authorization_other_poa_grantor: 'Trường hợp khác — Bên ủy quyền',
  // Chỉ áp dụng cho 4.II (ĐD theo ủy quyền) — khối "Trường hợp đăng ký mới Đại
  // diện theo ủy quyền … Trường hợp khác, áp dụng theo Văn bản ủy quyền số…".
  authorization_rep_other_poa_no: 'ĐD ủy quyền mới — Số văn bản ủy quyền',
  authorization_rep_other_poa_date: 'ĐD ủy quyền mới — Ngày văn bản ủy quyền',
  authorization_rep_other_poa_grantor: 'ĐD ủy quyền mới — Bên ủy quyền',
};

// Composed record labels — one per Section 4 people list.
const MB03_LEGAL_REP_LABELS: Record<string, string> = {
  ...MB03_PROFILE_BLOCK_LABELS,
  ...MB03_SECTION4_ROLE_LABELS,
};
const MB03_AUTH_REP_LABELS: Record<string, string> = {
  ...MB03_PROFILE_BLOCK_LABELS,
  ...MB03_SECTION4_ROLE_LABELS,
};
const MB03_AUTH_ACCOUNT_USER_LABELS: Record<string, string> = {
  ...MB03_PROFILE_BLOCK_LABELS,
  ...MB03_SECTION4_ROLE_LABELS,
};
const MB03_CHIEF_ACCOUNTANT_LABELS: Record<string, string> = {
  ...MB03_PROFILE_BLOCK_LABELS,
  ...MB03_SECTION4_ROLE_LABELS,
};
const MB03_AUTH_CHIEF_ACCOUNTANT_LABELS: Record<string, string> = {
  ...MB03_PROFILE_BLOCK_LABELS,
  ...MB03_SECTION4_ROLE_LABELS,
};

// Section 5 V.1 "existing user" sub-block — only 7 fields; the user already
// exists in VPBank's system so only the identifier + config keys are needed.
const MB03_ONLINE_BANKING_EXISTING_USER_LABELS: Record<string, string> = {
  action_type: 'Loại yêu cầu (ĐK/Thay đổi/Hủy)',
  full_name: 'Họ và tên',
  id_no: 'Số giấy tờ tùy thân',
  function: 'Chức năng',
  approval_order: 'Thứ tự phê duyệt',
  approval_limit: 'Hạn mức phê duyệt',
  admin_type: 'Loại quản trị viên',
};

// Section 5 V.2 "new user" sub-block — Profile Block PLUS these config keys.
const MB03_ONLINE_BANKING_NEW_USER_LABELS: Record<string, string> = {
  ...MB03_PROFILE_BLOCK_LABELS,
  action_type: 'Loại yêu cầu (ĐK mới)',
  function: 'Chức năng',
  approval_order: 'Thứ tự phê duyệt',
  pin: 'Mã PIN',
  approval_limit: 'Hạn mức phê duyệt',
  admin_type: 'Loại quản trị viên',
  other: 'Ghi chú khác',
  authorization_scope: 'Phạm vi ủy quyền',
  authorization_period: 'Thời hạn ủy quyền',
};

// Section 6 cardholder sub-block — Profile Block PLUS card-specific keys.
// Shared by main cardholder (I.6) and each supplementary cardholder (II.1+).
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

// ── Group 1 — Section 1 (service selection) + Section 2 (organization update) ─
const MB03_GROUP_SERVICE_AND_ORG: ExtractSchemaGroup = {
  name: 'service_selection_and_org',
  contextHint:
    'Focus ONLY on: the top page-1 tick grid where the customer chooses WHICH service groups they want to update (Section 1 — 8 groups of checkboxes), and Section 2 "A. ĐỀ NGHỊ SỬA ĐỔI THÔNG TIN KHÁCH HÀNG (TỔ CHỨC)" which details the organization info changes. Do NOT read Sections 3–8 or the personal-info / online-banking / debit-card blocks.',
  aiFields: [
    // Section 1 — the 8 top-level service-selection tick groups. Each MUST
    // be a JSON array of strings (the ticked labels, exactly as printed).
    { key: 'requested_services_org_info_changes', label: 'Nhóm dịch vụ: Thay đổi thông tin tổ chức', type: 'string[]', desc: 'Section 1 row "Thay đổi thông tin tổ chức" — return a JSON array containing the labels of every ticked option (from "Thay đổi tên tổ chức", "Thay đổi địa chỉ trụ sở/GD", "Thay đổi thông tin nhận thông báo", "Thay đổi mẫu dấu", "Thay đổi khác"). Return null if nothing is ticked.' },
    { key: 'requested_services_accounts', label: 'Nhóm dịch vụ: TK thanh toán & dịch vụ TK', type: 'string[]', desc: 'Section 1 row "TK thanh toán & dịch vụ TK" — return a JSON array containing the labels of every ticked option (from "Mở thêm TKTT", "Gói quản lý dòng tiền KH SME", "Phong tỏa TKTT", "Chấm dứt phong tỏa", "DV sổ phụ/hóa đơn điện tử", "Người giao nhận hồ sơ", "SMS banking", "Đóng TKTT"). Return null if nothing is ticked.' },
    { key: 'requested_services_personal_info', label: 'Nhóm dịch vụ: Thay đổi thông tin cá nhân', type: 'string[]', desc: 'Section 1 row "Thay đổi thông tin cá nhân" — return a JSON array containing the labels of every ticked option (from "ĐD pháp luật", "ĐD hợp pháp là ĐD ủy quyền", "Người được UQ sử dụng tài khoản", "Kế toán trưởng/PTKT", "Người được UQ của KTT/PTKT"). Return null if nothing is ticked.' },
    { key: 'requested_services_kyc_online', label: 'Nhóm dịch vụ: Gói sản phẩm KYC Online', type: 'string[]', desc: 'Section 1 row "Gói sản phẩm KYC Online" — return a JSON array containing "Nâng cấp Gói sản phẩm KYC Online" if that single checkbox is ticked; else null.' },
    { key: 'requested_services_online_banking', label: 'Nhóm dịch vụ: DV Ngân hàng trực tuyến', type: 'string[]', desc: 'Section 1 row "DV Ngân hàng trực tuyến" — return a JSON array containing the labels of every ticked option (from "Đăng ký mới", "Thay đổi thông tin (hạn mức, cơ chế...)", "Người sử dụng dịch vụ", "Chấm dứt sử dụng"). Return null if nothing is ticked.' },
    { key: 'requested_services_debit_card', label: 'Nhóm dịch vụ: Dịch vụ Thẻ ghi nợ', type: 'string[]', desc: 'Section 1 row "Dịch vụ Thẻ ghi nợ" — return a JSON array containing the labels of every ticked option (from "Phát hành Thẻ chính/phụ", "Cấp lại PIN/Thẻ", "Thay đổi hạn mức", "Đóng/Tất toán thẻ"). Return null if nothing is ticked.' },
    { key: 'requested_services_email', label: 'Nhóm dịch vụ: Dịch vụ Email', type: 'string[]', desc: 'Section 1 row "Dịch vụ Email" — return a JSON array containing the labels of every ticked option (from "Đăng ký mới", "Thay đổi", "Chấm dứt"). Return null if nothing is ticked.' },
    { key: 'requested_services_fax', label: 'Nhóm dịch vụ: Dịch vụ Fax', type: 'string[]', desc: 'Section 1 row "Dịch vụ Fax" — return a JSON array containing the labels of every ticked option (from "Đăng ký mới", "Thay đổi", "Chấm dứt"). Return null if nothing is ticked.' },

    // Section 2 — organization info updates. Read ONLY when the corresponding
    // sub-row is ticked; otherwise return null / [] as instructed per field.
    { key: 'org_name_new_vi', label: 'Tên tổ chức mới (tiếng Việt)', desc: 'Section 2.I "Thay đổi tên tổ chức" — the NEW Vietnamese organization name written on the "Tên tiếng Việt mới" line. Null if the row is blank or the parent I. checkbox is not ticked.' },
    { key: 'org_name_new_foreign', label: 'Tên tổ chức mới (tiếng nước ngoài)', desc: 'Section 2.I — the NEW foreign-language name written on the "Tên tiếng nước ngoài mới" line. Null if blank.' },
    { key: 'org_name_new_abbr', label: 'Tên viết tắt mới', desc: 'Section 2.I — the NEW abbreviation written on the "Tên viết tắt mới" line. Null if blank.' },
    { key: 'head_office_address_new', label: 'Địa chỉ trụ sở chính mới', desc: 'Section 2.II "Thay đổi địa chỉ" — the NEW head-office address written on the "Địa chỉ trụ sở chính mới" line. Null if blank.' },
    { key: 'transaction_address_new', label: 'Địa chỉ giao dịch mới', desc: 'Section 2.II — the NEW transaction address written on the "Địa chỉ giao dịch mới" line as a single full line; null if blank.' },
    { key: 'transaction_address_new_street', label: 'Địa chỉ giao dịch mới — Số nhà / Tầng / Tòa nhà, tên đường', desc: STREET_LEVEL_DESC },
    { key: 'transaction_address_new_ward', label: 'Địa chỉ giao dịch mới — Phường/Xã/Thị trấn', desc: WARD_LEVEL_DESC + ' null if blank.' },
    { key: 'transaction_address_new_district', label: 'Địa chỉ giao dịch mới — Quận/Huyện', desc: DISTRICT_LEVEL_DESC + ' null if blank.' },
    { key: 'transaction_address_new_province', label: 'Địa chỉ giao dịch mới — Tỉnh/Thành phố', desc: PROVINCE_LEVEL_DESC + ' null if blank.' },
    { key: 'phone_new', label: 'Số điện thoại mới', desc: 'Section 2.III "Thay đổi thông tin nhận TB" — the NEW notification phone number written on the "Số điện thoại mới" line. Null if blank.' },
    { key: 'email_new', label: 'Email mới', desc: 'Section 2.III — the NEW notification email written on the "Email mới" line. Null if blank.' },
    { key: 'seal_change_note', label: 'Ghi chú thay đổi mẫu dấu', desc: 'Section 2.IV "Thay đổi mẫu dấu mới" — this row is an IMAGE crop zone, not text. Return "Có mẫu dấu mới" if the row shows a stamped seal image; return "Không có" if the row is empty; return null if the entire Section 2.IV row is absent from the form. The image itself is captured separately by the crop-zone pipeline, not by this LLM.' },
    { key: 'org_other_changes_note', label: 'Nội dung thay đổi khác (tổ chức)', desc: 'Free-text detail written after "Thay đổi khác" in Section 2 when that row is ticked; null otherwise.' },
  ],
};

// ── Group 2 — Section 3 accounts + KYC + Email + Fax + consent ─────────────
const MB03_GROUP_ACCOUNTS_AND_ANCILLARY: ExtractSchemaGroup = {
  name: 'accounts_and_ancillary',
  contextHint:
    'Focus ONLY on: Section 3 "Tài khoản thanh toán & các dịch vụ liên quan" (subsections I. Mở thêm TKTT, II. Gói QLDT SME, III. Phong tỏa TKTT, IV. Chấm dứt phong tỏa, V. Sổ phụ / HĐ điện tử, VI. Giao nhận hồ sơ, VII. SMS Banking, VIII. Đóng TKTT), Section 4 (Gói sản phẩm KYC Online) upgrade row, Section 7 (Dịch vụ Email), Section 8 (Dịch vụ Fax), and the bottom personal-data consent + VPBank signature-confirmation blocks. Do NOT read Section 1 header ticks, Section 2 (organization update), Section 4 personal-info blocks, Section 5 (online banking) or Section 6 (debit card).',
  aiFields: [
    // 3.I Mở thêm TKTT
    {
      key: 'new_tktt_accounts',
      label: 'Mở TKTT — Danh sách tài khoản',
      type: 'object[]',
      recordLabels: TKTT_ACCOUNT_ROW_LABELS,
      desc:
        'Section 3.I "Mở thêm TKTT" — return a JSON array with ONE object per row in the table. ' +
        'Each object has: ' +
        'account_type (the account-type label exactly as printed in the "Loại tài khoản" column, e.g. "TKTT thông thường", "TKTT vốn đầu tư gián tiếp nước ngoài vào Việt Nam", or any other label written there), ' +
        'currencies (the raw text written in the "Loại tiền" cell for that row — the user may write free-form currency names or codes; return the text as-is, null if blank), ' +
        'quantity (the number written in the "Số lượng" column for that row; null if blank), ' +
        'beautiful_account_no (account number written after "Số tài khoản:" inside the "Tài khoản số đẹp" column for that row; null if blank), ' +
        'beautiful_fee (pre-VAT fee written after "Phí (chưa VAT):" inside the "Tài khoản số đẹp" column for that row; null if blank). ' +
        'Return null if Section 3.I is entirely blank.',
    },

    // 3.II Gói QLDT (SME)
    { key: 'qldt_actions', label: 'QLDT SME — Loại yêu cầu', type: 'string[]', desc: 'Section 3.II "Gói QLDT (SME)" — return a JSON array of the ticked action labels among "Đăng ký mới", "Chuyển đổi", "Hủy". Return null if nothing is ticked.' },
    { key: 'qldt_new_package', label: 'QLDT SME — Gói đăng ký mới', desc: 'Section 3.II "Đăng ký mới: Chọn gói" — the package name written after "Chọn gói:"; null if blank.' },
    { key: 'qldt_current_package', label: 'QLDT SME — Gói hiện tại', desc: 'Section 3.II "Chuyển đổi: Gói hiện tại" — the current package name; null if blank.' },
    { key: 'qldt_target_package', label: 'QLDT SME — Gói mới (chuyển đổi)', desc: 'Section 3.II "Chuyển đổi: Gói mới" — the target package name; null if blank.' },
    { key: 'qldt_cancel_package', label: 'QLDT SME — Gói hủy', desc: 'Section 3.II "Hủy: Chọn gói" — the package name to be cancelled; null if blank.' },
    { key: 'qldt_fee_account', label: 'QLDT SME — Số TK thu phí', desc: 'Section 3.II "Số TK thu phí" — the account number that pays the QLDT fee; null if blank.' },

    // 3.III Phong tỏa TKTT
    { key: 'block_account_no', label: 'Phong tỏa TKTT — Số TK', desc: 'Section 3.III "Phong tỏa TKTT" — the account number to be blocked; null if blank.' },
    { key: 'block_amount_number', label: 'Phong tỏa TKTT — Số tiền (số)', desc: 'Section 3.III — the block amount written in digits; null if blank.' },
    { key: 'block_amount_text', label: 'Phong tỏa TKTT — Số tiền (bằng chữ)', desc: 'Section 3.III — the block amount written in words; null if blank.' },
    { key: 'block_reason', label: 'Phong tỏa TKTT — Lý do', desc: 'Section 3.III — the reason for blocking; null if blank.' },
    { key: 'block_payment_instruction', label: 'Phong tỏa TKTT — Chỉ dẫn thanh toán', desc: 'Section 3.III — the payment instruction line ("Chỉ dẫn thanh toán"); null if blank.' },
    { key: 'block_duration_options', label: 'Phong tỏa TKTT — Thời hạn (tick)', type: 'string[]', desc: 'Section 3.III "Thời hạn" — return a JSON array of the ticked duration-option labels (there are typically 3 checkboxes: "Cho đến khi có thông báo mới", "Đến ngày ...", or a specific date range). Return null if nothing is ticked.' },
    { key: 'block_duration_from', label: 'Phong tỏa TKTT — Từ ngày', desc: 'Section 3.III — the block start date written after "Từ ngày"; null if blank.' },
    { key: 'block_duration_to', label: 'Phong tỏa TKTT — Đến ngày', desc: 'Section 3.III — the block end date written after "Đến ngày"; null if blank.' },

    // 3.IV Chấm dứt phong tỏa
    { key: 'unblock_account_no', label: 'Chấm dứt phong tỏa — Số TK', desc: 'Section 3.IV "Chấm dứt phong tỏa" — the account number to be unblocked; null if blank.' },
    { key: 'unblock_amount_number', label: 'Chấm dứt phong tỏa — Số tiền (số)', desc: 'Section 3.IV — the unblock amount written in digits; null if blank.' },
    { key: 'unblock_amount_text', label: 'Chấm dứt phong tỏa — Số tiền (bằng chữ)', desc: 'Section 3.IV — the unblock amount written in words; null if blank.' },
    { key: 'unblock_reason', label: 'Chấm dứt phong tỏa — Lý do', desc: 'Section 3.IV — the reason for lifting the block; null if blank.' },

    // 3.V Sổ phụ / HĐ điện tử — split into 6 sub-fields (statement + einvoice
    // each have their own action tick set + their own delivery detail).
    { key: 'statement_action', label: 'Sổ phụ — Loại yêu cầu', type: 'string[]', desc: 'Section 3.V "Sổ phụ" row — return a JSON array of the ticked action labels among "Đăng ký mới", "Thay đổi", "Hủy" pertaining to the "Sổ phụ" service specifically. Return null if nothing is ticked.' },
    { key: 'statement_frequency', label: 'Sổ phụ — Tần suất', type: 'string[]', desc: 'Section 3.V "Sổ phụ: Tần suất" — return a JSON array of the ticked frequency labels (e.g. "Hàng ngày", "Hàng tuần", "Hàng tháng"). Return null if nothing is ticked.' },
    { key: 'statement_delivery_methods', label: 'Sổ phụ — Hình thức nhận', type: 'string[]', desc: 'Section 3.V "Sổ phụ: Hình thức nhận" — return a JSON array of the ticked delivery-method labels, including any address/email written next to a ticked option as part of that entry. Return null if nothing is ticked.' },
    { key: 'einvoice_action', label: 'HĐĐT — Loại yêu cầu', type: 'string[]', desc: 'Section 3.V "Hóa đơn điện tử" row — return a JSON array of the ticked action labels among "Đăng ký mới", "Thay đổi", "Hủy" pertaining to the "HĐĐT" service specifically. Return null if nothing is ticked.' },
    { key: 'einvoice_delivery_methods', label: 'HĐĐT — Hình thức nhận', type: 'string[]', desc: 'Section 3.V "HĐĐT: Hình thức nhận" — return a JSON array of the ticked e-invoice delivery-method labels (e.g. "Qua email", "Trực tiếp tại VPBank"), each including any address/email written next to a ticked option. Return null if nothing is ticked.' },
    { key: 'einvoice_email', label: 'HĐĐT — Email nhận', desc: 'Section 3.V "HĐĐT: Email nhận" — the email address for receiving electronic invoices; null if blank.' },

    // 3.VI Giao nhận hồ sơ
    { key: 'document_handover_action', label: 'Giao nhận hồ sơ — Loại yêu cầu', type: 'string[]', desc: 'Section 3.VI "Người giao nhận hồ sơ" — return a JSON array of the ticked action labels among "Đăng ký mới", "Thay đổi", "Hủy bỏ". Return null if nothing is ticked.' },

    // 3.VII SMS Banking
    { key: 'sms_banking_account_no', label: 'SMS Banking — Số TK', desc: 'Section 3.VII "SMS Banking" — the linked account number; null if blank.' },
    { key: 'sms_banking_phone', label: 'SMS Banking — SĐT nhận biến động', desc: 'Section 3.VII — the phone number that will receive SMS notifications; null if blank.' },
    { key: 'sms_banking_action', label: 'SMS Banking — Loại yêu cầu', type: 'string[]', desc: 'Section 3.VII — return a JSON array of the ticked action labels among "Đăng ký mới", "Hủy bỏ". Return null if nothing is ticked.' },

    // 3.VIII Đóng TKTT
    { key: 'close_tktt_account_nos', label: 'Đóng TKTT — Danh sách số TK', type: 'string[]', desc: 'Section 3.VIII "Đóng TKTT" — return a JSON array of the account numbers to be closed, each element being one account number exactly as printed. Return null if nothing is declared.' },

    // Section 4 (customer-facing list #4) — Gói sản phẩm KYC Online
    { key: 'kyc_online_upgrade', label: 'Gói KYC Online — Yêu cầu', type: 'string[]', desc: 'The "Nâng cấp Gói sản phẩm KYC Online" row — return a JSON array containing "Nâng cấp Gói sản phẩm KYC Online" if the checkbox is ticked; else null.' },

    // Section 7 — Dịch vụ Email
    { key: 'email_service_action', label: 'Dịch vụ Email — Loại yêu cầu', type: 'string[]', desc: 'Section 7 "Dịch vụ Email" — return a JSON array of the ticked action labels among "Đăng ký mới", "Thay đổi", "Chấm dứt". Return null if nothing is ticked.' },
    { key: 'email_service_address', label: 'Dịch vụ Email — Địa chỉ Email', desc: 'Section 7 — the email address written on the service form; null if blank.' },

    // Section 8 — Dịch vụ Fax
    { key: 'fax_service_action', label: 'Dịch vụ Fax — Loại yêu cầu', type: 'string[]', desc: 'Section 8 "Dịch vụ Fax" — return a JSON array of the ticked action labels among "Đăng ký mới", "Thay đổi", "Chấm dứt". Return null if nothing is ticked.' },
    { key: 'fax_service_number', label: 'Dịch vụ Fax — Số Fax', desc: 'Section 8 — the fax number written on the service form; null if blank.' },

    // Bottom personal-data consent + VPBank confirmation
    { key: 'personal_data_consents', label: 'Đồng ý xử lý DLCN', type: 'string[]', desc: 'Personal-data protection consent block at the bottom of the form — return a JSON array of the ticked consent labels (each label as its leading short phrase). Return null if nothing is ticked.' },
    { key: 'vpbank_signature_confirmation', label: 'Xác nhận chữ ký VPBank', type: 'string[]', desc: 'VPBank signature confirmation checkbox at the bottom of the form — return a JSON array containing "Xác nhận chứng kiến Khách hàng ký" when ticked; else null.' },
  ],
};

// ── Group 3 — Section 4 (I / II / III) people lists ────────────────────────
const MB03_GROUP_PERSONAL_INFO_REPS: ExtractSchemaGroup = {
  name: 'personal_info_reps',
  contextHint:
    'Focus ONLY on Section 4 "Thay đổi thông tin các cá nhân liên quan", subsections I. Đại diện theo pháp luật, II. ĐD hợp pháp (Ủy quyền), and III. Người UQ sử dụng TK. Each subsection is a repeating people list (one Profile Block per person). Do NOT read subsections IV or V (they are handled by another group) and do NOT read any other section of the form.',
  aiFields: [
    {
      key: 'legal_representatives',
      label: 'Đại diện theo pháp luật (Section 4.I)',
      type: 'object[]',
      recordLabels: MB03_LEGAL_REP_LABELS,
      desc:
        'Section 4.I "Đại diện theo pháp luật" — return a JSON array with one object per person block declared. ' +
        'Each object has these keys (set any missing key to null; every checkbox field is a JSON array of ticked labels, [] when nothing is ticked): ' +
        'action_type (JSON array of ticked labels among "Đăng ký mới", "Thay đổi", "Khác"), ' +
        'is_legal_authorized_rep (JSON array containing "Là Người ĐD hợp pháp của Chủ TK" when that checkbox is ticked; else null), ' +
        'full_name, date_of_birth (DD/MM/YYYY), sex (ticked "Nam"/"Nữ"), occupation, position, nationality, tax_code, ' +
        'id_document_type, id_no, date_of_issue (DD/MM/YYYY), place_of_issue, date_of_expiry (DD/MM/YYYY), ' +
        'phone, email, residency_status (ticked "Cư trú"/"Không cư trú"), permanent_address, permanent_address_street (' + STREET_LEVEL_DESC + '), permanent_address_ward, permanent_address_district, permanent_address_province, ' +
        'visa_no (null if not foreign), visa_place_of_issue (null if not foreign), visa_expiry_date (DD/MM/YYYY, null if not foreign). ' +
        'Return null if the subsection is empty.',
    },
    {
      key: 'authorized_representatives',
      label: 'ĐD hợp pháp — Ủy quyền (Section 4.II)',
      type: 'object[]',
      recordLabels: MB03_AUTH_REP_LABELS,
      desc:
        'Section 4.II "ĐD hợp pháp (Ủy quyền)" — return a JSON array with one object per person block declared. ' +
        'Each object has the same 19 Profile Block keys as legal_representatives (see that field\'s description) PLUS: ' +
        'action_type (JSON array of ticked labels among "Đăng ký mới", "Thay đổi", "Hủy bỏ"). ' +
        'The "Phạm vi và Thời hạn ủy quyền" block is split into 8 sub-keys (set each to null if the blank is empty): ' +
        'authorization_default_tktt_no (the TKTT number filled in after "Mặc định áp dụng theo nội dung ủy quyền tại văn bản đăng ký mở và sử dụng TKTT số:"), ' +
        'authorization_default_tktt_date (the date after that clause\'s "ngày", DD/MM/YYYY), ' +
        'authorization_other_poa_no (the POA number after "Trường hợp khác, áp dụng theo Văn bản ủy quyền số:"), ' +
        'authorization_other_poa_date (the date after that clause\'s "ngày", DD/MM/YYYY), ' +
        'authorization_other_poa_grantor (the granting entity after that clause\'s "của"), ' +
        'authorization_rep_other_poa_no (the POA number in the second block "Trường hợp đăng ký mới Đại diện theo ủy quyền … Trường hợp khác, áp dụng theo Văn bản ủy quyền số:"), ' +
        'authorization_rep_other_poa_date (the date after that second block\'s "ngày", DD/MM/YYYY), ' +
        'authorization_rep_other_poa_grantor (the granting entity after that second block\'s "của"). ' +
        'is_legal_authorized_rep is NOT applicable here — omit it or set to []. ' +
        'Return null if the subsection is empty.',
    },
    {
      key: 'authorized_account_users',
      label: 'Người UQ sử dụng TK (Section 4.III)',
      type: 'object[]',
      recordLabels: MB03_AUTH_ACCOUNT_USER_LABELS,
      desc:
        'Section 4.III "Người UQ sử dụng TK" — return a JSON array with one object per person block declared. ' +
        'Each object has the same 19 Profile Block keys as legal_representatives PLUS: ' +
        'action_type (JSON array of ticked labels among "Đăng ký mới", "Thay đổi", "Hủy bỏ"), ' +
        'is_legal_authorized_rep (JSON array containing "Là Người ĐD hợp pháp của Chủ TK" when that checkbox is ticked; else null). ' +
        'The "Phạm vi và Thời hạn ủy quyền" block is split into 5 sub-keys (set each to null if the blank is empty): ' +
        'authorization_default_tktt_no (the TKTT number after "Mặc định áp dụng theo nội dung ủy quyền tại văn bản đăng ký mở và sử dụng TKTT số:"), ' +
        'authorization_default_tktt_date (the date after that clause\'s "ngày", DD/MM/YYYY), ' +
        'authorization_other_poa_no (the POA number after "Trường hợp khác, áp dụng theo Văn bản ủy quyền số:"), ' +
        'authorization_other_poa_date (the date after that clause\'s "ngày", DD/MM/YYYY), ' +
        'authorization_other_poa_grantor (the granting entity after that clause\'s "của"). ' +
        'Return null if the subsection is empty.',
    },
  ],
};

// ── Group 4 — Section 4 (IV / V) people lists ──────────────────────────────
const MB03_GROUP_PERSONAL_INFO_ACCOUNTANTS: ExtractSchemaGroup = {
  name: 'personal_info_accountants',
  contextHint:
    'Focus ONLY on Section 4 "Thay đổi thông tin các cá nhân liên quan", subsections IV. Kế toán trưởng/PTKT and V. Ủy quyền KTT/PTKT. Each subsection is a repeating people list (one Profile Block per person). Do NOT read subsections I / II / III (handled by another group) and do NOT read any other section of the form.',
  aiFields: [
    {
      key: 'chief_accountants',
      label: 'Kế toán trưởng / PTKT (Section 4.IV)',
      type: 'object[]',
      recordLabels: MB03_CHIEF_ACCOUNTANT_LABELS,
      desc:
        'Section 4.IV "Kế toán trưởng/PTKT" — return a JSON array with one object per person block declared. ' +
        'Each object has the 19 Profile Block keys (full_name, date_of_birth (DD/MM/YYYY), sex — ticked "Nam"/"Nữ", occupation, position, nationality, tax_code, id_document_type, id_no, date_of_issue (DD/MM/YYYY), place_of_issue, date_of_expiry (DD/MM/YYYY), phone, email, residency_status — ticked "Cư trú"/"Không cư trú", permanent_address, permanent_address_street (' + STREET_LEVEL_DESC + '), permanent_address_ward, permanent_address_district, permanent_address_province, visa_no, visa_place_of_issue, visa_expiry_date (DD/MM/YYYY, null if not foreign)) PLUS: ' +
        'action_type (JSON array of ticked labels among "Đăng ký mới", "Thay đổi", "Khác"). ' +
        'Return null if the subsection is empty.',
    },
    {
      key: 'authorized_by_chief_accountants',
      label: 'Ủy quyền KTT / PTKT (Section 4.V)',
      type: 'object[]',
      recordLabels: MB03_AUTH_CHIEF_ACCOUNTANT_LABELS,
      desc:
        'Section 4.V "Ủy quyền KTT/PTKT" — return a JSON array with one object per person block declared. ' +
        'Each object has the same 19 Profile Block keys as chief_accountants PLUS: ' +
        'action_type (JSON array of ticked labels among "Đăng ký mới", "Thay đổi", "Hủy bỏ"). ' +
        'The "Phạm vi và Thời hạn ủy quyền" block is split into 5 sub-keys (set each to null if the blank is empty): ' +
        'authorization_default_tktt_no (the TKTT number after "Mặc định áp dụng theo nội dung ủy quyền tại văn bản đăng ký mở và sử dụng TKTT số:"), ' +
        'authorization_default_tktt_date (the date after that clause\'s "ngày", DD/MM/YYYY), ' +
        'authorization_other_poa_no (the POA number after "Trường hợp khác, áp dụng theo Văn bản ủy quyền số:"), ' +
        'authorization_other_poa_date (the date after that clause\'s "ngày", DD/MM/YYYY), ' +
        'authorization_other_poa_grantor (the granting entity after that clause\'s "của"). ' +
        'Return null if the subsection is empty.',
    },
  ],
};

// ── Group 5 — Section 5 online banking (service fields + V.1 + V.2) ────────
const MB03_GROUP_ONLINE_BANKING: ExtractSchemaGroup = {
  name: 'online_banking_service',
  contextHint:
    'Focus ONLY on Section 5 "Dịch vụ Ngân hàng trực tuyến" — the service-level configuration rows (loại yêu cầu chung, I. Tài khoản đăng ký, II. TK thanh toán phí, III. Hạn mức giao dịch, IV. Cơ chế phê duyệt) and the two people lists V.1 (Người dùng đã có TT) and V.2 (Người dùng chưa có TT). Do NOT read Section 6 (debit card) or any other section.',
  aiFields: [
    // Service-level fields
    { key: 'online_banking_actions', label: 'NHTT — Loại yêu cầu chung', type: 'string[]', desc: 'Section 5 top "Loại yêu cầu chung" — return a JSON array of the ticked action labels among "Đăng ký mới", "Thay đổi", "Chấm dứt dịch vụ". Return null if nothing is ticked.' },
    { key: 'online_banking_account_choice', label: 'NHTT — Tài khoản đăng ký', type: 'string[]', desc: 'Section 5.I "Tài khoản đăng ký" — return a JSON array of the ticked labels among "Tất cả TKTT", "Khác". Return null if nothing is ticked.' },
    { key: 'online_banking_account_other', label: 'NHTT — TK khác', desc: 'Section 5.I — the free-text account details written after "Khác:" when that option is ticked; null otherwise.' },
    { key: 'online_banking_fee_account_no', label: 'NHTT — Số TK thu phí', desc: 'Section 5.II "TK thanh toán phí" — the fee-payment account number; null if blank.' },
    { key: 'online_banking_daily_limit_choice', label: 'NHTT — Hạn mức giao dịch', type: 'string[]', desc: 'Section 5.III "Hạn mức giao dịch" — return a JSON array of the ticked labels among "Không giới hạn", "Khác". Return null if nothing is ticked.' },
    { key: 'online_banking_daily_limit_details', label: 'NHTT — Chi tiết hạn mức', desc: 'Section 5.III — the free-text specific limits written when "Khác" is ticked (join multi-line details with "; "); null otherwise.' },
    { key: 'online_banking_approval_mechanism', label: 'NHTT — Cơ chế phê duyệt', type: 'string[]', desc: 'Section 5.IV "Cơ chế phê duyệt" — return a JSON array of the ticked mechanism labels (from "Một cấp vừa lập vừa duyệt", "Một cấp duyệt", "Nhiều cấp duyệt", "Đồng cấp số lượng", "Có thứ tự số lượng", "Khác"). Return null if nothing is ticked.' },
    { key: 'online_banking_approval_details', label: 'NHTT — Chi tiết cơ chế phê duyệt', desc: 'Section 5.IV — complementary numeric details (participant counts, level counts) or the free text after "Khác:". Join multiple details with "; "; null if none.' },

    // V.1 existing user list
    {
      key: 'online_banking_existing_users',
      label: 'NHTT — V.1 Người dùng đã có TT',
      type: 'object[]',
      recordLabels: MB03_ONLINE_BANKING_EXISTING_USER_LABELS,
      desc:
        'Section 5.V.1 "Người dùng đã có TT" — this table lists users who ALREADY exist in VPBank\'s system, so only identifier + config keys are required (no full Profile Block). Return a JSON array with one object per row. ' +
        'Each object has: ' +
        'action_type (JSON array of ticked labels among "Đăng ký", "Thay đổi", "Hủy"), ' +
        'full_name, id_no, function (Chức năng — e.g. "Duyệt lệnh"/"Lập lệnh"), approval_order (Thứ tự phê duyệt), approval_limit (Hạn mức), admin_type (Loại QTV). ' +
        'Set any missing key to null. Return null if the table is empty.',
    },

    // V.2 new user list — full profile block + config + authorization
    {
      key: 'online_banking_new_users',
      label: 'NHTT — V.2 Người dùng chưa có TT',
      type: 'object[]',
      recordLabels: MB03_ONLINE_BANKING_NEW_USER_LABELS,
      desc:
        'Section 5.V.2 "Người dùng chưa có TT" — this list creates BRAND NEW users, so each row carries the FULL 19-field Profile Block plus service-config keys. Return a JSON array with one object per person block. ' +
        'Each object has ALL 19 Profile Block keys (full_name, date_of_birth (DD/MM/YYYY), sex — ticked "Nam"/"Nữ", occupation, position, nationality, tax_code, id_document_type, id_no, date_of_issue (DD/MM/YYYY), place_of_issue, date_of_expiry (DD/MM/YYYY), phone, email, residency_status, permanent_address, permanent_address_street (' + STREET_LEVEL_DESC + '), permanent_address_ward, permanent_address_district, permanent_address_province, visa_no, visa_place_of_issue, visa_expiry_date (DD/MM/YYYY, null if not foreign)) PLUS: ' +
        'action_type (JSON array containing "Đăng ký mới" when ticked; else null), ' +
        'function (Chức năng), approval_order (Thứ tự duyệt), pin (Mã PIN), approval_limit (Hạn mức), admin_type (Loại QTV), other (free text after "Khác:"), ' +
        'authorization_scope (JSON array of ticked labels for "Phạm vi ủy quyền"), authorization_period (free-text tenure after "Thời hạn:"; null if blank). ' +
        'Set any missing key to null. Return [] if the section is empty.',
    },
  ],
};

// ── Group 6 — Section 6 debit card (service + main + supplementary holders) ─
const MB03_GROUP_DEBIT_CARD: ExtractSchemaGroup = {
  name: 'debit_card_service',
  contextHint:
    'Focus ONLY on Section 6 "Dịch vụ Thẻ ghi nợ" — the service-level fields (I.1 TKTT gắn thẻ, I.2 Loại thẻ, I.3 Tên in nổi trên thẻ, I.4 Hình thức nhận Thẻ & PIN, I.5 Người nhận), the main cardholder block (I.6 Người sử dụng thẻ chính, one or more persons), and the supplementary card section (II. Mở thẻ phụ — with II.1 first supplementary holder, and optionally II.2+ additional supplementary holders). Do NOT read any other section of the form.',
  aiFields: [
    // I.1 — I.5 service-level fields
    { key: 'debit_card_account_choice', label: 'Thẻ ghi nợ — Tài khoản gắn thẻ', type: 'string[]', desc: 'Section 6.I.1 "TKTT gắn thẻ" — return a JSON array of the ticked labels among "Số TK", "Khác". Return null if nothing is ticked.' },
    { key: 'debit_card_account_other', label: 'Thẻ ghi nợ — TK khác', desc: 'Section 6.I.1 — the free-text account written when "Khác" is ticked; null otherwise. If "Số TK" is ticked, the account number written on that same row also belongs here.' },
    { key: 'debit_card_type', label: 'Thẻ ghi nợ — Loại thẻ', type: 'string[]', desc: 'Section 6.I.2 "Loại thẻ" — return a JSON array of the ticked labels among "VPBIZ DEBIT CASHBACK", "Khác". Return null if nothing is ticked.' },
    { key: 'debit_card_type_other', label: 'Thẻ ghi nợ — Loại thẻ khác', desc: 'Section 6.I.2 — the free-text card type written when "Khác" is ticked; null otherwise.' },
    { key: 'debit_card_embossed_name', label: 'Thẻ ghi nợ — Tên in nổi (service-level)', desc: 'Section 6.I.3 "Tên in nổi trên thẻ" — the embossed name read from the row of letter checkboxes / boxed characters. Return the letters concatenated as printed; null if blank.' },
    { key: 'debit_card_delivery_method', label: 'Thẻ ghi nợ — Hình thức nhận Thẻ & PIN', type: 'string[]', desc: 'Section 6.I.4 "Hình thức nhận Thẻ & PIN" — return a JSON array of the ticked delivery-method labels among "Tại quầy", "Tại địa chỉ KH", "Bưu điện". Return null if nothing is ticked.' },
    { key: 'debit_card_delivery_address', label: 'Thẻ ghi nợ — Địa chỉ nhận', desc: 'Section 6.I.4 — the address / branch written next to the ticked delivery method; null if blank.' },
    { key: 'debit_card_receiver_name', label: 'Thẻ ghi nợ — Người nhận (nếu có)', desc: 'Section 6.I.5 "Người nhận (nếu có)" — the receiver\'s full name written on that row; null if blank.' },

    // II. supplementary condition — 4 sub-fields per user's spec:
    // 2 tick conditions + 2 text fields (main card no + main card embossed name).
    { key: 'debit_card_supplementary_condition', label: 'Thẻ phụ — Điều kiện mở', type: 'string[]', desc: 'Section 6.II "Mở thẻ phụ" — return a JSON array of the ticked condition labels among "Đồng thời cùng thẻ chính", "Thẻ chính đã có". Return null if nothing is ticked.' },
    { key: 'debit_card_supplementary_open_together_note', label: 'Thẻ phụ — Ghi chú "Đồng thời cùng thẻ chính"', desc: 'Section 6.II — any free-text note or reference written on the "Đồng thời cùng thẻ chính" row (usually blank — the option is a plain tick). Return the text as printed, or null if blank.' },
    { key: 'debit_card_supplementary_main_card_no', label: 'Thẻ phụ — Số thẻ chính đã có', desc: 'Section 6.II — the primary card number written when "Thẻ chính đã có" is ticked; null otherwise.' },
    { key: 'debit_card_supplementary_main_card_embossed_name', label: 'Thẻ phụ — Tên in nổi trên thẻ chính đã có', desc: 'Section 6.II — the embossed name on the existing primary card written when "Thẻ chính đã có" is ticked; null otherwise.' },

    // I.6 main cardholder list
    {
      key: 'debit_card_main_holders',
      label: 'Thẻ ghi nợ — Người sử dụng thẻ chính (I.6)',
      type: 'object[]',
      recordLabels: MB03_CARDHOLDER_LABELS,
      desc:
        'Section 6.I.6 "Người sử dụng thẻ chính" — the form may declare one or more main cardholders (rare but supported), so return a JSON array with one object per person block. ' +
        'Each object has ALL 19 Profile Block keys (full_name, date_of_birth (DD/MM/YYYY), sex — ticked "Nam"/"Nữ", occupation, position, nationality, tax_code, id_document_type, id_no, date_of_issue (DD/MM/YYYY), place_of_issue, date_of_expiry (DD/MM/YYYY), phone, email, residency_status, permanent_address, permanent_address_street (' + STREET_LEVEL_DESC + '), permanent_address_ward, permanent_address_district, permanent_address_province, visa_no, visa_place_of_issue, visa_expiry_date (DD/MM/YYYY, null if not foreign)) PLUS the card-specific keys: ' +
        'embossed_name_on_card (Tên in nổi trên thẻ for this holder), ' +
        'card_authorization (free text about "Ủy quyền sử dụng thẻ"; null if blank), ' +
        'card_purposes (JSON array of ticked labels among the 5 purpose options — "Nhận lương", "Quản lý dòng tiền", "Thanh toán, chuyển tiền trong nước", "Thanh toán, chuyển tiền quốc tế", "Mục đích khác phục vụ đời sống"), ' +
        'fatca_us_person (JSON array of ticked labels among "Không", "Có"), ' +
        'us_tin (U.S. TIN written when "Có" is ticked; null otherwise), ' +
        'beneficial_owner (JSON array of ticked labels among "Chủ sở hữu hưởng lợi chính là Người được ủy quyền sử dụng thẻ", "Chủ sở hữu hưởng lợi là người khác"), ' +
        'legal_agreement (JSON array of ticked labels for the 2 "Thỏa thuận pháp lý" tickboxes — return each ticked option\'s full label), ' +
        'dlcn_consent (JSON array of ticked labels for the 3 "Xác nhận bảo vệ DLCN" tickboxes — return each ticked option\'s full label). ' +
        'Set any missing key to null. Return null if the subsection is empty.',
    },

    // Supplementary cardholder list
    {
      key: 'debit_card_supplementary_holders',
      label: 'Thẻ ghi nợ — Chủ thẻ phụ (II.1 và tiếp theo)',
      type: 'object[]',
      recordLabels: MB03_CARDHOLDER_LABELS,
      desc:
        'Section 6.II supplementary cardholder blocks — the form may declare one OR MORE supplementary cardholders (II.1 "Chủ thẻ phụ thứ nhất", II.2 second, etc.). Each supplementary block has the same shape as the main cardholder block. Return a JSON array with one object per supplementary person block, in printed order. ' +
        'Each object uses the SAME sub-keys as debit_card_main_holders (full 19-field Profile Block + embossed_name_on_card + card_authorization + card_purposes + fatca_us_person + us_tin + beneficial_owner + legal_agreement + dlcn_consent) — see that field\'s description for details. ' +
        'Set any missing key to null. Return null if no supplementary cardholder is declared.',
    },
  ],
};

/**
 * MB03 — GIẤY ĐỀ NGHỊ CẬP NHẬT THÔNG TIN VÀ DỊCH VỤ.
 *
 * Multi-call schema: 6 groups extracted in parallel (see extract-engine.ts).
 * Every checkbox field returns a JSON array of ticked-option labels (string[]),
 * per the form-wide convention noted in the header comment above.
 */
const MB03_SCHEMA: MultiCallExtractSchema = {
  groups: [
    MB03_GROUP_SERVICE_AND_ORG,
    MB03_GROUP_ACCOUNTS_AND_ANCILLARY,
    MB03_GROUP_PERSONAL_INFO_REPS,
    MB03_GROUP_PERSONAL_INFO_ACCOUNTANTS,
    MB03_GROUP_ONLINE_BANKING,
    MB03_GROUP_DEBIT_CARD,
  ],
  fixedFields: [
    {
      key: 'title',
      label: 'Loại tài liệu',
      value: 'GIẤY ĐỀ NGHỊ CẬP NHẬT THÔNG TIN VÀ DỊCH VỤ',
    },
  ],
};

// Same rationale as MB02 — fail fast at module load if any group declared a
// duplicate top-level key, since Object.assign would silently clobber.
validateGroupKeyUniqueness(MB03_SCHEMA);

// ═══════════════════════════════════════════════════════════════════════════
// MB04 — GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ VÀ SỬ DỤNG TÀI KHOẢN THANH TOÁN CHUNG
// ═══════════════════════════════════════════════════════════════════════════
//
// MB04 opens a JOINT payment account for TWO organizations (Chủ Tài Khoản 1
// and Chủ Tài Khoản 2 — CTK1 / CTK2). The form mirrors MB02's shape twice:
// every organization-info field appears once for CTK1 (Section I) and once
// for CTK2 (Section II); every people list (legal reps, authorized reps,
// chief accountants, authorized-by-CA) also appears once per side. Section
// IV holds the shared joint-account services, and Sections VI / VII / IX
// hold shared registrations (seal, handover person, DLCN consent).
//
// Same checkbox rule as MB03: every tick field returns string[] of ticked
// labels ([] when nothing is ticked). Text fields return the printed value
// or null when blank.
//
// The file uses 6 extraction groups to keep each LLM call focused on a single
// half of the form:
//   1. org_ctk1            — Section I organization info for holder 1
//   2. org_ctk2            — Section II organization info for holder 2
//   3. joint_services      — Section IV joint TKTT + Sổ phụ/HĐĐT + SMS
//   4. people_ctk1         — CTK1's 4 people lists (V.1.1 / V.1.2 / VI.2.1 / VI.2.2)
//   5. people_ctk2         — CTK2's 4 people lists (same shape, mirrored)
//   6. seals_and_consent   — Section VI seal registration + VII handover + IX DLCN
//
// Global rules from PAM_SYSTEM_PROMPT_HEADER + PAM_OUTPUT_FORMAT_HINT apply
// as with MB02 / MB03: Vietnamese UPPERCASE without diacritics, ⟨conf:0.NN⟩
// markers, missing → null, empty tick sets → [].

// ── MB04 shared sub-key label maps ──────────────────────────────────────────

/**
 * MB04's Profile Block — 19 personal-basics fields per the user's spec. This
 * is the same as the MB03 Profile Block. Every people-list entry (all 8 lists
 * across the two CTK sides) uses this same block.
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

/**
 * MB04 role-specific tick fields. `is_legal_authorized_rep` and
 * `is_authorized_account_user` only apply to certain roles (see role-specific
 * label maps below); collecting them into a superset keeps the renderer trivial.
 */
const MB04_ROLE_TICK_LABELS: Record<string, string> = {
  is_legal_authorized_rep: 'Là Người ĐD hợp pháp của Chủ TK',
  is_authorized_account_user: 'Là Người được UQ sử dụng TK',
};

// Composed record labels — one per role (same shape on both CTK sides).
const MB04_LEGAL_REP_LABELS: Record<string, string> = {
  ...MB04_PROFILE_BLOCK_LABELS,
  is_legal_authorized_rep: MB04_ROLE_TICK_LABELS.is_legal_authorized_rep,
};
const MB04_AUTH_REP_LABELS: Record<string, string> = {
  ...MB04_PROFILE_BLOCK_LABELS,
  ...MB04_ROLE_TICK_LABELS,
};
const MB04_CHIEF_ACCOUNTANT_LABELS: Record<string, string> = {
  ...MB04_PROFILE_BLOCK_LABELS,
};
const MB04_AUTH_CHIEF_ACCOUNTANT_LABELS: Record<string, string> = {
  ...MB04_PROFILE_BLOCK_LABELS,
};

// ── MB04 organization-info group factory ────────────────────────────────────
// The two CTK sides declare the SAME 33 org fields. Rather than duplicate them
// verbatim across two group definitions, this factory stamps out a group given
// the side identifier ('ctk1' / 'ctk2'). Every top-level key on the resulting
// group carries a `_ctk1` or `_ctk2` suffix so validateGroupKeyUniqueness can
// keep enforcing global-key uniqueness across the 6-group schema.
//
// The Section-numbering differs by side (Section I on CTK1 vs Section II on
// CTK2), so the contextHint and every `desc` string references the matching
// Roman numeral — pass it in via the `section` param.
function buildMb04OrgGroup(
  side: 'ctk1' | 'ctk2',
  section: 'I' | 'II',
  sideName: 'THỨ NHẤT' | 'THỨ HAI',
): ExtractSchemaGroup {
  const s = `_${side}`;
  const sec = section;
  // Two variants of the holder identifier:
  //   holderHeading — ALL-CAPS matching the form's printed heading (used in
  //                   contextHint so the LLM can string-match the heading).
  //   holder        — Title case for reviewer-facing labels (nicer to read).
  const holderHeading = `CHỦ TÀI KHOẢN ${sideName}`;
  const holder = `Chủ Tài Khoản ${sideName === 'THỨ NHẤT' ? 'Thứ Nhất' : 'Thứ Hai'}`;
  const holderLower = `chủ tài khoản ${sideName === 'THỨ NHẤT' ? 'thứ nhất' : 'thứ hai'}`;
  return {
    name: `org_${side}`,
    contextHint:
      `Focus ONLY on Section "${sec}. THÔNG TIN ${holderHeading}" of the joint-account form MB04 — the entire organization-info block of that ONE holder (organization identity, address, contact, business sector, SME extras, FATCA classification, relationship purpose). Do NOT read the OTHER holder's section, Section IV (joint services), Sections V–IX (people lists, seals, handover, consent), or any other part of the form.`,
    aiFields: [
      // Thông tin cơ bản (10 fields)
      { key: `org_name_vi${s}`, label: `${holder} — Tên tổ chức (tiếng Việt)`, desc: `Full organization name in Vietnamese for ${holderLower}, labeled "Tên tiếng Việt" under Section ${sec}.` },
      { key: `org_name_foreign${s}`, label: `${holder} — Tên tổ chức (tiếng nước ngoài)`, desc: `Full organization name in a foreign language for ${holderLower}, labeled "Tên tiếng nước ngoài" under Section ${sec}. Null if blank.` },
      { key: `org_short_name${s}`, label: `${holder} — Tên viết tắt`, desc: `Organization abbreviation / short name for ${holderLower}, labeled "Tên viết tắt". Null if blank.` },
      { key: `business_registration_no${s}`, label: `${holder} — Số ĐKDN/QĐTL`, desc: `Enterprise / establishment-decision number for ${holderLower}, labeled "ĐKDN/QĐTL số" under Section ${sec}.` },
      { key: `establishment_date${s}`, label: `${holder} — Ngày ĐK / thành lập`, desc: `Establishment / registration date for ${holderLower}, labeled "Ngày ĐK" under Section ${sec}. Return in DD/MM/YYYY format.` },
      { key: `registration_place${s}`, label: `${holder} — Nơi cấp`, desc: `Issuing authority / place of registration for ${holderLower}, labeled "Nơi cấp" under Section ${sec}.` },
      { key: `establishment_country${s}`, label: `${holder} — Quốc gia thành lập`, desc: `Country of establishment for ${holderLower}, labeled "Quốc gia" under Section ${sec}.` },
      { key: `tax_code${s}`, label: `${holder} — Mã số thuế`, desc: `Enterprise / tax code for ${holderLower}, labeled "Mã số thuế" (MST) under Section ${sec}.` },
      { key: `org_identification_no${s}`, label: `${holder} — Số định danh của tổ chức`, desc: `Organization identification number for ${holderLower}, labeled "Số định danh" under Section ${sec}. Null if absent.` },
      { key: `state_budget_relation_code${s}`, label: `${holder} — Mã ĐV có QH với NSNN`, desc: `Code of a unit having a relationship with the state budget for ${holderLower}, labeled "Mã đơn vị có QH với NSNN" under Section ${sec}. Null if absent.` },

      // Địa chỉ & Liên hệ (8 fields)
      { key: `residency_status${s}`, label: `${holder} — Tình trạng cư trú`, type: 'string[]', desc: `Residency-status checkbox under Section ${sec} for ${holderLower} — return a JSON array containing the ticked label ("Cư trú" or "Không cư trú"); [] if nothing ticked.` },
      { key: `head_office_address${s}`, label: `${holder} — Địa chỉ trụ sở chính`, desc: `Head-office address for ${holderLower}, labeled "Địa chỉ trụ sở chính" under Section ${sec}. Often the boilerplate "Theo ghi nhận tại ĐKDN/QĐTL nêu trên" — return as written.` },
      { key: `transaction_address_type${s}`, label: `${holder} — Loại địa chỉ giao dịch`, type: 'string[]', desc: `Transaction-address-type checkbox under Section ${sec} "Địa chỉ giao dịch" — return a JSON array containing the ticked label ("Giống địa chỉ trụ sở chính" or "Khác"); [] if nothing ticked.` },
      { key: `other_address_line${s}`, label: `${holder} — Địa chỉ khác (toàn dòng)`, desc: `The ENTIRE "Khác" address as a single line written after "Khác" under Section ${sec} for ${holderLower} (only when "Khác" is ticked); null otherwise.` },
      { key: `other_address_street${s}`, label: `${holder} — Địa chỉ khác — Số nhà / Tầng / Tòa nhà, tên đường`, desc: STREET_LEVEL_DESC },
      { key: `other_address_ward${s}`, label: `${holder} — Phường/Xã (địa chỉ khác)`, desc: `Ward name written on the "Phường/xã" line of the "Khác" address under Section ${sec}; null when the "Khác" option is not ticked or the line is blank.` },
      { key: `other_address_district${s}`, label: `${holder} — Quận/Huyện (địa chỉ khác)`, desc: `District written on the "Quận/Huyện" line of the "Khác" address under Section ${sec}; null when the "Khác" option is not ticked or the line is blank.` },
      { key: `other_address_province${s}`, label: `${holder} — Tỉnh/TP (địa chỉ khác)`, desc: `Province / city written on the "Tỉnh/Thành phố" line of the "Khác" address under Section ${sec}; null when the "Khác" option is not ticked or the line is blank.` },
      { key: `phone${s}`, label: `${holder} — Số điện thoại`, desc: `Organization phone number for ${holderLower}, labeled "Điện thoại" under Section ${sec}.` },
      { key: `email${s}`, label: `${holder} — Email`, desc: `Organization email used for VPBank notifications for ${holderLower}, labeled "Email" under Section ${sec}.` },

      // Lĩnh vực kinh doanh (2 fields)
      { key: `main_business_sector${s}`, label: `${holder} — Tên ngành`, desc: `Main business sector name for ${holderLower}, labeled "Tên ngành" (Lĩnh vực kinh doanh chính) under Section ${sec}.` },
      { key: `business_sector_code${s}`, label: `${holder} — Mã ngành (cấp 5)`, desc: `Business sector code (level 5) for ${holderLower}, labeled "Mã ngành (cấp 5)" under Section ${sec}.` },

      // SME (5 fields)
      { key: `sme_micro_enterprise${s}`, label: `${holder} — Quy mô doanh nghiệp siêu nhỏ`, type: 'string[]', desc: `Return a JSON array containing "Quy mô doanh nghiệp siêu nhỏ và áp dụng chế độ kế toán đơn giản" when that checkbox is ticked under Section ${sec} for ${holderLower}; else null.` },
      { key: `sme_previous_year_revenue${s}`, label: `${holder} — Doanh thu năm trước (tỷ đồng)`, type: 'string[]', desc: `Previous-year revenue band under Section ${sec} for ${holderLower} — return a JSON array containing the ticked band label (one of "<=3", "trên 3-10", "trên 10-20", "trên 20-30", "trên 30-50", "trên 50-100", "trên 100-200", "trên 200-300", "trên 300-400", "trên 400"); [] if nothing ticked.` },
      { key: `sme_total_capital${s}`, label: `${holder} — Tổng nguồn vốn (tỷ đồng)`, type: 'string[]', desc: `Total-capital band under Section ${sec} for ${holderLower} — return a JSON array containing the ticked band label (one of "<=3", "3-20", "20-50", "50-100", ">100"); [] if nothing ticked.` },
      { key: `sme_social_insurance_employees${s}`, label: `${holder} — Số lao động BHXH (người)`, type: 'string[]', desc: `Social-insurance-employees band under Section ${sec} for ${holderLower} — return a JSON array containing the ticked band label (one of "<=10", "10-50", "50-100", "100-200", ">200"); [] if nothing ticked.` },
      { key: `sme_woman_owned${s}`, label: `${holder} — Sở hữu bởi phụ nữ`, type: 'string[]', desc: `Woman-owned declaration under "KH có được sở hữu bởi phụ nữ không" under Section ${sec} for ${holderLower} — return a JSON array containing the ticked-option label; if a free-text answer is written, wrap it as a single-element array; [] if nothing ticked.` },

      // FATCA (2 fields)
      { key: `fatca_us_tax_code${s}`, label: `${holder} — Mã số thuế Hoa Kỳ`, desc: `US tax code for ${holderLower} — labeled "Mã số thuế Hoa Kỳ của tổ chức" in the FATCA sub-block of Section ${sec}. Null if the organization is not a US-law entity.` },
      { key: `fatca_classification${s}`, label: `${holder} — Phân loại FATCA`, type: 'string[]', desc: `FATCA classification for ${holderLower} under Section ${sec} — return a JSON array of the ticked classification labels (e.g. "Tổ chức phi tài chính chủ động", "Tổ chức phi tài chính bị động", "Tổ chức tài chính, vui lòng cung cấp thông tin theo Mẫu biểu W-8BEN-E", "Không thuộc một trong các trường hợp trên đây"). [] if nothing ticked.` },

      // Mục đích, bản chất mối quan hệ (2 fields — 6 OCR tick options collapsed to 1 array + 1 khác text)
      { key: `relationship_purposes${s}`, label: `${holder} — Mục đích quan hệ với VPBank`, type: 'string[]', desc: `Purpose-of-relationship checkboxes under Section ${sec} for ${holderLower} — return a JSON array of the ticked labels (from "Sử dụng dịch vụ thu, chi hộ", "Thanh toán, chuyển tiền, kinh doanh trong nước", "Thanh toán, chuyển tiền, kinh doanh quốc tế", "Quản lý dòng tiền", "Các mục đích khác phục vụ cho hoạt động vận hành tổ chức", "Khác"). [] if nothing ticked.` },
      { key: `relationship_purpose_other${s}`, label: `${holder} — Mục đích khác (nêu rõ)`, desc: `Free-text detail written after "Khác:" in the relationship-purpose block under Section ${sec} for ${holderLower}; null when the "Khác" option is not ticked.` },
    ],
  };
}

const MB04_GROUP_ORG_CTK1: ExtractSchemaGroup = buildMb04OrgGroup('ctk1', 'I', 'THỨ NHẤT');
const MB04_GROUP_ORG_CTK2: ExtractSchemaGroup = buildMb04OrgGroup('ctk2', 'II', 'THỨ HAI');

// ── Group 3 — Section IV joint TKTT + Sổ phụ/HĐĐT + SMS Banking ────────────
const MB04_GROUP_JOINT_SERVICES: ExtractSchemaGroup = {
  name: 'joint_services',
  contextHint:
    'Focus ONLY on Section "IV. ĐĂNG KÝ THÔNG TIN TÀI KHOẢN THANH TOÁN CHUNG & CÁC DỊCH VỤ" of MB04 — the shared joint-account setup (currency, beautiful number, statement / e-invoice frequency and delivery, SMS Banking phones). Do NOT read the organization-info sections (I / II), the personal-info sections (V / VI), the seal / handover / consent sections (VI / VII / IX), or any other part of the form.',
  aiFields: [
    // Loại tài khoản — 6 OCR sub-fields per user's spec (4 currency ticks + tk số đẹp + số TK)
    { key: 'joint_tktt_currencies', label: 'TKTT chung — Loại tiền', type: 'string[]', desc: 'Section IV "Loại tài khoản" — return a JSON array of the ticked currency labels among "VND", "USD", "EURO", "Khác". [] if nothing ticked.' },
    { key: 'joint_tktt_currency_other', label: 'TKTT chung — Loại tiền khác', desc: 'Section IV — the free-text value written after "Khác" (only when "Khác" is ticked); accept any text the user has written — do NOT restrict to known currency codes; null if blank or "Khác" is not ticked.' },
    { key: 'joint_tktt_beautiful_number', label: 'TKTT chung — Tài khoản số đẹp', type: 'string[]', desc: 'Section IV "Tài khoản số đẹp" — return a JSON array containing "Tài khoản số đẹp" when the checkbox is ticked; else null.' },
    { key: 'joint_tktt_account_no', label: 'TKTT chung — Số tài khoản', desc: 'Section IV — the account number written after "Số:"; null if blank.' },

    // Sổ phụ / HĐ điện tử (3 fields)
    { key: 'statement_frequency', label: 'Sổ phụ / HĐĐT — Tần suất', type: 'string[]', desc: 'Section IV "Sổ phụ / Hóa đơn điện tử: Tần suất" — return a JSON array of the ticked frequency labels (e.g. "Hàng ngày", "Hàng tuần", "Hàng tháng"). [] if nothing ticked.' },
    { key: 'statement_delivery_methods', label: 'Sổ phụ / HĐĐT — Hình thức nhận', type: 'string[]', desc: 'Section IV "Hình thức nhận" — return a JSON array of the ticked delivery-method labels, each including any address / email / branch name written next to the ticked option as part of that entry. [] if nothing ticked.' },
    { key: 'statement_delivery_email_or_address', label: 'Sổ phụ / HĐĐT — Email / Địa chỉ nhận', desc: 'Section IV — the free-text email address or physical delivery address written on the "Email / Địa chỉ" line under the delivery-method row. Null if blank.' },

    // SMS Banking (3 fields — one per phone slot)
    { key: 'sms_banking_phones', label: 'SMS Banking — Danh sách số điện thoại', type: 'string[]', desc: 'Section IV "SMS Banking" — return a JSON array of up to 3 phone strings read from the "ĐTDĐ 1", "ĐTDĐ 2", "ĐTDĐ 3" rows in reading order. Skip any row that is blank. Return null if all are blank.' },
  ],
};

// ── People-group factory — mirrors people_ctk1 and people_ctk2 ──────────────
// Each CTK side has 4 people lists (legal reps, authorized reps, chief
// accountants, authorized-by-CA). The four lists share the same 18-field
// Profile Block and differ only in their tick sub-keys. The factory below
// stamps out one people-group per side; keys are suffixed with `_ctk1` /
// `_ctk2` so validateGroupKeyUniqueness holds.
// 
// IMPORTANT: MB04's on-paper section numbering has a KNOWN DUPLICATE — Section
// "VI." is used TWICE (once for CTK2's people block, and again for the joint
// seal-registration block that follows Section VI's people list). The
// contextHint below disambiguates by naming the full section title (which
// contains the CTK holder name for people, or "ĐĂNG KÝ MẪU DẤU" for the seal).
function buildMb04PeopleGroup(
  side: 'ctk1' | 'ctk2',
  sideName: 'THỨ NHẤT' | 'THỨ HAI',
  sectionRoman: 'V' | 'VI',
): ExtractSchemaGroup {
  const s = `_${side}`;
  // ALL-CAPS heading for the LLM prompt (to match the paper form),
  // title case for reviewer-facing labels.
  const holderHeading = `CHỦ TÀI KHOẢN ${sideName}`;
  const holder = `Chủ Tài Khoản ${sideName === 'THỨ NHẤT' ? 'Thứ Nhất' : 'Thứ Hai'}`;
  const holderLower = `${sideName === 'THỨ NHẤT' ? 'thứ nhất' : 'thứ hai'}`;
  // Explicit disambiguation for CTK2 — Section VI is also used later for the
  // joint seal-registration block, so we anchor the LLM on the exact heading.
  const dupNote =
    sectionRoman === 'VI'
      ? ' WARNING: The form uses the Roman numeral "VI." TWICE — once for this people block (heading contains "THÔNG TIN ĐĂNG KÝ CỦA CHỦ TÀI KHOẢN THỨ HAI") and once further down the form for "VI. ĐĂNG KÝ MẪU DẤU..." (seal registration). Read ONLY the FIRST occurrence — the one whose heading names the account holder — and stop before "ĐĂNG KÝ MẪU DẤU".'
      : '';

  return {
    name: `people_${side}`,
    contextHint:
      `Focus ONLY on Section "${sectionRoman}. THÔNG TIN ĐĂNG KÝ CỦA ${holderHeading}" on MB04 — its four subsections: "1.1 THÔNG TIN NGƯỜI ĐẠI DIỆN PHÁP LUẬT", "1.2 THÔNG TIN ĐĂNG KÝ, MẪU CHỮ KÝ CỦA ĐẠI DIỆN THEO ỦY QUYỀN, NGƯỜI ĐƯỢC SỬ DỤNG TK", "2.1 THÔNG TIN KẾ TOÁN TRƯỞNG / PHỤ TRÁCH KẾ TOÁN", and "2.2 NGƯỜI ĐƯỢC KTT / PHỤ TRÁCH KẾ TOÁN ỦY QUYỀN". Each subsection is a repeating people list (one Profile Block per person block). Do NOT read the OTHER holder's Section ${sectionRoman === 'V' ? 'VI' : 'V'} people block, the organization-info sections (I / II), the joint-account section (IV), or the seal / handover / consent sections.${dupNote}`,
    aiFields: [
      {
        key: `legal_representatives${s}`,
        label: `${holder} — Đại diện pháp luật (1.1)`,
        type: 'object[]',
        recordLabels: MB04_LEGAL_REP_LABELS,
        desc:
          `Subsection "1.1 THÔNG TIN NGƯỜI ĐẠI DIỆN PHÁP LUẬT ${holder}" — the ${holderLower} holder may declare one OR MORE legal representatives, so return a JSON array with one object per person block. ` +
          'Each object has these 19 Profile Block keys (set any missing key to null): ' +
          'full_name, date_of_birth (DD/MM/YYYY), sex (JSON array of ticked labels among "Nam", "Nữ"), occupation, position, nationality, tax_code, id_document_type, id_no, date_of_issue (DD/MM/YYYY), place_of_issue, date_of_expiry (DD/MM/YYYY), phone, email, ' +
          'residency_status (JSON array of ticked labels among "Cư trú", "Không cư trú"), ' +
          'permanent_address (Địa chỉ thường trú — null if absent), permanent_address_street (' + STREET_LEVEL_DESC + ' — null if absent), permanent_address_ward (' + WARD_LEVEL_DESC + ' — null if absent), permanent_address_district (' + DISTRICT_LEVEL_DESC + ' — null if absent), permanent_address_province (' + PROVINCE_LEVEL_DESC + ' — null if absent), ' +
          'visa_no (null if not foreign), visa_place_of_issue (null if not foreign), visa_expiry_date (DD/MM/YYYY, null if not foreign), ' +
          'PLUS the role tick: is_legal_authorized_rep (JSON array containing "Là Người ĐD hợp pháp của Chủ TK" when that checkbox is ticked in this person\'s block; else null). ' +
          'Return null if the subsection is empty.',
      },
      {
        key: `authorized_representatives${s}`,
        label: `${holder} — Đại diện ủy quyền (1.2)`,
        type: 'object[]',
        recordLabels: MB04_AUTH_REP_LABELS,
        desc:
          `Subsection "1.2 THÔNG TIN NGƯỜI ĐẠI DIỆN ỦY QUYỀN ${holder}" — the ${holderLower} holder may declare one OR MORE authorized representatives, so return a JSON array with one object per person block. ` +
          'Each object has the SAME 19 Profile Block keys as legal_representatives (see that field\'s description) PLUS two role ticks: ' +
          'is_legal_authorized_rep (JSON array containing "ĐD hợp pháp là ĐD UQ" when that checkbox is ticked; else null), ' +
          'is_authorized_account_user (JSON array containing "Người được UQ sử dụng TK" when that checkbox is ticked; else null). ' +
          'Return null if the subsection is empty.',
      },
      {
        key: `chief_accountants${s}`,
        label: `${holder} — Kế toán trưởng / PTKT (2.1)`,
        type: 'object[]',
        recordLabels: MB04_CHIEF_ACCOUNTANT_LABELS,
        desc:
          `Subsection "2.1 THÔNG TIN KẾ TOÁN TRƯỞNG ${holder}" — the ${holderLower} holder may declare one OR MORE chief accountants, so return a JSON array with one object per person block. ` +
          'Each object has the SAME 19 Profile Block keys as legal_representatives (see that field\'s description). No role tick sub-keys apply to this list. ' +
          'Return null if the subsection is empty.',
      },
      {
        key: `authorized_by_chief_accountants${s}`,
        label: `${holder} — Người được KTT ủy quyền (2.2)`,
        type: 'object[]',
        recordLabels: MB04_AUTH_CHIEF_ACCOUNTANT_LABELS,
        desc:
          `Subsection "2.2 THÔNG TIN NGƯỜI ĐƯỢC KẾ TOÁN TRƯỞNG ỦY QUYỀN ${holder}" — the ${holderLower} holder may declare one OR MORE persons the chief accountant has delegated, so return a JSON array with one object per person block. ` +
          'Each object has the SAME 19 Profile Block keys as legal_representatives (see that field\'s description). No role tick sub-keys apply to this list. ' +
          'Return null if the subsection is empty.',
      },
    ],
  };
}

const MB04_GROUP_PEOPLE_CTK1: ExtractSchemaGroup = buildMb04PeopleGroup('ctk1', 'THỨ NHẤT', 'V');
const MB04_GROUP_PEOPLE_CTK2: ExtractSchemaGroup = buildMb04PeopleGroup('ctk2', 'THỨ HAI', 'VI');

// ── Group 6 — Section VI (seal) + VII (handover) + IX (DLCN consent) ───────
// WARNING: The MB04 form uses the Roman numeral "VI." TWICE — once for CTK2's
// people block ("VI. THÔNG TIN ĐĂNG KÝ CỦA CHỦ TÀI KHOẢN THỨ HAI", read by the
// people_ctk2 group) and again for THIS seal-registration block ("VI. ĐĂNG KÝ
// MẪU DẤU SỬ DỤNG TÀI KHOẢN THANH TOÁN CHUNG", read here). The contextHint
// below anchors on the second occurrence via its "ĐĂNG KÝ MẪU DẤU" heading.
const MB04_GROUP_SEALS_AND_CONSENT: ExtractSchemaGroup = {
  name: 'seals_and_consent',
  contextHint:
    'Focus ONLY on THREE sections that follow the CTK2 people block on MB04: the SECOND "VI. ..." block whose heading is "VI. ĐĂNG KÝ MẪU DẤU SỬ DỤNG TÀI KHOẢN THANH TOÁN CHUNG" (joint-account seal registration — NOT the earlier Section VI which is CTK2 people), then Section "VII. ĐĂNG KÝ NGƯỜI GIAO NHẬN HỢP ĐỒNG, VĂN BẢN, CHỨNG TỪ" (document handover person), and finally Section "IX. XÁC NHẬN ĐỒNG Ý VỚI HOẠT ĐỘNG BẢO VỆ, XỬ LÝ DỮ LIỆU CÁ NHÂN" (personal-data consent), plus the VPBank signature-confirmation checkbox at the very bottom of MB04. Do NOT read the organization-info sections (I / II), the joint-account section (IV), the CTK1 people section (V), the CTK2 people section (the FIRST "VI."), or Section VIII (Ủy quyền of CTK / KTT — no fields required here).',
  aiFields: [
    // Section VI — seal registration (2 ticks + 1 free-text)
    { key: 'seal_registration_options', label: 'Mẫu dấu — Đăng ký', type: 'string[]', desc: 'Section VI "ĐĂNG KÝ MẪU DẤU" — return a JSON array of the ticked labels among "Đăng ký mẫu dấu của Chủ TK thứ nhất", "Đăng ký mẫu dấu của Chủ TK thứ hai". [] if nothing ticked.' },
    { key: 'seal_other_principle', label: 'Mẫu dấu — Nguyên tắc khác', desc: 'Section VI — the free-text principle written on the "Nguyên tắc khác" line when the customer overrides the default seal-usage rule; null if blank.' },
    { key: 'seal_image_note', label: 'Mẫu dấu — Ghi chú vùng đóng dấu', desc: 'Section VI seal-image row — return "Có mẫu dấu" when a stamped seal image is present, "Không có" when the row is empty. The seal image itself is captured separately by the crop-zone pipeline.' },

    // Section VII — document handover person (1 field — block presence + free-form summary)
    { key: 'document_handover_note', label: 'Giao nhận hồ sơ — Ghi chú', desc: 'Section VII "NGƯỜI GIAO NHẬN HỒ SƠ" — return "Có thông tin" when the handover-person block is filled in, "Không có" when the block is empty. The block\'s details (name, ID, contact) are captured separately by the crop-zone pipeline and downstream handover-person schema.' },

    // Section IX — DLCN personal-data consent (1 array field per the user's rule)
    { key: 'personal_data_consents', label: 'Đồng ý xử lý DLCN', type: 'string[]', desc: 'Section IX "XÁC NHẬN ĐỒNG Ý VỚI HOẠT ĐỘNG BẢO VỆ, XỬ LÝ DỮ LIỆU CÁ NHÂN" — return a JSON array of the ticked consent labels (use each option\'s leading short phrase — typically "Để cung cấp và bảo đảm việc cung cấp các SPDV", "Để CTDL, Khách hàng được chủ động sử dụng hệ sinh thái VPBank", "Để nâng cao trải nghiệm và gia tăng lợi ích cho CTDL / Marketing"). [] if nothing ticked.' },

    // VPBank signature confirmation
    { key: 'vpbank_signature_confirmation', label: 'Xác nhận chữ ký VPBank', type: 'string[]', desc: 'VPBank signature confirmation checkbox at the bottom of MB04 — return a JSON array containing "Xác nhận chứng kiến Khách hàng ký" when ticked; else null.' },
  ],
};

/**
 * MB04 — GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ VÀ SỬ DỤNG TÀI KHOẢN THANH TOÁN CHUNG.
 *
 * Multi-call schema: 6 groups extracted in parallel (see extract-engine.ts).
 * The two CTK sides use suffixed keys (`*_ctk1` / `*_ctk2`) so top-level keys
 * stay globally unique across groups; per-record sub-keys are the same on
 * both sides (a person is a person, regardless of which holder side they
 * belong to).
 */
const MB04_SCHEMA: MultiCallExtractSchema = {
  groups: [
    MB04_GROUP_ORG_CTK1,
    MB04_GROUP_ORG_CTK2,
    MB04_GROUP_JOINT_SERVICES,
    MB04_GROUP_PEOPLE_CTK1,
    MB04_GROUP_PEOPLE_CTK2,
    MB04_GROUP_SEALS_AND_CONSENT,
  ],
  fixedFields: [
    {
      key: 'title',
      label: 'Loại tài liệu',
      value: 'GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ VÀ SỬ DỤNG TÀI KHOẢN THANH TOÁN CHUNG',
    },
  ],
};

// Same rationale as MB02 / MB03 — fail fast at module load if any group
// declared a duplicate top-level key, since Object.assign would silently clobber.
validateGroupKeyUniqueness(MB04_SCHEMA);

/**
 * Schema for "Phiếu thu phí dịch vụ" (Service Fee Receipt).
 *
 * Hai hình thức thu phí:
 *   1. Thu từ tài khoản khách hàng (T24): trường tên trên phiếu là TÊN CÔNG TY
 *      (tổ chức bị trích phí). Tên công ty cũng xuất hiện trong nội dung thu phí,
 *      nhưng CÓ THỂ viết tắt theo ý người hạch toán.
 *   2. Thu bằng tiền mặt: trường tên là TÊN CÁ NHÂN người nộp. Tên công ty nằm
 *      trong trường nội dung, CÓ THỂ viết tắt.
 *
 * Quy tắc trích xuất:
 *   - customer_name: luôn lấy giá trị từ TRƯỜNG TÊN in sẵn trên phiếu (tên công ty
 *     nếu thu từ TK, tên cá nhân nếu thu tiền mặt). Trả nguyên văn như trên chứng từ.
 *   - amount: số tiền thu — lấy chính xác giá trị số (kèm đơn vị nếu có).
 *   - company_name: đọc PHẦN NỘI DUNG THU PHÍ (content / ghi chú) và trích tên
 *     tổ chức/công ty được đề cập trong đó. Nếu trường nội dung không chứa tên tổ
 *     chức thì trả null.
 */
const PHIEU_THU_PHI_SCHEMA: ExtractSchema = {
  aiFields: [
    {
      key: 'full_name',
      label: 'Tên khách hàng',
      desc:
        'The name printed in the customer / payer name field of the receipt ' +
        '(labeled "Tên khách hàng", "Họ tên", "Tên đơn vị", "Người nộp", or similar). ' +
        'When the fee is debited from a bank account (T24), this field shows the COMPANY NAME ' +
        'of the account holder being charged. ' +
        'When the fee is paid in cash, this field shows the INDIVIDUAL\'S NAME of the person paying. ' +
        'Return the value exactly as printed on the document, without abbreviating or expanding. ' +
        'If the field is blank, return null.',
    },
    {
      key: 'amount',
      label: 'Số tiền',
      desc:
        'The fee amount collected, as printed on the receipt ' +
        '(labeled "Số tiền", "Tiền phí", "Thành tiền", "Amount", or similar). ' +
        'Include the currency unit if it appears next to the number (e.g. "150,000 VND", "500.000đ"). ' +
        'Return the value exactly as printed. If not present, return null.',
    },
    {
      key: 'company_name',
      label: 'Tên công ty (từ nội dung)',
      desc:
        'The organization / company name extracted from the CONTENT / DESCRIPTION field of the receipt ' +
        '(labeled "Nội dung", "Diễn giải", "Ghi chú", "Content", or similar — NOT the customer name field). ' +
        'The content line often contains the company name, possibly abbreviated by the accountant ' +
        '(e.g. "Thu phí dv CTY ABC", "Phí TK CONG TY XYZ"). ' +
        'Extract only the organization name from that text; do not return the full content string. ' +
        'If no organization name can be identified in the content field, return null.',
    },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'Phiếu thu phí dịch vụ' },
  ],
};

/**
 * Schema for "Quyết định bổ nhiệm KTT/PTKT"
 * (Decision on appointment of Chief Accountant / Deputy Chief Accountant).
 *
 * Trích xuất thông tin của NGƯỜI ĐƯỢC BỔ NHIỆM và người/đơn vị ký quyết định.
 * Tái sử dụng key đã có trong codebase:
 *   - company_name     → tên công ty ban hành quyết định
 *   - business_type    → loại hình công ty
 *   - full_name        → họ tên người được bổ nhiệm
 *   - id_no            → số GTTT (CCCD/hộ chiếu) của người được bổ nhiệm
 *   - date_of_birth    → ngày sinh người được bổ nhiệm
 *   - position         → chức vụ của người được bổ nhiệm (VD: "Kế toán trưởng")
 *   - signer_department → chức danh kèm con dấu (VD: "Giám đốc", tên đơn vị đóng dấu)
 */
const APPOINTMENT_CHIEF_ACCOUNTANT_SCHEMA: ExtractSchema = {
  aiFields: [
    {
      key: 'company_name',
      label: 'Tên công ty',
      desc:
        'Full name of the company / organization that issues this appointment decision — ' +
        'typically found in the header of the document (labeled "Công ty …", "Tên công ty", ' +
        '"Tên đơn vị", or in the opening clause "Giám đốc Công ty …"). ' +
        'Return exactly as printed.',
    },
    {
      key: 'business_type',
      label: 'Loại hình công ty',
      desc:
        'Type / legal form of the issuing company — ' +
        'found in the company name or in the header (e.g. "Công ty TNHH", "Công ty Cổ phần", ' +
        '"Doanh nghiệp tư nhân", "Công ty hợp danh"). ' +
        'Return the full label as printed; null if not stated.',
    },
    {
      key: 'full_name',
      label: 'Họ và tên',
      desc:
        'Full name of the person being appointed as Chief Accountant / Deputy Chief Accountant ' +
        '(labeled "Họ và tên", "Ông/Bà", or similar — the appointee, NOT the signer). ' +
        'Return exactly as printed.',
    },
    {
      key: 'id_no',
      label: 'Số GTTT',
      desc:
        'Identity document number of the appointee — CCCD, CMND, or passport number ' +
        '(labeled "Số CCCD", "Số CMND", "Số giấy tờ tùy thân", "Số hộ chiếu", or similar). ' +
        'Return only the number, no labels.',
    },
    {
      key: 'date_of_birth',
      label: 'Ngày sinh',
      desc:
        'Date of birth of the appointee (labeled "Ngày sinh", "Sinh ngày", or similar). ' +
        'Return in DD/MM/YYYY format.',
    },
    {
      key: 'position',
      label: 'Chức vụ',
      desc:
        'The position/title the person is appointed to ' +
        '(labeled "Chức vụ", "Chức danh bổ nhiệm", or found in the body of the decision — ' +
        'e.g. "Kế toán trưởng", "Phụ trách kế toán"). ' +
        'Return exactly as printed.',
    },
    {
      key: 'signer_department',
      label: 'Chức danh và con dấu',
      desc:
        'The title and/or organization shown in the signing/stamp area at the bottom of the decision ' +
        '(labeled "Chức danh" or found under the official stamp — e.g. "Giám đốc", "Tổng Giám đốc", ' +
        'or the organization name on the stamp). ' +
        'Return exactly as printed; null if not legible.',
    },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'QĐ bổ nhiệm KTT/PTKT' },
  ],
};

/**
 * Registry of open-account extraction schemas, keyed by document code.
 *
 * Every code produced by the classifier (see documents.ts) is listed here so the
 * mapping is complete and easy to audit. Codes whose schema is not defined yet
 * are set to `null` (placeholder) — the extractor skips those gracefully. Fill in
 * a real ExtractSchema as each document type is implemented.
 */
export const ACCOUNT_EXTRACT_SCHEMAS: ExtractSchemaRegistry = {
  // ── Defined ──────────────────────────────────────────────────────────────
  can_cuoc_cong_dan: CITIZEN_IDENTITY_CARD_SCHEMA,
  can_cuoc: IDENTITY_CARD_SCHEMA,
  passport: PASSPORT_SCHEMA,
  thi_thuc: VISA_SCHEMA,
  the_tam_tru: TEMPORARY_RESIDENCE_CARD_SCHEMA,
  tracuu_1414: TRACUU_1414_SCHEMA,
  dieu_le: CHARTER_SCHEMA,
  bien_ban_giao_nhan: HANDOVER_RECORD_SCHEMA,
  cam_ket_khong_co_ktt: COMMITMENT_NO_CHIEF_ACCOUNTANT_SCHEMA,
  MB01: RELATIONSHIP_ESTABLISHMENT_SCHEMA,
  MB02: MB02_SCHEMA,
  MB03: MB03_SCHEMA,
  MB04: MB04_SCHEMA,
  van_ban_uy_quyen: POWER_OF_ATTORNEY_SCHEMA,
  vneid: VNEID_SCHEMA,
  dang_ky_kinh_doanh: BUSINESS_REGISTRATION_SCHEMA,
  phieu_thu_phi: PHIEU_THU_PHI_SCHEMA,
  webca: WEBCA_SCHEMA,
  quyet_dinh_bo_nhiem_ktt: APPOINTMENT_CHIEF_ACCOUNTANT_SCHEMA,
};