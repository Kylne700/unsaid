// Kept apart from plugins/db.ts so the tests can create the same tables.
export const MIGRATIONS = [
  {
    version: 1,
    name: "create-unsaid-rooms",
    sql: `CREATE TABLE IF NOT EXISTS unsaid_rooms (
        code TEXT PRIMARY KEY,
        doc TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      )`,
  },
  {
    version: 2,
    name: "create-unsaid-llm-usage",
    sql: `CREATE TABLE IF NOT EXISTS unsaid_llm_usage (
        day TEXT NOT NULL,
        bucket TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, bucket)
      )`,
  },
];
export const MIGRATIONS_TABLE = "unsaid_migrations";
