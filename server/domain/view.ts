// The ONE redaction point. Every action that returns room data goes through viewRoom(), so the UI and the chat
// agent get exactly the same answer for the same caller. What each phase may show is decided here and nowhere else.
import { getScenario } from "./scenario";
import { buildReveal, guessMeter, guessTarget, holdersOf, meterHiddenReason, rank, type Ranking, type Scores, uniqueCount, validGuesses, type Verdict } from "./ledger";
import type { Absorbed, Card, Member, Phase, Polarity, Room } from "./types";
import { mayNameOption, seededShuffle } from "./util";

export const DISCLAIMER = "Unsaid never votes or recommends. These are your team's facts and your team's weights.";
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const roundScores = (s: Scores): Scores => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, r3(v)]));
const roundRanking = (r: Ranking): Ranking => ({ tiedFirst: r.tiedFirst, groups: r.groups.map((g) => ({ options: g.options, score: r3(g.score) })) });

export interface GuestView {
  guest: true;
  code: string;
  phase: Phase;
  question: string;
  options: { id: string; name: string }[];
  /** Whether a new person can still join with this link. */
  joinable: boolean;
  practice: boolean;
  memberCount: number;
  /** The caller sent a token that matches nobody in this room. */
  tokenInvalid: boolean;
}
export interface MemberView {
  id: string;
  name: string;
  role: string | null;
  simulated: boolean;
  isCreator: boolean;
  done: boolean;
}
export interface DraftView {
  id: string;
  option: string | null;
  polarity: Polarity | null;
  text: string;
  neutral: string;
  origin: "notes" | "practice" | "manual";
  phrase: string | null;
  ready: boolean;
  /** The neutral wording may still name an option (see mayNameOption). */
  leak: boolean;
}
export interface LedgerCardView {
  id: string;
  option: string;
  polarity: Polarity;
  text: string;
  /** Does the caller hold this card, and how many members hold it. Who the others are comes with the reveal. */
  mine: boolean;
  holderCount: number;
  merged: { id: string; text: string; mine: boolean; holderCount: number }[];
  /** The caller's own rating, only once ratings exist (vote phase). */
  myRating: number | null;
  /** Vote phase: exactly one other member knew this fact, so the caller may guess who. */
  guessable: boolean;
  /** The caller's own guess (a member id), vote phase only. Never in the chat agent's view. */
  myGuess: string | null;
}
export interface WeighView {
  total: number;
  rated: number;
  /** Shuffled per member. Neutral text only: no option, no holder count, no total. `mine`: the caller holds this card (those are the ones to fold into another card). */
  cards: { id: string; neutral: string; mine: boolean; myRating: number | null }[];
}
export interface RevealView {
  disclaimer: string;
  options: { id: string; name: string; fullScore: number; sharedScore: number; votes: number }[];
  fullRanking: Ranking;
  sharedRanking: Ranking;
  members: {
    id: string;
    name: string;
    role: string | null;
    simulated: boolean;
    initialPick: string | null;
    vote: string | null;
    cardCount: number;
    ownScores: Scores;
    ownRanking: Ranking;
  }[];
  moved: { up: string[]; down: string[] } | null;
  changed: { id: string; text: string; option: string; polarity: Polarity; holders: string[]; weight: number; effect: number }[];
  cards: { id: string; option: string; polarity: Polarity; text: string; holders: string[]; weight: number; raters: number }[];
  uniqueCount: number;
  viewer: { id: string; initialPick: string | null; vote: string | null; ownTop: string[]; ownTied: boolean; fullTop: string[]; fullTied: boolean };
  /** Null when no fact could be guessed (and for the chat agent in a practice room). Never anyone's own guesses, except the viewer's in practice. */
  guessWho: GuessWhoView | null;
  /** The viewer's own guess of how many others would vote like them, next to what happened. Null if they gave none (and for the chat agent). */
  aloneCheck: { expected: number; actual: number; others: number } | null;
}
export interface GuessWhoView {
  /** "room": everyone's guesses pooled into one number. "practice": only the viewer's own guesses. */
  scope: "room" | "practice";
  /** Null when a room-wide number would give away what one person guessed (see meterHiddenReason). Practice: null means the viewer made no guess. */
  result: { guessers: number; guesses: number; right: number; rightPct: number; chancePct: number; verdict: Verdict } | null;
}
export interface RoomView {
  guest: false;
  code: string;
  phase: Phase;
  question: string;
  options: { id: string; name: string }[];
  practice: { title: string } | null;
  me: { id: string; name: string; isCreator: boolean; done: boolean; hasInitialPick: boolean; hasVoted: boolean };
  members: MemberView[];
  uniqueCount: number | null;
  notes: string | null;
  drafts: DraftView[] | null;
  /** Cards phase: the caller's own approved cards only. Vote phase: every card. */
  ledger: LedgerCardView[] | null;
  /** Cards phase only: how many approved cards the caller does not hold (a number, nothing about them). */
  othersCardCount: number | null;
  weigh: WeighView | null;
  reveal: RevealView | null;
}

const publicOptions = (room: Room) => room.options.map((o) => ({ id: o.id, name: o.name }));

export function guestView(room: Room, tokenInvalid = false): GuestView {
  return {
    guest: true,
    code: room.code,
    phase: room.phase,
    question: room.question,
    options: publicOptions(room),
    joinable: !room.practice && room.phase === "notes",
    practice: room.practice !== null,
    memberCount: room.members.length,
    tokenInvalid,
  };
}

/** `agent`: the view for the chat agent. Its tool output stays in the chat history, so it carries no guess of the member's. */
export function viewRoom(room: Room, me: Member, opts: { agent?: boolean } = {}): RoomView {
  const myRatings = room.ratings[me.id] ?? {};
  const myGuesses = opts.agent ? {} : (room.whoGuesses?.[me.id] ?? {});
  const phase = room.phase;
  const ownCards = room.cards.filter((c) => holdersOf(c).includes(me.id));
  const ledgerCard = (c: Card, vote: boolean): LedgerCardView => {
    const holders = holdersOf(c);
    const guessable = vote && guessTarget(room, c, me.id) !== null;
    return {
      id: c.id,
      option: c.option,
      polarity: c.polarity,
      text: c.text,
      mine: holders.includes(me.id),
      holderCount: holders.length,
      merged: c.absorbed.map((a: Absorbed) => ({ id: a.id, text: a.text, mine: a.ownHolders.includes(me.id), holderCount: a.ownHolders.length })),
      myRating: vote ? (myRatings[c.id] ?? null) : null,
      guessable,
      myGuess: guessable ? (myGuesses[c.id] ?? null) : null,
    };
  };

  const view: RoomView = {
    guest: false,
    code: room.code,
    phase,
    question: room.question,
    options: publicOptions(room),
    practice: room.practice ? { title: getScenario(room.practice.scenarioId)?.title ?? "Practice" } : null,
    // Only flags about the caller: never the pick or the vote itself, before the reveal.
    me: {
      id: me.id,
      name: me.name,
      isCreator: me.id === room.creatorId,
      done: me.done,
      hasInitialPick: room.initialPicks[me.id] !== undefined,
      hasVoted: room.votes[me.id] !== undefined,
    },
    members: room.members.map((m) => ({ id: m.id, name: m.name, role: m.role, simulated: m.simulated, isCreator: m.id === room.creatorId, done: m.done })),
    uniqueCount: phase === "notes" ? null : uniqueCount(room.cards),
    notes: phase === "notes" || phase === "cards" ? (room.notes[me.id] ?? "") : null,
    drafts:
      phase === "cards"
        ? room.drafts
            .filter((d) => d.ownerId === me.id)
            .map((d) => ({ id: d.id, option: d.option, polarity: d.polarity, text: d.text, neutral: d.neutral, origin: d.origin, phrase: d.phrase, ready: d.option !== null && d.polarity !== null, leak: mayNameOption(d.neutral, room.options) }))
        : null,
    // Cards phase: only the caller's own cards, in full. The others' cards show as a number and reach the screen when the
    // room moves on to weigh; seen live, a card appearing just after someone approved it would tell who wrote it.
    // Cards show their option before the blind weigh and after it, never during. Never who holds them (only whether
    // the caller does, and how many do) until the reveal. The vote list is shuffled (same order for everyone, stable
    // per room) so the order the cards were approved in cannot tell who wrote which.
    ledger: phase === "cards" ? ownCards.map((c) => ledgerCard(c, false)) : phase === "vote" ? seededShuffle(room.cards, `${room.seed}:vote`).map((c) => ledgerCard(c, true)) : null,
    othersCardCount: phase === "cards" ? room.cards.length - ownCards.length : null,
    weigh: null,
    reveal: null,
  };

  if (phase === "weigh") {
    const order = seededShuffle(room.cards.map((c) => c.id), `${room.seed}:${me.id}`);
    const byId = new Map(room.cards.map((c) => [c.id, c]));
    view.weigh = {
      total: room.cards.length,
      rated: room.cards.filter((c) => myRatings[c.id] !== undefined).length,
      cards: order.map((id) => {
        const c = byId.get(id) as Card;
        return { id, neutral: c.neutral, mine: holdersOf(c).includes(me.id), myRating: myRatings[id] ?? null };
      }),
    };
  }
  if (phase === "reveal") view.reveal = revealView(room, me, opts.agent === true);
  return view;
}

function guessWhoView(room: Room, me: Member, agent: boolean): GuessWhoView | null {
  if (room.members.length < 3 || !room.cards.some((c) => holdersOf(c).length === 1)) return null;
  const all = validGuesses(room);
  if (room.practice) {
    if (agent) return null;
    const own = all.filter((g) => g.by === me.id);
    return { scope: "practice", result: own.length ? { guessers: 1, guesses: own.length, ...pick(guessMeter(own)) } : null };
  }
  const m = guessMeter(all);
  return { scope: "room", result: meterHiddenReason(m) ? null : { guessers: m.guessers, guesses: m.guesses, ...pick(m) } };
}
const pick = (m: ReturnType<typeof guessMeter>) => ({ right: m.right, rightPct: m.rightPct, chancePct: m.chancePct, verdict: m.verdict });

function revealView(room: Room, me: Member, agent: boolean): RevealView {
  const nameOf = (id: string) => room.members.find((m) => m.id === id)?.name ?? "?";
  const rv = buildReveal(room);
  const top = (r: Ranking) => r.groups[0]?.options ?? [];
  const mine = rv.members.find((m) => m.memberId === me.id);
  const mineRanking = mine ? mine.ranking : rank({}, room.options);
  const card = (c: (typeof rv.cards)[number]) => ({ id: c.id, option: c.option, polarity: c.polarity, text: c.text, holders: c.holders.map(nameOf), weight: r3(c.weight), raters: c.raters });
  return {
    disclaimer: DISCLAIMER,
    options: room.options.map((o) => ({
      id: o.id,
      name: o.name,
      fullScore: r3(rv.full.scores[o.id] ?? 0),
      sharedScore: r3(rv.shared.scores[o.id] ?? 0),
      votes: Object.values(room.votes).filter((v) => v === o.id).length,
    })),
    fullRanking: roundRanking(rv.full.ranking),
    sharedRanking: roundRanking(rv.shared.ranking),
    members: room.members.map((m) => {
      const own = rv.members.find((x) => x.memberId === m.id);
      return {
        id: m.id,
        name: m.name,
        role: m.role,
        simulated: m.simulated,
        initialPick: room.initialPicks[m.id] ?? null,
        vote: room.votes[m.id] ?? null,
        cardCount: own?.cardCount ?? 0,
        ownScores: roundScores(own?.scores ?? {}),
        ownRanking: roundRanking(own?.ranking ?? rank({}, room.options)),
      };
    }),
    moved: rv.moved,
    changed: rv.changed.map((x) => ({ ...card(x.card), effect: r3(x.effect) })),
    cards: rv.cards.map(card),
    uniqueCount: rv.uniqueCount,
    viewer: {
      id: me.id,
      initialPick: room.initialPicks[me.id] ?? null,
      vote: room.votes[me.id] ?? null,
      ownTop: top(mineRanking),
      ownTied: mineRanking.tiedFirst,
      fullTop: top(rv.full.ranking),
      fullTied: rv.full.ranking.tiedFirst,
    },
    guessWho: guessWhoView(room, me, agent),
    aloneCheck: agent ? null : aloneCheckOf(room, me),
  };
}

function aloneCheckOf(room: Room, me: Member): RevealView["aloneCheck"] {
  const expected = room.aloneGuesses?.[me.id];
  const mine = room.votes[me.id];
  if (expected === undefined || mine === undefined) return null;
  return { expected, actual: room.members.filter((m) => m.id !== me.id && room.votes[m.id] === mine).length, others: room.members.length - 1 };
}
