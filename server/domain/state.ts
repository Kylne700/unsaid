// Low-level builders shared by room.ts and practice.ts (kept apart so those two never import each other).
import type { Card, Member, OptionDef, Polarity, Room } from "./types";
import { hashToken, newId, newToken } from "./util";

export const MAX_MEMBERS = 8;

export function optionDefs(names: string[]): OptionDef[] {
  return names.map((name, i) => ({ id: String.fromCharCode(65 + i), name, aliases: [] }));
}

export function emptyRoom(code: string, question: string, options: OptionDef[]): Room {
  return {
    code,
    seed: newToken(),
    question,
    options,
    creatorId: "",
    practice: null,
    phase: "notes",
    members: [],
    notes: {},
    initialPicks: {},
    drafts: [],
    cards: [],
    ratings: {},
    votes: {},
  };
}

/** Adds a member; the token is returned once and only its hash is stored. Simulated members get no token. */
export function pushMember(room: Room, name: string, extra: { id?: string; role?: string | null; simulated?: boolean } = {}): { member: Member; token: string | null } {
  const simulated = extra.simulated === true;
  const token = simulated ? null : newToken();
  const member: Member = {
    id: extra.id ?? `m${room.members.length + 1}`,
    name,
    role: extra.role ?? null,
    simulated,
    tokenHash: token ? hashToken(token) : null,
    done: false,
  };
  room.members.push(member);
  if (!room.creatorId) room.creatorId = member.id;
  return { member, token };
}

export interface CardFields {
  option: string;
  polarity: Polarity;
  text: string;
  neutral: string;
  factKey: string | null;
}
/**
 * Puts a member's fact into the ledger. A practice fact that is already there (same fact id, same option
 * and side) gains a holder instead of a second card; everything else becomes a new card.
 */
export function addCardOrJoin(room: Room, ownerId: string, f: CardFields): Card {
  const same = f.factKey ? room.cards.find((c) => c.factKey === f.factKey && c.option === f.option && c.polarity === f.polarity) : undefined;
  if (same) {
    if (!same.ownHolders.includes(ownerId)) same.ownHolders.push(ownerId);
    return same;
  }
  const card: Card = { id: newId("c"), option: f.option, polarity: f.polarity, text: f.text, neutral: f.neutral, ownHolders: [ownerId], absorbed: [], factKey: f.factKey };
  room.cards.push(card);
  return card;
}
