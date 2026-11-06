// Room operations: the phase machine and everything a member can do. Pure functions over a Room document;
// each takes the acting member and throws RoomError when the move is not allowed.
import type { ExtractedCard } from "./extract-cards";
import { holdersOf } from "./ledger";
import { buildPracticeRoom, practiceEnter } from "./practice";
import { DEFAULT_SCENARIO_ID, getScenario } from "./scenario";
import { addCardOrJoin, emptyRoom, MAX_MEMBERS, optionDefs, pushMember } from "./state";
import type { Absorbed, Card, Draft, Member, Phase, Polarity, Room, Weight } from "./types";
import { hashToken, neutralize, newId, RoomError } from "./util";

export const NEXT: Record<Phase, Phase | null> = { notes: "cards", cards: "weigh", weigh: "vote", vote: "reveal", reveal: null };

const MAX_NOTES = 8000;
const MAX_TEXT = 400;

function needPhase(room: Room, ...allowed: Phase[]) {
  if (!allowed.includes(room.phase)) throw new RoomError(`Not possible in the "${room.phase}" phase.`, "bad_phase");
}
function cleanName(raw: string, what: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 40) throw new RoomError(`${what} must be 1 to 40 characters.`);
  return name;
}
const optionExists = (room: Room, id: string) => room.options.some((o) => o.id === id);

// ---- creating, joining, identity -------------------------------------------------------------

export function createRoom(input: { code: string; question: string; options: string[]; creatorName: string }): { room: Room; token: string; memberId: string } {
  const question = input.question.trim();
  if (question.length < 3 || question.length > 200) throw new RoomError("The question must be 3 to 200 characters.");
  const names = input.options.map((o) => o.trim().replace(/\s+/g, " "));
  if (names.length < 2 || names.length > 4) throw new RoomError("Give 2 to 4 options.");
  if (names.some((n) => n.length < 2 || n.length > 40)) throw new RoomError("Each option name must be 2 to 40 characters.");
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new RoomError("Option names must differ.");
  const room = emptyRoom(input.code, question, optionDefs(names));
  const { member, token } = pushMember(room, cleanName(input.creatorName, "Your name"));
  return { room, token: token as string, memberId: member.id };
}

export function createPractice(code: string): { room: Room; token: string; memberId: string } {
  const sc = getScenario(DEFAULT_SCENARIO_ID);
  if (!sc) throw new RoomError("Practice scenario missing.", "not_found");
  return buildPracticeRoom(code, sc);
}

export function joinRoom(room: Room, name: string): { memberId: string; token: string } {
  if (room.practice) throw new RoomError("Practice rooms are single-player.", "forbidden");
  needPhase(room, "notes");
  if (room.members.length >= MAX_MEMBERS) throw new RoomError(`This room is full (${MAX_MEMBERS} members).`, "conflict");
  const clean = cleanName(name, "Your name");
  if (room.members.some((m) => m.name.toLowerCase() === clean.toLowerCase())) throw new RoomError("Someone in this room already uses that name.", "conflict");
  const { member, token } = pushMember(room, clean);
  return { memberId: member.id, token: token as string };
}

export function memberByToken(room: Room, token: string | undefined): Member | null {
  if (!token) return null;
  const h = hashToken(token);
  return room.members.find((m) => m.tokenHash === h) ?? null;
}

// ---- phase machine ---------------------------------------------------------------------------

export function goTo(room: Room, phase: Phase) {
  room.phase = phase;
  for (const m of room.members) m.done = false;
  practiceEnter(room, phase);
}
/** Moves the room on when every member is done. Returns whether it moved. */
export function settle(room: Room): boolean {
  const next = NEXT[room.phase];
  if (!next || !room.members.length || !room.members.every((m) => m.done)) return false;
  goTo(room, next);
  return true;
}
export function forceAdvance(room: Room, me: Member) {
  if (me.id !== room.creatorId) throw new RoomError("Only the person who made the room can move it on.", "forbidden");
  const next = NEXT[room.phase];
  if (!next) throw new RoomError("The room is already at the reveal.", "bad_phase");
  goTo(room, next);
}

const ratedCount = (room: Room, memberId: string) => room.cards.filter((c) => room.ratings[memberId]?.[c.id] !== undefined).length;

export function setDone(room: Room, me: Member, done: boolean) {
  needPhase(room, "notes", "cards", "weigh");
  if (done && room.phase === "notes" && room.practice && !room.initialPicks[me.id]) {
    throw new RoomError("Seal your lean first: which option do you lean to now?");
  }
  if (done && room.phase === "weigh") {
    const left = room.cards.length - ratedCount(room, me.id);
    if (left > 0) throw new RoomError(`Rate every card first (${left} left).`);
  }
  me.done = done;
  settle(room);
}

// ---- notes and the sealed initial pick -------------------------------------------------------

export function saveNotes(room: Room, me: Member, text: string) {
  needPhase(room, "notes");
  if (text.length > MAX_NOTES) throw new RoomError(`Notes are limited to ${MAX_NOTES} characters.`);
  room.notes[me.id] = text;
}
export function setInitialPick(room: Room, me: Member, optionId: string) {
  needPhase(room, "notes");
  if (!optionExists(room, optionId)) throw new RoomError("Unknown option.");
  room.initialPicks[me.id] = optionId;
}

// ---- cards -----------------------------------------------------------------------------------

function ownDraft(room: Room, me: Member, id: string): Draft {
  const d = room.drafts.find((x) => x.id === id && x.ownerId === me.id);
  if (!d) throw new RoomError("Draft not found.", "not_found");
  return d;
}
function cardById(room: Room, id: string): Card {
  const c = room.cards.find((x) => x.id === id);
  if (!c) throw new RoomError("Card not found.", "not_found");
  return c;
}

/** Adds extracted cards as the caller's private drafts, skipping sentences they already drafted or approved. */
export function addExtractedDrafts(room: Room, me: Member, extracted: ExtractedCard[]): number {
  needPhase(room, "cards");
  const have = new Set([
    ...room.drafts.filter((d) => d.ownerId === me.id).map((d) => d.text),
    ...room.cards.filter((c) => c.ownHolders.includes(me.id)).map((c) => c.text),
  ]);
  let added = 0;
  for (const x of extracted) {
    if (have.has(x.text)) continue;
    room.drafts.push({ id: newId("d"), ownerId: me.id, option: x.option, polarity: x.polarity, text: x.text, neutral: neutralize(x.neutral || x.text, room.options, x.option), origin: "notes", phrase: null, factKey: null });
    added++;
  }
  return added;
}

export function saveDraft(room: Room, me: Member, input: { draftId?: string | undefined; text: string; option: string | null; polarity: Polarity | null; neutral?: string | undefined }): Draft {
  needPhase(room, "cards");
  const text = input.text.trim();
  if (text.length < 1 || text.length > MAX_TEXT) throw new RoomError(`A card is 1 to ${MAX_TEXT} characters.`);
  if (input.option !== null && !optionExists(room, input.option)) throw new RoomError("Unknown option.");
  const neutral = neutralize((input.neutral ?? "").trim() || text, room.options, input.option);
  if (input.draftId) {
    const d = ownDraft(room, me, input.draftId);
    Object.assign(d, { text, neutral, option: input.option, polarity: input.polarity });
    return d;
  }
  const d: Draft = { id: newId("d"), ownerId: me.id, option: input.option, polarity: input.polarity, text, neutral, origin: "manual", phrase: null, factKey: null };
  room.drafts.push(d);
  return d;
}
export function deleteDraft(room: Room, me: Member, draftId: string) {
  needPhase(room, "cards");
  room.drafts.splice(room.drafts.indexOf(ownDraft(room, me, draftId)), 1);
}
export function approveDraft(room: Room, me: Member, draftId: string): Card {
  needPhase(room, "cards");
  const d = ownDraft(room, me, draftId);
  if (!d.option || !d.polarity) throw new RoomError("Choose which option this fact is about and whether it is a pro or a con.");
  const card = addCardOrJoin(room, me.id, { option: d.option, polarity: d.polarity, text: d.text, neutral: neutralize(d.neutral || d.text, room.options, d.option), factKey: d.factKey });
  room.drafts.splice(room.drafts.indexOf(d), 1);
  return card;
}
/** Takes the caller's own card back out of the shared ledger and into their drafts. */
export function withdrawCard(room: Room, me: Member, cardId: string) {
  needPhase(room, "cards");
  const card = cardById(room, cardId);
  if (!card.ownHolders.includes(me.id)) throw new RoomError("Only a member who holds this card can withdraw it.", "forbidden");
  if (card.absorbed.length) throw new RoomError("Split the merged cards first.", "conflict");
  card.ownHolders = card.ownHolders.filter((h) => h !== me.id);
  if (!card.ownHolders.length) room.cards.splice(room.cards.indexOf(card), 1);
  room.drafts.push({ id: newId("d"), ownerId: me.id, option: card.option, polarity: card.polarity, text: card.text, neutral: card.neutral, origin: "manual", phrase: null, factKey: card.factKey });
}

/** Two cards that state the same fact become one card whose holders are the union. */
export function mergeCards(room: Room, me: Member, keepId: string, absorbId: string) {
  needPhase(room, "cards");
  if (keepId === absorbId) throw new RoomError("Pick two different cards.");
  const keep = cardById(room, keepId);
  const gone = cardById(room, absorbId);
  if (!holdersOf(keep).includes(me.id) && !holdersOf(gone).includes(me.id)) throw new RoomError("You can only merge cards that one of you holds.", "forbidden");
  if (keep.option !== gone.option || keep.polarity !== gone.polarity) throw new RoomError("Cards about different options, or a pro and a con, are not the same fact.", "conflict");
  const part: Absorbed = { id: gone.id, text: gone.text, neutral: gone.neutral, ownHolders: gone.ownHolders, factKey: gone.factKey, by: me.id };
  keep.absorbed.push(part, ...gone.absorbed);
  room.cards.splice(room.cards.indexOf(gone), 1);
}
/** Undo a merge: the absorbed card comes back as its own card with its own holders. */
export function unmergeCard(room: Room, me: Member, cardId: string, absorbedId: string) {
  needPhase(room, "cards");
  const card = cardById(room, cardId);
  const part = card.absorbed.find((a) => a.id === absorbedId);
  if (!part) throw new RoomError("That card is not merged here.", "not_found");
  if (!holdersOf(card).includes(me.id)) throw new RoomError("Only a holder of the merged card can split it.", "forbidden");
  card.absorbed = card.absorbed.filter((a) => a !== part);
  room.cards.splice(room.cards.indexOf(card) + 1, 0, { id: part.id, option: card.option, polarity: card.polarity, text: part.text, neutral: part.neutral, ownHolders: part.ownHolders, absorbed: [], factKey: part.factKey });
}

// ---- weighing and voting ---------------------------------------------------------------------

export function rateCard(room: Room, me: Member, cardId: string, weight: number) {
  needPhase(room, "weigh");
  cardById(room, cardId);
  if (!Number.isInteger(weight) || weight < 0 || weight > 3) throw new RoomError("Rate from 0 to 3.");
  (room.ratings[me.id] ??= {})[cardId] = weight as Weight;
}
export function castVote(room: Room, me: Member, optionId: string) {
  needPhase(room, "vote");
  if (!optionExists(room, optionId)) throw new RoomError("Unknown option.");
  if (room.votes[me.id]) throw new RoomError("Your vote is already sealed.", "conflict");
  room.votes[me.id] = optionId;
  me.done = true;
  settle(room);
}
