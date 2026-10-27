/**
 * Legacy role helper.
 *
 * Capability-based authorization lives in `lib/rbac/capabilities.ts`,
 * `lib/rbac/resolve.ts` and `lib/auth-guard.ts`. Only the hard ADMIN check
 * remains here, for control planes that are intentionally not delegable to OPS
 * (currently Bull Board).
 *
 * Do NOT reintroduce a `requireAdmin` here: `lib/auth-guard.ts` already exports
 * one, and the two had opposite success contracts (`null` vs `{ session }`),
 * which silently denied legitimate admins when a call site was migrated.
 */

export function isAdmin(role: string): boolean {
  return role === 'ADMIN';
}
