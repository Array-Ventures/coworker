import { LibSQLStore } from '@mastra/libsql';
import { DATA_PATH } from '../config/paths';

/** LibSQL file-based storage — derives path from DATA_PATH. */
export const DB_URL = `file:${DATA_PATH}/coworker.db`;

/** Single shared storage instance — passed to Mastra (which calls init()), Harness, and Memory. */
export const storage = new LibSQLStore({ id: 'coworker-storage', url: DB_URL });
