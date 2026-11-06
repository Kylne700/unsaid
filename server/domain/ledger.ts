// Ledger math. One rule everywhere: a card's weight is the team mean of every member's 0-3 rating of it
// (0 when nobody rated it); a card scores +weight if it is a pro and -weight if it is a con.
import type { Card, OptionDef, Room, Weight } from "./types";

export const EPS = 1e-9;
export type Scores = Record<string, number>;

export const holdersOf = (c: Card): string[] => [...new Set([...c.ownHolders, ...c.absorbed.flatMap((a) => a.ownHolders)])];
/** "Facts only one of you knew": approved cards with exactly one holder. */
export const uniqueCount = (cards: Card[]) => cards.filter((c) => holdersOf(c).length === 1).length;

export function teamWeights(room: Room): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of room.cards) {
    const given = Object.values(room.ratings)
      .map((r) => r[c.id])
      .filter((v): v is Weight => v !== undefined);
    out[c.id] = given.length ? given.reduce<number>((a, b) => a + b, 0) / given.length : 0;
  }
  return out;
}
export const ratersOf = (room: Room, cardId: string) => Object.values(room.ratings).filter((r) => r[cardId] !== undefined).length;

export function scoreOptions(cards: Card[], weights: Record<string, number>, options: OptionDef[]): Scores {
  const out: Scores = Object.fromEntries(options.map((o) => [o.id, 0]));
  for (const c of cards) out[c.option] = (out[c.option] ?? 0) + (c.polarity === "pro" ? 1 : -1) * (weights[c.id] ?? 0);
  return out;
}

export interface RankGroup {
  /** Options with equal score, in the room's option order. More than one means a tie. */
  options: string[];
  score: number;
}
export interface Ranking {
  groups: RankGroup[];
  tiedFirst: boolean;
}
/** Best first. Equal scores share a group: a tie is reported, never broken. */
export function rank(scores: Scores, options: OptionDef[]): Ranking {
  const order = options.map((o) => o.id);
  const sorted = [...order].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  const groups: RankGroup[] = [];
  for (const id of sorted) {
    const score = scores[id] ?? 0;
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.score - score) < EPS) last.options.push(id);
    else groups.push({ options: [id], score });
  }
  for (const g of groups) g.options.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { groups, tiedFirst: (groups[0]?.options.length ?? 0) > 1 };
}

export interface RevealCard {
  id: string;
  option: string;
  polarity: "pro" | "con";
  text: string;
  holders: string[];
  weight: number;
  raters: number;
}
export interface Reveal {
  cards: RevealCard[];
  uniqueCount: number;
  full: { scores: Scores; ranking: Ranking };
  /** Only cards that two or more members held: what the team already shared. */
  shared: { scores: Scores; ranking: Ranking };
  /** Each member's "own facts only" score, with the same team weights. */
  members: { memberId: string; cardCount: number; scores: Scores; ranking: Ranking }[];
  /** Single-holder cards that moved the ranking from the shared one to the full one, biggest first. */
  changed: { card: RevealCard; effect: number }[];
  moved: { up: string[]; down: string[] } | null;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function buildReveal(room: Room): Reveal {
  const weights = teamWeights(room);
  const cards: RevealCard[] = room.cards.map((c) => ({
    id: c.id,
    option: c.option,
    polarity: c.polarity,
    text: c.text,
    holders: holdersOf(c),
    weight: weights[c.id] ?? 0,
    raters: ratersOf(room, c.id),
  }));
  const make = (subset: Card[]) => {
    const scores = scoreOptions(subset, weights, room.options);
    return { scores, ranking: rank(scores, room.options) };
  };
  const full = make(room.cards);
  const shared = make(room.cards.filter((c) => holdersOf(c).length >= 2));
  const members = room.members.map((m) => {
    const mine = room.cards.filter((c) => holdersOf(c).includes(m.id));
    return { memberId: m.id, cardCount: mine.length, ...make(mine) };
  });

  // Where the shared-only and full orders first differ: who moved up, who was displaced.
  let moved: Reveal["moved"] = null;
  const n = Math.max(full.ranking.groups.length, shared.ranking.groups.length);
  for (let i = 0; i < n && !moved; i++) {
    const a = full.ranking.groups[i]?.options ?? [];
    const b = shared.ranking.groups[i]?.options ?? [];
    if (!sameSet(a, b)) moved = { up: a.filter((o) => !b.includes(o)), down: b.filter((o) => !a.includes(o)) };
  }
  const changed: Reveal["changed"] = [];
  if (moved) {
    for (const card of cards) {
      if (card.holders.length !== 1) continue;
      const sign = card.polarity === "pro" ? 1 : -1;
      const effect = moved.up.includes(card.option) ? sign * card.weight : moved.down.includes(card.option) ? -sign * card.weight : 0;
      if (effect > EPS) changed.push({ card, effect });
    }
    changed.sort((a, b) => b.effect - a.effect);
  }
  return { cards, uniqueCount: uniqueCount(room.cards), full, shared, members, changed, moved };
}

// ---- the guess-who meter ------------------------------------------------------------------------

/** One valid guess: who made it, whether it named the real holder, and how many members it chose between. */
export interface Guess {
  by: string;
  right: boolean;
  candidates: number;
}
export type Verdict = "above" | "near" | "below";
export interface GuessMeter {
  guessers: number;
  guesses: number;
  right: number;
  rightPct: number;
  /** What luck alone would give: the mean of 1/candidates over the guesses. */
  chancePct: number;
  /** Rough, not a significance test: more than 2 standard deviations above (or below) luck, else near it. */
  verdict: Verdict;
}
/** A room-wide number from fewer guessers than this would let a guesser work out what the others guessed. */
export const MIN_GUESSERS = 3;

export function guessMeter(guesses: Guess[]): GuessMeter {
  const n = guesses.length;
  const right = guesses.filter((g) => g.right).length;
  const p = guesses.map((g) => 1 / g.candidates);
  const expected = p.reduce((a, b) => a + b, 0);
  const sd = Math.sqrt(p.reduce((a, b) => a + b * (1 - b), 0));
  const z = sd > 0 ? (right - expected) / sd : 0;
  return {
    guessers: new Set(guesses.map((g) => g.by)).size,
    guesses: n,
    right,
    rightPct: n ? Math.round((100 * right) / n) : 0,
    chancePct: n ? Math.round((100 * expected) / n) : 0,
    verdict: z >= 2 ? "above" : z <= -2 ? "below" : "near",
  };
}
/** Why the room-wide number must stay hidden (it would show what individuals guessed), or null if it may be shown. */
export function meterHiddenReason(m: GuessMeter): "few" | "none" | "all" | null {
  if (m.guessers < MIN_GUESSERS) return "few";
  if (m.right === 0) return "none";
  if (m.right === m.guesses) return "all";
  return null;
}

/** The one member who held this card, if `guesserId` may guess who it was: exactly one other member held it, in a room of 3 or more. */
export function guessTarget(room: Room, card: Card, guesserId: string): string | null {
  const holders = holdersOf(card);
  return room.members.length >= 3 && holders.length === 1 && holders[0] !== guesserId ? (holders[0] as string) : null;
}

/** Every guess in the room that still makes sense: a real guesser, a card they may guess about, another member named. */
export function validGuesses(room: Room): Guess[] {
  const out: Guess[] = [];
  for (const [by, mine] of Object.entries(room.whoGuesses ?? {})) {
    if (!room.members.some((m) => m.id === by && !m.simulated)) continue;
    for (const [cardId, named] of Object.entries(mine)) {
      const card = room.cards.find((c) => c.id === cardId);
      const holder = card ? guessTarget(room, card, by) : null;
      if (holder === null || named === by || !room.members.some((m) => m.id === named)) continue;
      out.push({ by, right: holder === named, candidates: room.members.length - 1 });
    }
  }
  return out;
}
