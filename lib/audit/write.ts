import { db } from '@/lib/db';
import { configAudits } from '@/lib/db/schema';

export interface AuditEntry {
  entityType: string; entityId?: string; entityName?: string; scopeEntityId?: string; action: string; outcome: string;
  changes?: Record<string, { from?: unknown; to?: unknown }>; detail?: string;
  fromHash?: string; toHash?: string; planHash?: string; ticketId?: string;
  actorUserId?: string; actorRole?: string; sourceIp?: string;
}

/** Append-only, fail-open audit write. Entries must never contain secret values. */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(configAudits).values({
      ...entry,
      changes: entry.changes ? JSON.stringify(entry.changes) : null,
    });
  } catch (error) {
    // Keep audit fail-open so a logging outage cannot block a critical config
    // repair. Do not log `changes` or `detail`: they may be user-provided.
    console.error('[AUDIT] Failed to write audit entry (non-fatal)', {
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      outcome: entry.outcome,
      actorUserId: entry.actorUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
