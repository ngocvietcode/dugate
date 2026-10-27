import { Logger } from './logger';
import { RUNNING_STALL_MS, recoverStalledOperations } from './stalled-reaper';

const logger = new Logger({ service: 'stalled-reaper-scheduler' });
const FIVE_MINUTES_MS = 5 * 60 * 1000;
let scheduled = false;

/** Starts one in-process safety-net reaper after app startup and every five minutes. */
export function ensureStalledReaperScheduled(): void {
  if (scheduled) return;
  scheduled = true;
  logger.info('[Scheduled] Stalled-operation reaper started — interval 5 min');

  const reap = async () => {
    try {
      const recovered = await recoverStalledOperations(RUNNING_STALL_MS);
      if (recovered.length > 0) {
        logger.warn(`[Scheduled] Recovered ${recovered.length} stalled operation(s).`, { ids: recovered.map((operation) => operation.id) });
      }
    } catch (error) {
      logger.error('[Scheduled] Stalled-operation reaper failed', {}, error);
    }
  };

  setTimeout(() => void reap(), 10_000);
  setInterval(() => void reap(), FIVE_MINUTES_MS);
}
