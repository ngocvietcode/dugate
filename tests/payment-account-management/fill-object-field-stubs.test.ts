// tests/payment-account-management/fill-object-field-stubs.test.ts
// Unit tests for fillObjectFieldStubs — the post-process pass that ensures
// every declared object / object[] field always surfaces with a full key
// skeleton (all-null sub-keys) instead of a bare null or a missing key.
//
// Problem being tested:
//   When the AI returns  "chief_accountants": null  (field is absent / empty),
//   downstream consumers must still receive the expected shape:
//     object[]  →  [{ full_name: null, date_of_birth: null, ... }]
//     object    →  { full_name: null, date_of_birth: null, ... }
//
// fillObjectFieldStubs is a pure function, so every test is synchronous and
// does not involve any LLM calls or I/O.

jest.mock('@/lib/storage', () => ({
  getStorageBackend: jest.fn(),
}));

import { fillObjectFieldStubs } from '../../lib/pipelines/workflows/payment-account-management/shared/extract-engine';
import type { FieldSpec } from '../../lib/pipelines/workflows/payment-account-management/shared/schemas';

// ─── Shared fixtures ────────────────────────────────────────────────────────

const PERSON_LABELS = {
  full_name: 'Họ và tên',
  date_of_birth: 'Ngày sinh',
  id_no: 'Số GTTT',
};

const OWNER_LABELS = {
  full_name: 'Họ và tên',
  date_of_birth: 'Sinh ngày',
  nationality: 'Quốc tịch',
};

// A minimal FieldSpec set that mirrors the real MB02 chief_accountants field.
const FIELDS_WITH_OBJECT_ARRAY: FieldSpec[] = [
  {
    key: 'org_name_vi',
    label: 'Tên tổ chức',
    desc: 'Org name',
    // no type → defaults to 'string' → should be skipped by fillObjectFieldStubs
  },
  {
    key: 'chief_accountants',
    label: 'Kế toán trưởng',
    desc: 'Chief accountants list',
    type: 'object[]',
    recordLabels: PERSON_LABELS,
  },
];

// A FieldSpec set with a bare 'object' field (like DKKD's owner block).
const FIELDS_WITH_OBJECT: FieldSpec[] = [
  {
    key: 'registration_no',
    label: 'Mã số DN',
    desc: 'Registration number',
    // string → skipped
  },
  {
    key: 'owner',
    label: 'Chủ sở hữu',
    desc: 'Single owner record',
    type: 'object',
    recordLabels: OWNER_LABELS,
  },
];

// ─── object[] — null input ──────────────────────────────────────────────────
describe('fillObjectFieldStubs — object[] field', () => {
  it('replaces null with a one-element array whose object has every recordLabel key set to null', () => {
    const wrapped: Record<string, unknown> = {
      org_name_vi: { value: 'CÔNG TY ABC', confidence: 0.9 },
      chief_accountants: null,
    };

    fillObjectFieldStubs(wrapped, FIELDS_WITH_OBJECT_ARRAY);

    expect(wrapped.chief_accountants).toEqual([
      { full_name: null, date_of_birth: null, id_no: null },
    ]);
  });

  it('replaces an undefined / missing key with the same stub', () => {
    // AI omitted the key entirely (not even returning null)
    const wrapped: Record<string, unknown> = {
      org_name_vi: { value: 'X', confidence: 0.8 },
      // chief_accountants absent on purpose
    };

    fillObjectFieldStubs(wrapped, FIELDS_WITH_OBJECT_ARRAY);

    expect(wrapped.chief_accountants).toEqual([
      { full_name: null, date_of_birth: null, id_no: null },
    ]);
  });

  it('does NOT touch a field that already has a real array value', () => {
    const existing = [
      { full_name: { value: 'Nguyễn Văn A', confidence: 0.95 }, date_of_birth: null, id_no: null },
    ];
    const wrapped: Record<string, unknown> = {
      chief_accountants: existing,
    };

    fillObjectFieldStubs(wrapped, FIELDS_WITH_OBJECT_ARRAY);

    // Must be the exact same reference — not replaced
    expect(wrapped.chief_accountants).toBe(existing);
  });

  it('does NOT touch a field that already has an empty array []', () => {
    const wrapped: Record<string, unknown> = {
      chief_accountants: [],
    };

    fillObjectFieldStubs(wrapped, FIELDS_WITH_OBJECT_ARRAY);

    expect(wrapped.chief_accountants).toEqual([]);
  });

  it('stub contains exactly the keys declared in recordLabels — no extras, no missing', () => {
    const wrapped: Record<string, unknown> = { chief_accountants: null };

    fillObjectFieldStubs(wrapped, FIELDS_WITH_OBJECT_ARRAY);

    const stub = (wrapped.chief_accountants as Record<string, unknown>[])[0];
    expect(Object.keys(stub).sort()).toEqual(Object.keys(PERSON_LABELS).sort());
    // All values are null
    expect(Object.values(stub).every((v) => v === null)).toBe(true);
  });

  it('does not affect non-object scalar fields', () => {
    const wrapped: Record<string, unknown> = {
      org_name_vi: { value: 'CÔNG TY ABC', confidence: 0.9 },
      chief_accountants: null,
    };

    fillObjectFieldStubs(wrapped, FIELDS_WITH_OBJECT_ARRAY);

    // Scalar field must be unchanged
    expect(wrapped.org_name_vi).toEqual({ value: 'CÔNG TY ABC', confidence: 0.9 });
  });
});

// ─── object (single record) — null input ───────────────────────────────────
describe('fillObjectFieldStubs — object (single record) field', () => {
  it('replaces null with a plain object whose every key is null', () => {
    const wrapped: Record<string, unknown> = {
      registration_no: { value: '0123456789', confidence: 1 },
      owner: null,
    };

    fillObjectFieldStubs(wrapped, FIELDS_WITH_OBJECT);

    expect(wrapped.owner).toEqual({
      full_name: null,
      date_of_birth: null,
      nationality: null,
    });
  });

  it('replaces a missing key with the plain-object stub', () => {
    const wrapped: Record<string, unknown> = {
      registration_no: { value: 'X', confidence: 0.9 },
      // owner absent
    };

    fillObjectFieldStubs(wrapped, FIELDS_WITH_OBJECT);

    expect(wrapped.owner).toEqual({
      full_name: null,
      date_of_birth: null,
      nationality: null,
    });
  });

  it('does NOT wrap in an array — returns a plain object, not [object]', () => {
    const wrapped: Record<string, unknown> = { owner: null };

    fillObjectFieldStubs(wrapped, FIELDS_WITH_OBJECT);

    expect(Array.isArray(wrapped.owner)).toBe(false);
    expect(typeof wrapped.owner).toBe('object');
  });

  it('does NOT touch an already-populated object value', () => {
    const existing = {
      full_name: { value: 'Trần Thị B', confidence: 0.9 },
      date_of_birth: null,
      nationality: null,
    };
    const wrapped: Record<string, unknown> = { owner: existing };

    fillObjectFieldStubs(wrapped, FIELDS_WITH_OBJECT);

    expect(wrapped.owner).toBe(existing);
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────────────
describe('fillObjectFieldStubs — edge cases', () => {
  it('skips an object[] field that has NO recordLabels — does not crash and leaves null', () => {
    const fields: FieldSpec[] = [
      {
        key: 'entries',
        label: 'Entries',
        desc: 'some list',
        type: 'object[]',
        // recordLabels intentionally absent
      },
    ];
    const wrapped: Record<string, unknown> = { entries: null };

    expect(() => fillObjectFieldStubs(wrapped, fields)).not.toThrow();
    // Without recordLabels there is no canonical stub → leave as-is
    expect(wrapped.entries).toBeNull();
  });

  it('handles multiple object[] fields in one pass', () => {
    const fields: FieldSpec[] = [
      {
        key: 'legal_representatives',
        label: 'Đại diện pháp luật',
        desc: '',
        type: 'object[]',
        recordLabels: { full_name: 'Họ và tên', id_no: 'Số GTTT' },
      },
      {
        key: 'chief_accountants',
        label: 'Kế toán trưởng',
        desc: '',
        type: 'object[]',
        recordLabels: { full_name: 'Họ và tên', position: 'Chức vụ' },
      },
    ];
    const wrapped: Record<string, unknown> = {
      legal_representatives: null,
      chief_accountants: null,
    };

    fillObjectFieldStubs(wrapped, fields);

    expect(wrapped.legal_representatives).toEqual([{ full_name: null, id_no: null }]);
    expect(wrapped.chief_accountants).toEqual([{ full_name: null, position: null }]);
  });

  it('mixes already-populated and null fields correctly', () => {
    const existing = [{ full_name: { value: 'A', confidence: 0.9 }, id_no: null }];
    const fields: FieldSpec[] = [
      {
        key: 'legal_representatives',
        label: '',
        desc: '',
        type: 'object[]',
        recordLabels: { full_name: 'Họ tên', id_no: 'GTTT' },
      },
      {
        key: 'chief_accountants',
        label: '',
        desc: '',
        type: 'object[]',
        recordLabels: { full_name: 'Họ tên', id_no: 'GTTT' },
      },
    ];
    const wrapped: Record<string, unknown> = {
      legal_representatives: existing,
      chief_accountants: null,
    };

    fillObjectFieldStubs(wrapped, fields);

    // populated one → untouched
    expect(wrapped.legal_representatives).toBe(existing);
    // null one → filled
    expect(wrapped.chief_accountants).toEqual([{ full_name: null, id_no: null }]);
  });

  it('does not mutate the aiFields array itself', () => {
    const fields: FieldSpec[] = [
      {
        key: 'chief_accountants',
        label: '',
        desc: '',
        type: 'object[]',
        recordLabels: PERSON_LABELS,
      },
    ];
    const fieldsCopy = JSON.stringify(fields);
    const wrapped: Record<string, unknown> = { chief_accountants: null };

    fillObjectFieldStubs(wrapped, fields);

    expect(JSON.stringify(fields)).toBe(fieldsCopy);
  });

  it('stub keys are independent objects — mutating one stub does not affect another call', () => {
    const fields: FieldSpec[] = [
      {
        key: 'chief_accountants',
        label: '',
        desc: '',
        type: 'object[]',
        recordLabels: PERSON_LABELS,
      },
    ];

    const wrapped1: Record<string, unknown> = { chief_accountants: null };
    const wrapped2: Record<string, unknown> = { chief_accountants: null };

    fillObjectFieldStubs(wrapped1, fields);
    fillObjectFieldStubs(wrapped2, fields);

    // Mutate wrapped1's stub
    (wrapped1.chief_accountants as Record<string, unknown>[])[0].full_name = 'changed';

    // wrapped2 must be unaffected
    expect(
      (wrapped2.chief_accountants as Record<string, unknown>[])[0].full_name,
    ).toBeNull();
  });
});
