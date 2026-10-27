// app/payment-account-management/components/validation-summary.ts
// Pure helpers for the mode=update reconciliation view.
//
// The runner attaches its compare results INSIDE the extracted tree (each judged
// leaf becomes `{ value, confidence, validation: [...] }`). Rendering them only
// there has three problems this module exists to solve:
//
//   1. At most 8 entries hide in a tree of hundreds of MB03 fields, behind two
//      or three levels of collapsed containers.
//   2. An entry whose `path` did not resolve is dropped from the tree entirely
//      (see attachFieldValidations) while still counting in the doc `summary` —
//      so counts and visible rows disagree with no way to diagnose it.
//   3. When a bank person has no MB03 match, the LLM emits NO entry at all (it
//      has nothing to anchor to), so a wrong `id_no` goes silently unreported.
//
// Walking the tree collects (1) and (2); diffing bank_data against the emitted
// entries recovers (3). The `code` field is the join key — the prompt guarantees
// it is stable precisely so the frontend can key off it.

import type { BankData, BankPerson, FieldValidationEntry } from '../types';
import { BANK_PEOPLE_LISTS } from '../types';

// ─── Code → human label ─────────────────────────────────────────────────────
// Codes come from the prompt's CODE FORMAT section:
//   org checks:    "org_name_match:<bankKey>"
//   person checks: "position_match:<listKey>"

const ORG_CODE_LABELS: Record<string, string> = {
  org_name_vi: 'Tên tổ chức (tiếng Việt)',
  org_name_foreign: 'Tên tổ chức (tiếng nước ngoài)',
  org_short_name: 'Tên viết tắt',
};

const PEOPLE_LIST_LABELS: Record<string, string> = Object.fromEntries(
  BANK_PEOPLE_LISTS.map(l => [l.key, l.label]),
);

/**
 * Human label for a validation `code`, falling back to the raw code so an
 * unrecognized (or future) code still renders a usable row rather than blank.
 */
export function labelForCode(code: string): string {
  const [kind, arg] = code.split(':');
  if (kind === 'org_name_match') return ORG_CODE_LABELS[arg] ?? arg ?? code;
  if (kind === 'position_match') {
    const list = PEOPLE_LIST_LABELS[arg];
    return list ? `Chức vụ — ${list}` : arg ?? code;
  }
  return code;
}

/** The people-list key a `position_match:<listKey>` code refers to, else null. */
export function listKeyFromCode(code: string): string | null {
  const [kind, arg] = code.split(':');
  return kind === 'position_match' && arg ? arg : null;
}

// ─── Collecting entries out of the extracted tree ───────────────────────────

/** One validation entry plus where in the extracted tree it was found. */
export interface CollectedEntry {
  entry: FieldValidationEntry;
  /** Dot/index path to the leaf, e.g. "chief_accountants[0].position". */
  path: string;
  /** The leaf's own extracted value, for a side-by-side bank-vs-MB03 row. */
  docValue: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Read the `validation` array off one leaf wrapper. Entries missing `status` or
 * `code` are dropped — the runner already normalizes, but a malformed entry must
 * never break rendering.
 */
export function readLeafValidations(leaf: unknown): FieldValidationEntry[] {
  if (!isRecord(leaf)) return [];
  const raw = leaf.validation;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is FieldValidationEntry =>
      isRecord(e) && typeof e.status === 'string' && typeof e.code === 'string',
  );
}

/** Local alias — the tree walkers below read leaves constantly. */
const readEntries = readLeafValidations;

/**
 * Walk an extracted tree and collect every attached validation entry, recording
 * the path it was found at. Order follows tree order, which is schema order —
 * stable across runs, so rows don't jump around between refreshes.
 */
export function collectValidations(extracted: unknown): CollectedEntry[] {
  const out: CollectedEntry[] = [];

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((el, i) => walk(el, `${path}[${i}]`));
      return;
    }
    if (!isRecord(node)) return;

    // A leaf wrapper: collect its entries, then stop — `value` holds data, not
    // more validated leaves.
    const entries = readEntries(node);
    if (entries.length > 0) {
      for (const entry of entries) {
        out.push({ entry, path, docValue: node.value });
      }
      return;
    }

    for (const [k, v] of Object.entries(node)) {
      if (k === 'validation') continue;
      walk(v, path ? `${path}.${k}` : k);
    }
  };

  walk(extracted, '');
  return out;
}

/**
 * True when any validation entry at or below this node is a `fail`. Used to badge
 * and auto-expand collapsed containers hiding a mismatch.
 */
export function hasFailedValidation(value: unknown): boolean {
  let found = false;
  const walk = (v: unknown): void => {
    if (found || v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (!isRecord(v)) return;
    if (readEntries(v).some(e => e.status === 'fail')) {
      found = true;
      return;
    }
    for (const [k, sub] of Object.entries(v)) {
      if (k === 'validation') continue;
      walk(sub);
    }
  };
  walk(value);
  return found;
}

/**
 * True when this node (or anything below it) carries ANY validation entry.
 * Backs the "only show reconciled fields" filter.
 */
export function hasAnyValidation(value: unknown): boolean {
  let found = false;
  const walk = (v: unknown): void => {
    if (found || v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (!isRecord(v)) return;
    if (readEntries(v).length > 0) {
      found = true;
      return;
    }
    for (const [k, sub] of Object.entries(v)) {
      if (k === 'validation') continue;
      walk(sub);
    }
  };
  walk(value);
  return found;
}

// ─── Unmatched bank people ──────────────────────────────────────────────────

/** A bank person the LLM never produced a check for. */
export interface UnmatchedPerson {
  listKey: string;
  listLabel: string;
  person: BankPerson;
  /** Why no check exists — drives the hint shown to the reviewer. */
  reason: 'no_match' | 'incomplete_key';
}

/**
 * Find bank people with no corresponding `position_match` entry.
 *
 * The LLM matches on (full_name, id_no) and emits nothing when it cannot match,
 * or when the bank record is missing either key field — so these people are
 * invisible in the per-field view by design. We approximate the gap by count per
 * list: if a list supplied N bank people but produced M < N entries, the people
 * beyond the first M are reported as unmatched.
 *
 * This is deliberately a count-based heuristic, not a re-implementation of the
 * LLM's diacritic-insensitive matching: the goal is to tell a reviewer "these
 * bank records produced no check — go look", not to decide who matched whom.
 */
export function findUnmatchedBankPeople(
  bankData: BankData | null | undefined,
  entries: ReadonlyArray<CollectedEntry>,
): UnmatchedPerson[] {
  if (!bankData) return [];

  const checkedPerList = new Map<string, number>();
  for (const { entry } of entries) {
    const listKey = listKeyFromCode(entry.code);
    if (listKey) checkedPerList.set(listKey, (checkedPerList.get(listKey) ?? 0) + 1);
  }

  const out: UnmatchedPerson[] = [];
  for (const { key, label } of BANK_PEOPLE_LISTS) {
    const people = bankData[key];
    if (!Array.isArray(people) || people.length === 0) continue;

    const checked = checkedPerList.get(key) ?? 0;
    if (checked >= people.length) continue;

    // Report the trailing (people.length - checked) records. Those missing a key
    // field are called out separately — that's a fixable input problem, whereas a
    // genuine no-match means the person is absent from the MB03.
    for (const person of people.slice(checked)) {
      const incomplete = !person.full_name?.trim() || !person.id_no?.trim();
      out.push({
        listKey: key,
        listLabel: label,
        person,
        reason: incomplete ? 'incomplete_key' : 'no_match',
      });
    }
  }
  return out;
}

// ─── Row model for the summary panel ────────────────────────────────────────

export interface SummaryRow {
  kind: 'checked' | 'unmatched';
  label: string;
  status: FieldValidationEntry['status'] | 'missing';
  bankValue: string | null;
  docValue: unknown;
  reason?: string;
  /** Path into the extracted tree; absent for unmatched-people rows. */
  path?: string;
  /** True when the entry counted in `summary` but its path did not resolve. */
  orphaned?: boolean;
}

const STATUS_ORDER: Record<SummaryRow['status'], number> = {
  fail: 0,
  missing: 1,
  skip: 2,
  pass: 3,
};

/**
 * Build the summary rows for one document: every collected entry plus a row per
 * unmatched bank person, ordered fail → missing → skip → pass so what needs
 * attention is at the top. Within a status group, tree order is preserved.
 */
export function buildSummaryRows(
  extracted: unknown,
  bankData: BankData | null | undefined,
): { rows: SummaryRow[]; entries: CollectedEntry[] } {
  const entries = collectValidations(extracted);

  const rows: SummaryRow[] = entries.map(({ entry, path, docValue }) => ({
    kind: 'checked' as const,
    label: labelForCode(entry.code),
    status: entry.status,
    bankValue: entry.bank_value,
    docValue,
    reason: entry.reason,
    path,
  }));

  for (const u of findUnmatchedBankPeople(bankData, entries)) {
    rows.push({
      kind: 'unmatched',
      label: `${u.listLabel} — ${u.person.full_name || '(chưa có tên)'}`,
      status: 'missing',
      bankValue: u.person.position || null,
      docValue: null,
      reason:
        u.reason === 'incomplete_key'
          ? 'Bản ghi core bank thiếu họ tên hoặc số GTTT nên không thể khớp với MB03.'
          : 'Không tìm thấy người này trong MB03 (khớp theo họ tên + số GTTT).',
    });
  }

  rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  return { rows, entries };
}

/** Count rows by status, for the panel header. */
export function countRows(rows: ReadonlyArray<SummaryRow>): {
  pass: number;
  fail: number;
  skip: number;
  missing: number;
} {
  const out = { pass: 0, fail: 0, skip: 0, missing: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}
