// tests/financial-report/concurrency.test.ts
// CODE-REVIEW-01 mục 6 — semaphore thay cho stagger tuyến tính.

import { runWithConcurrency, sleep } from '@/lib/pipelines/workflows/financial-report/concurrency';

describe('runWithConcurrency', () => {
  it('keeps overdue timer reservations separated after an event-loop stall', async () => {
    jest.useFakeTimers({ now: 0 });
    let stalled = false;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => stalled ? Math.max(100, jest.now()) : jest.now());
    try {
      const startedAt: number[] = [];
      // Reserve slots first, then simulate delayed callbacks observing the same clock.
      const pending = runWithConcurrency([0, 1, 2, 3], { limit: 4, staggerDelayMs: 20 }, async () => {
        startedAt.push(Date.now());
        await sleep(5);
        stalled = true;
      });
      await jest.runAllTimersAsync();
      await pending;
      expect(startedAt).toHaveLength(4);
      for (let i = 1; i < startedAt.length; i++) {
        expect(startedAt[i] - startedAt[i - 1]).toBeGreaterThanOrEqual(20);
      }
    } finally {
      nowSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('không bao giờ vượt quá `limit` task đồng thời', async () => {
    const limit = 3;
    let running = 0;
    let peak = 0;

    await runWithConcurrency(Array.from({ length: 20 }, (_, i) => i), { limit }, async () => {
      running++;
      peak = Math.max(peak, running);
      await sleep(5);
      running--;
    });

    expect(peak).toBeLessThanOrEqual(limit);
    expect(peak).toBe(limit);
    expect(running).toBe(0);
  });

  it('chạy hết mọi item và giữ ĐÚNG thứ tự kết quả theo input', async () => {
    const items = [50, 10, 30, 0, 20];
    const results = await runWithConcurrency(items, { limit: 2 }, async (ms, index) => {
      await sleep(ms % 15);
      return `${index}:${ms}`;
    });
    expect(results).toEqual(['0:50', '1:10', '2:30', '3:0', '4:20']);
  });

  it('limit lớn hơn số item thì không tạo worker rỗng', async () => {
    const calls: number[] = [];
    const results = await runWithConcurrency([1, 2], { limit: 10 }, async (v) => {
      calls.push(v);
      return v * 2;
    });
    expect(calls.sort()).toEqual([1, 2]);
    expect(results).toEqual([2, 4]);
  });

  it('limit không hợp lệ (0 / âm) vẫn chạy tuần tự, không treo', async () => {
    const results = await runWithConcurrency([1, 2, 3], { limit: 0 }, async (v) => v + 1);
    expect(results).toEqual([2, 3, 4]);
  });

  it('mảng rỗng trả về mảng rỗng, không gọi task', async () => {
    const task = jest.fn();
    expect(await runWithConcurrency([], { limit: 3 }, task)).toEqual([]);
    expect(task).not.toHaveBeenCalled();
  });

  // Vòng #04 mục 2: KHÔNG assert khoảng thời gian chính xác. Khi CPU bị tranh (full suite,
  // CI nhiều worker) `setTimeout` trả muộn tuỳ ý nên mọi trần trên đều flaky.
  // Chỉ assert tính chất thật sự cần: các lần khởi chạy KHÔNG dồn cục, cách nhau >= stagger
  // (trừ dung sai timer của Node), và cơ chế mới không cộng dồn tuyến tính theo index.
  const TIMER_TOLERANCE_MS = 10; // setTimeout của Node có thể trả sớm vài ms

  it('staggerDelayMs giãn cách các lần khởi chạy, không dồn cục', async () => {
    const stagger = 20;
    const startedAt: number[] = [];
    const t0 = Date.now();

    await runWithConcurrency(Array.from({ length: 4 }, (_, i) => i), { limit: 2, staggerDelayMs: stagger }, async () => {
      startedAt.push(Date.now() - t0);
      await sleep(5);
    });

    expect(startedAt).toHaveLength(4);
    // Chỉ kiểm biên DƯỚI: hai lần khởi chạy liền nhau không được sát nhau.
    for (let i = 1; i < startedAt.length; i++) {
      expect(startedAt[i] - startedAt[i - 1]).toBeGreaterThanOrEqual(stagger - TIMER_TOLERANCE_MS);
    }
  });

  it('không cộng dồn tuyến tính theo index (đo bằng đồng hồ ảo, không phụ thuộc CPU)', async () => {
    // Cơ chế cũ: task thứ i chờ i × stagger → khoảng chờ tăng dần 1×, 2×, 3×...
    // Cơ chế mới: mốc khởi chạy dùng chung → mỗi task chờ ĐÚNG 1 stagger.
    //
    // Dùng đồng hồ ảo: setTimeout không ngủ thật mà cộng thẳng vào clock, Date.now đọc clock.
    // Nhờ vậy phép tính thời gian trong runWithConcurrency vẫn đúng mà test chạy tức thì.
    const stagger = 5_000;
    const waits: number[] = [];
    let clock = 1_000_000;

    const realSetTimeout = global.setTimeout;
    const timeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(((fn: () => void, ms?: number) => {
        const delay = ms ?? 0;
        waits.push(delay);
        clock += delay;
        return realSetTimeout(fn, 0);
      }) as unknown as typeof setTimeout);
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);

    try {
      await runWithConcurrency(
        Array.from({ length: 5 }, (_, i) => i),
        { limit: 1, staggerDelayMs: stagger },
        async (v) => v,
      );
    } finally {
      timeoutSpy.mockRestore();
      nowSpy.mockRestore();
    }

    // 5 task, limit 1 → task đầu không phải chờ, 4 task sau mỗi task chờ đúng 1 stagger.
    expect(waits).toEqual([stagger, stagger, stagger, stagger]);
  });

  it('lỗi của task được ném ra ngoài (không bị swallow)', async () => {
    await expect(
      runWithConcurrency([1, 2, 3], { limit: 2 }, async (v) => {
        if (v === 2) throw new Error('boom');
        return v;
      }),
    ).rejects.toThrow('boom');
  });

  // CODE-REVIEW-01 mục 19 — dừng sớm khi có task throw.
  it('khi 1 task throw thì task CHƯA khởi chạy không được chạy nữa', async () => {
    const started: number[] = [];

    await expect(
      runWithConcurrency(Array.from({ length: 12 }, (_, i) => i), { limit: 2 }, async (index) => {
        started.push(index);
        await sleep(3);
        if (index === 1) throw new Error('storage down');
        return index;
      }),
    ).rejects.toThrow('storage down');

    // Cho các worker còn lại thời gian để (nếu có bug) rút thêm task.
    await sleep(60);

    // limit=2 nên tối đa 1 task nữa đã kịp khởi chạy song song trước khi cờ abort bật.
    expect(started.length).toBeLessThanOrEqual(4);
    expect(started).not.toContain(11);
  });

  it('dừng sớm vẫn áp dụng khi đang chờ stagger', async () => {
    const started: number[] = [];

    await expect(
      runWithConcurrency(Array.from({ length: 10 }, (_, i) => i), { limit: 1, staggerDelayMs: 15 }, async (index) => {
        started.push(index);
        if (index === 0) throw new Error('fail first');
        return index;
      }),
    ).rejects.toThrow('fail first');

    // Chờ đủ nhiều chu kỳ stagger để nếu có bug thì worker mồ côi kịp rút thêm task.
    // Không assert theo mốc thời gian, chỉ assert danh sách task đã chạy.
    for (let i = 0; i < 6; i++) await sleep(20);
    expect(started).toEqual([0]);
  });
});
