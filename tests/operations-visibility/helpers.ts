// tests/operations-visibility/helpers.ts
// Shared test utilities for the Operations visibility / audit fixes.
//
// `createQueryRecorder()` returns a fake Drizzle `db` whose query builders are
// chainable and thenable. Every `.where(condition)` argument is recorded so a
// test can render it to SQL text and assert on the real predicate a route sent,
// instead of on implementation details.

import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const dialect = new PgDialect();

/** Render a Drizzle condition to its SQL text (parameters become $1, $2…). */
export function toSqlText(condition: unknown): string {
  if (condition === undefined || condition === null) return '';
  return dialect.sqlToQuery(condition as SQL).sql;
}

/** The visibility predicate every reader must contain. */
export const VISIBLE_PREDICATE = /"deletedAt" is null and "Operation"\."hiddenFromOperations" = false/i;

export interface QueryRecorder {
  db: Record<string, jest.Mock>;
  whereArgs: unknown[];
  setArgs: unknown[];
  /** Queue the resolved value for the next awaited query (FIFO). */
  enqueueResult: (rows: unknown) => void;
  reset: () => void;
}

export function createQueryRecorder(): QueryRecorder {
  const whereArgs: unknown[] = [];
  const setArgs: unknown[] = [];
  let results: unknown[] = [];

  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of [
    'select', 'selectDistinct', 'from', 'leftJoin', 'innerJoin', 'orderBy',
    'limit', 'offset', 'groupBy', 'having', 'update', 'insert', 'values', 'returning',
    'onConflictDoNothing', 'onConflictDoUpdate',
  ]) {
    builder[method] = jest.fn(chain);
  }
  builder.where = jest.fn((condition: unknown) => {
    whereArgs.push(condition);
    return builder;
  });
  builder.set = jest.fn((values: unknown) => {
    setArgs.push(values);
    return builder;
  });
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(results.length > 0 ? results.shift() : []).then(resolve, reject)
  );

  const db: Record<string, jest.Mock> = {
    select: jest.fn(chain),
    selectDistinct: jest.fn(chain),
    update: jest.fn(chain),
    insert: jest.fn(chain),
    execute: jest.fn(async () => (results.length > 0 ? results.shift() : [])),
  };

  return {
    db,
    whereArgs,
    setArgs,
    enqueueResult: (rows) => { results.push(rows); },
    reset: () => {
      whereArgs.length = 0;
      setArgs.length = 0;
      results = [];
    },
  };
}

export function opsSession(id = 'ops-1', role = 'OPS') {
  return { session: { user: { id, username: id, role } } };
}
