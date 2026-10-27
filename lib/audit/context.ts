// lib/audit/context.ts
// Small helpers to derive audit metadata (actor + source IP) uniformly across
// API routes, so every writeAudit() call carries consistent traceability data.

/** Actor fields for an audit entry, derived from a NextAuth session. */
export interface AuditActor {
  actorUserId?: string;
  actorRole?: string;
}

/** Extract actor id/role from a NextAuth session (guard result). */
export function auditActor(
  session: { user?: { id?: string; role?: string } } | null | undefined,
): AuditActor {
  return {
    actorUserId: session?.user?.id,
    actorRole: session?.user?.role,
  };
}

/**
 * Best-effort client IP for traceability. Honors the first `x-forwarded-for`
 * hop, then `x-real-ip`. Returns undefined when neither is present.
 *
 * Deliberately tolerant: this value is audit METADATA, so a request-like object
 * without usable headers must degrade to `undefined` rather than throw and turn
 * an otherwise successful, audited operation into a 500.
 */
export function getSourceIp(req: Pick<Request, 'headers'> | null | undefined): string | undefined {
  const headers = req?.headers;
  if (!headers || typeof headers.get !== 'function') return undefined;

  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstHop = forwardedFor.split(',')[0]?.trim();
    if (firstHop) return firstHop;
  }
  return headers.get('x-real-ip')?.trim() || undefined;
}
