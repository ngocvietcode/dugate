// lib/pipelines/workflows/payment-account-management/update-account/parse-bank-data.ts
// Narrow the caller-supplied `metadata.data` (Record<string, unknown>) into a
// validated UpdateAccountBankData. Throws INVALID_INPUT with a Vietnamese message
// for wrong-type declared fields; NEVER throws for absent/optional fields — every
// field on UpdateAccountBankData is optional by contract.

import type {
  BankPersonRef,
  UpdateAccountBankData,
  BankPeopleListKey,
} from './types';
import { BANK_PEOPLE_LIST_KEYS } from './types';

const ORG_SCALAR_KEYS = ['org_name_vi', 'org_name_foreign', 'org_short_name'] as const;
const PERSON_SCALAR_KEYS = ['full_name', 'id_no', 'position'] as const;

/**
 * Parse a raw `metadata.data` value into UpdateAccountBankData.
 * - `raw === null | undefined` → treated as an empty object (`{}`), NOT an error.
 *   The caller (runUpdateAccount) already handles the "no bank data" case with a
 *   BANK_DATA_MISSING warning; this parser must not double-fail on the same
 *   input.
 * - Wrong-type declared field (e.g. `org_name_vi: 42`) → throws INVALID_INPUT.
 * - Unknown top-level keys → ignored silently (forward-compat).
 */
export function parseUpdateBankData(raw: unknown): UpdateAccountBankData {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `INVALID_INPUT: "metadata.data" phải là object. Nhận được: ${describeType(raw)}.`,
    );
  }
  const obj = raw as Record<string, unknown>;
  const out: UpdateAccountBankData = {};

  // ── Scalar org fields ───────────────────────────────────────────────────
  for (const key of ORG_SCALAR_KEYS) {
    if (!(key in obj)) continue;
    const v = obj[key];
    if (v === null || v === undefined) {
      out[key] = null;
      continue;
    }
    if (typeof v !== 'string') {
      throw new Error(
        `INVALID_INPUT: "metadata.data.${key}" phải là string. Nhận được: ${describeType(v)}.`,
      );
    }
    out[key] = v;
  }

  // ── People lists (5 of them, same shape) ───────────────────────────────
  for (const key of BANK_PEOPLE_LIST_KEYS) {
    if (!(key in obj)) continue;
    const v = obj[key];
    if (v === null || v === undefined) {
      // Explicit null: treat identically to "not sent" — omit from output so
      // the check pass sees "list not provided" rather than "list is empty".
      continue;
    }
    if (!Array.isArray(v)) {
      throw new Error(
        `INVALID_INPUT: "metadata.data.${key}" phải là mảng. Nhận được: ${describeType(v)}.`,
      );
    }
    out[key] = v.map((el, i) => parseBankPerson(el, key, i));
  }

  return out;
}

/**
 * Parse one BankPersonRef entry. Throws INVALID_INPUT if the element is not an
 * object or a declared sub-field has the wrong type. Missing sub-fields are OK.
 */
function parseBankPerson(
  el: unknown,
  listKey: BankPeopleListKey,
  index: number,
): BankPersonRef {
  if (typeof el !== 'object' || el === null || Array.isArray(el)) {
    throw new Error(
      `INVALID_INPUT: "metadata.data.${listKey}[${index}]" phải là object. Nhận được: ${describeType(el)}.`,
    );
  }
  const p = el as Record<string, unknown>;
  const person: BankPersonRef = {};
  for (const key of PERSON_SCALAR_KEYS) {
    if (!(key in p)) continue;
    const v = p[key];
    if (v === null || v === undefined) {
      person[key] = null;
      continue;
    }
    if (typeof v !== 'string') {
      throw new Error(
        `INVALID_INPUT: "metadata.data.${listKey}[${index}].${key}" phải là string. Nhận được: ${describeType(v)}.`,
      );
    }
    person[key] = v;
  }
  return person;
}

/** Short human-readable type name for error messages. */
function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
