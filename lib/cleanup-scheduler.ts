// lib/cleanup-scheduler.ts
// Singleton: chạy cleanup 1 lần khi server khởi động + mỗi 6 tiếng
// Import từ layout.tsx để đảm bảo chạy khi app start

import { cleanupExpiredFiles, cleanupExpiredCache } from './cleanup';
import { Logger } from './logger';

const logger = new Logger({ service: 'cleanup-scheduler' });


const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

let scheduled = false;

export function ensureCleanupScheduled(): void {
  if (scheduled) return;
  scheduled = true;

  async function runAllCleanups() {
    await cleanupExpiredFiles().catch(err =>
      logger.error('[Scheduled] File cleanup failed', {}, err)
    );
    await cleanupExpiredCache().catch(err =>
      logger.error('[Scheduled] Cache cleanup failed', {}, err)
    );
  }

  // Chạy lần đầu sau 10s (đợi server fully ready)
  setTimeout(() => runAllCleanups(), 10_000);

  // Lặp mỗi 6 tiếng
  setInterval(() => runAllCleanups(), SIX_HOURS_MS);
}
