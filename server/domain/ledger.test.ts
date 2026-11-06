import { describe, expect, it } from "vitest";
import { buildReveal, holdersOf, rank, scoreOptions, teamWeights, uniqueCount } from "./ledger";
import type { Card, Member, Polarity, Room, Weight } from "./types";
import { neutralize, optionsNamed } from "./util";
import { viewRoom } from "./view";

const options = [
  { id: "A", name: "Lisbon", aliases: [] },
  { id: "B", name: "Berlin", aliases: [] },
];
const member = (id: string): Member => ({ id, name: `Member ${id}`, role: null, simulated: false, tokenHash: `hash-${id}`, done: true });
const card = (id: string, option: string, polarity: Polarity, ownHolders: string[]): Card => ({ id, option, polarity, text: `fact ${id}`, neutral: `neutral ${id}`, ownHolders, absorbed: [], factKey: null });
/** ratings[member][card] */
const room = (cards: Card[], ratings: Record<string, Record<string, Weight>>, votes: Record<string, string> = {}): Room => ({
  code: "LEDGER",
  seed: "seed",
  question: "Which city?",
  options,
  creatorId: "m1",
  practice: null,
  phase: "reveal",
  members: [member("m1"), member("m2"), member("m3")],
  notes: {},
  initialPicks: { m1: "A", m2: "A", m3: "B" },
  drafts: [],
  cards,
  ratings,
  votes,
});

// Hand-computed fixture.
//   c1 A pro  held by m1,m2   ratings 3,3,2  -> weight 8/3
//   c2 A con  held by m1      ratings 1,0,2  -> weight 1
//   c3 B pro  held by m2      ratings 3,3,3  -> weight 3
//   c4 B pro  held by m3      ratings 2,2,2  -> weight 2
//   c5 B con  held by m2,m3   ratings 1,2,0  -> weight 1
const cards = [card("c1", "A", "pro", ["m1", "m2"]), card("c2", "A", "con", ["m1"]), card("c3", "B", "pro", ["m2"]), card("c4", "B", "pro", ["m3"]), card("c5", "B", "con", ["m2", "m3"])];
const ratings: Record<string, Record<string, Weight>> = {
  m1: { c1: 3, c2: 1, c3: 3, c4: 2, c5: 1 },
  m2: { c1: 3, c2: 0, c3: 3, c4: 2, c5: 2 },
  m3: { c1: 2, c2: 2, c3: 3, c4: 2, c5: 0 },
};
const close = (a: number | undefined, b: number) => expect(a).toBeCloseTo(b, 9);

describe("ledger math against a hand-computed fixture", () => {
  const fx = room(cards, ratings, { m1: "A", m2: "A", m3: "B" });

  it("weights are the team mean of every member's 0-3 rating", () => {
    const w = teamWeights(fx);
    close(w.c1, 8 / 3);
    close(w.c2, 1);
    close(w.c3, 3);
    close(w.c4, 2);
    close(w.c5, 1);
  });

  it("full ledger: A = 8/3 - 1, B = 3 + 2 - 1, so B ranks first", () => {
    const rv = buildReveal(fx);
    close(rv.full.scores.A, 5 / 3);
    close(rv.full.scores.B, 4);
    expect(rv.full.ranking.groups.map((g) => g.options)).toEqual([["B"], ["A"]]);
    expect(rv.full.ranking.tiedFirst).toBe(false);
  });

  it("each member's own facts use the SAME team weights", () => {
    const rv = buildReveal(fx);
    const by = (id: string) => rv.members.find((m) => m.memberId === id);
    // m1 holds c1 (A pro) and c2 (A con): A = 8/3 - 1, B = 0
    close(by("m1")?.scores.A, 5 / 3);
    close(by("m1")?.scores.B, 0);
    expect(by("m1")?.ranking.groups[0]?.options).toEqual(["A"]);
    // m2 holds c1, c3, c5: A = 8/3, B = 3 - 1
    close(by("m2")?.scores.A, 8 / 3);
    close(by("m2")?.scores.B, 2);
    expect(by("m2")?.ranking.groups[0]?.options).toEqual(["A"]);
    // m3 holds c4, c5: A = 0, B = 2 - 1
    close(by("m3")?.scores.A, 0);
    close(by("m3")?.scores.B, 1);
    expect(by("m3")?.ranking.groups[0]?.options).toEqual(["B"]);
    expect(by("m1")?.cardCount).toBe(2);
  });

  it("shared-only ranking, the unique count and which single-holder facts moved the ranking", () => {
    const rv = buildReveal(fx);
    // cards with two or more holders: c1 and c5
    close(rv.shared.scores.A, 8 / 3);
    close(rv.shared.scores.B, -1);
    expect(rv.shared.ranking.groups[0]?.options).toEqual(["A"]);
    expect(rv.uniqueCount).toBe(3); // c2, c3, c4
    expect(uniqueCount(fx.cards)).toBe(3);
    expect(rv.moved).toEqual({ up: ["B"], down: ["A"] });
    expect(rv.changed.map((x) => [x.card.id, x.effect])).toEqual([
      ["c3", 3],
      ["c4", 2],
      ["c2", 1],
    ]);
  });

  it("the reveal view carries the same numbers, rounded to 3 decimals, plus the viewer's headline data", () => {
    const m1 = fx.members[0] as Member;
    const v = viewRoom(fx, m1).reveal;
    expect(v).not.toBeNull();
    expect(v?.options.map((o) => [o.id, o.fullScore, o.sharedScore, o.votes])).toEqual([
      ["A", 1.667, 2.667, 2],
      ["B", 4, -1, 1],
    ]);
    expect(v?.viewer).toMatchObject({ id: "m1", initialPick: "A", vote: "A", ownTop: ["A"], ownTied: false, fullTop: ["B"], fullTied: false });
    expect(v?.members.map((m) => [m.id, m.initialPick, m.vote])).toEqual([
      ["m1", "A", "A"],
      ["m2", "A", "A"],
      ["m3", "B", "B"],
    ]);
    expect(v?.changed.map((c) => [c.id, c.holders])).toEqual([
      ["c3", ["Member m2"]],
      ["c4", ["Member m3"]],
      ["c2", ["Member m1"]],
    ]);
  });

  it("a card nobody rated weighs 0 and moves nothing", () => {
    const r = room([card("x", "A", "pro", ["m1"])], {});
    expect(teamWeights(r).x).toBe(0);
    expect(buildReveal(r).full.scores).toEqual({ A: 0, B: 0 });
  });
});

describe("ties are reported, never broken", () => {
  it("equal scores share one group and flag tiedFirst", () => {
    const r = room([card("x", "A", "pro", ["m1"]), card("y", "B", "pro", ["m2"])], { m1: { x: 2, y: 2 }, m2: { x: 2, y: 2 }, m3: { x: 2, y: 2 } });
    const rv = buildReveal(r);
    expect(rv.full.ranking).toEqual({ groups: [{ options: ["A", "B"], score: 2 }], tiedFirst: true });
    const v = viewRoom(r, r.members[0] as Member).reveal;
    expect(v?.viewer.fullTied).toBe(true);
    expect(v?.viewer.fullTop).toEqual(["A", "B"]);
  });

  it("a floating point near-tie (1/3 + 2/3 against 1) is still a tie", () => {
    const r = room([card("x", "A", "pro", ["m1"]), card("y", "A", "pro", ["m2"]), card("z", "B", "pro", ["m3"])], { m1: { x: 1, y: 1, z: 1 }, m2: { x: 0, y: 1, z: 1 }, m3: { x: 0, y: 0, z: 1 } });
    expect(buildReveal(r).full.ranking.tiedFirst).toBe(true);
  });

  it("a tie for second place is a group too, and the order inside a group follows the room's option order", () => {
    const three = [...options, { id: "C", name: "Oslo", aliases: [] }];
    const rk = rank({ A: 1, B: 3, C: 1 }, three);
    expect(rk.groups).toEqual([
      { options: ["B"], score: 3 },
      { options: ["A", "C"], score: 1 },
    ]);
    expect(rk.tiedFirst).toBe(false);
  });
});

describe("no single fact flips the ranking, but the set of them does", () => {
  // One shared fact for A (weight 3). Three single-holder facts for B, each weight 2.
  const flip = room([card("a", "A", "pro", ["m1", "m2"]), card("s1", "B", "pro", ["m1"]), card("s2", "B", "pro", ["m2"]), card("s3", "B", "pro", ["m3"])], {
    m1: { a: 3, s1: 2, s2: 2, s3: 2 },
    m2: { a: 3, s1: 2, s2: 2, s3: 2 },
    m3: { a: 3, s1: 2, s2: 2, s3: 2 },
  });
  it("what the team already shared points to A, the full ledger to B, and all three facts are named", () => {
    const rv = buildReveal(flip);
    expect(rv.shared.ranking.groups[0]?.options).toEqual(["A"]);
    expect(rv.full.ranking.groups[0]?.options).toEqual(["B"]);
    expect(rv.changed.map((x) => x.card.id).sort()).toEqual(["s1", "s2", "s3"]);
  });
  it("dropping any one of the three still leaves B ahead", () => {
    for (const drop of ["s1", "s2", "s3"]) {
      const rest = flip.cards.filter((c) => c.id !== drop);
      const s = scoreOptions(rest, teamWeights({ ...flip, cards: rest }), options);
      expect(rank(s, options).groups[0]?.options).toEqual(["B"]);
    }
  });
});

describe("holders after a merge", () => {
  it("are the union of the kept card's holders and the absorbed cards' holders", () => {
    const kept = card("k", "A", "pro", ["m1"]);
    kept.absorbed.push({ id: "g", text: "t", neutral: "n", ownHolders: ["m2", "m1"], factKey: null, by: "m1" });
    expect(holdersOf(kept).sort()).toEqual(["m1", "m2"]);
    expect(uniqueCount([kept])).toBe(0);
  });
});

describe("neutralize", () => {
  const opts = [
    { id: "A", name: "New York", aliases: [] },
    { id: "B", name: "York", aliases: ["YRK"] },
    { id: "C", name: "C++", aliases: [] },
  ];
  it("replaces whole names and aliases, longest first, case-insensitively", () => {
    expect(neutralize("New York beats york and YRK.", opts)).toBe("this option beats this option and this option.");
  });
  it("leaves words that merely contain a name, and escapes regex characters in names", () => {
    expect(neutralize("Yorkshire is not York.", opts)).toBe("Yorkshire is not this option.");
    expect(neutralize("We know C++ well.", opts)).toBe("We know this option well.");
  });
  it("optionsNamed lists the options a text mentions", () => {
    expect(optionsNamed("YRK is cheap", opts)).toEqual(["B"]);
    expect(optionsNamed("nothing here", opts)).toEqual([]);
  });
});
