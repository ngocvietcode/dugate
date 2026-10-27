// lib/queue/worker-group-validation.ts
// Shared validation logic for worker group names and WORKER_QUEUE env var parsing.
// Used by both API routes (admin CRUD) and worker startup.

/**
 * Regex for valid worker group names:
 * - 2–50 characters
 * - Lowercase alphanumeric + hyphens only
 * - Must start and end with alphanumeric
 *
 * Note: This regex does NOT catch consecutive hyphens — use isValidWorkerGroupName() for full validation.
 */
export const WORKER_GROUP_NAME_REGEX = /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/;

/** Pattern that detects consecutive hyphens */
const CONSECUTIVE_HYPHENS_REGEX = /--/;

/**
 * Validates a worker group name against all constraints:
 * - 2–50 characters in length
 * - Lowercase alphanumeric characters and hyphens only
 * - Must start and end with an alphanumeric character
 * - No consecutive hyphens
 */
export function isValidWorkerGroupName(name: string): boolean {
  if (!WORKER_GROUP_NAME_REGEX.test(name)) return false;
  if (CONSECUTIVE_HYPHENS_REGEX.test(name)) return false;
  return true;
}

// ─── WORKER_QUEUE env var parsing ─────────────────────────────────────────────

export interface WorkerQueueEnvResult {
  valid: boolean;
  pipelineQueue: string;
  stepsQueue: string;
  /** Queue job workflow cha (`workflow` / `workflow.<group>`). */
  workflowQueue: string;
  error?: string;
}

/**
 * Parses and validates the WORKER_QUEUE environment variable value.
 *
 * Valid formats:
 * - "" or undefined → default queues (pipeline, workflow-steps)
 * - "pipeline" → default queues
 * - "pipeline.{group-name}" → group-specific queues
 *
 * Returns the resolved pipeline and steps queue names, or an error.
 */
export function validateWorkerQueueEnv(value: string | undefined): WorkerQueueEnvResult {
  // Empty or unset → default queues
  if (!value || value.trim() === '') {
    return { valid: true, pipelineQueue: 'pipeline', stepsQueue: 'workflow-steps', workflowQueue: 'workflow' };
  }

  const trimmed = value.trim();

  // Exact "pipeline" → default queues
  if (trimmed === 'pipeline') {
    return { valid: true, pipelineQueue: 'pipeline', stepsQueue: 'workflow-steps', workflowQueue: 'workflow' };
  }

  // Check for "pipeline.{group-name}" format
  const prefix = 'pipeline.';
  if (trimmed.startsWith(prefix)) {
    const groupName = trimmed.slice(prefix.length);

    if (!isValidWorkerGroupName(groupName)) {
      return {
        valid: false,
        pipelineQueue: '',
        stepsQueue: '',
        workflowQueue: '',
        error: `Invalid WORKER_QUEUE value "${trimmed}". The group name "${groupName}" must be 2–50 characters, ` +
          `lowercase alphanumeric and hyphens only, start and end with alphanumeric, and contain no consecutive hyphens. ` +
          `Expected format: "pipeline" or "pipeline.{valid-group-name}"`,
      };
    }

    return {
      valid: true,
      pipelineQueue: `pipeline.${groupName}`,
      stepsQueue: `workflow-steps.${groupName}`,
      workflowQueue: `workflow.${groupName}`,
    };
  }

  // Invalid format
  return {
    valid: false,
    pipelineQueue: '',
    stepsQueue: '',
    workflowQueue: '',
    error: `Invalid WORKER_QUEUE value "${trimmed}". Expected format: "pipeline" or "pipeline.{group-name}" ` +
      `where group-name is 2–50 lowercase alphanumeric characters and hyphens.`,
  };
}
