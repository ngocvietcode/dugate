export const ACTIVE_STATES = [
  'RUNNING',
  'PENDING',
  'WAITING_USER_INPUT',
] as const;

export const SUCCESSFUL_STATES = ['SUCCEEDED'] as const;

export const UNSUCCESSFUL_STATES = ['FAILED', 'CANCELLED'] as const;

export const TERMINAL_STATES = [
  ...SUCCESSFUL_STATES,
  ...UNSUCCESSFUL_STATES,
] as const;

export type ActiveState = (typeof ACTIVE_STATES)[number];
export type SuccessfulState = (typeof SUCCESSFUL_STATES)[number];
export type UnsuccessfulState = (typeof UNSUCCESSFUL_STATES)[number];
export type TerminalState = (typeof TERMINAL_STATES)[number];
export type KnownRequestState = ActiveState | TerminalState;

export type RequestStateCategory =
  | 'ACTIVE'
  | 'SUCCESSFUL'
  | 'UNSUCCESSFUL'
  | 'UNKNOWN';

export type BusinessStatus = 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'N/A';
export type ValidBusinessStatus = Exclude<BusinessStatus, 'N/A'>;

export interface AggregateStatus {
  status: BusinessStatus;
  invalidData: boolean;
}

const activeStateSet: ReadonlySet<string> = new Set(ACTIVE_STATES);
const successfulStateSet: ReadonlySet<string> = new Set(SUCCESSFUL_STATES);
const unsuccessfulStateSet: ReadonlySet<string> = new Set(UNSUCCESSFUL_STATES);

export function classifyRequestState(state: string): RequestStateCategory {
  if (activeStateSet.has(state)) {
    return 'ACTIVE';
  }

  if (successfulStateSet.has(state)) {
    return 'SUCCESSFUL';
  }

  if (unsuccessfulStateSet.has(state)) {
    return 'UNSUCCESSFUL';
  }

  return 'UNKNOWN';
}

export function isKnownRequestState(state: string): state is KnownRequestState {
  return classifyRequestState(state) !== 'UNKNOWN';
}

/**
 * Computes a status only when the group is non-empty and every request state is
 * known. Unknown states and empty groups intentionally return null.
 */
export function aggregateCurrentStatus(
  states: readonly string[],
): ValidBusinessStatus | null {
  if (states.length === 0 || states.some((state) => !isKnownRequestState(state))) {
    return null;
  }

  if (states.some((state) => activeStateSet.has(state))) {
    return 'IN_PROGRESS';
  }

  if (states.every((state) => successfulStateSet.has(state))) {
    return 'SUCCEEDED';
  }

  // With only known, non-active states remaining, every state is terminal.
  // At least one unsuccessful state therefore makes the whole group failed.
  if (states.some((state) => unsuccessfulStateSet.has(state))) {
    return 'FAILED';
  }

  return null;
}

/**
 * Resolves the dashboard status while preserving the last valid status only
 * when current source data contains an unknown request state.
 */
export function resolveDisplayedStatus(
  states: readonly string[],
  lastValid: BusinessStatus | null,
): AggregateStatus {
  if (states.length === 0) {
    return { status: 'N/A', invalidData: false };
  }

  const hasUnknownState = states.some((state) => !isKnownRequestState(state));
  if (hasUnknownState) {
    return {
      status: lastValid && lastValid !== 'N/A' ? lastValid : 'N/A',
      invalidData: true,
    };
  }

  return {
    status: aggregateCurrentStatus(states) ?? 'N/A',
    invalidData: false,
  };
}
