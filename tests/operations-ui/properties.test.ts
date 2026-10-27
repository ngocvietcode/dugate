// tests/operations-ui/properties.test.ts
// Property-based tests for Operations UI pure functions and invariants.
// Uses fast-check for property-based testing.

import fc from 'fast-check';
import {
  OperationState,
  STATE_BADGE_CONFIG,
  getStepDisplayStatus,
  safeParseJson,
  StepResult,
  StepDisplayStatus,
} from '../../app/operations/types';

// ═══════════════════════════════════════════════
// Arbitraries (generators)
// ═══════════════════════════════════════════════

const ALL_STATES: OperationState[] = [
  'RUNNING', 'SUCCEEDED', 'FAILED', 'PENDING', 'WAITING_USER_INPUT', 'CANCELLED',
];

const arbOperationState = fc.constantFrom(...ALL_STATES);

const arbStepResult = (step: number): fc.Arbitrary<StepResult> =>
  fc.record({
    step: fc.constant(step),
    processor: fc.string({ minLength: 1, maxLength: 30 }),
    output_format: fc.constantFrom('json', 'md', 'html', 'csv'),
    content_preview: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
  });

// ═══════════════════════════════════════════════
// Property 6: State Badge Color Mapping
// Feature: operations-ui, Property 6: State Badge Color Mapping
// ═══════════════════════════════════════════════

describe('Property 6: State Badge Color Mapping', () => {
  it('every valid OperationState maps to a non-empty label and className', () => {
    fc.assert(
      fc.property(arbOperationState, (state) => {
        const config = STATE_BADGE_CONFIG[state];
        expect(config).toBeDefined();
        expect(config.label.length).toBeGreaterThan(0);
        expect(config.className.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('SUCCEEDED maps to green classes', () => {
    const config = STATE_BADGE_CONFIG['SUCCEEDED'];
    expect(config.className).toContain('green');
  });

  it('FAILED maps to red classes', () => {
    const config = STATE_BADGE_CONFIG['FAILED'];
    expect(config.className).toContain('red');
  });

  it('RUNNING maps to blue classes', () => {
    const config = STATE_BADGE_CONFIG['RUNNING'];
    expect(config.className).toContain('blue');
  });

  it('WAITING_USER_INPUT maps to yellow classes', () => {
    const config = STATE_BADGE_CONFIG['WAITING_USER_INPUT'];
    expect(config.className).toContain('yellow');
  });

  it('CANCELLED and PENDING map to gray classes', () => {
    expect(STATE_BADGE_CONFIG['CANCELLED'].className).toContain('gray');
    expect(STATE_BADGE_CONFIG['PENDING'].className).toContain('gray');
  });

  it('all states include dark mode classes', () => {
    fc.assert(
      fc.property(arbOperationState, (state) => {
        expect(STATE_BADGE_CONFIG[state].className).toContain('dark:');
      }),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════
// Property 8: Step Status Determination
// Feature: operations-ui, Property 8: Step Status Determination
// ═══════════════════════════════════════════════

describe('Property 8: Step Status Determination', () => {
  it('a step with a result in stepsResult is always "completed"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        arbOperationState,
        fc.integer({ min: 0, max: 20 }),
        fc.option(fc.integer({ min: 0, max: 20 }), { nil: null }),
        (stepIndex, opState, currentStep, failedAtStep) => {
          // Create stepsResult that includes this step
          const stepsResult: StepResult[] = [
            { step: stepIndex, processor: 'test', output_format: 'json' },
          ];
          const status = getStepDisplayStatus(stepIndex, stepsResult, currentStep, failedAtStep, opState);
          expect(status).toBe('completed');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a step matching failedAtStep (without result) is "failed"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        arbOperationState,
        fc.integer({ min: 0, max: 20 }),
        (stepIndex, opState, currentStep) => {
          // No result for this step, failedAtStep matches
          const stepsResult: StepResult[] = [];
          const status = getStepDisplayStatus(stepIndex, stepsResult, currentStep, stepIndex, opState);
          expect(status).toBe('failed');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a step matching currentStep when RUNNING (without result, not failed) is "running"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        (stepIndex) => {
          const stepsResult: StepResult[] = [];
          // failedAtStep is null or different from stepIndex
          const status = getStepDisplayStatus(stepIndex, stepsResult, stepIndex, null, 'RUNNING');
          expect(status).toBe('running');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a step not in results, not failed, not current+RUNNING is "pending"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 20 }),
        fc.constantFrom<OperationState>('SUCCEEDED', 'FAILED', 'PENDING', 'WAITING_USER_INPUT', 'CANCELLED'),
        (stepIndex, opState) => {
          const stepsResult: StepResult[] = [];
          // currentStep is 0 (different from stepIndex which is >= 5)
          // failedAtStep is null
          const status = getStepDisplayStatus(stepIndex, stepsResult, 0, null, opState);
          expect(status).toBe('pending');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('completed takes priority over failed (step has result AND matches failedAtStep)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        arbOperationState,
        (stepIndex, opState) => {
          const stepsResult: StepResult[] = [
            { step: stepIndex, processor: 'test', output_format: 'json' },
          ];
          // failedAtStep also matches, but result exists → should be 'completed'
          const status = getStepDisplayStatus(stepIndex, stepsResult, 0, stepIndex, opState);
          expect(status).toBe('completed');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('return type is always one of the four valid StepDisplayStatus values', () => {
    const validStatuses: StepDisplayStatus[] = ['completed', 'running', 'pending', 'failed'];
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.array(arbStepResult(0), { minLength: 0, maxLength: 5 }),
        fc.integer({ min: 0, max: 20 }),
        fc.option(fc.integer({ min: 0, max: 20 }), { nil: null }),
        arbOperationState,
        (stepIndex, stepsResult, currentStep, failedAtStep, opState) => {
          const status = getStepDisplayStatus(stepIndex, stepsResult, currentStep, failedAtStep, opState);
          expect(validStatuses).toContain(status);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════
// Property: safeParseJson correctness
// ═══════════════════════════════════════════════

describe('safeParseJson utility', () => {
  it('returns fallback for null/undefined input', () => {
    fc.assert(
      fc.property(fc.anything(), (fallback) => {
        expect(safeParseJson(null, fallback)).toBe(fallback);
        expect(safeParseJson(undefined, fallback)).toBe(fallback);
        expect(safeParseJson('', fallback)).toBe(fallback);
      }),
      { numRuns: 100 },
    );
  });

  it('correctly parses valid JSON strings', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.string(),
          fc.boolean(),
          fc.constant(null),
          fc.array(fc.integer()),
          fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.integer()),
        ),
        (value) => {
          const json = JSON.stringify(value);
          const result = safeParseJson(json, 'FALLBACK');
          expect(result).toEqual(value);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns fallback for invalid JSON strings', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => {
          try { JSON.parse(s); return false; } catch { return true; }
        }),
        (invalidJson) => {
          const result = safeParseJson(invalidJson, 'FALLBACK');
          expect(result).toBe('FALLBACK');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════
// Property 3: Filter Correctness (pure logic)
// Feature: operations-ui, Property 3: Filter Correctness
// ═══════════════════════════════════════════════

describe('Property 3: Filter Correctness (pure logic)', () => {
  interface MockOperation {
    state: OperationState;
    endpointSlug: string | null;
    apiKeyId: string | null;
    deletedAt: Date | null;
  }

  function applyFilters(
    ops: MockOperation[],
    filters: { state?: OperationState; endpoint?: string; profile?: string },
  ): MockOperation[] {
    let result = ops.filter((op) => op.deletedAt === null);
    if (filters.state) result = result.filter((op) => op.state === filters.state);
    if (filters.endpoint) result = result.filter((op) => op.endpointSlug === filters.endpoint);
    if (filters.profile) result = result.filter((op) => op.apiKeyId === filters.profile);
    return result;
  }

  const arbMockOp: fc.Arbitrary<MockOperation> = fc.record({
    state: arbOperationState,
    endpointSlug: fc.option(fc.constantFrom('extract:invoice', 'analyze:fact-check', 'workflows:payroll'), { nil: null }),
    apiKeyId: fc.option(fc.constantFrom('key-1', 'key-2', 'key-3'), { nil: null }),
    deletedAt: fc.constant(null),
  });

  it('state filter: all returned operations have the filtered state', () => {
    fc.assert(
      fc.property(
        fc.array(arbMockOp, { minLength: 0, maxLength: 50 }),
        arbOperationState,
        (ops, filterState) => {
          const filtered = applyFilters(ops, { state: filterState });
          filtered.forEach((op) => {
            expect(op.state).toBe(filterState);
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  it('endpoint filter: all returned operations have the filtered endpoint', () => {
    fc.assert(
      fc.property(
        fc.array(arbMockOp, { minLength: 0, maxLength: 50 }),
        fc.constantFrom('extract:invoice', 'analyze:fact-check', 'workflows:payroll'),
        (ops, filterEndpoint) => {
          const filtered = applyFilters(ops, { endpoint: filterEndpoint });
          filtered.forEach((op) => {
            expect(op.endpointSlug).toBe(filterEndpoint);
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  it('profile filter: all returned operations have the filtered apiKeyId', () => {
    fc.assert(
      fc.property(
        fc.array(arbMockOp, { minLength: 0, maxLength: 50 }),
        fc.constantFrom('key-1', 'key-2', 'key-3'),
        (ops, filterProfile) => {
          const filtered = applyFilters(ops, { profile: filterProfile });
          filtered.forEach((op) => {
            expect(op.apiKeyId).toBe(filterProfile);
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════
// Property 5: Soft Delete Exclusion (pure logic)
// Feature: operations-ui, Property 5: Soft Delete Exclusion
// ═══════════════════════════════════════════════

describe('Property 5: Soft Delete Exclusion (pure logic)', () => {
  interface MockOperation {
    id: string;
    deletedAt: Date | null;
  }

  function filterSoftDeleted(ops: MockOperation[]): MockOperation[] {
    return ops.filter((op) => op.deletedAt === null);
  }

  it('never returns operations with deletedAt set', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            deletedAt: fc.option(fc.date(), { nil: null }),
          }),
          { minLength: 0, maxLength: 50 },
        ),
        (ops) => {
          const result = filterSoftDeleted(ops);
          result.forEach((op) => {
            expect(op.deletedAt).toBeNull();
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  it('preserves all non-deleted operations', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            deletedAt: fc.option(fc.date(), { nil: null }),
          }),
          { minLength: 0, maxLength: 50 },
        ),
        (ops) => {
          const result = filterSoftDeleted(ops);
          const expectedCount = ops.filter((op) => op.deletedAt === null).length;
          expect(result.length).toBe(expectedCount);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════
// Property 7: Auto-Refresh Invariant (pure logic)
// Feature: operations-ui, Property 7: Auto-Refresh Invariant
// ═══════════════════════════════════════════════

describe('Property 7: Auto-Refresh Invariant (pure logic)', () => {
  function shouldAutoRefresh(states: OperationState[]): boolean {
    return states.some((s) => s === 'RUNNING' || s === 'PENDING');
  }

  it('auto-refresh is active iff at least one operation is RUNNING or PENDING', () => {
    fc.assert(
      fc.property(
        fc.array(arbOperationState, { minLength: 0, maxLength: 30 }),
        (states) => {
          const hasActive = states.some((s) => s === 'RUNNING' || s === 'PENDING');
          expect(shouldAutoRefresh(states)).toBe(hasActive);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('auto-refresh is false for empty list', () => {
    expect(shouldAutoRefresh([])).toBe(false);
  });

  it('auto-refresh is false when all operations are terminal', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom<OperationState>('SUCCEEDED', 'FAILED', 'CANCELLED', 'WAITING_USER_INPUT'),
          { minLength: 1, maxLength: 30 },
        ),
        (states) => {
          expect(shouldAutoRefresh(states)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════
// Property 9: Detail Polling Invariant (pure logic)
// Feature: operations-ui, Property 9: Detail Polling Invariant
// ═══════════════════════════════════════════════

describe('Property 9: Detail Polling Invariant (pure logic)', () => {
  function shouldPoll(state: OperationState): boolean {
    return state === 'RUNNING' || state === 'PENDING';
  }

  it('polling is active iff state is RUNNING or PENDING', () => {
    fc.assert(
      fc.property(arbOperationState, (state) => {
        const expected = state === 'RUNNING' || state === 'PENDING';
        expect(shouldPoll(state)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('polling is false for all terminal states', () => {
    const terminalStates: OperationState[] = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'WAITING_USER_INPUT'];
    terminalStates.forEach((state) => {
      expect(shouldPoll(state)).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════
// Property 1: RBAC Filtering Correctness (pure logic)
// Feature: operations-ui, Property 1: RBAC Filtering Correctness
// ═══════════════════════════════════════════════

describe('Property 1: RBAC Filtering Correctness (pure logic)', () => {
  interface MockOperation {
    id: string;
    apiKeyId: string | null;
    deletedAt: Date | null;
  }

  /**
   * Mirrors the server rule in app/api/internal/operations/route.ts.
   *
   * Scope is expressed exactly as getAssignedProfileIds() returns it:
   *   - `null`  → holder of data:all-profiles (ADMIN, or OPS granted that scope)
   *   - array   → assigned Profiles ONLY, plus operations that carry no Profile
   *               at all (internal/no-profile operational work stays visible).
   * Soft-deleted rows are excluded in both cases.
   */
  function applyRbacFilter(
    ops: MockOperation[],
    assignedProfileIds: string[] | null,
  ): MockOperation[] {
    const result = ops.filter((op) => op.deletedAt === null);
    if (assignedProfileIds === null) return result;
    return result.filter((op) => op.apiKeyId === null || assignedProfileIds.includes(op.apiKeyId));
  }

  const arbMockOp: fc.Arbitrary<MockOperation> = fc.record({
    id: fc.uuid(),
    apiKeyId: fc.option(fc.constantFrom('key-1', 'key-2', 'key-3', 'key-4'), { nil: null }),
    deletedAt: fc.option(fc.date(), { nil: null }),
  });

  it('a holder of data:all-profiles sees all non-deleted operations', () => {
    fc.assert(
      fc.property(
        fc.array(arbMockOp, { minLength: 0, maxLength: 50 }),
        (ops) => {
          const result = applyRbacFilter(ops, null);
          const expected = ops.filter((op) => op.deletedAt === null);
          expect(result.length).toBe(expected.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a scoped operator never sees another Profile’s operations', () => {
    fc.assert(
      fc.property(
        fc.array(arbMockOp, { minLength: 0, maxLength: 50 }),
        fc.subarray(['key-1', 'key-2', 'key-3', 'key-4']),
        (ops, assignedIds) => {
          const result = applyRbacFilter(ops, assignedIds);
          result.forEach((op) => {
            if (op.apiKeyId !== null) expect(assignedIds).toContain(op.apiKeyId);
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a scoped operator with no assignment sees exactly the no-Profile operations', () => {
    fc.assert(
      fc.property(
        fc.array(arbMockOp, { minLength: 1, maxLength: 50 }),
        (ops) => {
          const result = applyRbacFilter(ops, []);
          const expected = ops.filter((op) => op.deletedAt === null && op.apiKeyId === null);
          expect(result.length).toBe(expected.length);
          result.forEach((op) => expect(op.apiKeyId).toBeNull());
        },
      ),
      { numRuns: 100 },
    );
  });

  it('no soft-deleted operations appear in results regardless of scope', () => {
    fc.assert(
      fc.property(
        fc.array(arbMockOp, { minLength: 0, maxLength: 50 }),
        fc.oneof(
          fc.constant<string[] | null>(null),
          fc.subarray(['key-1', 'key-2', 'key-3', 'key-4']),
        ),
        (ops, scope) => {
          const result = applyRbacFilter(ops, scope);
          result.forEach((op) => {
            expect(op.deletedAt).toBeNull();
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});
