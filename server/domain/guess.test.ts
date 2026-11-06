// Guess who and the alone check: the maths, the hide rules, who may do what, and that nobody's guess reaches anybody else.
// Card ids are random, so a test that compares two rooms builds ONE room and clones it for each variant.
import { describe, expect, it } from "vitest";
import { type Guess, guessMeter, guessTarget, meterHiddenReason, validGuesses } from "./ledger";
import { approveDraft, castVote, createPractice, createRoom, forceAdvance, guessWho, joinRoom, memberByToken, rateCard, saveDraft, setDone, setInitialPick } from "./room";
import { buildRoom, keysDeep, must } from "./test-helpers";
import type { Member, Phase, Room } from "./types";
import { viewRoom, type RevealView } from "./view";

const g = (by: string, right: boolean, candidates = 2): Guess => ({ by, right, candidates });
const reveal = (room: Room, m: Member, agent = false): RevealView => must(viewRoom(room, m, { agent }).reveal);
type Table = ReturnType<typeof buildRoom>;
/** A copy of the room and its three members (Ana, Ben, Cy). */
function clone(t: Table): { room: Room; all: [Member, Member, Member] } {
  const room = structuredClone(t.room);
  return { room, all: t.all.map((m) => must(room.members.find((x) => x.id === m.id))) as [Member, Member, Member] };
}

/** `m` guesses on every card they may guess about: the real holder when `right()` says so, else the other member. */
function guessEvery(room: Room, m: Member, right: () => boolean = () => true) {
  for (const c of room.cards) {
    const holder = guessTarget(room, c, m.id);
    if (holder === null) continue;
    const wrong = must(room.members.find((x) => x.id !== m.id && x.id !== holder)).id;
    guessWho(room, m, c.id, right() ? holder : wrong);
  }
}
/** The first `n` calls say true. */
const firstRight = (n: number) => {
  let left = n;
  return () => left-- > 0;
};
const alternating = () => {
  let k = 0;
  return () => k++ % 2 === 0;
};
/** Everyone votes (Ana A, Ben B, Cy C unless told otherwise); the last vote reveals the room. */
function voteAll(room: Room, all: Member[], votes: [string, number?][] = [["A"], ["B"], ["C"]]) {
  all.forEach((m, i) => castVote(room, m, ...(votes[i] as [string, number?])));
  expect(room.phase).toBe("reveal");
}
/** A copy where Ana, Ben and Cy get `rights[i]` of their guesses right (in card order), then everyone votes. */
function guessed(t: Table, rights: [number, number, number]) {
  const c = clone(t);
  c.all.forEach((m, i) => guessEvery(c.room, m, firstRight(rights[i] as number)));
  voteAll(c.room, c.all);
  return c;
}
/** The visitor of a practice room, taken to the vote phase; the two simulated teammates have voted A. */
function practiceVote(code: string) {
  const p = createPractice(code);
  const me = must(memberByToken(p.room, p.token));
  setInitialPick(p.room, me, "B");
  setDone(p.room, me, true);
  for (const d of [...p.room.drafts]) approveDraft(p.room, me, d.id);
  setDone(p.room, me, true);
  for (const c of p.room.cards) rateCard(p.room, me, c.id, 2);
  setDone(p.room, me, true);
  expect(p.room.phase).toBe("vote");
  return { room: p.room, me };
}

describe("the guess-who meter: maths", () => {
  it("compares the right guesses with luck, the mean of 1/candidates over the guesses", () => {
    // two guesses between 2 members (50% each) and two between 4 (25% each): luck gives 37.5%, rounded to 38
    expect(guessMeter([g("m1", true, 2), g("m1", false, 2), g("m2", true, 4), g("m3", false, 4)])).toMatchObject({ guessers: 3, guesses: 4, right: 2, rightPct: 50, chancePct: 38 });
    expect(guessMeter([g("m1", true, 5), g("m2", false, 5)]).chancePct).toBe(20);
    expect(guessMeter([g("m1", true, 2), g("m2", false, 2), g("m3", false, 2)])).toMatchObject({ rightPct: 33, chancePct: 50 });
  });

  it("an empty list is all zeros and near luck", () => {
    expect(guessMeter([])).toEqual({ guessers: 0, guesses: 0, right: 0, rightPct: 0, chancePct: 0, verdict: "near" });
  });

  it("calls a result above or below luck only past two standard deviations", () => {
    // 20 guesses at 50%: luck gives 10 right, one standard deviation is 2.24, so 15 or more is above and 5 or fewer is below
    const verdict = (right: number) => guessMeter(Array.from({ length: 20 }, (_, i) => g(`m${i % 3}`, i < right))).verdict;
    expect([10, 14, 6].map(verdict)).toEqual(["near", "near", "near"]);
    expect(verdict(15)).toBe("above");
    expect(verdict(5)).toBe("below");
    // 8 guesses among 8 candidates: luck is 12.5% (one right), so 4 right is far above it, and 1 right is luck
    const wide = (right: number) => guessMeter(Array.from({ length: 8 }, (_, i) => g(`m${i % 3}`, i < right, 8))).verdict;
    expect([wide(4), wide(1)]).toEqual(["above", "near"]);
  });

  it("hides the room-wide number for fewer than 3 guessers, all right, or all wrong", () => {
    const hide = (gs: Guess[]) => meterHiddenReason(guessMeter(gs));
    expect(hide([])).toBe("few");
    expect(hide([g("m1", true), g("m2", false)])).toBe("few");
    expect(hide([g("m1", true), g("m1", false), g("m1", true), g("m2", false)])).toBe("few"); // two people, four guesses
    expect(hide([g("m1", true), g("m2", true), g("m3", true)])).toBe("all");
    expect(hide([g("m1", false), g("m2", false), g("m3", false)])).toBe("none");
    expect(hide([g("m1", true), g("m2", false), g("m3", false)])).toBeNull();
    expect(hide([g("m1", true), g("m2", true), g("m3", true), g("m4", false)])).toBeNull();
  });
});

describe("guess who: who may guess what", () => {
  it("only in the vote phase, and it locks with the last vote", () => {
    for (const phase of ["notes", "cards", "weigh"] as Phase[]) {
      const t = buildRoom(phase);
      expect(() => guessWho(t.room, t.ana, "c_nope", t.ben.id), phase).toThrow(/Not possible in the "\w+" phase/);
    }
    const t = buildRoom("vote");
    const ben = must(t.room.cards.find((c) => c.ownHolders[0] === t.ben.id));
    guessWho(t.room, t.ana, ben.id, t.cy.id);
    voteAll(t.room, t.all);
    expect(() => guessWho(t.room, t.ana, ben.id, t.ben.id)).toThrow(/Not possible in the "reveal" phase/);
    expect(t.room.whoGuesses?.[t.ana.id]?.[ben.id]).toBe(t.cy.id);
  });

  it("only about a fact exactly one other member knew, naming another member", () => {
    const t = buildRoom("vote", { merge: true });
    const own = must(t.room.cards.find((c) => c.ownHolders[0] === t.ana.id));
    const benOnly = must(t.room.cards.find((c) => c.text === "Berlin rents are rising."));
    const twoHolders = must(t.room.cards.find((c) => c.absorbed.length > 0)); // Ben and Cy
    expect(() => guessWho(t.room, t.ana, "c_nope", t.ben.id)).toThrow(/Card not found/);
    expect(() => guessWho(t.room, t.ana, own.id, t.ben.id)).toThrow(/exactly one other member/); // their own card
    expect(() => guessWho(t.room, t.ana, twoHolders.id, t.ben.id)).toThrow(/exactly one other member/); // two holders
    expect(() => guessWho(t.room, t.ana, benOnly.id, "m9")).toThrow(/Unknown member/);
    expect(() => guessWho(t.room, t.ana, benOnly.id, t.ana.id)).toThrow(/Unknown member/); // not themselves
    expect(t.room.whoGuesses).toBeUndefined(); // nothing was stored by the refused calls
    guessWho(t.room, t.ana, benOnly.id, t.cy.id); // a wrong guess is allowed
    expect(t.room.whoGuesses).toEqual({ [t.ana.id]: { [benOnly.id]: t.cy.id } });
  });

  it("needs 3 members", () => {
    const duo = createRoom({ code: "TWOMEM", question: "Which city?", options: ["Lisbon", "Berlin"], creatorName: "Ana" });
    const ana = must(memberByToken(duo.room, duo.token));
    const ben = must(memberByToken(duo.room, joinRoom(duo.room, "Ben").token));
    forceAdvance(duo.room, ana); // cards
    approveDraft(duo.room, ben, saveDraft(duo.room, ben, { text: "Berlin has a tech scene.", option: "B", polarity: "pro" }).id);
    forceAdvance(duo.room, ana); // weigh
    forceAdvance(duo.room, ana); // vote
    expect(() => guessWho(duo.room, ana, must(duo.room.cards[0]).id, ben.id)).toThrow(/3 or more/);
    expect(viewRoom(duo.room, ana).ledger?.every((c) => !c.guessable)).toBe(true);
  });

  it("can be changed, and taken back with not sure, which is no guess", () => {
    const t = buildRoom("vote");
    const card = must(t.room.cards.find((x) => x.ownHolders[0] === t.ben.id));
    const mine = () => viewRoom(t.room, t.ana).ledger?.find((x) => x.id === card.id)?.myGuess;
    guessWho(t.room, t.ana, card.id, t.cy.id);
    guessWho(t.room, t.ana, card.id, t.ben.id);
    expect(mine()).toBe(t.ben.id);
    expect(validGuesses(t.room)).toEqual([{ by: t.ana.id, right: true, candidates: 2 }]);
    guessWho(t.room, t.ana, card.id, null);
    expect(mine()).toBeNull();
    expect(validGuesses(t.room)).toEqual([]);
  });

  it("marks exactly the cards the member may guess about", () => {
    const t = buildRoom("vote");
    const ids = (m: Member) => viewRoom(t.room, m).ledger?.filter((c) => c.guessable).map((c) => c.id).sort();
    expect(ids(t.ana)).toEqual(t.room.cards.filter((c) => c.ownHolders[0] !== t.ana.id).map((c) => c.id).sort()); // Ben's 3 and Cy's 2
    expect(ids(t.ana)).toHaveLength(5);
    expect(ids(t.cy)).toHaveLength(6);
    const cards = buildRoom("cards").room; // not before the vote phase
    expect((viewRoom(cards, must(cards.members[0])).ledger ?? []).every((c) => !c.guessable && c.myGuess === null)).toBe(true);
  });

  it("ignores junk in an old document: unknown cards or guessers, their own cards, unknown members", () => {
    const t = buildRoom("vote");
    const ben = must(t.room.cards.find((c) => c.ownHolders[0] === t.ben.id));
    const own = must(t.room.cards.find((c) => c.ownHolders[0] === t.ana.id));
    t.room.whoGuesses = { zz: { [ben.id]: t.cy.id }, [t.ana.id]: { c_nope: t.ben.id, [own.id]: t.ben.id, [ben.id]: "m9" } };
    expect(validGuesses(t.room)).toEqual([]);
    must(t.room.whoGuesses)[t.ana.id] = { [ben.id]: t.cy.id };
    expect(validGuesses(t.room)).toEqual([{ by: t.ana.id, right: false, candidates: 2 }]);
  });
});

describe("the reveal shows one room-wide number, never anybody's own guesses", () => {
  // Three guessers, 16 guesses: Ana 5, Ben 5, Cy 6.
  it("pools every real member's guesses: right guesses against luck, plus guessers and guess counts", () => {
    const base = buildRoom("vote");
    const mixed = guessed(base, [5, 3, 0]); // 8 of 16 right, luck 50%
    for (const m of mixed.all) {
      expect(reveal(mixed.room, m).guessWho).toEqual({ scope: "room", result: { guessers: 3, guesses: 16, right: 8, rightPct: 50, chancePct: 50, verdict: "near" } });
    }
    const high = guessed(base, [5, 5, 4]); // 14 of 16
    expect(reveal(high.room, high.all[0]).guessWho?.result).toMatchObject({ right: 14, rightPct: 88, verdict: "above" });
  });

  it("does not depend on who got which guesses right", () => {
    const base = buildRoom("vote");
    const [a, b, c] = [guessed(base, [5, 0, 3]), guessed(base, [0, 5, 3]), guessed(base, [2, 3, 3])];
    for (const i of [0, 1, 2]) {
      const json = (x: typeof a) => JSON.stringify(viewRoom(x.room, x.all[i] as Member));
      expect(json(b), `member ${i}`).toBe(json(a)); // 8 of 16 each time: the whole view is the same
      expect(json(c), `member ${i}`).toBe(json(a));
    }
  });

  it("hides it, with no numbers at all, for fewer than 3 guessers, all right, or all wrong", () => {
    const hidden = { scope: "room", result: null };
    const base = buildRoom("vote");

    const few = clone(base);
    guessEvery(few.room, few.all[0]);
    guessEvery(few.room, few.all[1], () => false);
    voteAll(few.room, few.all);
    expect(reveal(few.room, few.all[2]).guessWho).toEqual(hidden); // two people guessed

    for (const right of [0, 99]) {
      const c = guessed(base, [right, right, right]); // all wrong, then all right
      for (const m of c.all) {
        expect(reveal(c.room, m).guessWho, `${right}/${m.name}`).toEqual(hidden);
        expect(JSON.stringify(reveal(c.room, m))).not.toMatch(/"(right|rightPct|chancePct|guessers|guesses)"/);
      }
    }
  });

  it("is not there at all when no fact could be guessed", () => {
    const c = clone(buildRoom("vote"));
    for (const card of c.room.cards) card.ownHolders = [c.all[0].id, c.all[1].id]; // everything is shared
    voteAll(c.room, c.all);
    expect(reveal(c.room, c.all[0]).guessWho).toBeNull();
  });

  it("counts only real guesses: not sure and nobody guessing leave no number", () => {
    const base = buildRoom("vote");
    const none = clone(base);
    voteAll(none.room, none.all);
    expect(reveal(none.room, none.all[0]).guessWho).toEqual({ scope: "room", result: null });

    const some = clone(base);
    some.all.forEach((m, i) => guessEvery(some.room, m, firstRight([3, 2, 1][i] as number)));
    guessWho(some.room, some.all[0], must(some.room.cards.find((c) => c.ownHolders[0] === some.all[1].id)).id, null); // Ana takes one back
    voteAll(some.room, some.all);
    expect(reveal(some.room, some.all[0]).guessWho?.result).toMatchObject({ guessers: 3, guesses: 15, right: 5 });
  });

  it("the reveal view carries only the two results, no guess of anybody's", () => {
    const c = guessed(buildRoom("vote"), [3, 2, 1]);
    for (const m of c.all) {
      const keys = keysDeep(viewRoom(c.room, m));
      for (const k of ["whoGuesses", "aloneGuesses", "expectSame", "myGuess", "guessable"]) expect(keys.has(k), `${m.name}: ${k}`).toBe(false);
    }
  });
});

describe("guess who in a practice room", () => {
  it("has six facts to guess, between the two teammates", () => {
    const { room, me } = practiceVote("PRACT9");
    expect(viewRoom(room, me).ledger?.filter((c) => c.guessable)).toHaveLength(6);
    expect(validGuesses(room)).toEqual([]);
  });

  it("shows only your own guesses, with no hiding rule", () => {
    const some = practiceVote("PRACT1");
    guessEvery(some.room, some.me, firstRight(4));
    castVote(some.room, some.me, "B");
    expect(reveal(some.room, some.me).guessWho).toEqual({ scope: "practice", result: { guessers: 1, guesses: 6, right: 4, rightPct: 67, chancePct: 50, verdict: "near" } });

    const perfect = practiceVote("PRACT2");
    guessEvery(perfect.room, perfect.me);
    castVote(perfect.room, perfect.me, "B");
    expect(reveal(perfect.room, perfect.me).guessWho?.result).toMatchObject({ right: 6, rightPct: 100, verdict: "above" }); // shown, even at 100%

    const none = practiceVote("PRACT3");
    castVote(none.room, none.me, "B");
    expect(reveal(none.room, none.me).guessWho).toEqual({ scope: "practice", result: null });
  });
});

describe("the chat agent's view carries no guess of the member's", () => {
  it("vote: myGuess is null even after a guess; the member's own view has it", () => {
    const t = buildRoom("vote");
    guessEvery(t.room, t.ana);
    const mine = viewRoom(t.room, t.ana).ledger ?? [];
    const agent = viewRoom(t.room, t.ana, { agent: true }).ledger ?? [];
    expect(mine.filter((c) => c.myGuess !== null)).toHaveLength(5);
    expect(agent.filter((c) => c.myGuess !== null)).toHaveLength(0);
    expect(agent.filter((c) => c.guessable)).toHaveLength(5); // the rest of the ledger is the same
    expect(JSON.stringify(agent)).toBe(JSON.stringify(mine.map((c) => ({ ...c, myGuess: null }))));
  });

  it("reveal: the room-wide number is the same; your own check and practice result are not given", () => {
    const c = clone(buildRoom("vote"));
    c.all.forEach((m, i) => guessEvery(c.room, m, firstRight([3, 1, 4][i] as number)));
    voteAll(c.room, c.all, [["A", 1], ["A", 1], ["C", 1]]);
    const full = reveal(c.room, c.all[0]);
    const agent = reveal(c.room, c.all[0], true);
    expect(full.aloneCheck).not.toBeNull();
    expect(agent.aloneCheck).toBeNull();
    expect(agent.guessWho).toEqual(full.guessWho);
    expect(agent.guessWho?.scope).toBe("room");

    const p = practiceVote("PRACT8");
    guessEvery(p.room, p.me);
    castVote(p.room, p.me, "A", 2);
    expect(reveal(p.room, p.me).guessWho?.scope).toBe("practice");
    expect(reveal(p.room, p.me).aloneCheck).not.toBeNull();
    expect(reveal(p.room, p.me, true).guessWho).toBeNull();
    expect(reveal(p.room, p.me, true).aloneCheck).toBeNull();
  });
});

describe("nobody else's guess shows before the reveal", () => {
  it("vote: a member's view depends on their own guesses only, never on the others'", () => {
    const base = buildRoom("vote");
    for (const [i, viewer] of base.all.entries()) {
      const alone = clone(base);
      guessEvery(alone.room, alone.all[i] as Member, alternating()); // only the viewer guesses
      const baseline = JSON.stringify(viewRoom(alone.room, alone.all[i] as Member));
      for (const rightFor of [() => true, () => false, alternating()]) {
        const crowd = clone({ ...base, room: alone.room });
        crowd.all.forEach((m, j) => j !== i && guessEvery(crowd.room, m, rightFor));
        expect(JSON.stringify(viewRoom(crowd.room, crowd.all[i] as Member)), `${viewer.name} with the others' guesses`).toBe(baseline);
      }
    }
  });

  it("vote: the viewer's own guess shows only as myGuess; no other member's id sits on a card", () => {
    const t = buildRoom("vote");
    for (const m of t.all) guessEvery(t.room, m);
    for (const m of t.all) {
      const ledger = viewRoom(t.room, m).ledger ?? [];
      const guessed = ledger.filter((c) => c.myGuess !== null);
      expect(guessed).toHaveLength(ledger.filter((c) => c.guessable).length);
      for (const c of guessed) expect(c.myGuess).toBe(t.room.cards.find((x) => x.id === c.id)?.ownHolders[0]); // all right in this room
      for (const c of ledger) {
        const row = JSON.stringify({ ...c, myGuess: null });
        for (const other of t.all.filter((x) => x.id !== m.id)) expect(row, `${m.name} / ${other.name}`).not.toContain(`"${other.id}"`);
      }
    }
  });

  it("vote: sealed votes and alone guesses are in nobody's view and change nobody's view", () => {
    const base = buildRoom("vote");
    const run = (a: number, b: number) => {
      const c = clone(base);
      castVote(c.room, c.all[0], "A", a);
      castVote(c.room, c.all[1], "B", b);
      expect(c.room.phase).toBe("vote");
      return c;
    };
    const [one, other] = [run(0, 2), run(2, 0)];
    for (const i of [0, 1, 2]) {
      const [v1, v2] = [viewRoom(one.room, one.all[i] as Member), viewRoom(other.room, other.all[i] as Member)];
      expect(JSON.stringify(v1), `member ${i}`).toBe(JSON.stringify(v2)); // the alone guesses are the only difference between the rooms
      const keys = keysDeep(v1);
      for (const k of ["aloneGuesses", "expectSame", "aloneCheck", "whoGuesses", "vote", "votes"]) expect(keys.has(k), `member ${i}: ${k}`).toBe(false);
    }
  });
});

describe("the alone check", () => {
  /** A copy of the room where everyone votes `[option, how many of the others they expect to vote the same]`. */
  const voted = (base: Table, votes: [string, number?][]) => {
    const c = clone(base);
    voteAll(c.room, c.all, votes);
    return c;
  };

  it("gives each member their own guess next to how many of the others voted like them", () => {
    const c = voted(buildRoom("vote"), [["A", 2], ["A", 0], ["C", 1]]);
    expect(reveal(c.room, c.all[0]).aloneCheck).toEqual({ expected: 2, actual: 1, others: 2 });
    expect(reveal(c.room, c.all[1]).aloneCheck).toEqual({ expected: 0, actual: 1, others: 2 });
    expect(reveal(c.room, c.all[2]).aloneCheck).toEqual({ expected: 1, actual: 0, others: 2 });
  });

  it("is optional: a member who gave none has none", () => {
    const c = voted(buildRoom("vote"), [["A", 0], ["B"], ["A"]]);
    expect(reveal(c.room, c.all[0]).aloneCheck).toEqual({ expected: 0, actual: 1, others: 2 });
    expect(reveal(c.room, c.all[1]).aloneCheck).toBeNull();
    expect(reveal(c.room, c.all[2]).aloneCheck).toBeNull();
  });

  it("shows nobody else's guess: changing it changes nobody else's view", () => {
    const base = buildRoom("vote");
    const a = voted(base, [["A", 2], ["A", 0], ["C", 1]]);
    const b = voted(base, [["A", 1], ["A", 0], ["C", 1]]); // only Ana's guess differs
    const json = (x: typeof a, i: number) => JSON.stringify(viewRoom(x.room, x.all[i] as Member));
    expect(json(b, 1)).toBe(json(a, 1));
    expect(json(b, 2)).toBe(json(a, 2));
    expect(json(b, 0)).not.toBe(json(a, 0));
    for (const m of a.all) expect(keysDeep(reveal(a.room, m)).has("aloneGuesses"), m.name).toBe(false);
  });

  it("takes a whole number from 0 to the number of others, and refuses before sealing anything", () => {
    const t = buildRoom("vote");
    for (const bad of [-1, 3, 1.5, Number.NaN]) {
      expect(() => castVote(t.room, t.ana, "A", bad), String(bad)).toThrow(/from 0 to 2/);
      expect(t.room.votes[t.ana.id]).toBeUndefined();
      expect(t.ana.done).toBe(false);
    }
    expect(t.room.aloneGuesses).toBeUndefined();
    castVote(t.room, t.ana, "A", 2);
    expect(t.room.aloneGuesses).toEqual({ [t.ana.id]: 2 });
    expect(() => castVote(t.room, t.ana, "B", 0)).toThrow(/already sealed/);
    expect(t.room.aloneGuesses).toEqual({ [t.ana.id]: 2 }); // the first vote and guess stand
  });

  it("counts the simulated teammates' votes in a practice room", () => {
    const run = (option: string, code: string) => {
      const p = practiceVote(code);
      castVote(p.room, p.me, option, 1);
      return reveal(p.room, p.me).aloneCheck;
    };
    expect(run("A", "PRACT4")).toEqual({ expected: 1, actual: 2, others: 2 }); // both teammates vote A
    expect(run("B", "PRACT5")).toEqual({ expected: 1, actual: 0, others: 2 });
  });
});
