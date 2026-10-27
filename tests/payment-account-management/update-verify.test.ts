// tests/payment-account-management/update-verify.test.ts
// Unit tests for the update-account reconciliation:
//   - parseUpdateBankData        — shape narrowing + INVALID_INPUT surface
//   - attachFieldValidations     — path resolver + leaf mutation semantics
//   - verifyUpdateAccount        — LLM-driven verify end-to-end with a mocked
//                                  enqueueSubStep (both happy path and failure)

import { parseUpdateBankData } from '../../lib/pipelines/workflows/payment-account-management/update-account/parse-bank-data';
import {
  attachFieldValidations,
  verifyUpdateAccount,
} from '../../lib/pipelines/workflows/payment-account-management/update-account/validate';
import type {
  UpdateAccountBankData,
  ValidationEntry,
} from '../../lib/pipelines/workflows/payment-account-management/update-account/types';

// Mock the workflow engine's enqueueSubStep so tests never touch the queue.
jest.mock('@/lib/pipelines/workflow-engine', () => {
  const actual = jest.requireActual('@/lib/pipelines/workflow-engine');
  return {
    ...actual,
    enqueueSubStep: jest.fn(),
  };
});
import { enqueueSubStep } from '@/lib/pipelines/workflow-engine';
const mockEnqueue = enqueueSubStep as jest.MockedFunction<typeof enqueueSubStep>;

// Minimal ctx stub — we only touch logger + modelOverrides in verifyUpdateAccount.
const stubCtx = () =>
  ({
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    modelOverrides: {},
    reasoningEffortOverrides: {},
  }) as any;

// ═══════════════════════════════════════════════════════════════════════════
// parseUpdateBankData
// ═══════════════════════════════════════════════════════════════════════════

describe('parseUpdateBankData', () => {
  it('returns {} for null / undefined (parser must not double-fail on missing data)', () => {
    expect(parseUpdateBankData(null)).toEqual({});
    expect(parseUpdateBankData(undefined)).toEqual({});
  });

  it('throws INVALID_INPUT when metadata.data is not an object', () => {
    expect(() => parseUpdateBankData('not an object')).toThrow(/INVALID_INPUT.*phải là object/);
    expect(() => parseUpdateBankData(42)).toThrow(/INVALID_INPUT/);
    expect(() => parseUpdateBankData([1, 2])).toThrow(/INVALID_INPUT.*array/);
  });

  it('accepts every optional scalar org field with string or null', () => {
    const out = parseUpdateBankData({
      org_name_vi: 'ABC',
      org_name_foreign: null,
      // org_short_name absent
    });
    expect(out.org_name_vi).toBe('ABC');
    expect(out.org_name_foreign).toBeNull();
    expect('org_short_name' in out).toBe(false);
  });

  it('rejects wrong-type scalar org fields', () => {
    expect(() => parseUpdateBankData({ org_name_vi: 42 })).toThrow(
      /INVALID_INPUT.*org_name_vi.*string/,
    );
  });

  it('parses a people list and each BankPersonRef inside it', () => {
    const out = parseUpdateBankData({
      legal_representatives: [
        { full_name: 'NGUYEN VAN A', id_no: '012', position: 'GIAM DOC' },
        { full_name: 'LE THI B' },
        {},
      ],
    });
    expect(out.legal_representatives).toHaveLength(3);
    expect(out.legal_representatives?.[0]).toEqual({
      full_name: 'NGUYEN VAN A',
      id_no: '012',
      position: 'GIAM DOC',
    });
  });

  it('rejects non-array people list', () => {
    expect(() => parseUpdateBankData({ legal_representatives: 'nope' })).toThrow(
      /INVALID_INPUT.*legal_representatives.*mảng/,
    );
  });

  it('rejects non-object elements inside a people list', () => {
    expect(() =>
      parseUpdateBankData({ chief_accountants: [{ full_name: 'A' }, 'stray'] }),
    ).toThrow(/INVALID_INPUT.*chief_accountants\[1\].*object/);
  });

  it('rejects wrong-type sub-fields on a person, naming the path', () => {
    expect(() =>
      parseUpdateBankData({ chief_accountants: [{ position: 42 }] }),
    ).toThrow(/INVALID_INPUT.*chief_accountants\[0\]\.position.*string/);
  });

  it('ignores unknown top-level keys (forward-compat)', () => {
    const out = parseUpdateBankData({ org_name_vi: 'ABC', unknown_field: 'ignored' });
    expect(out.org_name_vi).toBe('ABC');
    expect('unknown_field' in out).toBe(false);
  });

  it('treats an explicitly null people list identically to "not sent"', () => {
    const out = parseUpdateBankData({ legal_representatives: null });
    expect('legal_representatives' in out).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// attachFieldValidations — path resolver + leaf-mutation semantics
// ═══════════════════════════════════════════════════════════════════════════

describe('attachFieldValidations', () => {
  const entry = (code: string, status: 'pass' | 'fail' | 'skip' = 'pass'): ValidationEntry => ({
    code,
    status,
    severity: 'warning',
    bank_value: null,
  });

  it('attaches to a top-level wrapped scalar', () => {
    const tree: any = { org_name_new_vi: { value: 'X', confidence: 0.9 } };
    attachFieldValidations(tree, [{ path: 'org_name_new_vi', entry: entry('c1') }]);
    expect(tree.org_name_new_vi.validation).toEqual([entry('c1')]);
    expect(tree.org_name_new_vi.value).toBe('X'); // original value preserved
  });

  it('attaches to a nested array-item sub-key', () => {
    const tree: any = {
      chief_accountants: [
        { position: { value: 'KTT', confidence: 0.9 } },
      ],
    };
    attachFieldValidations(tree, [
      { path: 'chief_accountants[0].position', entry: entry('c2', 'fail') },
    ]);
    expect(tree.chief_accountants[0].position.validation).toEqual([entry('c2', 'fail')]);
  });

  it('appends when a validation array already exists', () => {
    const tree: any = {
      org_name_new_vi: { value: 'X', confidence: 0.9, validation: [entry('prior')] },
    };
    attachFieldValidations(tree, [{ path: 'org_name_new_vi', entry: entry('added') }]);
    expect(tree.org_name_new_vi.validation).toHaveLength(2);
    expect(tree.org_name_new_vi.validation[0].code).toBe('prior');
    expect(tree.org_name_new_vi.validation[1].code).toBe('added');
  });

  it('upgrades a raw scalar leaf into a wrapper before attaching', () => {
    const tree: any = { plain: 'unwrapped-value' };
    attachFieldValidations(tree, [{ path: 'plain', entry: entry('c3') }]);
    expect(tree.plain).toEqual({
      value: 'unwrapped-value',
      confidence: null,
      validation: [entry('c3')],
    });
  });

  it('silently drops entries whose path does not resolve', () => {
    const tree: any = { existing: { value: 'X', confidence: 0.9 } };
    attachFieldValidations(tree, [
      { path: 'not_there', entry: entry('c4') },
      { path: 'existing.missing[0]', entry: entry('c5') },
    ]);
    expect(tree).toEqual({ existing: { value: 'X', confidence: 0.9 } });
  });

  it('refuses to decorate a container-typed leaf (array or plain object)', () => {
    // Container leaves have no obvious "field" they own — better to skip than
    // corrupt the shape. The entry is dropped from the tree; counts still
    // reflect it at the doc level.
    const tree: any = { chief_accountants: [], profile: { nested: 'x' } };
    attachFieldValidations(tree, [
      { path: 'chief_accountants', entry: entry('c6') },
      { path: 'profile', entry: entry('c7') },
    ]);
    expect(Array.isArray(tree.chief_accountants)).toBe(true);
    expect((tree.chief_accountants as any).validation).toBeUndefined();
    expect(tree.profile.nested).toBe('x');
    expect((tree.profile as any).validation).toBeUndefined();
  });

  it('handles multi-index paths like a[0][1]', () => {
    const tree: any = {
      matrix: [[{ value: 'A' }, { value: 'B' }]],
    };
    attachFieldValidations(tree, [{ path: 'matrix[0][1]', entry: entry('c8') }]);
    expect(tree.matrix[0][1].validation).toEqual([entry('c8')]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// verifyUpdateAccount — LLM-driven, mocked
// ═══════════════════════════════════════════════════════════════════════════

describe('verifyUpdateAccount', () => {
  beforeEach(() => {
    mockEnqueue.mockReset();
  });

  it('surfaces `error` and skips the LLM call when extracted is null / undefined / non-object', async () => {
    const bank: UpdateAccountBankData = { org_name_vi: 'X' };
    for (const bad of [null, undefined, 'not object', 42]) {
      const v = await verifyUpdateAccount(stubCtx(), bad as any, bank);
      expect(mockEnqueue).not.toHaveBeenCalled();
      expect(v.error).toMatch(/Không có dữ liệu trích xuất/);
      expect(v.summary).toEqual({ pass: 0, fail: 0, skip: 0 });
      expect(v).not.toHaveProperty('orphan_checks');
    }
  });

  it('happy path: attaches per-field validations from LLM response and counts them', async () => {
    mockEnqueue.mockResolvedValue({
      operation: {} as any,
      extractedData: null,
      content: JSON.stringify({
        field_validations: [
          {
            path: 'org_name_new_vi',
            code: 'org_name_match:org_name_vi',
            status: 'fail',
            severity: 'warning',
            bank_value: 'CÔNG TY TNHH ABC',
            reason: 'Bank=ABC ≠ MB03=XYZ',
          },
          {
            path: 'chief_accountants[0].position',
            code: 'position_match:chief_accountants',
            status: 'pass',
            severity: 'warning',
            bank_value: 'Kế toán trưởng',
          },
        ],
      }),
    });

    const extracted: any = {
      org_name_new_vi: { value: 'XYZ', confidence: 0.9 },
      chief_accountants: [{ position: { value: 'KE TOAN TRUONG', confidence: 0.94 } }],
    };
    const v = await verifyUpdateAccount(stubCtx(), extracted, {});

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0][1]).toBe('ext-fact-verifier');
    const varsArg = mockEnqueue.mock.calls[0][2] as { _prompt: string };
    expect(varsArg._prompt).toContain('MB03');

    // Attached inline
    expect(extracted.org_name_new_vi.validation).toHaveLength(1);
    expect(extracted.org_name_new_vi.validation[0].status).toBe('fail');
    expect(extracted.chief_accountants[0].position.validation[0].status).toBe('pass');

    // Envelope — no error, counts only field entries
    expect(v.overall).toBe('pass');
    expect(v.summary).toEqual({ pass: 1, fail: 1, skip: 0 });
    expect(v.error).toBeUndefined();
    expect(v).not.toHaveProperty('orphan_checks');
  });

  it('surfaces `error` when the LLM call throws', async () => {
    mockEnqueue.mockRejectedValue(new Error('boom'));
    const v = await verifyUpdateAccount(stubCtx(), { foo: { value: 1 } }, {});
    expect(v.error).toMatch(/boom/);
    expect(v.summary).toEqual({ pass: 0, fail: 0, skip: 0 });
  });

  it('surfaces `error` when the LLM returns non-JSON', async () => {
    mockEnqueue.mockResolvedValue({
      operation: {} as any,
      extractedData: null,
      content: 'this is not json',
    });
    const v = await verifyUpdateAccount(stubCtx(), { foo: { value: 1 } }, {});
    expect(v.error).toMatch(/không phải object JSON/);
    expect(v.summary).toEqual({ pass: 0, fail: 0, skip: 0 });
  });

  it('surfaces `error` when the LLM returns empty content', async () => {
    mockEnqueue.mockResolvedValue({
      operation: {} as any,
      extractedData: null,
      content: '',
    });
    const v = await verifyUpdateAccount(stubCtx(), { foo: { value: 1 } }, {});
    expect(v.error).toMatch(/rỗng/);
  });

  it('drops malformed entries silently (missing path, code, or status)', async () => {
    mockEnqueue.mockResolvedValue({
      operation: {} as any,
      extractedData: null,
      content: JSON.stringify({
        field_validations: [
          { path: 'x', code: 'valid', status: 'pass', severity: 'warning', bank_value: null },
          { code: 'no_path', status: 'pass', bank_value: null },     // dropped
          { path: 'x', code: 'no_status', bank_value: null },        // dropped
          { path: 'x', status: 'pass', bank_value: null },           // dropped
          'not an object',                                           // dropped
        ],
      }),
    });
    const extracted: any = { x: { value: 'v' } };
    const v = await verifyUpdateAccount(stubCtx(), extracted, {});
    expect(extracted.x.validation).toHaveLength(1);
    expect(extracted.x.validation[0].code).toBe('valid');
    expect(v.summary).toEqual({ pass: 1, fail: 0, skip: 0 });
    expect(v.error).toBeUndefined();
  });
});
