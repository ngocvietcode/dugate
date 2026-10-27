import { appendProgressLog } from '@/lib/pipelines/workflow-engine';

describe('workflow progress history — R14-O3', () => {
  it('appends timestamped entries and retains only the newest 50', () => {
    let log: string | null = null;
    for (let index = 0; index < 51; index++) {
      log = appendProgressLog(log, index, `progress ${index}`, new Date(index * 1000));
    }

    const entries = JSON.parse(log ?? '[]');
    expect(entries).toHaveLength(50);
    expect(entries[0]).toMatchObject({ percent: 1, message: 'progress 1' });
    expect(entries.at(-1)).toMatchObject({ percent: 50, message: 'progress 50' });
  });
});
