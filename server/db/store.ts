import { and, eq } from "drizzle-orm";
import type { Room } from "../domain/types";
import { RoomError } from "../domain/util";
import { getDb } from "./index.js";
import { unsaidRooms } from "./schema.js";

export async function loadRoom(code: string): Promise<Room | null> {
  const [row] = await getDb().select({ doc: unsaidRooms.doc }).from(unsaidRooms).where(eq(unsaidRooms.code, code)).limit(1);
  return row ? (JSON.parse(row.doc) as Room) : null;
}

/** Returns false when the code is already taken. */
export async function insertRoom(room: Room): Promise<boolean> {
  const rows = await getDb().insert(unsaidRooms).values({ code: room.code, doc: JSON.stringify(room) }).onConflictDoNothing().returning({ code: unsaidRooms.code });
  return rows.length === 1;
}

/**
 * Load, change, save. The save only lands if nobody else saved in between (version check); otherwise the
 * change is re-applied to the fresh room. `change` must be a pure function of the room it is given.
 */
async function tryMutate<T>(code: string, change: (room: Room) => T | Promise<T>): Promise<{ room: Room; result: T }> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const [row] = await getDb().select().from(unsaidRooms).where(eq(unsaidRooms.code, code)).limit(1);
    if (!row) throw new RoomError("Room not found.", "not_found");
    const room = JSON.parse(row.doc) as Room;
    const result = await change(room);
    const saved = await getDb()
      .update(unsaidRooms)
      .set({ doc: JSON.stringify(room), version: row.version + 1 })
      .where(and(eq(unsaidRooms.code, code), eq(unsaidRooms.version, row.version)))
      .returning({ version: unsaidRooms.version });
    if (saved.length === 1) return { room, result };
    await new Promise((r) => setTimeout(r, Math.random() * 20 * (attempt + 1))); // desynchronise other writers
  }
  throw new RoomError("The room is busy, try again.", "conflict");
}

// Writers to one room queue up inside this process (so a burst of clicks never races itself); the version
// check above still protects against other server instances.
const queues = new Map<string, Promise<unknown>>();
export function mutateRoom<T>(code: string, change: (room: Room) => T | Promise<T>): Promise<{ room: Room; result: T }> {
  const run = () => tryMutate(code, change);
  const result = (queues.get(code) ?? Promise.resolve()).then(run, run);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(code, tail);
  void tail.then(() => {
    if (queues.get(code) === tail) queues.delete(code);
  });
  return result;
}
