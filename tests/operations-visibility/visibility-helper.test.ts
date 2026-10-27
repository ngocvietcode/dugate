import {
  isHiddenFromOperations,
  visibleInOperationsCondition,
  workflowChildVisibility,
} from '@/lib/operations/operational-metadata';
import { toSqlText, VISIBLE_PREDICATE } from './helpers';

describe('Operation visibility helpers', () => {
  it('excludes both soft-deleted rows and hidden workflow sub-steps in SQL', () => {
    const text = toSqlText(visibleInOperationsCondition());
    expect(text).toMatch(VISIBLE_PREDICATE);
    expect(text).toBe('("Operation"."deletedAt" IS NULL AND "Operation"."hiddenFromOperations" = false)');
  });

  it.each([
    [{ deletedAt: null, hiddenFromOperations: false }, false],
    [{ deletedAt: new Date(), hiddenFromOperations: false }, true],
    [{ deletedAt: null, hiddenFromOperations: true }, true],
    [{ deletedAt: new Date(), hiddenFromOperations: true }, true],
  ])('row %p is hidden=%p', (row, expected) => {
    expect(isHiddenFromOperations(row)).toBe(expected);
  });

  it('treats a row created by workflowChildVisibility() as hidden', () => {
    expect(isHiddenFromOperations(workflowChildVisibility())).toBe(true);
  });
});
