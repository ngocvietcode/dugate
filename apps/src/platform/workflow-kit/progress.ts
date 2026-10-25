import { defineQuery, setHandler } from '@temporalio/workflow';

export interface Progress { status: string; percent: number; message: string; openTasks: number }
export const progressQuery = defineQuery<Progress>('progress');

/** Trạng thái đọc realtime qua Query (projection DB có thể trễ). */
export class ProgressState {
  value: Progress = { status: 'RUNNING', percent: 0, message: 'Bắt đầu', openTasks: 0 };
  constructor() {
    setHandler(progressQuery, () => this.value);
  }
  set(p: Partial<Progress>): Progress {
    this.value = { ...this.value, ...p };
    return this.value;
  }
}
