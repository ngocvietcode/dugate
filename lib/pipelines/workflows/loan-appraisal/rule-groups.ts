// Nhóm hiển thị của rule thẩm định (rule engine + rule LLM). Module thuần, không import gì để cả backend lẫn UI dùng chung.
//
// `group` là metadata trình bày: không đổi cách chấm hay kết quả. Rule cũ chưa có `group` được suy ra từ id
// (`LOAN.<AREA>.<NAME>`), nên cấu hình đã lưu vẫn hiển thị đúng mà không cần migrate.

export const RULE_GROUP_KEYS = ['DOSSIER', 'CAPACITY', 'COLLATERAL', 'LOAN_PLAN', 'OTHER'] as const;
export type RuleGroupKey = typeof RULE_GROUP_KEYS[number];

/** Thứ tự trong mảng là thứ tự hiển thị. */
export const RULE_GROUPS: ReadonlyArray<{ key: RuleGroupKey; label: string; description: string }> = [
  { key: 'DOSSIER', label: 'Hồ sơ & định danh', description: 'Đủ chứng từ, định danh khách hàng nhất quán giữa các chứng từ.' },
  { key: 'CAPACITY', label: 'Năng lực trả nợ', description: 'Dòng tiền và khả năng đáp ứng nghĩa vụ nợ.' },
  { key: 'COLLATERAL', label: 'Tài sản bảo đảm', description: 'Quyền sở hữu và mức bao phủ của tài sản bảo đảm.' },
  { key: 'LOAN_PLAN', label: 'Phương án & hạn mức vay', description: 'Số tiền, mục đích vay và hạn mức sản phẩm.' },
  { key: 'OTHER', label: 'Khác', description: 'Rule tuỳ chỉnh hoặc chưa phân nhóm.' },
];

const GROUP_ORDER = new Map<string, number>(RULE_GROUPS.map((group, index) => [group.key, index]));

export function isRuleGroupKey(value: unknown): value is RuleGroupKey {
  return typeof value === 'string' && (RULE_GROUP_KEYS as readonly string[]).includes(value);
}

/** Vùng nghiệp vụ trong id (`LOAN.<AREA>.<NAME>`) → nhóm. Id lạ hoặc `CUSTOM` → OTHER. */
const AREA_TO_GROUP: Readonly<Record<string, RuleGroupKey>> = {
  INTAKE: 'DOSSIER',
  CONSISTENCY: 'DOSSIER',
  CAPACITY: 'CAPACITY',
  COLLATERAL: 'COLLATERAL',
  PRODUCT: 'LOAN_PLAN',
  PURPOSE: 'LOAN_PLAN',
};

/** Nhóm của một rule: `group` khai báo hợp lệ thì dùng, không thì suy từ id. */
export function resolveRuleGroup(rule: { id?: string; rule_id?: string; group?: unknown }): RuleGroupKey {
  if (isRuleGroupKey(rule.group)) return rule.group;
  const id = (rule.id ?? rule.rule_id ?? '').replace(/^HKD\./, 'LOAN.');
  const area = id.split('.')[1] ?? '';
  return AREA_TO_GROUP[area] ?? 'OTHER';
}

export function ruleGroupLabel(key: RuleGroupKey): string {
  return RULE_GROUPS.find((group) => group.key === key)?.label ?? key;
}

/** So sánh theo thứ tự hiển thị của nhóm. */
export function compareRuleGroups(a: RuleGroupKey, b: RuleGroupKey): number {
  return (GROUP_ORDER.get(a) ?? 99) - (GROUP_ORDER.get(b) ?? 99);
}
