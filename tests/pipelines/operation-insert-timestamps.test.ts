// tests/pipelines/operation-insert-timestamps.test.ts
//
// Regression guard for the Operation.updatedAt insert contract.
//
// Operation.updatedAt is NOT NULL and is written with the DB clock. If the column
// ever gains a Drizzle .default(), Drizzle stops emitting a value on INSERT and
// writes `default` instead — every Operation insert then depends on the DEFAULT
// existing in the target database. On a database created before that default was
// introduced the insert violates NOT NULL and the whole submit path (POST
// /api/v1/docs/ingest and friends) fails with a 500.
//
// These tests assert the generated SQL directly, so no database is required.

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';

function insertSqlWithout(): string {
  return db.insert(operations).values({
    id: 'op-regression',
    pipelineJson: '[]',
  } as never).toSQL().sql;
}

describe('Operation insert timestamp contract', () => {
  it('emits the DB clock for updatedAt even when the caller omits it', () => {
    // Must be a real expression, never the `default` keyword: the submit path
    // (lib/pipelines/submit.ts) and enqueueSubStep both insert without updatedAt.
    expect(insertSqlWithout()).toContain('CURRENT_TIMESTAMP(3)');
  });

  it('keeps an explicitly supplied updatedAt expression', () => {
    const statement = db.insert(operations).values({
      id: 'op-regression-2',
      pipelineJson: '[]',
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    } as never).toSQL().sql;

    expect(statement).toContain('CURRENT_TIMESTAMP(3)');
  });

  it('still lists updatedAt among the inserted columns', () => {
    expect(insertSqlWithout()).toContain('"updatedAt"');
  });
});
