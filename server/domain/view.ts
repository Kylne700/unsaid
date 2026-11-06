// The ONE redaction point. Every action that returns room data goes through viewRoom(), so the UI and the chat
// agent get exactly the same answer for the same caller. What each phase may show is decided here and nowhere else.
import { getScenario } from "./scenario";
import { buildReveal, holdersOf, rank, type Ranking, type Scores, uniqueCount } from "./ledger";
import type { Absorbed, Card, Member, Phase, Polarity, Room } from "./types";
import { seededShuffle } from "./util";

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
}
export interface LedgerCardView {
  id: string;
  option: string;
  polarity: Polarity;
  text: string;
  holders: { id: string; name: string }[];
  mine: boolean;
  merged: { id: string; text: string; holders: string[] }[];
  /** The caller's own rating, only once ratings exist (vote phase). */
  myRating: number | null;
}
export interface WeighView {
  total: number;
  rated: number;
  /** Shuffled per member. Neutral text only: no option, no holder, no total. */
  cards: { id: string; neutral: string; myRating: number | null }[];
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
  ledger: LedgerCardView[] | null;
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

export function viewRoom(room: Room, me: Member): RoomView {
  const nameOf = (id: string) => room.members.find((m) => m.id === id)?.name ?? "?";
  const myRatings = room.ratings[me.id] ?? {};
  const phase = room.phase;
  const ledgerCard = (c: Card, withRating: boolean): LedgerCardView => {
    const holders = holdersOf(c);
    return {
      id: c.id,
      option: c.option,
      polarity: c.polarity,
      text: c.text,
      holders: holders.map((id) => ({ id, name: nameOf(id) })),
      mine: holders.includes(me.id),
      merged: c.absorbed.map((a: Absorbed) => ({ id: a.id, text: a.text, holders: a.ownHolders.map(nameOf) })),
      myRating: withRating ? (myRatings[c.id] ?? null) : null,
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
            .map((d) => ({ id: d.id, option: d.option, polarity: d.polarity, text: d.text, neutral: d.neutral, origin: d.origin, phrase: d.phrase, ready: d.option !== null && d.polarity !== null }))
        : null,
    // Cards show their option and holders only before the blind weigh and after it, never during.
    ledger: phase === "cards" ? room.cards.map((c) => ledgerCard(c, false)) : phase === "vote" ? room.cards.map((c) => ledgerCard(c, true)) : null,
    weigh: null,
    reveal: null,
  };

  if (phase === "weigh") {
    const order = seededShuffle(room.cards.map((c) => c.id), `${room.seed}:${me.id}`);
    const byId = new Map(room.cards.map((c) => [c.id, c]));
    view.weigh = {
      total: room.cards.length,
      rated: room.cards.filter((c) => myRatings[c.id] !== undefined).length,
      cards: order.map((id) => ({ id, neutral: (byId.get(id) as Card).neutral, myRating: myRatings[id] ?? null })),
    };
  }
  if (phase === "reveal") view.reveal = revealView(room, me);
  return view;
}

function revealView(room: Room, me: Member): RevealView {
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
  };
}
