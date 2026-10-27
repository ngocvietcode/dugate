import {
  aggregateCurrentStatus,
  classifyRequestState,
  resolveDisplayedStatus,
} from '@/lib/operations/status';

describe('Business Operation status aggregation', () => {
  it.each([
    ['RUNNING', 'ACTIVE'],
    ['PENDING', 'ACTIVE'],
    ['WAITING_USER_INPUT', 'ACTIVE'],
    ['SUCCEEDED', 'SUCCESSFUL'],
    ['FAILED', 'UNSUCCESSFUL'],
    ['CANCELLED', 'UNSUCCESSFUL'],
    ['running', 'UNKNOWN'],
    ['', 'UNKNOWN'],
  ] as const)('classifies %p as %s', (state, expected) => {
    expect(classifyRequestState(state)).toBe(expected);
  });

  it('returns IN_PROGRESS when any known state is active', () => {
    expect(aggregateCurrentStatus(['SUCCEEDED', 'PENDING', 'FAILED'])).toBe(
      'IN_PROGRESS',
    );
  });

  it('returns SUCCEEDED only when all requests succeeded', () => {
    expect(aggregateCurrentStatus(['SUCCEEDED', 'SUCCEEDED'])).toBe(
      'SUCCEEDED',
    );
  });

  it('returns FAILED for mixed terminal states containing a failure', () => {
    expect(aggregateCurrentStatus(['SUCCEEDED', 'FAILED', 'CANCELLED'])).toBe(
      'FAILED',
    );
  });

  it('does not consider an empty group or a group with unknown state valid', () => {
    expect(aggregateCurrentStatus([])).toBeNull();
    expect(aggregateCurrentStatus(['SUCCEEDED', 'UNRECOGNIZED'])).toBeNull();
  });
});

describe('Business Operation displayed status', () => {
  it('marks unknown current data invalid and preserves the last valid status', () => {
    expect(resolveDisplayedStatus(['RUNNING', 'UNRECOGNIZED'], 'FAILED')).toEqual(
      { status: 'FAILED', invalidData: true },
    );
  });

  it('uses N/A when unknown current data has no valid snapshot', () => {
    expect(resolveDisplayedStatus(['UNRECOGNIZED'], null)).toEqual({
      status: 'N/A',
      invalidData: true,
    });
    expect(resolveDisplayedStatus(['UNRECOGNIZED'], 'N/A')).toEqual({
      status: 'N/A',
      invalidData: true,
    });
  });

  it('clears the marker and recomputes once all states are known again', () => {
    expect(resolveDisplayedStatus(['SUCCEEDED', 'CANCELLED'], 'SUCCEEDED')).toEqual(
      { status: 'FAILED', invalidData: false },
    );
  });

  it('does not revive an empty group from a stale snapshot', () => {
    expect(resolveDisplayedStatus([], 'SUCCEEDED')).toEqual({
      status: 'N/A',
      invalidData: false,
    });
  });
});
