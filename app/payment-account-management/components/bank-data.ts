// app/payment-account-management/components/bank-data.ts
// Pure helpers for the core-bank data input (mode=update). Kept in a .ts file,
// separate from BankDataPanel.tsx, so unit tests can import them without a
// JSX-aware transformer (same split as FieldRenderer.helpers.ts).
//
//   pruneBankData    — drop empties before submit
//   bankDataFromMb03 — seed the form from a finished run's MB03
//
// Why prefill: hand-typing Vietnamese names + 12-digit ID numbers to test the compare is
// slow and typo-prone, and a typo'd id_no silently produces NO check at all (the
// LLM only emits an entry when it can match on (full_name, id_no)). Prefilling
// from the real MB03 guarantees every check matches, so a tester can then change
// ONE `position` to produce a deliberate `fail` and see the compare work.
//
// Key mapping (MB03 extracted → bank data):
//   org_name_new_vi      → org_name_vi
//   org_name_new_foreign → org_name_foreign
//   org_name_new_abbr    → org_short_name
//   the five Section 4 people lists keep their names; each person contributes
//   only full_name / id_no / position (the only fields the bank side declares).

import type { BankData, BankPerson } from '../types';
import { BANK_PEOPLE_LISTS } from '../types';

/** The three scalar org-name fields, with form labels/placeholders. */
export const ORG_FIELDS: Array<{
  key: 'org_name_vi' | 'org_name_foreign' | 'org_short_name';
  label: string;
  placeholder: string;
}> = [
  { key: 'org_name_vi', label: 'Tên tổ chức (tiếng Việt)', placeholder: 'CÔNG TY TNHH HƯNG ANH' },
  { key: 'org_name_foreign', label: 'Tên tổ chức (tiếng nước ngoài)', placeholder: 'HUNG ANH COMPANY LIMITED' },
  { key: 'org_short_name', label: 'Tên viết tắt', placeholder: 'HUNG ANH CO.,LTD' },
];

/**
 * Strip the payload down to what the backend will actually act on: drop empty
 * strings, drop person rows that are entirely blank, drop lists left empty. This
 * runs before submit so a half-filled form doesn't send `""` values that the LLM
 * would then report as skip-because-empty.
 *
 * Returning `{}` for an all-empty form is deliberate — the caller uses the key
 * count to decide whether to send `metadata.data` at all, so an untouched form
 * still exercises the BANK_DATA_MISSING branch.
 */
export function pruneBankData(data: BankData): BankData {
  const out: BankData = {};

  for (const { key } of ORG_FIELDS) {
    const v = data[key]?.trim();
    if (v) out[key] = v;
  }

  for (const { key } of BANK_PEOPLE_LISTS) {
    const rows = data[key];
    if (!Array.isArray(rows)) continue;
    const kept = rows
      .map(p => ({
        full_name: p.full_name?.trim() ?? '',
        id_no: p.id_no?.trim() ?? '',
        position: p.position?.trim() ?? '',
      }))
      .filter(p => p.full_name || p.id_no || p.position);
    if (kept.length > 0) out[key] = kept;
  }

  return out;
}

/** Extracted leaves are `{ value, confidence }` wrappers; scalars may be raw. */
function leafString(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    return leafString((raw as Record<string, unknown>).value);
  }
  return '';
}

/** Bank-side scalar key ← MB03 "new value" key. */
const ORG_MAP: Array<[typeof ORG_FIELDS[number]['key'], string]> = [
  ['org_name_vi', 'org_name_new_vi'],
  ['org_name_foreign', 'org_name_new_foreign'],
  ['org_short_name', 'org_name_new_abbr'],
];

/**
 * Build a BankData from an MB03 `extracted` tree. Returns null when nothing
 * usable was found, so the caller can hide the prefill button entirely.
 */
export function bankDataFromMb03(extracted: Record<string, unknown> | null): BankData | null {
  if (!extracted) return null;
  const out: BankData = {};

  for (const [bankKey, mb03Key] of ORG_MAP) {
    const v = leafString(extracted[mb03Key]).trim();
    if (v) out[bankKey] = v;
  }

  for (const { key } of BANK_PEOPLE_LISTS) {
    const rows = extracted[key];
    if (!Array.isArray(rows)) continue;
    const people: BankPerson[] = rows
      .map(row => ({
        full_name: leafString((row as Record<string, unknown>)?.full_name).trim(),
        id_no: leafString((row as Record<string, unknown>)?.id_no).trim(),
        position: leafString((row as Record<string, unknown>)?.position).trim(),
      }))
      .filter(p => p.full_name || p.id_no || p.position);
    if (people.length > 0) out[key] = people;
  }

  return Object.keys(out).length > 0 ? out : null;
}
