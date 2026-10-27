// app/account-opening/segments.ts
// Cấu hình phân khúc & sản phẩm phía client — dùng để dựng KHUNG giao diện
// (checklist template, nhóm Customer Profile) NGAY khi mở trang, trước khi chạy.
// Mirror gọn của ACCOUNT_SEGMENTS / ACCOUNT_PRODUCTS ở backend: chỉ giữ những
// field UI cần (key, nhãn, bắt buộc, nhóm) — không mirror prompt hay preset field.

import type { CustomerSegmentKey } from './types';

export type ProfileGroup =
  | 'identity'
  | 'contact'
  | 'organization'
  | 'authorization'
  | 'ownership'
  | 'compliance'
  | 'account';

export interface ChecklistTemplateItem {
  key: string;
  label: string;
  required: boolean;
  group: ProfileGroup;
}

export interface ProductTemplate {
  code: string;
  segmentKey: CustomerSegmentKey;
  name: string;
  shortName: string;
  accountType: string;
  description: string;
  checklist: ChecklistTemplateItem[];
}

export interface SegmentTemplate {
  key: CustomerSegmentKey;
  name: string;
  shortName: string;
  description: string;
  isOrganization: boolean;
}

export const SEGMENTS: SegmentTemplate[] = [
  {
    key: 'KHCN',
    name: 'Khách hàng cá nhân (KHCN)',
    shortName: 'Cá nhân',
    description: 'Cá nhân mở tài khoản thanh toán cho tiêu dùng, nhận lương, tiết kiệm.',
    isOrganization: false,
  },
  {
    key: 'HKD',
    name: 'Hộ kinh doanh (HKD)',
    shortName: 'Hộ kinh doanh',
    description: 'Hộ kinh doanh cá thể mở tài khoản phục vụ hoạt động kinh doanh.',
    isOrganization: false,
  },
  {
    key: 'SME',
    name: 'Doanh nghiệp vừa và nhỏ (SME)',
    shortName: 'SME',
    description: 'Doanh nghiệp SME, cần người đại diện hợp pháp và kê khai chủ sở hữu hưởng lợi.',
    isOrganization: true,
  },
  {
    key: 'KHDN',
    name: 'Khách hàng doanh nghiệp lớn (KHDN)',
    shortName: 'Doanh nghiệp lớn',
    description: 'Tổ chức có cấu trúc sở hữu nhiều tầng, bắt buộc rà soát tăng cường (EDD).',
    isOrganization: true,
  },
];

// ─── Checklist theo sản phẩm ──────────────────────────────────────────────────

const KHCN_STANDARD: ChecklistTemplateItem[] = [
  { key: 'id_document', label: 'Giấy tờ định danh chủ tài khoản', required: true, group: 'identity' },
  { key: 'account_form', label: 'Giấy đề nghị mở tài khoản / hồ sơ CIF', required: true, group: 'account' },
  { key: 'residence_proof', label: 'Xác nhận cư trú / địa chỉ liên hệ', required: false, group: 'contact' },
  { key: 'signature_specimen', label: 'Mẫu chữ ký / mẫu dấu', required: false, group: 'account' },
  { key: 'fatca_crs', label: 'Tờ khai FATCA / CRS', required: false, group: 'compliance' },
  { key: 'source_of_funds', label: 'Chứng minh nguồn tiền / thu nhập', required: false, group: 'compliance' },
];

const KHCN_NONRESIDENT: ChecklistTemplateItem[] = [
  { key: 'passport', label: 'Hộ chiếu khách hàng nước ngoài', required: true, group: 'identity' },
  { key: 'entry_permit', label: 'Thị thực / thẻ tạm trú / thẻ thường trú', required: true, group: 'identity' },
  { key: 'account_form', label: 'Giấy đề nghị mở tài khoản / hồ sơ CIF', required: true, group: 'account' },
  { key: 'fatca_crs', label: 'Tờ khai FATCA / CRS', required: true, group: 'compliance' },
  { key: 'source_of_funds', label: 'Chứng minh nguồn tiền / thu nhập', required: true, group: 'compliance' },
  { key: 'work_permit', label: 'Giấy phép lao động / xác nhận công tác', required: false, group: 'organization' },
  { key: 'residence_proof', label: 'Xác nhận cư trú / địa chỉ liên hệ', required: false, group: 'contact' },
];

const HKD_STANDARD: ChecklistTemplateItem[] = [
  { key: 'id_document', label: 'Giấy tờ định danh chủ hộ', required: true, group: 'identity' },
  { key: 'business_registration', label: 'GCN đăng ký hộ kinh doanh', required: true, group: 'organization' },
  { key: 'account_form', label: 'Giấy đề nghị mở tài khoản / hồ sơ CIF', required: true, group: 'account' },
  { key: 'tax_registration', label: 'Đăng ký mã số thuế', required: false, group: 'organization' },
  { key: 'business_location_proof', label: 'Xác nhận địa điểm kinh doanh', required: false, group: 'organization' },
  { key: 'authorization_doc', label: 'Giấy ủy quyền sử dụng tài khoản', required: false, group: 'authorization' },
  { key: 'source_of_funds', label: 'Chứng minh nguồn tiền / thu nhập', required: false, group: 'compliance' },
];

const SME_STANDARD: ChecklistTemplateItem[] = [
  { key: 'business_registration', label: 'GCN đăng ký doanh nghiệp', required: true, group: 'organization' },
  { key: 'company_charter', label: 'Điều lệ tổ chức', required: true, group: 'organization' },
  { key: 'legal_rep_id', label: 'Định danh người đại diện theo pháp luật', required: true, group: 'identity' },
  { key: 'appointment_decision', label: 'Quyết định bổ nhiệm người đại diện / kế toán trưởng', required: true, group: 'authorization' },
  { key: 'beneficial_owner_declaration', label: 'Kê khai chủ sở hữu hưởng lợi', required: true, group: 'ownership' },
  { key: 'account_form', label: 'Giấy đề nghị mở tài khoản / hồ sơ CIF', required: true, group: 'account' },
  { key: 'chief_accountant_id', label: 'Định danh kế toán trưởng', required: false, group: 'identity' },
  { key: 'authorization_doc', label: 'Giấy ủy quyền sử dụng tài khoản', required: false, group: 'authorization' },
  { key: 'signature_specimen', label: 'Mẫu chữ ký / mẫu dấu', required: false, group: 'account' },
  { key: 'tax_registration', label: 'Đăng ký mã số thuế', required: false, group: 'organization' },
  { key: 'financial_statement', label: 'Báo cáo tài chính / báo cáo thuế', required: false, group: 'compliance' },
];

const KHDN_STANDARD: ChecklistTemplateItem[] = [
  { key: 'business_registration', label: 'GCN đăng ký doanh nghiệp', required: true, group: 'organization' },
  { key: 'company_charter', label: 'Điều lệ tổ chức', required: true, group: 'organization' },
  { key: 'legal_rep_id', label: 'Định danh người đại diện theo pháp luật', required: true, group: 'identity' },
  { key: 'appointment_decision', label: 'Quyết định bổ nhiệm người đại diện / kế toán trưởng', required: true, group: 'authorization' },
  { key: 'board_resolution', label: 'Nghị quyết/biên bản họp về mở tài khoản', required: true, group: 'authorization' },
  { key: 'beneficial_owner_declaration', label: 'Kê khai chủ sở hữu hưởng lợi', required: true, group: 'ownership' },
  { key: 'ownership_structure', label: 'Sơ đồ cấu trúc sở hữu', required: true, group: 'ownership' },
  { key: 'account_form', label: 'Giấy đề nghị mở tài khoản / hồ sơ CIF', required: true, group: 'account' },
  { key: 'fatca_crs', label: 'Tờ khai FATCA / CRS', required: true, group: 'compliance' },
  { key: 'financial_statement', label: 'Báo cáo tài chính / báo cáo thuế', required: true, group: 'compliance' },
  { key: 'chief_accountant_id', label: 'Định danh kế toán trưởng', required: false, group: 'identity' },
  { key: 'authorization_doc', label: 'Giấy ủy quyền sử dụng tài khoản', required: false, group: 'authorization' },
  { key: 'signature_specimen', label: 'Mẫu chữ ký / mẫu dấu', required: false, group: 'account' },
  { key: 'tax_registration', label: 'Đăng ký mã số thuế', required: false, group: 'organization' },
];

export const PRODUCTS: ProductTemplate[] = [
  {
    code: 'casa-khcn-standard',
    segmentKey: 'KHCN',
    name: 'Tài khoản thanh toán cá nhân (KHCN)',
    shortName: 'CASA cá nhân',
    accountType: 'CASA cá nhân',
    description: 'Tài khoản thanh toán VND cho khách hàng cá nhân cư trú.',
    checklist: KHCN_STANDARD,
  },
  {
    code: 'casa-khcn-nonresident',
    segmentKey: 'KHCN',
    name: 'Tài khoản cá nhân người nước ngoài / không cư trú',
    shortName: 'CASA không cư trú',
    accountType: 'CASA cá nhân không cư trú',
    description: 'Bắt buộc FATCA/CRS và chứng minh nguồn tiền; luôn rà soát tăng cường.',
    checklist: KHCN_NONRESIDENT,
  },
  {
    code: 'casa-hkd-standard',
    segmentKey: 'HKD',
    name: 'Tài khoản thanh toán hộ kinh doanh',
    shortName: 'CASA hộ kinh doanh',
    accountType: 'CASA hộ kinh doanh',
    description: 'Phục vụ hoạt động kinh doanh của hộ kinh doanh cá thể.',
    checklist: HKD_STANDARD,
  },
  {
    code: 'casa-sme-standard',
    segmentKey: 'SME',
    name: 'Tài khoản thanh toán doanh nghiệp SME',
    shortName: 'CASA SME',
    accountType: 'CASA doanh nghiệp',
    description: 'Yêu cầu điều lệ, quyết định bổ nhiệm và kê khai chủ sở hữu hưởng lợi từ 25%.',
    checklist: SME_STANDARD,
  },
  {
    code: 'casa-khdn-standard',
    segmentKey: 'KHDN',
    name: 'Tài khoản thanh toán khách hàng doanh nghiệp lớn',
    shortName: 'CASA doanh nghiệp lớn',
    accountType: 'CASA doanh nghiệp lớn',
    description: 'Bắt buộc nghị quyết mở tài khoản, sơ đồ sở hữu, FATCA/CRS và EDD.',
    checklist: KHDN_STANDARD,
  },
];

export const DEFAULT_PRODUCT_CODE = 'casa-khcn-standard';

export function productsOfSegment(segmentKey: CustomerSegmentKey): ProductTemplate[] {
  return PRODUCTS.filter((product) => product.segmentKey === segmentKey);
}

export function findProduct(code: string): ProductTemplate {
  return PRODUCTS.find((product) => product.code === code) ?? PRODUCTS[0];
}

export function findSegment(key: CustomerSegmentKey): SegmentTemplate {
  return SEGMENTS.find((segment) => segment.key === key) ?? SEGMENTS[0];
}

export const PROFILE_GROUPS: Array<{ key: ProfileGroup; label: string; icon: string }> = [
  { key: 'identity', label: 'Định danh', icon: '🪪' },
  { key: 'contact', label: 'Liên hệ', icon: '📇' },
  { key: 'organization', label: 'Thông tin tổ chức', icon: '🏢' },
  { key: 'authorization', label: 'Thẩm quyền & ủy quyền', icon: '✍️' },
  { key: 'ownership', label: 'Cấu trúc sở hữu', icon: '🧩' },
  { key: 'compliance', label: 'Tuân thủ & KYC', icon: '🛡️' },
  { key: 'account', label: 'Thông tin tài khoản', icon: '💳' },
];
