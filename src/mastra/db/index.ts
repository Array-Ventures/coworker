import { LibSQLStore } from '@mastra/libsql';

/** LibSQL file-based storage — no external database server needed. */
export const DB_URL = process.env.DATABASE_URL || 'file:./data/coworker.db';

/** Single shared storage instance — passed to Mastra (which calls init()), Harness, and Memory. */
export const storage = new LibSQLStore({ id: 'coworker-storage', url: DB_URL });
