// Binds the chat agent to one member seat without the member's token ever reaching the agent.
// The room page sets a cookie holding the seat (room code + token) on the framework's /_agent-native paths. The chat
// plugin's `anonymousOwner` turns it into an owner id on the server, and every agent run, thread and tool call of
// that guest is keyed by that owner. The owner holds the room code, the member id and a tag derived from the
// token hash; it is never the token or the token's sha256, and nobody can make up a valid one.
import { getRequestContext } from "@agent-native/core/server";
import { getCookie, type H3Event } from "h3";
import { createHash } from "node:crypto";
import { loadRoom } from "../db/store";
import { memberByToken } from "../domain/room";
import type { Member, Room } from "../domain/types";
import { normalizeCode } from "../domain/util";

export const SEAT_COOKIE = "unsaid_seat";
const OWNER = /^([a-z0-9]{4,12})-([0-9a-f]{2,64})-([0-9a-f]{16})@guest\.unsaid\.invalid$/;

const tagOf = (m: Member) => createHash("sha256").update(`unsaid-owner:${m.tokenHash}`).digest("hex").slice(0, 16);

export interface Seat {
  room: Room;
  me: Member;
}

/** The chat owner id for one member seat. */
export function guestOwner(room: Room, me: Member): string {
  return `${room.code.toLowerCase()}-${Buffer.from(me.id, "utf8").toString("hex")}-${tagOf(me)}@guest.unsaid.invalid`;
}

/** The quota bucket of one seat (server/lib/llm-quota.ts). */
export const seatBucket = (s: Seat) => `member:${s.room.code}:${s.me.id}`;

/** The seat an owner id stands for; null unless the room, the member and the tag all match. */
export async function seatFromOwner(owner: string | null | undefined): Promise<Seat | null> {
  const m = OWNER.exec((owner ?? "").toLowerCase());
  if (!m) return null;
  const [, code, idHex, tag] = m as unknown as [string, string, string, string];
  const room = await loadRoom(normalizeCode(code));
  const id = Buffer.from(idHex, "hex").toString("utf8");
  const me = room?.members.find((x) => x.id === id && x.tokenHash);
  return room && me && tagOf(me) === tag ? { room, me } : null;
}

/** `anonymousOwner` for the chat plugin: the seat cookie, checked against the room. No valid seat, no owner (401). */
export async function ownerFromSeatCookie(event: H3Event): Promise<string | null> {
  const raw = getCookie(event, SEAT_COOKIE) ?? "";
  const dot = raw.indexOf(".");
  if (dot < 4 || raw.length > 140) return null;
  const room = await loadRoom(normalizeCode(raw.slice(0, dot)));
  const me = room ? memberByToken(room, raw.slice(dot + 1)) : null;
  return room && me ? guestOwner(room, me) : null;
}

/** The seat the current agent run acts for. Only guest runs have one; a signed-in session never does. */
export async function boundSeat(): Promise<Seat | null> {
  const ctx = getRequestContext();
  return ctx?.agentRunAnonymous === true ? seatFromOwner(ctx.userEmail) : null;
}
