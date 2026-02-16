import { createClient } from '@libsql/client';

export const DB_URL = process.env.DATABASE_URL || 'file:../../mastra.db';

export const db = createClient({ url: DB_URL });

export async function initCustomTables() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      cron TEXT NOT NULL,
      schedule_config TEXT,
      prompt TEXT NOT NULL,
      notify INTEGER DEFAULT 1,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_run_at TEXT
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS agent_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_allowlist (
      phone_number TEXT PRIMARY KEY,
      raw_jid TEXT,
      label TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Add raw_jid column if upgrading from older schema
  try {
    await db.execute(`ALTER TABLE whatsapp_allowlist ADD COLUMN raw_jid TEXT`);
  } catch {
    // column already exists
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_pairing (
      code TEXT PRIMARY KEY,
      raw_jid TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}
