import { integer, pgTable, text } from "drizzle-orm/pg-core";

// One row per room: the whole room is a JSON document (server/domain/types.ts). `version` makes updates optimistic.
// No owner_email on purpose: rooms belong to a room code and per-member tokens, not to a signed-in account.
export const unsaidRooms = pgTable("unsaid_rooms", {
  code: text("code").primaryKey(),
  doc: text("doc").notNull(),
  version: integer("version").notNull().default(1),
});
