import pg from 'pg';

export const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

export const pool = new pg.Pool({ connectionString: DB_URL });

export async function initCustomTables() {
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  } catch (err) {
    console.warn('[db] pgvector extension not available — semantic memory will fail until installed');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      cron TEXT NOT NULL,
      schedule_config TEXT,
      prompt TEXT NOT NULL,
      notify BOOLEAN DEFAULT TRUE,
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      last_run_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_allowlist (
      phone_number TEXT PRIMARY KEY,
      raw_jid TEXT,
      label TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_pairing (
      code TEXT PRIMARY KEY,
      raw_jid TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_groups (
      group_jid TEXT PRIMARY KEY,
      group_name TEXT,
      enabled BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
