import { describe, expect, it } from "vitest";
import { createPractice, createReplay, memberByToken } from "./room";
import { must } from "./test-helpers";
import { viewRoom } from "./view";

const cents = (x: number | undefined) => must(x).toFixed(2);

describe("the replay room (See the trap in 20 seconds)", () => {
  const made = createReplay("REPLAY");
  const me = must(memberByToken(made.room, made.token));
  const v = viewRoom(made.room, me);
  const rv = must(v.reveal);
  const opt = (id: string) => must(rv.options.find((o) => o.id === id));
  const alone = (memberId: string) => must(rv.members.find((m) => m.id === memberId)).ownScores;

  it("opens on the reveal of a practice room and says it is a replay", () => {
    expect(v.phase).toBe("reveal");
    expect(v.practice).toEqual({ title: expect.any(String), replay: true });
    expect(made.room.practice).toMatchObject({ scenarioId: "vendor-v1", replay: true });
    expect(me.id).toBe("m1");
    expect(rv.members.map((m) => [m.id, m.simulated])).toEqual([["m1", false], ["m2", true], ["m3", true]]);
  });

  it("a plain practice room is not a replay", () => {
    const p = createPractice("PRACT9");
    expect(p.room.practice?.replay).toBeUndefined();
    expect(viewRoom(p.room, must(memberByToken(p.room, p.token))).practice).toEqual({ title: expect.any(String) });
  });

  // The proof rows on the home page and in the video: the same facts, three different answers.
  it("each person alone leans to B: 4.67 / 5.00 / 5.00", () => {
    expect([alone("m1"), alone("m2"), alone("m3")].map((s) => cents(s.B))).toEqual(["4.67", "5.00", "5.00"]);
  });

  it("the facts that are shared point to B too: B 7.33, A -2.33", () => {
    expect([cents(opt("B").sharedScore), cents(opt("A").sharedScore)]).toEqual(["7.33", "-2.33"]);
  });

  it("the full ledger flips it: A 10.33, B 0.00", () => {
    expect([cents(opt("A").fullScore), cents(opt("B").fullScore)]).toEqual(["10.33", "0.00"]);
  });

  it("the vote is A 3, B 0, C 0, over 15 cards of which 9 are held by one person only", () => {
    expect(["A", "B", "C"].map((id) => opt(id).votes)).toEqual([3, 0, 0]);
    expect(rv.cards).toHaveLength(15);
    expect(rv.uniqueCount).toBe(9);
    expect(rv.cards.filter((c) => c.holders.length === 1)).toHaveLength(9);
  });

  it("the visitor started on B and ended on A", () => {
    expect(rv.viewer).toMatchObject({ initialPick: "B", vote: "A" });
  });
});
