import * as fc from 'fast-check';

import {
  resolveDisplayedStatus,
  type ValidBusinessStatus,
} from '@/lib/operations/status';

const ACTIVE_STATES = ['RUNNING', 'PENDING', 'WAITING_USER_INPUT'] as const;
const KNOWN_STATES = [
  ...ACTIVE_STATES,
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;

const knownStateSet: ReadonlySet<string> = new Set(KNOWN_STATES);

const knownStatesArbitrary = fc.array(fc.constantFrom(...KNOWN_STATES), {
  minLength: 1,
  maxLength: 20,
});

const unknownStateArbitrary = fc
  .string({ maxLength: 32 })
  .filter((state) => !knownStateSet.has(state));

const lastValidStatusArbitrary = fc.constantFrom<ValidBusinessStatus>(
  'IN_PROGRESS',
  'SUCCEEDED',
  'FAILED',
);

function expectedKnownStatus(
  states: readonly (typeof KNOWN_STATES)[number][],
): ValidBusinessStatus {
  if (states.some((state) => ACTIVE_STATES.includes(state as never))) {
    return 'IN_PROGRESS';
  }

  if (states.every((state) => state === 'SUCCEEDED')) {
    return 'SUCCEEDED';
  }

  return 'FAILED';
}

describe('Business Operation unknown-state status property', () => {
  // Feature: operations-request-tracking, Property 3: Unknown state không phá hủy trạng thái hợp lệ gần nhất
  // **Validates: Requirements 2.5, 2.6, 2.7, 2.8**
  it('preserves a last-valid snapshot during unknown data and recomputes after recovery', () => {
    fc.assert(
      fc.property(
        knownStatesArbitrary,
        knownStatesArbitrary,
        unknownStateArbitrary,
        lastValidStatusArbitrary,
        fc.nat(),
        (
          currentKnownStates,
          recoveredKnownStates,
          unknownState,
          lastValidStatus,
          insertionSeed,
        ) => {
          const current = resolveDisplayedStatus(currentKnownStates, null);
          expect(current).toEqual({
            status: expectedKnownStatus(currentKnownStates),
            invalidData: false,
          });

          const statesWithUnknown: string[] = [...currentKnownStates];
          const insertionIndex = insertionSeed % (statesWithUnknown.length + 1);
          statesWithUnknown.splice(insertionIndex, 0, unknownState);

          expect(
            resolveDisplayedStatus(statesWithUnknown, lastValidStatus),
          ).toEqual({
            status: lastValidStatus,
            invalidData: true,
          });
          expect(
            resolveDisplayedStatus(
              statesWithUnknown,
              current.status as ValidBusinessStatus,
            ),
          ).toEqual({
            status: current.status,
            invalidData: true,
          });
          expect(resolveDisplayedStatus(statesWithUnknown, null)).toEqual({
            status: 'N/A',
            invalidData: true,
          });
          expect(resolveDisplayedStatus(statesWithUnknown, 'N/A')).toEqual({
            status: 'N/A',
            invalidData: true,
          });

          expect(
            resolveDisplayedStatus(recoveredKnownStates, lastValidStatus),
          ).toEqual({
            status: expectedKnownStatus(recoveredKnownStates),
            invalidData: false,
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
