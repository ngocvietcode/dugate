// app/doc-compare/types.ts

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
