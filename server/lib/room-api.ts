// Shared plumbing for the room actions. Every action goes through asMember()/readView(), and every view
// goes through domain/view.ts, so the UI and the chat agent are redacted by the same code.
import { fail, type ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";
import { insertRoom, loadRoom, mutateRoom } from "../db/store";
import { memberByToken } from "../domain/room";
import type { Member, Room } from "../domain/types";
import { newRoomCode, normalizeCode, RoomError } from "../domain/util";
import { guestView, viewRoom, type GuestView, type RoomView } from "../domain/view";

export const codeArg = z.string().min(4).max(12).describe("Room code, e.g. K7M2QX");
export const memberArgs = {
  code: codeArg,
  token: z.string().min(16).max(100).describe("The calling member's secret token for this room"),
};

/** Writes: the audit log keeps who called (UI or agent) and which room, never the arguments (they hold tokens and notes). */
export const WRITE = {
  http: { method: "POST" as const },
  requiresAuth: false,
  changeEvents: false,
  audit: { recordInputs: false, target: (a: { code: string }) => ({ type: "room", id: normalizeCode(a.code) }) },
};

// A member's own judgments. Neither the in-app agent ("tool") nor MCP/A2A/CLI/automation callers may make them.
const OWN_JUDGMENT_CALLERS = new Set(["http", "frontend"]);
export function requireOwnJudgment(ctx: ActionRunContext | undefined): void {
  if (!ctx || !OWN_JUDGMENT_CALLERS.has(ctx.caller)) {
    fail("Initial picks, ratings and votes belong to each member. The agent never makes them.", { errorCode: "own_judgment_only", statusCode: 403 });
  }
}

function failFrom(e: unknown): never {
  if (e instanceof RoomError) fail(e.message, { errorCode: e.kind, statusCode: e.status });
  throw e;
}

/** Runs `change` on the room and saves it only if `change` succeeds; domain errors reach the caller as failures. */
export async function inRoom<T>(code: string, change: (room: Room) => T | Promise<T>): Promise<T> {
  try {
    return (await mutateRoom(normalizeCode(code), change)).result;
  } catch (e) {
    return failFrom(e);
  }
}

/** Same, as the member who owns `token`. */
export const asMember = <T>(args: { code: string; token: string }, change: (room: Room, me: Member) => T | Promise<T>): Promise<T> =>
  inRoom(args.code, (room) => {
    const me = memberByToken(room, args.token);
    if (!me) throw new RoomError("You are not a member of this room.", "forbidden");
    return change(room, me);
  });

/** The room as this caller may see it. No token, or a wrong one, gets the join preview only. */
export async function readView(args: { code: string; token?: string | undefined }): Promise<RoomView | GuestView> {
  try {
    const room = await loadRoom(normalizeCode(args.code));
    if (!room) throw new RoomError("Room not found. Check the code.", "not_found");
    const me = memberByToken(room, args.token);
    return me ? viewRoom(room, me) : guestView(room, Boolean(args.token));
  } catch (e) {
    return failFrom(e);
  }
}

/** Reads the caller's own notes (for extraction, which must run outside the save loop). */
export async function readOwnNotes(args: { code: string; token: string }): Promise<{ notes: string; room: Room }> {
  try {
    const room = await loadRoom(normalizeCode(args.code));
    if (!room) throw new RoomError("Room not found. Check the code.", "not_found");
    const me = memberByToken(room, args.token);
    if (!me) throw new RoomError("You are not a member of this room.", "forbidden");
    return { notes: room.notes[me.id] ?? "", room };
  } catch (e) {
    return failFrom(e);
  }
}

/** Creates a room under a fresh code. */
export async function createUnderFreshCode(build: (code: string) => { room: Room; token: string; memberId: string }): Promise<{ code: string; token: string; memberId: string }> {
  try {
    for (let i = 0; i < 6; i++) {
      const made = build(newRoomCode());
      if (await insertRoom(made.room)) return { code: made.room.code, token: made.token, memberId: made.memberId };
    }
    throw new RoomError("Could not make a room code, try again.", "conflict");
  } catch (e) {
    return failFrom(e);
  }
}
