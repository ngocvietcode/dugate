// lib/rbac/capabilities.ts
// Curated RBAC capability catalog. Admins may only toggle entries marked
// `configurable` for OPS; they cannot create arbitrary capability strings.

export type AppRole = 'ADMIN' | 'OPS';
export type CapabilityGroup = 'Profile' | 'Connector' | 'Operations' | 'System' | 'Data' | 'Identity';
export type CapabilityKind = 'baseline' | 'configurable' | 'locked';

export interface CapabilityMeta {
  key: Capability;
  group: CapabilityGroup;
  label: string;
  description: string;
  kind: CapabilityKind;
  /** Default persisted grant for OPS. Only relevant to configurable capabilities. */
  opsDefault: boolean;
  /** Explains a hard administrative boundary in the permission-matrix UI. */
  lockedReason?: string;
}

/**
 * Complete permission vocabulary understood by DU. Do not accept permission
 * values outside this union from an API request or database row.
 */
export type Capability =
  | 'profile:read'
  | 'profile:create'
  | 'profile:update'
  | 'profile:delete'
  | 'profile:rotate'
  | 'endpoint:manage'
  | 'release:manage'
  | 'connector:read'
  | 'connector:manage'
  | 'operations:read'
  | 'operations:cancel'
  | 'operations:resume'
  | 'operations:export'
  | 'settings:manage'
  | 'workergroups:manage'
  | 'queue:view'
  | 'observability:view'
  | 'audit:view'
  | 'data:all-profiles'
  | 'user:manage'
  | 'role:assign'
  | 'assignment:manage'
  | 'rbac:manage';

/**
 * Security model:
 * - baseline: every recognised UI role needs this capability; no database toggle.
 * - configurable: an ADMIN can grant/revoke it to OPS through the matrix.
 * - locked: ADMIN-only invariant; resolver ignores any malicious/stale DB grant.
 */
export const CAPABILITIES: readonly CapabilityMeta[] = [
  { key: 'profile:read', group: 'Profile', label: 'Xem Profile', description: 'Xem danh sách, chi tiết Profile và endpoint.', kind: 'baseline', opsDefault: true },
  { key: 'profile:create', group: 'Profile', label: 'Tạo Profile', description: 'Tạo Profile và cấp API key mới.', kind: 'configurable', opsDefault: true },
  { key: 'profile:update', group: 'Profile', label: 'Cập nhật Profile', description: 'Sửa thông tin và cấu hình cấp Profile.', kind: 'configurable', opsDefault: true },
  { key: 'profile:delete', group: 'Profile', label: 'Xóa Profile', description: 'Xóa Profile không thể khôi phục.', kind: 'configurable', opsDefault: true },
  { key: 'profile:rotate', group: 'Profile', label: 'Cấp lại API key', description: 'Rotate API key của Profile.', kind: 'configurable', opsDefault: true },
  { key: 'endpoint:manage', group: 'Profile', label: 'Quản lý endpoint', description: 'Bật/tắt endpoint, tham số và override theo Profile.', kind: 'configurable', opsDefault: true },
  { key: 'release:manage', group: 'Profile', label: 'Quản lý release', description: 'Plan, export, apply và rollback Profile Release.', kind: 'configurable', opsDefault: true },

  { key: 'connector:read', group: 'Connector', label: 'Xem Connector', description: 'Xem Connector đã được che thông tin bí mật.', kind: 'baseline', opsDefault: true },
  { key: 'connector:manage', group: 'Connector', label: 'Quản lý Connector', description: 'Tạo, sửa, xóa và kiểm tra External API Connector.', kind: 'configurable', opsDefault: true },

  { key: 'operations:read', group: 'Operations', label: 'Xem Operations', description: 'Xem Operations, chi tiết và thống kê.', kind: 'baseline', opsDefault: true },
  { key: 'operations:cancel', group: 'Operations', label: 'Hủy Operation', description: 'Hủy Operation đang chạy.', kind: 'configurable', opsDefault: true },
  { key: 'operations:resume', group: 'Operations', label: 'Tiếp tục Operation', description: 'Tiếp tục Operation đang chờ input.', kind: 'configurable', opsDefault: true },
  { key: 'operations:export', group: 'Operations', label: 'Xuất Operations', description: 'Xuất danh sách Operations (metadata) dưới dạng CSV.', kind: 'configurable', opsDefault: true },

  { key: 'settings:manage', group: 'System', label: 'Cài đặt hệ thống', description: 'Cập nhật cấu hình hệ thống vận hành.', kind: 'configurable', opsDefault: true },
  { key: 'workergroups:manage', group: 'System', label: 'Quản lý Worker Groups', description: 'Cấu hình Worker Groups và hàng đợi.', kind: 'configurable', opsDefault: true },
  { key: 'queue:view', group: 'System', label: 'Xem Queue Monitor', description: 'Theo dõi trạng thái hàng đợi.', kind: 'configurable', opsDefault: true },
  { key: 'observability:view', group: 'System', label: 'Xem Observability', description: 'Xem Dashboard và analytics vận hành.', kind: 'configurable', opsDefault: true },
  { key: 'audit:view', group: 'System', label: 'Xem Audit Log', description: 'Xem lịch sử thay đổi cấu hình.', kind: 'configurable', opsDefault: true },

  { key: 'data:all-profiles', group: 'Data', label: 'Toàn bộ Profile', description: 'Xem và vận hành toàn bộ Profile/Operation, không chỉ Profile được gán.', kind: 'configurable', opsDefault: true },

  { key: 'user:manage', group: 'Identity', label: 'Quản lý người dùng', description: 'Tạo, sửa và xóa tài khoản.', kind: 'locked', opsDefault: false, lockedReason: 'Chỉ ADMIN quản lý danh tính.' },
  { key: 'role:assign', group: 'Identity', label: 'Gán role', description: 'Thay đổi role ADMIN/OPS cho tài khoản.', kind: 'locked', opsDefault: false, lockedReason: 'Ngăn đặc quyền tự leo thang.' },
  { key: 'assignment:manage', group: 'Identity', label: 'Gán Profile cho user', description: 'Thay đổi UserProfileAssignment.', kind: 'locked', opsDefault: false, lockedReason: 'Quyết định phạm vi dữ liệu của người dùng.' },
  { key: 'rbac:manage', group: 'Identity', label: 'Quản lý ma trận quyền', description: 'Thay đổi quyền của role OPS.', kind: 'locked', opsDefault: false, lockedReason: 'OPS không được thay đổi quyền của chính role OPS.' },
];

const capabilityByKey = new Map(CAPABILITIES.map((capability) => [capability.key, capability]));

export const ALL_CAPABILITIES = CAPABILITIES.map((capability) => capability.key) as readonly Capability[];
export const BASELINE_CAPABILITIES = CAPABILITIES
  .filter((capability) => capability.kind === 'baseline')
  .map((capability) => capability.key) as readonly Capability[];
export const CONFIGURABLE_CAPABILITIES = CAPABILITIES
  .filter((capability) => capability.kind === 'configurable')
  .map((capability) => capability.key) as readonly Capability[];
export const LOCKED_CAPABILITIES = CAPABILITIES
  .filter((capability) => capability.kind === 'locked')
  .map((capability) => capability.key) as readonly Capability[];

export function getCapabilityMeta(capability: Capability): CapabilityMeta {
  return capabilityByKey.get(capability)!;
}

export function isCapability(value: string): value is Capability {
  return capabilityByKey.has(value as Capability);
}

export function isConfigurableCapability(value: string): value is Capability {
  return isCapability(value) && getCapabilityMeta(value).kind === 'configurable';
}

export function isLockedCapability(value: string): value is Capability {
  return isCapability(value) && getCapabilityMeta(value).kind === 'locked';
}
