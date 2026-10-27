// lib/pipelines/workflows/margin-deposit-profile.ts
// Hồ sơ Ký quỹ (VPBAI-5261) — Layer 2: strict AI-response parsers, field maps,
// and document taxonomy shared by all margin-deposit modes.
//
// Orchestration (the former single `e2e`-defaulting `runMarginDepositProfile`)
// has been REPLACED by four independent mode runners registered as one
// workflow at lib/pipelines/workflows/margin-deposit/index.ts, per the
// margin-deposit-mode-contracts spec. This file intentionally keeps ONLY the
// parsing/validation backbone those runners import and reuse unchanged:
//   parseClassifyDocuments, parseExtractFields, parsePresencePages,
//   parseFrameworkCompareResult, getPresenceVerdict, mapPresencePagesToOriginal,
//   plus the constants/taxonomy those parsers depend on.
// Do not reintroduce e2e/gd1/gd2 mode branching, per-mode orchestration, or a
// combined WorkflowOutput shape here — that belongs to the mode runners.

import { parseDeep } from '@/lib/pipelines/workflow-engine';
import {
  ESCROW_DOCUMENT_CODES,
  CLASSIFICATION_TITLES,
  EXTRACT_FIELDS_BY_CODE,
  ARRAY_FIELDS_BY_CODE,
  ARRAY_MEMBER_FIELDS,
  ARRAY_MEMBER_SUBARRAYS,
  type ScalarField,
  type ExtractGroupMember,
  type ExtractFieldValue,
  type ClassifyPageResult,
  type ExtractFieldResult,
  type FrameworkCompareResult,
} from './prompts/margin-deposit-profile-prompts';

const KNOWN_CODES = new Set<string>(ESCROW_DOCUMENT_CODES);
const FRAMEWORK_VERDICTS = new Set(['PASS', 'FAIL', 'WARNING']);
const FRAMEWORK_ACTIONS = new Set(['added', 'removed', 'modified', 'missing']);
const FRAMEWORK_SEVERITIES = new Set(['info', 'warning', 'critical']);
const NUMERIC_PAGE_RANGE = /^\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*$/;
const MAX_DOCUMENTS_PER_FILE = 100;

export function parseClassifyDocuments(value: unknown): ClassifyPageResult[] {
  const parsed = parseDeep(value);
  const candidates = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).documents)
      ? (parsed as Record<string, unknown>).documents as unknown[]
      : null;

  if (!candidates || candidates.length === 0 || candidates.length > MAX_DOCUMENTS_PER_FILE) {
    throw new Error(`INVALID_AI_RESPONSE: classifier must return 1-${MAX_DOCUMENTS_PER_FILE} documents.`);
  }

  return candidates.map((item, index): ClassifyPageResult => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`INVALID_AI_RESPONSE: classifier document[${index}] must be an object.`);
    }
    const doc = item as Record<string, unknown>;
    const code = typeof doc.code === 'string' ? doc.code.trim() : '';
    const pageRange = typeof doc.page_range === 'string' ? doc.page_range.trim() : '';
    const confidence = doc.confidence;
    if ((!KNOWN_CODES.has(code) && code !== 'unknown') || !NUMERIC_PAGE_RANGE.test(pageRange)) {
      throw new Error(`INVALID_AI_RESPONSE: classifier document[${index}] has invalid code or page_range.`);
    }
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error(`INVALID_AI_RESPONSE: classifier document[${index}] confidence must be between 0 and 1.`);
    }
    return {
      code,
      page_range: pageRange,
      confidence,
      title: CLASSIFICATION_TITLES[code] ?? (typeof doc.title === 'string' && doc.title.trim() ? doc.title.trim() : code),
      reason: typeof doc.reason === 'string' ? doc.reason : '',
      file_id: typeof doc.file_id === 'string' ? doc.file_id : '',
    };
  });
}

/** Placeholder written to `fields[x]` when a single scalar field fails to parse,
 *  so downstream readers (compare, mismatch detection, webhook) see a safe empty
 *  value instead of crashing. The real reason is recorded in `field_errors`. */
const EMPTY_SCALAR: ScalarField = { value: null, confidence: 0 };

export interface ParsedExtractFields {
  fields: ExtractFieldResult['fields'];
  /** fieldName → reason, for every field that failed to parse. Empty when all clean. */
  field_errors: Record<string, string>;
}

export function parseExtractFields(
  value: unknown,
  docCode: string,
): ParsedExtractFields {
  const parsed = parseDeep(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('INVALID_AI_RESPONSE: extraction response must be an object.');
  }
  const object = parsed as Record<string, unknown>;
  const rawFields = object.fields ?? object;
  if (!rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) {
    throw new Error('INVALID_AI_RESPONSE: extraction fields must be an object.');
  }

  const expectedFields = EXTRACT_FIELDS_BY_CODE[docCode] ?? [];
  if (expectedFields.length === 0) {
    throw new Error(`INVALID_AI_RESPONSE: no extraction schema exists for ${docCode}.`);
  }

  const parseScalar = (raw: unknown, label: string): ScalarField => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`INVALID_AI_RESPONSE: extraction field "${label}" must be an object { value, confidence }.`);
    }
    const field = raw as Record<string, unknown>;
    if (field.value !== null && typeof field.value !== 'string') {
      throw new Error(`INVALID_AI_RESPONSE: extraction field "${label}" value must be string or null.`);
    }
    if (typeof field.confidence !== 'number'
        || !Number.isFinite(field.confidence)
        || field.confidence < 0
        || field.confidence > 1) {
      throw new Error(`INVALID_AI_RESPONSE: extraction field "${label}" confidence must be between 0 and 1.`);
    }
    return { value: field.value as string | null, confidence: field.confidence };
  };

  const arrayFields = new Set(ARRAY_FIELDS_BY_CODE[docCode] ?? []);
  const source = rawFields as Record<string, unknown>;

  // Coerce a value into an array of member objects. Normalizes a common model
  // mistake WITHOUT another AI call: a single member returned as a bare object
  // (instead of a one-element array) is wrapped, but only when it looks like a
  // real member (has ≥1 expected member key). Genuinely wrong shapes still throw.
  const coerceMemberArray = (raw: unknown, label: string, memberKeys: string[]): unknown[] => {
    let arrayValue = raw;
    if (!Array.isArray(arrayValue)
        && arrayValue !== null
        && typeof arrayValue === 'object'
        && memberKeys.some((k) => k in (arrayValue as Record<string, unknown>))) {
      arrayValue = [arrayValue];
    }
    if (!Array.isArray(arrayValue)) {
      throw new Error(`INVALID_AI_RESPONSE: extraction field "${label}" must be an array.`);
    }
    return arrayValue;
  };

  // Parse one group member: its scalar keys, plus any nested sub-array keys
  // declared in ARRAY_MEMBER_SUBARRAYS (one level of nesting, e.g. a
  // reconciliation record owning its reconciliation_parties[]).
  const parseMember = (
    raw: unknown,
    label: string,
    scalarKeys: string[],
    subArrays: Record<string, string[]>,
  ): ExtractGroupMember => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`INVALID_AI_RESPONSE: extraction field "${label}" must be an object.`);
    }
    const memberSource = raw as Record<string, unknown>;
    const member: ExtractGroupMember = {};
    for (const key of scalarKeys) {
      member[key] = parseScalar(memberSource[key], `${label}.${key}`);
    }
    for (const [subKey, subMemberKeys] of Object.entries(subArrays)) {
      const subArrayValue = coerceMemberArray(memberSource[subKey], `${label}.${subKey}`, subMemberKeys);
      member[subKey] = subArrayValue.map((rawSub, subIndex) =>
        // Sub-members never nest further (no sub-arrays passed), so this is a
        // single level of recursion by design.
        parseMember(rawSub, `${label}.${subKey}[${subIndex}]`, subMemberKeys, {}),
      );
    }
    return member;
  };

  // Parse a single expected field. Throws on any validation problem; the caller
  // isolates the failure to that field (Requirement: per-field errors, not an
  // all-or-nothing document failure).
  const parseOneField = (fieldName: string): ExtractFieldValue => {
    const rawField = source[fieldName];

    if (arrayFields.has(fieldName)) {
      const memberKeys = ARRAY_MEMBER_FIELDS[fieldName] ?? [];
      const subArrays = ARRAY_MEMBER_SUBARRAYS[fieldName] ?? {};
      const arrayValue = coerceMemberArray(rawField, fieldName, memberKeys);
      return arrayValue.map((rawMember, memberIndex) =>
        parseMember(rawMember, `${fieldName}[${memberIndex}]`, memberKeys, subArrays),
      );
    }

    return parseScalar(rawField, fieldName);
  };

  const fields: ExtractFieldResult['fields'] = {};
  const fieldErrors: Record<string, string> = {};

  // Per-field isolation: one malformed field (e.g. escrow_parties with a wrong
  // shape) no longer discards the whole document. The bad field is recorded in
  // field_errors and left as a safe empty value; every other field is kept.
  // Array fields keep the empty-array placeholder so downstream array readers
  // (flattenCopy, presence pairing) stay type-correct.
  for (const fieldName of expectedFields) {
    try {
      fields[fieldName] = parseOneField(fieldName);
    } catch (error) {
      fieldErrors[fieldName] = error instanceof Error ? error.message : String(error);
      fields[fieldName] = arrayFields.has(fieldName) ? [] : { ...EMPTY_SCALAR };
    }
  }

  return { fields, field_errors: fieldErrors };
}

export function parseFrameworkCompareResult(value: unknown): FrameworkCompareResult {
  const parsed = parseDeep(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('INVALID_AI_RESPONSE: framework comparison response must be an object.');
  }
  const object = parsed as Record<string, unknown>;
  if (typeof object.verdict !== 'string' || !FRAMEWORK_VERDICTS.has(object.verdict)) {
    throw new Error('INVALID_AI_RESPONSE: framework verdict must be PASS, FAIL, or WARNING.');
  }
  if (!Array.isArray(object.clauses_modified) || object.clauses_modified.length > 500) {
    throw new Error('INVALID_AI_RESPONSE: framework clauses_modified must be an array.');
  }
  // Which template the comparator matched against (only meaningful when several
  // templates were supplied). Optional — absent for single-template compares.
  const matchedTemplate = typeof object.matched_template === 'string' && object.matched_template.trim()
    ? object.matched_template.trim()
    : undefined;
  // Different-document-type guard (Option B): the comparator prompt reports
  // `document_type_match: false` when the customer and template documents are
  // NOT the same kind (e.g. TTKQ vs. BBTL — different title / "Căn cứ" section).
  // In that case comparing clause-by-clause is meaningless: force a FAIL verdict
  // and surface DOC_TYPE_MISMATCH so the client can distinguish "wrong template
  // type" from an ordinary clause-level FAIL. When the field is absent (older
  // provider responses), behaviour is unchanged.
  const docTypeMatch = object.document_type_match;
  if (docTypeMatch === false) {
    const customerTitle = typeof object.customer_doc_title === 'string' ? object.customer_doc_title.trim() : '';
    const templateTitle = typeof object.template_doc_title === 'string' ? object.template_doc_title.trim() : '';
    const detail = customerTitle && templateTitle
      ? ` Chứng từ khách hàng là "${customerTitle}" nhưng chứng từ khung là "${templateTitle}".`
      : '';
    return {
      clauses_modified: [],
      verdict: 'FAIL',
      status: 'success',
      error: `DOC_TYPE_MISMATCH:${detail} Hai tài liệu không cùng loại nên không thể đối chiếu khung.`,
      ...(matchedTemplate ? { matched_template: matchedTemplate } : {}),
    };
  }
  const clauses = object.clauses_modified.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`INVALID_AI_RESPONSE: framework clause[${index}] must be an object.`);
    }
    const clause = item as Record<string, unknown>;
    if (typeof clause.clause_id !== 'string'
        || typeof clause.action !== 'string'
        || !FRAMEWORK_ACTIONS.has(clause.action)
        || typeof clause.severity !== 'string'
        || !FRAMEWORK_SEVERITIES.has(clause.severity)
        || (clause.template !== undefined && typeof clause.template !== 'string')
        || (clause.customer !== undefined && typeof clause.customer !== 'string')
        || (clause.detail !== undefined && typeof clause.detail !== 'string')) {
      throw new Error(`INVALID_AI_RESPONSE: framework clause[${index}] is malformed.`);
    }
    return {
      clause_id: clause.clause_id,
      // `removed` is a legacy alias for `missing`; normalize so downstream only
      // ever sees the four current actions with `missing` as the canonical
      // "template section absent in customer doc" signal.
      action: clause.action as 'added' | 'removed' | 'modified' | 'missing',
      ...(typeof clause.template === 'string' ? { template: clause.template } : {}),
      ...(typeof clause.customer === 'string' ? { customer: clause.customer } : {}),
      ...(typeof clause.detail === 'string' ? { detail: clause.detail } : {}),
      severity: clause.severity as 'info' | 'warning' | 'critical',
    };
  });
  return {
    clauses_modified: clauses,
    verdict: object.verdict as 'PASS' | 'FAIL' | 'WARNING',
    status: 'success',
    ...(matchedTemplate ? { matched_template: matchedTemplate } : {}),
  };
}


