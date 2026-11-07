import { describe, expect, it } from "vitest";

import { rank } from "../../server/domain/ledger";
import { proofGrid } from "./proof-grid";

const options = [
  { id: "A", name: "Kelvane Desk", aliases: [] },
  { id: "B", name: "Brightpane Chat", aliases: [] },
  { id: "C", name: "Cobbleline Basic", aliases: [] },
];
const votes = (a: number, b: number, c: number) => options.map((o, i) => ({ id: o.id, votes: [a, b, c][i] ?? 0 }));
const person = (scores: Record<string, number>, cardCount = 1) => ({ cardCount, ownRanking: rank(scores, options) });

describe("proofGrid", () => {
  it("tints the column each row points to, and it jumps when the claim flips (the replay)", () => {
    const g = proofGrid({
      options: votes(3, 0, 0),
      members: [person({ A: 0, B: 4.67, C: 0 }), person({ A: -1, B: 5, C: 0 }), person({ A: 0, B: 5, C: -1 })],
      sharedRanking: rank({ A: -2.33, B: 7.33, C: -1.67 }, options),
      fullRanking: rank({ A: 10.33, B: 0, C: -1.67 }, options),
    });
    expect(g.lean).toEqual([0, 3, 0]);
    expect(g.leanOn).toEqual([false, true, false]);
    expect(g.sharedOn).toEqual([false, true, false]);
    expect(g.fullOn).toEqual([true, false, false]);
    expect(g.votesOn).toEqual([true, false, false]);
  });

  it("counts a person only when their own facts have one top option: a tie or no cards leans nowhere", () => {
    const g = proofGrid({
      options: votes(0, 0, 0),
      members: [person({ A: 0, B: 3, C: 0 }), person({ A: 2, B: 2, C: 0 }), person({}, 0)],
      sharedRanking: rank({}, options),
      fullRanking: rank({}, options),
    });
    expect(g.lean).toEqual([0, 1, 0]);
    expect(g.leanOn).toEqual([false, true, false]);
  });

  it("tints every tied cell of a row, but never a row where all options are level or all counts are zero", () => {
    const tie = proofGrid({
      options: votes(1, 1, 0),
      members: [person({ A: 3, B: 0, C: 0 }), person({ A: 0, B: 3, C: 0 })],
      sharedRanking: rank({ A: 4, B: 4, C: 1 }, options),
      fullRanking: rank({ A: 2, B: 2, C: 2 }, options),
    });
    expect(tie.leanOn).toEqual([true, true, false]);
    expect(tie.votesOn).toEqual([true, true, false]);
    expect(tie.sharedOn).toEqual([true, true, false]);
    expect(tie.fullOn).toEqual([false, false, false]);

    // Two options one vote each (or three people split 1-1-1): every option is level, so nothing is pointed at.
    const level = proofGrid({ options: [{ id: "A", votes: 1 }, { id: "B", votes: 1 }], members: [{ cardCount: 1, ownRanking: rank({ A: 1, B: 0 }, options.slice(0, 2)) }, { cardCount: 1, ownRanking: rank({ A: 0, B: 1 }, options.slice(0, 2)) }], sharedRanking: rank({}, options.slice(0, 2)), fullRanking: rank({}, options.slice(0, 2)) });
    expect(level.lean).toEqual([1, 1]);
    expect([...level.leanOn, ...level.votesOn].some(Boolean)).toBe(false);

    const empty = proofGrid({ options: votes(0, 0, 0), members: [person({}, 0)], sharedRanking: rank({}, options), fullRanking: rank({}, options) });
    expect(empty.lean).toEqual([0, 0, 0]);
    expect([...empty.leanOn, ...empty.sharedOn, ...empty.fullOn, ...empty.votesOn].some(Boolean)).toBe(false);
  });

  it("points at the least bad option when every score is negative", () => {
    const g = proofGrid({ options: votes(0, 0, 0), members: [], sharedRanking: rank({}, options), fullRanking: rank({ A: -3, B: -1, C: -2 }, options) });
    expect(g.fullOn).toEqual([false, true, false]);
  });

  it("works with two options", () => {
    const two = options.slice(0, 2);
    const g = proofGrid({ options: [{ id: "A", votes: 0 }, { id: "B", votes: 2 }], members: [{ cardCount: 1, ownRanking: rank({ A: 1, B: 0 }, two) }], sharedRanking: rank({ A: 1, B: 0 }, two), fullRanking: rank({ A: 0, B: 5 }, two) });
    expect(g.leanOn).toEqual([true, false]);
    expect(g.fullOn).toEqual([false, true]);
    expect(g.votesOn).toEqual([false, true]);
  });
});
