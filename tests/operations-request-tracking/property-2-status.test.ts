import * as fc from 'fast-check';

import { aggregateCurrentStatus } from '@/lib/operations/status';

const KNOWN_STATES = [
  'RUNNING',
  'PENDING',
  'WAITING_USER_INPUT',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;

type KnownState = (typeof KNOWN_STATES)[number];
type ExpectedStatus = 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';

const ACTIVE_STATES: ReadonlySet<KnownState> = new Set([
  'RUNNING',
  'PENDING',
  'WAITING_USER_INPUT',
]);

function expectedStatus(states: readonly KnownState[]): ExpectedStatus {
  if (states.some((state) => ACTIVE_STATES.has(state))) {
    return 'IN_PROGRESS';
  }

  if (states.every((state) => state === 'SUCCEEDED')) {
    return 'SUCCEEDED';
  }

  return 'FAILED';
}

const knownStateChangeArbitrary = fc
  .array(fc.constantFrom(...KNOWN_STATES), { minLength: 1, maxLength: 30 })
  .chain((states) =>
    fc.integer({ min: 0, max: states.length - 1 }).chain((changedIndex) =>
      fc
        .constantFrom(
          ...KNOWN_STATES.filter((state) => state !== states[changedIndex]),
        )
        .map((replacementState) => ({ states, changedIndex, replacementState })),
    ),
  );

describe('Business Operation state aggregation property', () => {
  // Feature: operations-request-tracking, Property 2: State aggregation khớp state model
  // **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
  it('matches the known-state model before and after a constituent state change', () => {
    fc.assert(
      fc.property(
        knownStateChangeArbitrary,
        ({ states, changedIndex, replacementState }) => {
          expect(aggregateCurrentStatus(states)).toBe(expectedStatus(states));

          const changedStates = [...states];
          changedStates[changedIndex] = replacementState;

          expect(changedStates[changedIndex]).not.toBe(states[changedIndex]);
          expect(aggregateCurrentStatus(changedStates)).toBe(
            expectedStatus(changedStates),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
