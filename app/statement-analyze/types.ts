// app/statement-analyze/types.ts
// Shared types for the Statement Analyze Demo UI.

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  icon: string;
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
}
