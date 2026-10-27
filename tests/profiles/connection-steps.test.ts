/**
 * Step-identity contract between the Profile editor, the internal API and the runtime.
 *
 * The editor keys prompt/model override drafts by `stepId ?? connectionId`, while
 * the API reports a stepless step as `stepId: null` and stores its override under
 * `'_default'`. If the editor invents a stepId on load, that key no longer matches
 * anything the server sent, the override renders empty, and the next save (which
 * uses `replaceOverrides: true`) deletes the stored row.
 */
import {
  ensureStepIds,
  overrideKeyFor,
  persistedStepId,
  type ConnectionStepDraft,
} from '@/lib/profiles/connection-steps';

const CONNECTION_ID = 'conn-doc-layout';
let counter = 0;
const deterministicId = () => `generated-${++counter}`;

beforeEach(() => { counter = 0; });

describe('ensureStepIds', () => {
  it('leaves a single stepless step alone so its draft key stays the connectionId', () => {
    // Legacy shape: connectionsOverride was persisted as ["ext-doc-layout"].
    const steps: ConnectionStepDraft[] = [{ slug: 'ext-doc-layout' }];

    const result = ensureStepIds(steps, deterministicId);

    expect(result[0].stepId).toBeUndefined();
    // The API answered `stepId: null` for this step, so its override draft was
    // stored under the connectionId. The rendered step must ask for the same key.
    expect(overrideKeyFor(result[0], CONNECTION_ID)).toBe(CONNECTION_ID);
    // ...and the save payload must target the row the server actually wrote.
    expect(persistedStepId(result[0])).toBe('_default');
  });

  it('keeps distinct stepless connectors on their own connectionId keys', () => {
    const result = ensureStepIds(
      [{ slug: 'ext-data-extractor' }, { slug: 'ext-fact-verifier' }],
      deterministicId,
    );

    expect(result.map((step) => step.stepId)).toEqual([undefined, undefined]);
    expect(overrideKeyFor(result[0], 'conn-a')).toBe('conn-a');
    expect(overrideKeyFor(result[1], 'conn-b')).toBe('conn-b');
  });

  it('only synthesises an id for a REPEATED connector, keeping the first occurrence default', () => {
    const result = ensureStepIds(
      [{ slug: 'ext-doc-layout' }, { slug: 'ext-doc-layout' }],
      deterministicId,
    );

    expect(result[0].stepId).toBeUndefined();
    expect(result[1].stepId).toBe('generated-1');
    expect(overrideKeyFor(result[0], CONNECTION_ID)).toBe(CONNECTION_ID);
    expect(overrideKeyFor(result[1], CONNECTION_ID)).toBe('generated-1');
    expect(persistedStepId(result[0])).toBe('_default');
    expect(persistedStepId(result[1])).toBe('generated-1');
  });

  it('never rewrites an explicit stepId', () => {
    const result = ensureStepIds(
      [{ slug: 'ext-doc-layout', stepId: 'ocr' }, { slug: 'ext-translator', stepId: 'translate' }],
      deterministicId,
    );

    expect(result.map((step) => step.stepId)).toEqual(['ocr', 'translate']);
    expect(counter).toBe(0);
  });

  it('is stable across reloads: keys do not drift between two loads of the same data', () => {
    const persisted: ConnectionStepDraft[] = [{ slug: 'ext-data-extractor' }, { slug: 'ext-fact-verifier' }];

    const firstLoad = ensureStepIds(persisted, deterministicId).map((s) => overrideKeyFor(s, `conn-${s.slug}`));
    const secondLoad = ensureStepIds(persisted, deterministicId).map((s) => overrideKeyFor(s, `conn-${s.slug}`));

    expect(secondLoad).toEqual(firstLoad);
  });
});

describe('override draft lookup against an API response', () => {
  it('finds the stored override for a stepless step', () => {
    // Shape of GET /api/internal/profile-endpoints → extConnections[]
    const apiConnections = [
      { connectionId: CONNECTION_ID, stepId: null as string | null, modelOverride: 'gemini-2.5-flash' },
    ];
    // Exactly how the editor seeds its draft map.
    const drafts: Record<string, string | null> = {};
    for (const conn of apiConnections) {
      drafts[conn.stepId ?? conn.connectionId] = conn.modelOverride ?? null;
    }

    const [renderedStep] = ensureStepIds([{ slug: 'ext-doc-layout' }], deterministicId);

    // Before the fix this read `drafts['generated-1']` → undefined → the Model
    // Override box rendered empty and the save wiped the row.
    expect(drafts[overrideKeyFor(renderedStep, CONNECTION_ID)]).toBe('gemini-2.5-flash');
  });
});
