import { integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

// One row per room: the whole room is a JSON document (server/domain/types.ts). `version` makes updates optimistic.
// No owner_email on purpose: rooms belong to a room code and per-member tokens, not to a signed-in account.
export const unsaidRooms = pgTable("unsaid_rooms", {
  code: text("code").primaryKey(),
  doc: text("doc").notNull(),
  version: integer("version").notNull().default(1),
});

// Gemini requests per UTC day: one "app" bucket for the whole deployment and one per room member (server/lib/llm-quota.ts).
export const unsaidLlmUsage = pgTable(
  "unsaid_llm_usage",
  {
    day: text("day").notNull(),
    bucket: text("bucket").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.bucket] })],
);
