// The version check in mutateRoom, which is what protects a room when two server instances (serverless) write at once.
// "Another instance" is simulated by saving to the table in the middle of our load-change-save.
import { getDbExec } from "@agent-native/core/db";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { emptyRoom, optionDefs } from "../domain/state";
import { getDb } from "./index.js";
import { MIGRATIONS } from "./migrations";
import { unsaidRooms } from "./schema.js";
import { insertRoom, loadRoom, mutateRoom } from "./store";

beforeAll(async () => {
  for (const m of MIGRATIONS) await getDbExec().execute(m.sql as string);
});

const newRoom = async (code: string) => {
  expect(await insertRoom(emptyRoom(code, "Which one?", optionDefs(["A", "B"])))).toBe(true);
};

describe("mutateRoom: a save by another instance between our load and our save", () => {
  it("is never overwritten: our change is re-applied to the fresh room", async () => {
    await newRoom("STORE1");
    let runs = 0;
    await mutateRoom("STORE1", async (room) => {
      runs++;
      if (runs === 1) {
        const other = { ...room, question: "Changed by the other instance" };
        await getDb().update(unsaidRooms).set({ doc: JSON.stringify(other), version: sql`${unsaidRooms.version} + 1` }).where(eq(unsaidRooms.code, "STORE1"));
      }
      room.notes["m1"] = `written on run ${runs}`;
    });
    expect(runs).toBe(2);
    const saved = await loadRoom("STORE1");
    expect(saved?.question).toBe("Changed by the other instance");
    expect(saved?.notes["m1"]).toBe("written on run 2");
  });

  it("gives up with a 'conflict' error after 10 attempts when other writers keep winning", async () => {
    await newRoom("STORE2");
    let runs = 0;
    const busy = mutateRoom("STORE2", async () => {
      runs++;
      await getDb().update(unsaidRooms).set({ version: sql`${unsaidRooms.version} + 1` }).where(eq(unsaidRooms.code, "STORE2"));
    });
    await expect(busy).rejects.toMatchObject({ kind: "conflict" });
    expect(runs).toBe(10);
  });
});
