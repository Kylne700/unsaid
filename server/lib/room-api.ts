// Shared plumbing for the room actions. Every action goes through asMember()/readView(), and every view
// goes through domain/view.ts, so the UI and the chat agent are redacted by the same code.
import { fail, type ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";
import { insertRoom, loadRoom, mutateRoom } from "../db/store";
import { memberByToken, needPhase } from "../domain/room";
import type { Member, Room } from "../domain/types";
import { newRoomCode, normalizeCode, RoomError } from "../domain/util";
import { guestView, viewRoom, type GuestView, type RoomView } from "../domain/view";
import { boundSeat } from "./guest";

export const codeArg = z.string().min(4).max(12).describe("Room code, e.g. K7M2QX");
/** UI callers send both; the chat agent sends neither (see who()). */
export const memberArgs = {
  code: codeArg.optional(),
  token: z.string().min(16).max(100).optional().describe("The calling member's secret token for this room"),
};

/** A member action's schema, and the one the chat agent sees: no code, no token (its runs are bound to a seat). */
export const memberSchemas = <T extends z.ZodRawShape>(shape: T) => ({
  schema: z.object({ ...memberArgs, ...shape }),
  agentInputSchema: z.object(shape),
});

/** The member an action acts for: a seat the server bound (chat agent), or the holder of a token (everyone else). */
export type Who = { code: string; token: string } | { code: string; memberId: string };

/**
 * The in-app agent ("tool") acts only as the seat its run is bound to (server/lib/guest.ts); a code or token in its
 * arguments is ignored. Any other caller must send a room code and that member's token.
 */
export async function who(args: { code?: string | undefined; token?: string | undefined }, ctx: ActionRunContext | undefined): Promise<Who> {
  if (ctx?.caller === "tool") {
    const seat = await boundSeat();
    if (!seat) fail("The assistant only acts inside a room you have joined, from that room's page.", { errorCode: "no_seat", statusCode: 403 });
    return { code: seat.room.code, memberId: seat.me.id };
  }
  if (!args.code || !args.token) fail("A room code and your member token are required.", { errorCode: "forbidden", statusCode: 403 });
  return { code: args.code, token: args.token };
}

const memberOf = (room: Room, w: Who): Member | null =>
  "token" in w ? memberByToken(room, w.token) : (room.members.find((m) => m.id === w.memberId && m.tokenHash) ?? null);

/** Writes: the audit log keeps who called (UI or agent) and which room, never the arguments (they hold tokens and notes). */
export const WRITE = {
  http: { method: "POST" as const },
  requiresAuth: false,
  changeEvents: false,
  audit: { recordInputs: false, target: (a: { code?: string | undefined }) => ({ type: "room", id: a.code ? normalizeCode(a.code) : "bound-seat" }) },
};

// A member's own judgments. Neither the in-app agent ("tool") nor MCP/A2A/CLI/automation callers may make them.
const OWN_JUDGMENT_CALLERS = new Set(["http", "frontend"]);
export function requireOwnJudgment(ctx: ActionRunContext | undefined): void {
  if (!ctx || !OWN_JUDGMENT_CALLERS.has(ctx.caller)) {
    fail("Initial picks, card approvals, ratings and votes belong to each member. The agent never makes them.", { errorCode: "own_judgment_only", statusCode: 403 });
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

/** Same, as that member. */
export const asMember = <T>(w: Who, change: (room: Room, me: Member) => T | Promise<T>): Promise<T> =>
  inRoom(w.code, (room) => {
    const me = memberOf(room, w);
    if (!me) throw new RoomError("You are not a member of this room.", "forbidden");
    return change(room, me);
  });

/** The room as this caller may see it: the agent sees its bound seat; anyone else without a valid token gets the join preview. */
export async function readView(args: { code?: string | undefined; token?: string | undefined }, ctx: ActionRunContext | undefined): Promise<RoomView | GuestView> {
  const w = ctx?.caller === "tool" ? await who(args, ctx) : null;
  try {
    const code = w?.code ?? args.code;
    const room = code ? await loadRoom(normalizeCode(code)) : null;
    if (!room) throw new RoomError("Room not found. Check the code.", "not_found");
    const me = w ? memberOf(room, w) : memberByToken(room, args.token);
    return me ? viewRoom(room, me, { agent: ctx?.caller === "tool" }) : guestView(room, Boolean(args.token));
  } catch (e) {
    return failFrom(e);
  }
}

/** The member's own notes, cards phase only (extraction runs outside the save loop, so it reads first). */
export async function readOwnNotes(w: Who): Promise<{ notes: string; room: Room; me: Member }> {
  try {
    const room = await loadRoom(normalizeCode(w.code));
    if (!room) throw new RoomError("Room not found. Check the code.", "not_found");
    const me = memberOf(room, w);
    if (!me) throw new RoomError("You are not a member of this room.", "forbidden");
    needPhase(room, "cards");
    return { notes: room.notes[me.id] ?? "", room, me };
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
