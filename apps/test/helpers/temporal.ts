import { TestWorkflowEnvironment } from '@temporalio/testing';

/** Temporal dev server thật cho test. TEMPORAL_CLI trỏ tới binary `temporal` có sẵn (môi trường không tải được). */
export async function localEnv(): Promise<TestWorkflowEnvironment> {
  const path = process.env.TEMPORAL_CLI;
  return TestWorkflowEnvironment.createLocal(path
    ? { server: { executable: { type: 'existing-path', path }, extraArgs: ['--log-level', 'error'] } }
    : { server: { extraArgs: ['--log-level', 'error'] } });
}
