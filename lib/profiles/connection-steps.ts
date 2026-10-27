// lib/profiles/connection-steps.ts
// Step identity for the Profile pipeline editor.
//
// A ProfileEndpoint's `connectionsOverride` may or may not carry a `stepId` per
// step. The runtime and the API collapse a missing `stepId` to the literal
// `'_default'` (see lib/endpoints/profile-resolver.ts and
// app/api/internal/profile-endpoints/route.ts), and `GET /profile-endpoints`
// reports such a step as `stepId: null`.
//
// The editor keys its prompt/model override drafts by `stepId ?? connectionId`.
// Minting a fresh UUID for every stepless step — as the editor used to do on
// load — therefore broke that key: the draft map was keyed by connectionId
// (from the API response) while the rendered step asked for a brand-new UUID.
// The result was an override that looked empty in the UI and, because the editor
// saves with `replaceOverrides: true`, got DELETED from the database on the next
// save. Legacy `string[]` overrides and any pipeline reordered/trimmed while it
// still used endpoint defaults were both affected.
//
// Rule enforced here: only a REPEATED connector slug needs a synthetic id. The
// first occurrence keeps the implicit `_default` identity, so UI keys and stored
// rows line up.

export interface ConnectionStepDraft {
  slug: string;
  stepId?: string;
  captureSession?: string | null;
  injectSession?: string | null;
}

/** Stable draft key for a step's prompt/model override. */
export function overrideKeyFor(step: Pick<ConnectionStepDraft, 'stepId'>, connectionId: string): string {
  return step.stepId ?? connectionId;
}

/** The stepId the API/runtime will resolve this step to. */
export function persistedStepId(step: Pick<ConnectionStepDraft, 'stepId'>): string {
  return step.stepId?.trim() || '_default';
}

/**
 * Give every ambiguous step a synthetic id, and only those.
 *
 * @param steps steps as loaded from the API or built from endpoint defaults
 * @param generateId injectable id factory (tests pass a deterministic one)
 */
export function ensureStepIds(
  steps: ConnectionStepDraft[],
  generateId: () => string = () => crypto.randomUUID(),
): ConnectionStepDraft[] {
  const seenSlugs = new Set<string>();
  return steps.map((step) => {
    if (step.stepId) return step;
    if (!seenSlugs.has(step.slug)) {
      seenSlugs.add(step.slug);
      return step; // implicit '_default' — matches the stored row and the API response
    }
    return { ...step, stepId: generateId() };
  });
}
