// lib/pipelines/workflows/financial-report/concurrency.ts
// Semaphore giới hạn số lần gọi AI đồng thời — CODE-REVIEW-01 mục 6.
//
// Vì sao không dùng `await sleep(index * staggerDelayMs)` + Promise.all như trước:
// độ trễ tuyến tính không co giãn. PDF 100 trang → ~45 chunk × 5s = task cuối bắt đầu
// ở giây ~225, trong khi mỗi sub-step lại có timeout riêng → timeout dồn ở file dài.
//
// Cơ chế mới: N worker rút task từ hàng đợi (limit = max_concurrency), `staggerDelayMs`
// trở thành khoảng nghỉ TỐI THIỂU giữa hai lần KHỞI CHẠY (chống burst khi worker rảnh),
// không còn cộng dồn theo index.

export interface ConcurrencyOptions {
  /** Số task chạy đồng thời tối đa. */
  limit: number;
  /** Khoảng nghỉ tối thiểu giữa 2 lần khởi chạy task (ms). 0 = không giãn. */
  staggerDelayMs?: number;
}

/**
 * Chạy `task` cho từng phần tử của `items` với tối đa `limit` task đồng thời.
 * Kết quả trả về theo ĐÚNG thứ tự của `items` (không theo thứ tự hoàn thành).
 *
 * Lỗi của task được ném ra ngoài như Promise.all. Các bước classify/extract/translate
 * của workflow đã tự catch bên trong nên ở đây không cần swallow lỗi.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  options: ConcurrencyOptions,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const limit = Math.max(1, Math.floor(options.limit) || 1);
  const stagger = Math.max(0, Math.floor(options.staggerDelayMs ?? 0));
  const results = new Array<R>(items.length);

  let cursor = 0;
  // Mốc thời gian sớm nhất mà task tiếp theo được phép khởi chạy (dùng chung giữa các worker).
  let nextLaunchAt = 0;
  // CODE-REVIEW-01 mục 19: khi MỘT task throw, Promise.all reject ngay nhưng các worker khác
  // vẫn tiếp tục rút task mới — vẫn gọi AI (tốn token) và vẫn push uploadedKeys SAU khi
  // orchestrator đã chạy `finally { cleanupChunks(uploadedKeys) }` → file tạm thành orphan.
  // Cờ này chặn việc rút task mới. Hành vi ném lỗi ra ngoài giữ nguyên để caller quyết định.
  let aborted = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (aborted) return;

      const index = cursor++;
      if (index >= items.length) return;

      if (stagger > 0) {
        const now = Date.now();
        const launchAt = Math.max(now, nextLaunchAt);
        nextLaunchAt = launchAt + stagger;
        const wait = launchAt - now;
        if (wait > 0) await sleep(wait);
        // Kiểm tra lại sau khi ngủ: có thể task khác đã throw trong lúc chờ.
        if (aborted) return;
      }

      try {
        results[index] = await task(items[index], index);
      } catch (err) {
        aborted = true;
        throw err;
      }
    }
  };

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
