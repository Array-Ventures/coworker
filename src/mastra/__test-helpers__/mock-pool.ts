/**
 * Mock pg Pool for unit tests.
 *
 * Usage:
 *   const { pool, queries } = createMockPool();
 *   // or with stubs:
 *   const { pool, queries } = createMockPool([
 *     { match: /SELECT.*allowlist/, result: { rows: [{ phone_number: '+1234' }] } },
 *   ]);
 */

import { mock } from 'bun:test';

export interface QueryRecord {
  sql: string;
  params: unknown[] | undefined;
}

export interface QueryStub {
  /** String or regex to match against the SQL text */
  match: string | RegExp;
  /** The result to return when matched */
  result: { rows?: unknown[]; rowCount?: number };
}

const DEFAULT_RESULT = { rows: [], rowCount: 0 };

export function createMockPool(stubs: QueryStub[] = []) {
  const queries: QueryRecord[] = [];

  const queryFn = mock(async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });

    for (const stub of stubs) {
      const matched =
        typeof stub.match === 'string'
          ? sql.includes(stub.match)
          : stub.match.test(sql);
      if (matched) return { ...DEFAULT_RESULT, ...stub.result };
    }

    return { ...DEFAULT_RESULT };
  });

  const pool = { query: queryFn };

  return { pool, queries };
}
