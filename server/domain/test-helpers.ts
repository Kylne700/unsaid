// Shared by the tests only (nothing in the app imports this file).
import { expect } from "vitest";
import { approveDraft, castVote, createRoom, forceAdvance, joinRoom, memberByToken, mergeCards, rateCard, saveDraft, saveNotes, setInitialPick } from "./room";
import type { Member, Phase, Room } from "./types";

export const must = <T>(x: T | undefined | null): T => {
  if (x === undefined || x === null) throw new Error("expected a value");
  return x;
};
export const keysDeep = (x: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(x)) for (const v of x) keysDeep(v, out);
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) (out.add(k), keysDeep(v, out));
  return out;
};
/** Keys that only the reveal may carry (votes, initial picks, per-option scores, weights), and secrets nobody may get. */
export const SEALED_KEYS = ["whoGuesses", "aloneGuesses", "expectSame", "vote", "votes", "initialPick", "initialPicks", "fullScore", "sharedScore", "ownScores", "ownRanking", "fullRanking", "sharedRanking", "scores", "ranking", "weight", "weights", "raters", "ratings", "changed", "moved", "viewer", "tokenHash", "token", "seed"];
export const expectSealed = (view: unknown, label: string) => {
  const keys = keysDeep(view);
  for (const k of SEALED_KEYS) expect(keys.has(k), `${label}: key "${k}" must not be present before the reveal`).toBe(false);
};

export const NOTES = { ana: "ANA-NOTES-SENTINEL Lisbon has cheap flights.", ben: "BEN-NOTES-SENTINEL Berlin rents are rising.", cy: "CY-NOTES-SENTINEL Oslo is dark in winter." };
export const DRAFT = { ana: "ANA-DRAFT-SENTINEL Lisbon is hilly.", ben: "BEN-DRAFT-SENTINEL Berlin is loud.", cy: "CY-DRAFT-SENTINEL Oslo is pricey." };

/**
 * A live room with three members (Ana, Ben, Cy), brought to `upTo` with the creator's force-advance. Every card has one
 * holder: Ana 3, Ben 3, Cy 2. With `merge`, Cy's Berlin pro is merged into Ben's (7 cards, one with two holders and a merged part).
 */
export function buildRoom(upTo: Phase, opts: { merge?: boolean } = {}) {
  const made = createRoom({ code: "SEALT1", question: "Which city should we move to?", options: ["Lisbon", "Berlin", "Oslo"], creatorName: "Ana" });
  const room: Room = made.room;
  room.seed = "fixed-seed";
  const ana = must(memberByToken(room, made.token));
  const ben = must(memberByToken(room, joinRoom(room, "Ben").token));
  const cy = must(memberByToken(room, joinRoom(room, "Cy").token));
  saveNotes(room, ana, NOTES.ana);
  saveNotes(room, ben, NOTES.ben);
  saveNotes(room, cy, NOTES.cy);
  setInitialPick(room, ana, "A");
  setInitialPick(room, ben, "B");
  setInitialPick(room, cy, "C");
  const t = { room, ana, ben, cy, all: [ana, ben, cy] as Member[] };
  if (upTo === "notes") return t;

  forceAdvance(room, ana); // cards
  const give = (m: Member, drafts: [string, string, "pro" | "con"][], keep: string) => {
    for (const [text, option, polarity] of drafts) approveDraft(room, m, saveDraft(room, m, { text, option, polarity }).id);
    saveDraft(room, m, { text: keep, option: null, polarity: null }); // stays a private draft
  };
  give(ana, [["Lisbon has cheap flights.", "A", "pro"], ["Lisbon summers are very hot.", "A", "con"], ["Oslo has great transit.", "C", "pro"]], DRAFT.ana);
  give(ben, [["Berlin rents are rising.", "B", "con"], ["Berlin has a big tech scene.", "B", "pro"], ["Lisbon has a tiny office market.", "A", "con"]], DRAFT.ben);
  give(cy, [["Oslo is dark in winter.", "C", "con"], ["Berlin nightlife is lively.", "B", "pro"]], DRAFT.cy);
  if (opts.merge) mergeCards(room, ben, must(room.cards.find((c) => c.text === "Berlin has a big tech scene.")).id, must(room.cards.find((c) => c.text === "Berlin nightlife is lively.")).id);
  if (upTo === "cards") return t;

  forceAdvance(room, ana); // weigh
  const rating = new Map<string, 1 | 2 | 3>([[ana.id, 2], [ben.id, 3], [cy.id, 1]]);
  for (const m of t.all) for (const c of room.cards) rateCard(room, m, c.id, rating.get(m.id) ?? 0);
  if (upTo === "weigh") return t;

  forceAdvance(room, ana); // vote
  if (upTo === "vote") return t;

  castVote(room, ana, "A");
  castVote(room, ben, "B");
  castVote(room, cy, "C"); // last vote: the room reveals by itself
  return t;
}
