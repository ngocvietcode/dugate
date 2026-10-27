// lib/pipelines/workflows/payment-account-management/update-account/validate.ts
// LLM-driven reconciliation for the update-account feature.
//
// Rather than hard-coding compare rules, we send the MB03 extracted data + core
// bank data to an LLM (ext-fact-verifier connector) and ask it to return per-
// field validation entries. The results are attached IN PLACE to the extracted
// tree at the paths the LLM points to.
//
// Contract with the LLM
// ─────────────────────
// See buildVerifyPrompt for the exact prompt. The LLM is instructed to return:
//   { field_validations: [{ path, code, status, severity, bank_value, reason }] }
// Malformed entries are dropped silently. When the verify step itself cannot
// run (extracted missing, LLM threw, non-JSON reply), the envelope carries an
// `error` string and no field-level attachments happen.

import type { WorkflowContext } from '@/lib/pipelines/workflow-engine';
import { enqueueSubStep, parseDeep } from '@/lib/pipelines/workflow-engine';

import type {
  UpdateAccountBankData,
  UpdateAccountValidation,
  ValidationEntry,
} from './types';
import { buildVerifyPrompt } from '../shared/prompts/update-verify-prompt';

const EMPTY_SUMMARY = { pass: 0, fail: 0, skip: 0 };

/** Connector slug: same LLM channel BRD and disbursement use for cross-check. */
const VERIFY_CONNECTOR = 'ext-fact-verifier';

/**
 * Verify one MB03 document's extracted data against the bank payload.
 *
 * Side effect: MUTATES `mb03Extracted` in place, attaching a `validation` array
 * to any leaf the LLM emitted an entry for. Callers keep the object reference.
 *
 * Returns the document-level envelope (overall + summary + optional error).
 * Never throws: verify-side failures are surfaced as `error` on the envelope
 * with an empty `summary`, so a single bad verify does not fail the workflow.
 */
export async function verifyUpdateAccount(
  ctx: WorkflowContext,
  mb03Extracted: unknown,
  bankData: UpdateAccountBankData,
): Promise<UpdateAccountValidation> {
  // Nothing to compare against — return a "verify skipped" envelope, no LLM call.
  if (mb03Extracted == null || typeof mb03Extracted !== 'object') {
    return errorEnvelope('Không có dữ liệu trích xuất từ MB03 để đối chiếu.');
  }

  let raw: string | null;
  try {
    const promptText = buildVerifyPrompt(mb03Extracted, bankData);
    const result = await enqueueSubStep(
      ctx,
      VERIFY_CONNECTOR,
      { _prompt: promptText },  // connector reads _prompt to bypass its DB template
      null,                     // text-only call — MB03 is already text, bank data is small JSON
      ctx.modelOverrides?.crosscheck,
    );
    raw = result.content;
  } catch (err) {
    ctx.logger.warn('[PAM:update-account] LLM verify call failed', undefined, err);
    return errorEnvelope(
      `Gọi LLM đối chiếu thất bại: ${(err as Error)?.message ?? String(err)}`,
    );
  }

  const parsed = parseVerifyResponse(raw, ctx);
  if ('error' in parsed) return errorEnvelope(parsed.error);
  attachFieldValidations(mb03Extracted, parsed.fieldEntries);
  return successEnvelope(parsed.fieldEntries.map((e) => e.entry));
}

// ── Response parsing ────────────────────────────────────────────────────────

/**
 * A field-level entry the LLM emitted, paired with its target path. Kept as a
 * tuple so the attacher can walk the extracted tree once and the summary can
 * count entries in one pass.
 */
interface FieldValidationRecord {
  path: string;
  entry: ValidationEntry;
}

/**
 * Parse the LLM's JSON reply into a list of field records. Returns an `error`
 * sentinel object when the reply is unparseable / not an object — the caller
 * turns that into a verify-level error envelope.
 */
function parseVerifyResponse(
  raw: string | null,
  ctx: WorkflowContext,
): { fieldEntries: FieldValidationRecord[] } | { error: string } {
  if (raw == null || raw.trim() === '') {
    return { error: 'LLM trả về nội dung rỗng.' };
  }
  const parsed = parseDeep(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: `LLM trả về không phải object JSON (nhận: ${describeType(parsed)}).` };
  }

  const obj = parsed as Record<string, unknown>;
  const fvRaw = Array.isArray(obj.field_validations) ? obj.field_validations : [];

  const fieldEntries: FieldValidationRecord[] = [];
  for (const el of fvRaw) {
    const parsedEl = normalizeEntry(el);
    if (parsedEl) fieldEntries.push(parsedEl);
  }

  ctx.logger.info(
    `[PAM:update-account] LLM verify: ${fieldEntries.length} field entries.`,
  );
  return { fieldEntries };
}

/**
 * Coerce one LLM-emitted entry into a FieldValidationRecord. Returns null when
 * required fields (path, code, status) are missing; loose on the rest.
 */
function normalizeEntry(el: unknown): FieldValidationRecord | null {
  if (el == null || typeof el !== 'object' || Array.isArray(el)) return null;
  const o = el as Record<string, unknown>;

  const path = typeof o.path === 'string' ? o.path : null;
  const code = typeof o.code === 'string' ? o.code : null;
  const status = o.status as string | undefined;
  if (!path || !code || (status !== 'pass' && status !== 'fail' && status !== 'skip')) return null;

  const severity = o.severity === 'error' ? 'error' : 'warning';
  const bank_value = typeof o.bank_value === 'string' ? o.bank_value : null;

  const entry: ValidationEntry = {
    code,
    status,
    severity,
    bank_value,
    ...(typeof o.reason === 'string' ? { reason: o.reason } : {}),
  };
  return { path, entry };
}

// ── Path-based attachment onto the extracted tree ───────────────────────────

/**
 * For each (path, entry) walk the extracted tree and mutate the target leaf to
 * carry `validation: [entry, ...]`. If a path is unresolvable (typo in the LLM
 * output, mismatched schema), the entry is silently dropped from the tree — it
 * will still appear in the doc-level counts.
 *
 * Path DSL supported:
 *   - dot notation:  "org_name_new_vi"
 *   - array index:   "chief_accountants[0].position"
 *   - deep chains:   "debit_card_main_holders[1].card_purposes"
 *
 * Only `[N]` (numeric literal) is supported for arrays — no wildcards. The LLM
 * is instructed to emit one entry per concrete leaf, not one per pattern.
 */
export function attachFieldValidations(
  extracted: unknown,
  records: ReadonlyArray<FieldValidationRecord>,
): void {
  for (const { path, entry } of records) {
    const leaf = resolvePath(extracted, path);
    if (leaf === undefined) continue; // path did not resolve — skip silently
    attachToLeaf(leaf.container, leaf.key, entry);
  }
}

interface ResolvedLeaf {
  container: Record<string, unknown> | unknown[];
  key: string | number;
}

/**
 * Resolve a path down to its container + last key so we can rewrite the leaf.
 * Returns undefined for any step that doesn't exist. Robust to LLM typos.
 */
function resolvePath(root: unknown, path: string): ResolvedLeaf | undefined {
  const segments = splitPath(path);
  if (segments.length === 0) return undefined;

  let current: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    current = stepInto(current, segments[i]);
    if (current === undefined || current === null) return undefined;
  }
  const last = segments[segments.length - 1];
  if (current == null || typeof current !== 'object') return undefined;
  if (Array.isArray(current) && typeof last === 'number') {
    return { container: current, key: last };
  }
  if (!Array.isArray(current) && typeof last === 'string') {
    return { container: current as Record<string, unknown>, key: last };
  }
  return undefined;
}

function stepInto(current: unknown, seg: string | number): unknown {
  if (current == null) return undefined;
  if (Array.isArray(current) && typeof seg === 'number') return current[seg];
  if (typeof current === 'object' && typeof seg === 'string') {
    return (current as Record<string, unknown>)[seg];
  }
  return undefined;
}

/** Tokenize "chief_accountants[0].position" into ["chief_accountants", 0, "position"]. */
function splitPath(path: string): Array<string | number> {
  const out: Array<string | number> = [];
  const parts = path.split('.');
  for (const p of parts) {
    // Handle "key[0][1]" style segments.
    const arrMatches = [...p.matchAll(/\[(\d+)\]/g)];
    const head = arrMatches.length > 0 ? p.slice(0, p.indexOf('[')) : p;
    if (head) out.push(head);
    for (const m of arrMatches) out.push(Number(m[1]));
  }
  return out;
}

/**
 * Attach `entry` to the container's key. If the current value is a wrapper
 * `{ value, confidence, ... }` we push into its `validation` array. If the
 * current value is a plain string / number / boolean (unwrapped scalar) we
 * upgrade it to a wrapper. Arrays / objects are targeted by leaf, not by
 * container — attaching to a container key silently no-ops rather than
 * corrupting nested data.
 */
function attachToLeaf(
  container: Record<string, unknown> | unknown[],
  key: string | number,
  entry: ValidationEntry,
): void {
  // Prefer `in` over property access so a legitimate `undefined` value (rare
  // but possible) is treated as "exists" while a MISSING key drops the entry.
  const containerObj = container as Record<string, unknown>;
  const keyStr = key as string;
  const exists = Array.isArray(container) ? (key as number) < container.length : keyStr in containerObj;
  if (!exists) return;

  const current = containerObj[keyStr];

  // Container-typed leaf (an array or a raw object without a `value` field) —
  // refuse to decorate it since attaching at the container level is ambiguous.
  // The entry still counts in the summary at the doc level.
  if (Array.isArray(current) || (current !== null && typeof current === 'object' && !isFieldWrapper(current))) {
    return;
  }

  const wrapper = isFieldWrapper(current)
    ? (current as Record<string, unknown>)
    : { value: current, confidence: null as number | null };
  const existing = Array.isArray(wrapper.validation) ? wrapper.validation : [];
  wrapper.validation = [...existing, entry];
  containerObj[keyStr] = wrapper;
}

function isFieldWrapper(v: unknown): boolean {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    'value' in (v as Record<string, unknown>)
  );
}

// ── Envelope + tiny helpers ─────────────────────────────────────────────────

function successEnvelope(fieldEntries: ValidationEntry[]): UpdateAccountValidation {
  const summary = { pass: 0, fail: 0, skip: 0 };
  for (const e of fieldEntries) summary[e.status] += 1;
  // `overall` flips to 'fail' only on an ERROR-severity fail. Every entry today
  // is 'warning'; overall stays 'pass' until domain rules elevate specifics.
  const overall: 'pass' | 'fail' =
    fieldEntries.some((e) => e.severity === 'error' && e.status === 'fail') ? 'fail' : 'pass';
  return { overall, summary };
}

/** Envelope for cases where the verify itself could not run. No attachments. */
function errorEnvelope(error: string): UpdateAccountValidation {
  return { overall: 'pass', summary: { ...EMPTY_SUMMARY }, error };
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
