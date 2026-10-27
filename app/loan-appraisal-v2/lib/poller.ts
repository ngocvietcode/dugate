// Poller tuần tự: mỗi vòng chỉ được lên lịch sau khi vòng trước xong, nên không có request chồng.

import { ApiError, isAbortError } from './api';
import type { OperationOutcome } from './operation-mapper';

export const POLL_INTERVAL_MS = 2000;
export const SOFT_TIMEOUT_MS = 10 * 60 * 1000;
export const STALL_TIMEOUT_MS = 60 * 60 * 1000;
export const MAX_CONSECUTIVE_ERRORS = 3;

export interface PollerDeps {
  fetchOperation: (signal: AbortSignal) => Promise<unknown>;
  /** Áp dữ liệu; trả outcome. Khác 'running' thì poller dừng. */
  onData: (data: unknown) => OperationOutcome;
  /** Lỗi dừng poll (fatal hoặc đủ số lần lỗi liên tiếp). */
  onFatal: (error: unknown) => void;
  onSoftTimeout: () => void;
  onStalled: () => void;
  intervalMs?: number;
  softTimeoutMs?: number;
  stallMs?: number;
  maxConsecutiveErrors?: number;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface Poller {
  start: () => void;
  stop: () => void;
  isActive: () => boolean;
}

export function createPoller(deps: PollerDeps): Poller {
  const interval = deps.intervalMs ?? POLL_INTERVAL_MS;
  const softMs = deps.softTimeoutMs ?? SOFT_TIMEOUT_MS;
  const stallMs = deps.stallMs ?? STALL_TIMEOUT_MS;
  const maxErrors = deps.maxConsecutiveErrors ?? MAX_CONSECUTIVE_ERRORS;
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let session = 0;
  let active = false;
  let timer: unknown = null;
  let controller: AbortController | null = null;
  let consecutiveErrors = 0;
  let startedAt = 0;
  let softFired = false;

  const stop = () => {
    session += 1;
    active = false;
    if (timer !== null) clearTimer(timer);
    timer = null;
    controller?.abort();
    controller = null;
  };

  const schedule = (mySession: number) => {
    timer = setTimer(() => { void tick(mySession); }, interval);
  };

  const tick = async (mySession: number) => {
    timer = null;
    if (mySession !== session) return;

    const elapsed = now() - startedAt;
    if (elapsed > stallMs) {
      stop();
      deps.onStalled();
      return;
    }
    if (!softFired && elapsed > softMs) {
      softFired = true;
      deps.onSoftTimeout();
    }

    const ctrl = new AbortController();
    controller = ctrl;
    try {
      const data = await deps.fetchOperation(ctrl.signal);
      if (mySession !== session) return;
      consecutiveErrors = 0;
      const outcome = deps.onData(data);
      if (mySession !== session) return;
      if (outcome !== 'running') { stop(); return; }
      schedule(mySession);
    } catch (error) {
      if (mySession !== session || isAbortError(error)) return;
      const fatal = error instanceof ApiError && (error.kind === 'forbidden' || error.kind === 'not-found');
      consecutiveErrors += 1;
      if (fatal || consecutiveErrors >= maxErrors) {
        stop();
        deps.onFatal(error);
        return;
      }
      schedule(mySession);
    }
  };

  return {
    start: () => {
      stop();
      active = true;
      consecutiveErrors = 0;
      softFired = false;
      startedAt = now();
      schedule(session);
    },
    stop,
    isActive: () => active,
  };
}
