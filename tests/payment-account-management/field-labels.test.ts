// tests/payment-account-management/field-labels.test.ts
// Unit tests for the UI-owned label lookups. The maps themselves are hand
// maintained (see the file header — they intentionally duplicate the backend
// schema's `label` fields), so these tests focus on the FALLBACK behavior
// which is the safety net when a schema adds a field before the UI catches up.

import {
  getFieldLabel,
  getRecordLabel,
} from '../../app/payment-account-management/components/field-labels';

describe('getFieldLabel', () => {
  it('returns the mapped label for a known code + key', () => {
    // Sanity check on the map: one entry from a small schema and one from MB01.
    expect(getFieldLabel('passport', 'id_no')).toBe('Số hộ chiếu');
    expect(getFieldLabel('MB01', 'legal_representatives')).toBe('Người đại diện hợp pháp');
  });

  it('falls back to the raw key when the doc code is unknown', () => {
    expect(getFieldLabel('does_not_exist', 'id_no')).toBe('id_no');
  });

  it('falls back to the raw key when the doc code is undefined', () => {
    // "unknown" documents (classifier failed) arrive with no code — the UI still
    // needs to render something, so we show the raw key.
    expect(getFieldLabel(undefined, 'id_no')).toBe('id_no');
  });

  it('falls back to the raw key when the doc code is known but the key is not', () => {
    // Happens whenever the backend adds a new field before the UI map is updated.
    expect(getFieldLabel('passport', 'brand_new_field')).toBe('brand_new_field');
  });

  it('handles a fixed-field label like `title`', () => {
    // `title` is a fixedField on every schema; the map treats it uniformly.
    expect(getFieldLabel('passport', 'title')).toBe('Loại tài liệu');
    expect(getFieldLabel('MB01', 'title')).toBe('Loại tài liệu');
  });
});

describe('getRecordLabel', () => {
  it('returns a shared person-record label for legal_representatives', () => {
    // Sub-keys shared across MB01's two people lists.
    expect(getRecordLabel('legal_representatives', 'full_name')).toBe('Họ và tên');
    expect(getRecordLabel('legal_representatives', 'position')).toBe('Chức vụ');
  });

  it('returns visa-specific labels for both legal_representatives and chief_accountants', () => {
    // MB02 puts a foreign-national visa block on BOTH person lists (VI legal
    // reps and VII chief accountants). The record-label superset covers both.
    expect(getRecordLabel('legal_representatives', 'visa_no')).toBe('Số thị thực');
    expect(getRecordLabel('chief_accountants', 'visa_no')).toBe('Số thị thực');
  });

  it('returns the shared person label for chief_accountants sub-keys', () => {
    expect(getRecordLabel('chief_accountants', 'full_name')).toBe('Họ và tên');
    expect(getRecordLabel('chief_accountants', 'tax_code')).toBe('Mã số thuế cá nhân');
  });

  it('falls back to the raw sub-key when the parent field has no record map', () => {
    // Not every parent field has record labels — most scalar fields don't.
    expect(getRecordLabel('id_no', 'full_name')).toBe('full_name');
  });

  it('falls back to the raw sub-key when the parent is known but the sub-key is not', () => {
    expect(getRecordLabel('legal_representatives', 'brand_new_subfield')).toBe(
      'brand_new_subfield',
    );
  });
});

// ─── Drift lock: every backend MB02 field must have a frontend label ────────
// The frontend label map intentionally duplicates the backend schema labels
// (see the file header — the two layers must not import each other). These
// tests close the drift risk: if a new MB02 field is added to the schema
// without a frontend label, the test below fails and points at the exact key.

// Mock @/lib/storage — the extract-schemas module transitively imports it via
// utils.ts, and we do not want to boot the storage backend for a pure lookup test.
jest.mock('@/lib/storage', () => ({
  getStorageBackend: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const schemasModule = require('../../lib/pipelines/workflows/payment-account-management/shared/schemas');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const extractSchemasModule = require('../../lib/pipelines/workflows/payment-account-management/shared/extract-schemas');

interface FieldSpecLike {
  key: string;
  label: string;
  recordLabels?: Record<string, string>;
}
interface FixedFieldLike {
  key: string;
  label: string;
  value: string;
}

const MB02_SCHEMA = extractSchemasModule.ACCOUNT_EXTRACT_SCHEMAS.MB02;

describe('MB02 label coverage (drift lock)', () => {
  it('MB02 is registered as a multi-call schema in the backend registry', () => {
    expect(MB02_SCHEMA).toBeTruthy();
    expect(schemasModule.isMultiCallSchema(MB02_SCHEMA)).toBe(true);
  });

  it('every top-level MB02 aiField key resolves to a non-fallback label', () => {
    const fields: FieldSpecLike[] = schemasModule.allAiFields(MB02_SCHEMA);
    const missing: string[] = [];
    for (const f of fields) {
      const label = getFieldLabel('MB02', f.key);
      if (label === f.key) missing.push(f.key);
    }
    expect(missing).toEqual([]);
  });

  it('every MB02 fixedField key resolves to a non-fallback label', () => {
    const fixed: FixedFieldLike[] = MB02_SCHEMA.fixedFields ?? [];
    const missing: string[] = [];
    for (const f of fixed) {
      const label = getFieldLabel('MB02', f.key);
      if (label === f.key) missing.push(f.key);
    }
    expect(missing).toEqual([]);
  });

  it('every sub-key on MB02\'s 4 repeating people arrays resolves to a non-fallback label', () => {
    // The four MB02 array fields — parent name → the aiField's recordLabels.
    const parentKeys = [
      'legal_representatives',
      'authorized_representatives',
      'chief_accountants',
      'authorized_by_chief_accountants',
    ] as const;

    // Section VII (chief_accountants + authorized_by_chief_accountants)
    // intentionally OMITS the online-banking sub-block from RECORD_LABELS —
    // per the XLSX, those persons don't register online banking. The
    // backend still declares the sub-keys on the schema's recordLabels for
    // completeness, so we skip them here to keep the drift lock accurate.
    const ONLINE_BANKING_KEYS = new Set([
      'online_banking_registered',
      'online_banking_function',
      'online_banking_pin',
      'online_banking_approval_order',
      'online_banking_approval_limit',
      'online_banking_admin_type',
      'online_banking_other',
    ]);
    const VII_LISTS = new Set<string>([
      'chief_accountants',
      'authorized_by_chief_accountants',
    ]);

    const fields: FieldSpecLike[] = schemasModule.allAiFields(MB02_SCHEMA);
    const byKey = new Map<string, FieldSpecLike>(fields.map((f) => [f.key, f]));

    const missing: Array<{ parent: string; key: string }> = [];
    for (const parent of parentKeys) {
      const parentField = byKey.get(parent);
      // Every list field on MB02 must be present in the schema.
      expect(parentField).toBeTruthy();
      const recordLabels = parentField?.recordLabels ?? {};
      for (const subKey of Object.keys(recordLabels)) {
        if (VII_LISTS.has(parent) && ONLINE_BANKING_KEYS.has(subKey)) continue;
        const label = getRecordLabel(parent, subKey);
        if (label === subKey) missing.push({ parent, key: subKey });
      }
    }
    expect(missing).toEqual([]);
  });
});
