// app/ai-demo/types.ts
// Shared types for the AI Pipeline Demo UI

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  icon: string;
}

export interface FileProgress {
  id: string;
  file: UploadedFile;
  status: StepStatus;
  progress: number;
  output: string | null;
  duration: number | null;
}

export interface PipelineStep {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  accentColor: string;
  status: StepStatus;
  progress: number;
  output: string | null;
  duration: number | null;
  isParallel?: boolean;
  filesProgress?: FileProgress[];
  isCollapsed?: boolean;
}

/** Shape of a single step config for mock or real orchestration */
export interface StepConfig {
  isParallel: boolean;
  outputFn?: () => string;
  duration?: number;
  streamSpeed?: number;
  items?: UploadedFile[];
  getFileOutput?: (file: UploadedFile, index: number) => string;
  durationBase?: number;
}
