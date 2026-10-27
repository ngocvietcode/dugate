export interface PipelineStepLike {
  processor: string;
  variables?: Record<string, unknown>;
  stepId?: string;
  captureSession?: string | null;
  injectSession?: string | null;
}

export function isPipelineStep(value: unknown): value is PipelineStepLike {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.processor !== 'string' || v.processor.length === 0) return false;
  if (v.variables !== undefined && (typeof v.variables !== 'object' || v.variables === null || Array.isArray(v.variables))) return false;
  if (v.stepId !== undefined && typeof v.stepId !== 'string') return false;
  if (v.captureSession !== undefined && v.captureSession !== null && typeof v.captureSession !== 'string') return false;
  if (v.injectSession !== undefined && v.injectSession !== null && typeof v.injectSession !== 'string') return false;
  return true;
}

export function extractPipelineProcessors(pipelineJson: string): string[] {
  try {
    const parsed = JSON.parse(pipelineJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPipelineStep).map((step) => step.processor);
  } catch {
    return [];
  }
}
