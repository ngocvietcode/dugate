// tests/payment-account-management/extract-schemas.test.ts
// Unit tests for the MULTI-CALL schema infrastructure introduced for MB02:
//   - isMultiCallSchema        (type guard)
//   - allAiFields              (flatten either shape into FieldSpec[])
//   - validateGroupKeyUniqueness (catches authoring mistakes at load time)
//   - fieldLabelFor            (resolves labels across group boundaries)
//   - recordLabelFor           (resolves sub-key labels on repeating lists)
//   - ACCOUNT_EXTRACT_SCHEMAS  (registry stays sane after MB02 registration)
//
// These helpers are the seams between the schema shape (multi-call vs. single-
// call) and every downstream consumer (engine, prompt builder, UI). Locking
// them in with tests prevents silent drift the next time we split a schema.

// extract-schemas.ts → utils.ts → @/lib/storage. We are testing pure helpers,
// so stub the storage backend to avoid booting DB / settings modules.
jest.mock('@/lib/storage', () => ({
  getStorageBackend: jest.fn(),
}));

import {
  isMultiCallSchema,
  allAiFields,
  validateGroupKeyUniqueness,
  fieldLabelFor,
  recordLabelFor,
  type ExtractSchema,
  type ExtractSchemaGroup,
  type MultiCallExtractSchema,
} from '../../lib/pipelines/workflows/payment-account-management/shared/schemas';
import { ACCOUNT_EXTRACT_SCHEMAS } from '../../lib/pipelines/workflows/payment-account-management/shared/extract-schemas';

// ─── Test fixtures ──────────────────────────────────────────────────────────
// Minimal hand-built schemas — used to unit-test the helpers in isolation
// from the real (large) MB02 schema, so a helper regression stays visible
// even if the real schema also changes.

const SINGLE_CALL_FIXTURE: ExtractSchema = {
  aiFields: [
    { key: 'foo', label: 'Foo', desc: 'foo description' },
    { key: 'bar', label: 'Bar', desc: 'bar description' },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'FIXTURE' },
  ],
};

const MULTI_CALL_FIXTURE: MultiCallExtractSchema = {
  groups: [
    {
      name: 'g_alpha',
      aiFields: [
        { key: 'a1', label: 'Alpha 1', desc: 'alpha 1 description' },
        { key: 'a2', label: 'Alpha 2', desc: 'alpha 2 description' },
      ],
    },
    {
      name: 'g_beta',
      aiFields: [
        { key: 'b1', label: 'Beta 1', desc: 'beta 1 description' },
        {
          key: 'people',
          label: 'People list',
          desc: 'array of person records',
          recordLabels: { full_name: 'Họ và tên', age: 'Tuổi' },
        },
      ],
    },
  ],
  fixedFields: [
    { key: 'title', label: 'Loại tài liệu', value: 'FIXTURE_MC' },
  ],
};

// The real MB02 schema — used to assert that the shipping schema stays valid.
const MB02_SCHEMA = ACCOUNT_EXTRACT_SCHEMAS.MB02;
const MB01_SCHEMA = ACCOUNT_EXTRACT_SCHEMAS.MB01;

// ─── isMultiCallSchema ─────────────────────────────────────────────────────
describe('isMultiCallSchema', () => {
  it('returns true for a MultiCallExtractSchema', () => {
    expect(isMultiCallSchema(MULTI_CALL_FIXTURE)).toBe(true);
  });

  it('returns false for a single-call ExtractSchema', () => {
    expect(isMultiCallSchema(SINGLE_CALL_FIXTURE)).toBe(false);
  });

  it('recognises the real MB02 schema as multi-call', () => {
    if (!MB02_SCHEMA) throw new Error('MB02_SCHEMA is null in the registry');
    expect(isMultiCallSchema(MB02_SCHEMA)).toBe(true);
  });

  it('recognises the real MB01 schema as single-call', () => {
    if (!MB01_SCHEMA) throw new Error('MB01_SCHEMA is null in the registry');
    expect(isMultiCallSchema(MB01_SCHEMA)).toBe(false);
  });
});

// ─── allAiFields ────────────────────────────────────────────────────────────
describe('allAiFields', () => {
  it('returns aiFields verbatim for a single-call schema', () => {
    expect(allAiFields(SINGLE_CALL_FIXTURE)).toEqual(SINGLE_CALL_FIXTURE.aiFields);
  });

  it('flattens groups into a single FieldSpec[] for a multi-call schema', () => {
    const flat = allAiFields(MULTI_CALL_FIXTURE);
    expect(flat.map((f) => f.key)).toEqual(['a1', 'a2', 'b1', 'people']);
  });

  it('total length equals the sum of every group\'s aiFields length', () => {
    if (!MB02_SCHEMA || !isMultiCallSchema(MB02_SCHEMA)) {
      throw new Error('Expected MB02_SCHEMA to be a MultiCallExtractSchema');
    }
    const expected = MB02_SCHEMA.groups.reduce((n, g) => n + g.aiFields.length, 0);
    expect(allAiFields(MB02_SCHEMA)).toHaveLength(expected);
  });

  it('returns exactly 85 top-level aiFields for the real MB02 schema', () => {
    if (!MB02_SCHEMA) throw new Error('MB02_SCHEMA is null in the registry');
    // The current MB02 design has 85 top-level AI fields
    // (see mb02.md §4.1). If this number changes, either the schema was
    // extended intentionally (update this test) or something regressed.
    expect(allAiFields(MB02_SCHEMA)).toHaveLength(85);
  });
});

// ─── validateGroupKeyUniqueness ────────────────────────────────────────────
describe('validateGroupKeyUniqueness', () => {
  it('accepts a valid multi-call schema (no duplicate keys)', () => {
    expect(() => validateGroupKeyUniqueness(MULTI_CALL_FIXTURE)).not.toThrow();
  });

  it('accepts the real MB02 schema (already validated at module load)', () => {
    if (!MB02_SCHEMA || !isMultiCallSchema(MB02_SCHEMA)) {
      throw new Error('Expected MB02_SCHEMA to be a MultiCallExtractSchema');
    }
    expect(() => validateGroupKeyUniqueness(MB02_SCHEMA)).not.toThrow();
  });

  it('throws MULTI_CALL_SCHEMA_INVALID when a key appears in two groups', () => {
    const dup: MultiCallExtractSchema = {
      groups: [
        {
          name: 'g1',
          aiFields: [{ key: 'shared_key', label: 'A', desc: 'from g1' }],
        },
        {
          name: 'g2',
          aiFields: [{ key: 'shared_key', label: 'B', desc: 'from g2' }],
        },
      ],
    };
    expect(() => validateGroupKeyUniqueness(dup)).toThrow(
      /MULTI_CALL_SCHEMA_INVALID.*shared_key.*g1.*g2/,
    );
  });

  it('names the duplicate key and both offending groups in the message', () => {
    const dup: MultiCallExtractSchema = {
      groups: [
        {
          name: 'org',
          aiFields: [
            { key: 'org_name_vi', label: 'A', desc: 'first declaration' },
          ],
        },
        {
          name: 'branch',
          aiFields: [
            { key: 'org_name_vi', label: 'B', desc: 'second declaration' },
          ],
        },
      ],
    };
    let caught: unknown;
    try {
      validateGroupKeyUniqueness(dup);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    expect(msg).toContain('org_name_vi');
    expect(msg).toContain('org');
    expect(msg).toContain('branch');
  });
});

// ─── fieldLabelFor ─────────────────────────────────────────────────────────
describe('fieldLabelFor', () => {
  it('resolves a scalar aiField label from a single-call schema', () => {
    expect(fieldLabelFor(SINGLE_CALL_FIXTURE, 'foo')).toBe('Foo');
  });

  it('resolves a fixed-field label from a single-call schema', () => {
    expect(fieldLabelFor(SINGLE_CALL_FIXTURE, 'title')).toBe('Loại tài liệu');
  });

  it('resolves a key declared in ANY group of a multi-call schema', () => {
    // Both groups' keys resolve — allAiFields flattens transparently.
    expect(fieldLabelFor(MULTI_CALL_FIXTURE, 'a1')).toBe('Alpha 1');
    expect(fieldLabelFor(MULTI_CALL_FIXTURE, 'b1')).toBe('Beta 1');
  });

  it('resolves the fixed title from a multi-call schema', () => {
    expect(fieldLabelFor(MULTI_CALL_FIXTURE, 'title')).toBe('Loại tài liệu');
  });

  it('resolves representative MB02 keys from each of its 4 groups', () => {
    if (!MB02_SCHEMA) throw new Error('MB02_SCHEMA is null');
    // One sample per group — proves fieldLabelFor spans group boundaries on
    // the real schema.
    expect(fieldLabelFor(MB02_SCHEMA, 'org_name_vi')).toBe('Tên tổ chức (tiếng Việt)');
    expect(fieldLabelFor(MB02_SCHEMA, 'registered_services')).toBe('Dịch vụ đăng ký');
    expect(fieldLabelFor(MB02_SCHEMA, 'legal_representatives')).toBe(
      'Người đại diện hợp pháp (VI.1)',
    );
    expect(fieldLabelFor(MB02_SCHEMA, 'chief_accountants')).toBe(
      'Kế toán trưởng / Phụ trách kế toán (VII.1)',
    );
  });

  it('falls back to the raw key when the schema is undefined', () => {
    expect(fieldLabelFor(undefined, 'anything')).toBe('anything');
  });

  it('falls back to the raw key for an unknown top-level key', () => {
    expect(fieldLabelFor(SINGLE_CALL_FIXTURE, 'not_declared')).toBe('not_declared');
    expect(fieldLabelFor(MULTI_CALL_FIXTURE, 'not_declared')).toBe('not_declared');
  });
});

// ─── recordLabelFor ────────────────────────────────────────────────────────
describe('recordLabelFor', () => {
  it('resolves a sub-key on a repeating-list field declared inside a group', () => {
    expect(recordLabelFor(MULTI_CALL_FIXTURE, 'people', 'full_name')).toBe('Họ và tên');
    expect(recordLabelFor(MULTI_CALL_FIXTURE, 'people', 'age')).toBe('Tuổi');
  });

  it('resolves aligned sub-keys on each of MB02\'s 4 repeating people arrays', () => {
    if (!MB02_SCHEMA) throw new Error('MB02_SCHEMA is null');
    // `full_name` is present on every people list; the label is the shared
    // MB01-aligned Vietnamese string.
    expect(recordLabelFor(MB02_SCHEMA, 'legal_representatives', 'full_name')).toBe('Họ và tên');
    expect(recordLabelFor(MB02_SCHEMA, 'authorized_representatives', 'full_name')).toBe('Họ và tên');
    expect(recordLabelFor(MB02_SCHEMA, 'chief_accountants', 'full_name')).toBe('Họ và tên');
    expect(recordLabelFor(MB02_SCHEMA, 'authorized_by_chief_accountants', 'full_name')).toBe('Họ và tên');
  });

  it('resolves MB02-only sub-keys (role_label, authorization_poa_no)', () => {
    if (!MB02_SCHEMA) throw new Error('MB02_SCHEMA is null');
    // `role_label` sits on every people list; `authorization_poa_no` only on
    // the two "delegated" lists (VI.2 and VII.2).
    expect(recordLabelFor(MB02_SCHEMA, 'legal_representatives', 'role_label')).toBe('Vai trò trên biểu mẫu');
    expect(recordLabelFor(MB02_SCHEMA, 'authorized_representatives', 'authorization_poa_no')).toBe('Số văn bản ủy quyền');
    expect(recordLabelFor(MB02_SCHEMA, 'authorized_by_chief_accountants', 'authorization_poa_no')).toBe('Số văn bản ủy quyền');
  });

  it('falls back to the raw sub-key when the parent field has no recordLabels', () => {
    // `foo` is a plain scalar in the fixture — no recordLabels declared.
    expect(recordLabelFor(SINGLE_CALL_FIXTURE, 'foo', 'anything')).toBe('anything');
  });

  it('falls back to the raw sub-key when the parent is unknown', () => {
    expect(recordLabelFor(MULTI_CALL_FIXTURE, 'not_a_field', 'full_name')).toBe('full_name');
  });

  it('falls back to the raw sub-key when the schema is undefined', () => {
    expect(recordLabelFor(undefined, 'people', 'full_name')).toBe('full_name');
  });
});

// ─── ACCOUNT_EXTRACT_SCHEMAS registry sanity ───────────────────────────────
describe('ACCOUNT_EXTRACT_SCHEMAS registry', () => {
  it('registers MB02 as a MultiCallExtractSchema (not null)', () => {
    const s = ACCOUNT_EXTRACT_SCHEMAS.MB02;
    expect(s).not.toBeNull();
    expect(s).toBeDefined();
    if (s) expect(isMultiCallSchema(s)).toBe(true);
  });

  it('every non-null entry is a well-formed schema; every multi-call one passes the uniqueness check', () => {
    for (const [code, schema] of Object.entries(ACCOUNT_EXTRACT_SCHEMAS)) {
      if (schema === null) continue;

      // Every schema must expose either aiFields (single-call) or groups (multi-call).
      const isMc = isMultiCallSchema(schema);
      expect(Array.isArray((isMc ? (schema as MultiCallExtractSchema).groups : (schema as ExtractSchema).aiFields)))
        .toBe(true);

      if (isMc) {
        // Fail fast with the code name so the failure is actionable if any
        // future multi-call schema is added with duplicated keys.
        expect(() => validateGroupKeyUniqueness(schema as MultiCallExtractSchema))
          .not.toThrow();
      }

      // allAiFields must return at least one field on every registered schema —
      // an empty schema wouldn't be usable and would signal a data bug.
      expect(allAiFields(schema).length).toBeGreaterThan(0);

      // Sanity: the code key isn't the empty string.
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it('every ExtractSchemaGroup carries a non-empty name and at least one aiField', () => {
    for (const [code, schema] of Object.entries(ACCOUNT_EXTRACT_SCHEMAS)) {
      if (schema === null || !isMultiCallSchema(schema)) continue;
      for (const g of (schema as MultiCallExtractSchema).groups) {
        expect(g.name.length).toBeGreaterThan(0);
        expect(g.aiFields.length).toBeGreaterThan(0);
        // Silence unused-code warning; keep the code in scope for debug.
        void code;
      }
    }
  });
});

// Silence unused-import warnings for types referenced only in comments/JSDoc.
void ({} as ExtractSchemaGroup);
