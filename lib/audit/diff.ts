import crypto from 'crypto';
import type { AuditFieldMode, AuditFieldPolicy } from './policy';

export interface AuditSummary {
  kind: 'summary';
  length: number;
  hash: string;
}

export type AuditChangeValue = unknown | 'configured' | 'not configured' | AuditSummary;
export type ChangeSet = Record<string, { from?: AuditChangeValue; to?: AuditChangeValue }>;

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b || (a == null && b == null)) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function summarize(value: unknown): AuditSummary {
  const content = stringify(value);
  return {
    kind: 'summary',
    length: content.length,
    hash: crypto.createHash('sha256').update(content).digest('hex').slice(0, 12),
  };
}

function represent(value: unknown, mode: AuditFieldMode): AuditChangeValue | undefined {
  if (value === undefined || value === null) return value;
  if (mode === 'PRESENCE') return hasValue(value) ? 'configured' : 'not configured';
  if (mode === 'SUMMARY') return summarize(value);
  return value;
}

/**
 * Create a policy-filtered audit diff. Only fields explicitly listed in the
 * policy are considered. This fail-closed default prevents a new database
 * column, secret or long prompt from leaking into ConfigAudit by accident.
 */
export function buildChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  policy: AuditFieldPolicy,
): ChangeSet {
  const b = before ?? {};
  const a = after ?? {};
  const changes: ChangeSet = {};

  for (const [field, mode] of Object.entries(policy)) {
    if (mode === 'OMIT') continue;
    const from = b[field];
    const to = a[field];
    if (isEqual(from, to)) continue;
    changes[field] = { from: represent(from, mode), to: represent(to, mode) };
  }
  return changes;
}
