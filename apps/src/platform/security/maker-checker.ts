import type { Actor } from '../contract';

/** Lý do từ chối, hoặc null nếu actor được phép quyết định (constitution §7). Hàm thuần: dùng được trong workflow. */
export function checkerViolation(actor: Actor, makerUserId: string, requiredRoles: readonly string[]): string | null {
  if (!actor.userId) return 'thiếu người thực hiện';
  if (actor.userId === makerUserId) return 'người duyệt trùng người lập hồ sơ (maker-checker)';
  if (requiredRoles.length && !actor.roles.some((r) => requiredRoles.includes(r))) {
    return `thiếu vai trò: cần một trong ${requiredRoles.join(', ')}`;
  }
  return null;
}
