// The seat binding: the cookie becomes an owner id on the server, and only a matching owner of a guest run is a seat.
import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { mockEvent } from "h3";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import createRoom from "../../actions/create-room";
import joinRoom from "../../actions/join-room";
import { MIGRATIONS } from "../db/migrations";
import { loadRoom } from "../db/store";
import { memberByToken } from "../domain/room";
import { must } from "../domain/test-helpers";
import { boundSeat, guestOwner, ownerFromSeatCookie, SEAT_COOKIE, seatFromOwner } from "./guest";

beforeAll(async () => {
  for (const m of MIGRATIONS) await getDbExec().execute(m.sql as string);
});

async function seats() {
  const made = await createRoom.run({ question: "Where do we meet?", options: ["Park", "Cafe"], name: "Ana" }, { caller: "http" });
  const ben = await joinRoom.run({ code: made.code, name: "Ben" }, { caller: "http" });
  const room = must(await loadRoom(made.code));
  const [ana, b] = [must(memberByToken(room, made.token)), must(memberByToken(room, ben.token))];
  return { room, code: made.code, tokens: { ana: made.token, ben: ben.token }, ana, ben: b };
}
const cookieEvent = (value: string) => mockEvent("http://localhost/_agent-native/agent-chat", { headers: { cookie: `${SEAT_COOKIE}=${encodeURIComponent(value)}` } });

describe("guest owner ids", () => {
  it("name the room and member, never the token or a hash of it, and map back to the same seat", async () => {
    const s = await seats();
    const owner = guestOwner(s.room, s.ana);
    expect(owner).toMatch(/^[a-z0-9]+-[0-9a-f]+-[0-9a-f]{16}@guest\.unsaid\.invalid$/);
    for (const secret of [s.tokens.ana, createHash("sha256").update(s.tokens.ana).digest("hex"), String(s.ana.tokenHash)]) expect(owner).not.toContain(secret.toLowerCase());
    const seat = must(await seatFromOwner(owner));
    expect([seat.room.code, seat.me.id]).toEqual([s.code, s.ana.id]);
    expect((await seatFromOwner(owner.toUpperCase()))?.me.id).toBe(s.ana.id);
  });

  it("are refused when anything does not match", async () => {
    const s = await seats();
    const owner = guestOwner(s.room, s.ana);
    const benTag = must(/-[0-9a-f]{16}@/.exec(guestOwner(s.room, s.ben)))[0];
    for (const bad of [
      owner.replace(/-[0-9a-f]{16}@/, benTag), // Ana's seat with Ben's tag
      owner.replace(/-[0-9a-f]{16}@/, "-0123456789abcdef@"),
      owner.replace(/^[a-z0-9]+-/, "zzzzzz-"), // another room
      owner.replace("@guest.unsaid.invalid", "@example.com"),
      `${owner}x`,
      "",
      null,
    ]) {
      expect(await seatFromOwner(bad), String(bad)).toBeNull();
    }
  });

  it("count only in a guest run: a signed-in session never has a seat", async () => {
    const s = await seats();
    const owner = guestOwner(s.room, s.ana);
    expect((await runWithRequestContext({ userEmail: owner, agentRunAnonymous: true }, boundSeat))?.me.id).toBe(s.ana.id);
    expect(await runWithRequestContext({ userEmail: owner }, boundSeat)).toBeNull();
    expect(await runWithRequestContext({ userEmail: owner, agentRunAnonymous: false }, boundSeat)).toBeNull();
    expect(await boundSeat()).toBeNull();
  });
});

describe("the seat cookie", () => {
  it("becomes the owner of the member whose token it holds", async () => {
    const s = await seats();
    expect(await ownerFromSeatCookie(cookieEvent(`${s.code}.${s.tokens.ben}`))).toBe(guestOwner(s.room, s.ben));
    expect(await ownerFromSeatCookie(cookieEvent(`${s.code.toLowerCase()}.${s.tokens.ben}`))).toBe(guestOwner(s.room, s.ben));
  });

  it("gives no owner for a wrong token, another room, a malformed or oversized value, or no cookie", async () => {
    const s = await seats();
    const other = await seats();
    for (const value of [`${s.code}.not-a-real-token-1234567890`, `${other.code}.${s.tokens.ben}`, s.tokens.ben, `.${s.tokens.ben}`, `${s.code}.${s.tokens.ben}${"x".repeat(140)}`]) {
      expect(await ownerFromSeatCookie(cookieEvent(value)), value.slice(0, 20)).toBeNull();
    }
    expect(await ownerFromSeatCookie(mockEvent("http://localhost/_agent-native/agent-chat"))).toBeNull();
  });
});
