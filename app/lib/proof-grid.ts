// Which cells of the reveal's proof grid point somewhere (one column per option, one row per way of counting). Pure, so the ties
// and the empty cases can be tested without a browser; components/unsaid/RevealPhase.tsx draws the tint from it.
import type { RevealView } from "../../server/domain/view";

type Ranking = RevealView["fullRanking"];

export type ProofGrid = {
  /** Row 1: how many people lean to each option on their own facts. */
  lean: number[];
  /** Per row, per option (same order as `options`): does this cell point there? */
  leanOn: boolean[];
  sharedOn: boolean[];
  fullOn: boolean[];
  votesOn: boolean[];
};

export const topOf = (r: Ranking) => r.groups[0]?.options ?? [];

/** The cells with the highest count, when that count is above zero and not every option has it (a tie tints every tied cell). */
const highest = (counts: number[]) => counts.map((c) => c > 0 && c === Math.max(...counts) && counts.some((x) => x !== c));

/** The part of the reveal view the grid reads (RevealView fits it). */
type GridInput = {
  options: { id: string; votes: number }[];
  members: { cardCount: number; ownRanking: Ranking }[];
  sharedRanking: Ranking;
  fullRanking: Ranking;
};

export function proofGrid(rv: GridInput): ProofGrid {
  // A person leans to an option when it is the only top option of their own facts; a tie, or no cards, counts for no column.
  const lean = rv.options.map(
    (o) =>
      rv.members.filter((m) => {
        const top = m.cardCount ? topOf(m.ownRanking) : [];
        return top.length === 1 && top[0] === o.id;
      }).length,
  );
  // The top of a ranking points somewhere only when it does not include every option (all tied = no information).
  const pointed = (r: Ranking) => rv.options.map((o) => topOf(r).length < rv.options.length && topOf(r).includes(o.id));
  return { lean, leanOn: highest(lean), sharedOn: pointed(rv.sharedRanking), fullOn: pointed(rv.fullRanking), votesOn: highest(rv.options.map((o) => o.votes)) };
}
