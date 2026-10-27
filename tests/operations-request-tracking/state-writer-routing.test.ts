import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STATE_WRITERS = [
  'lib/worker-dlq.ts',
  'lib/stalled-reaper.ts',
  'app/api/internal/operations/[id]/cancel/route.ts',
  'app/api/v1/operations/[id]/cancel/route.ts',
  'app/api/internal/operations/[id]/resume/route.ts',
  'app/api/v1/operations/[id]/resume/route.ts',
] as const;

const MEMBERSHIP_WRITERS = [
  'app/api/operations/[id]/route.ts',
  'app/api/v1/operations/[id]/route.ts',
] as const;

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('non-pipeline Operation writer routing', () => {
  it.each(STATE_WRITERS)(
    '%s routes state changes through the transition service',
    (relativePath) => {
      const content = source(relativePath);
      expect(content).toContain('transitionOperationState');
      expect(content).not.toMatch(/db\s*\.\s*update\s*\(\s*operations\s*\)/);
    },
  );

  it.each(MEMBERSHIP_WRITERS)(
    '%s routes soft-delete membership changes through snapshot maintenance',
    (relativePath) => {
      const content = source(relativePath);
      expect(content).toContain('updateOperationMembership');
      expect(content).not.toMatch(/db\s*\.\s*update\s*\(\s*operations\s*\)/);
    },
  );

  it('supports both soft-delete and internal-hide eligibility mutations', () => {
    const content = source('lib/operations/state-transition.ts');
    expect(content).toContain("'deletedAt' | 'hiddenFromOperations'");
    expect(content).toContain('recomputeLockedBusinessGroup');
  });
});
