// Kept apart from plugins/db.ts so the tests can create the same table.
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
];
export const MIGRATIONS_TABLE = "unsaid_migrations";
