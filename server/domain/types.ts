// Pure domain types for an Unsaid room. No framework imports: the whole room is one JSON document.

export const PHASES = ["notes", "cards", "weigh", "vote", "reveal"] as const;
export type Phase = (typeof PHASES)[number];
export type Polarity = "pro" | "con";
export type Weight = 0 | 1 | 2 | 3;

export interface OptionDef {
  id: string;
  name: string;
  aliases: string[];
}

export interface Member {
  id: string;
  name: string;
  role: string | null;
  simulated: boolean;
  /** sha256 of the member's secret token; null for simulated members. */
  tokenHash: string | null;
  done: boolean;
}

/** A private card, visible only to its owner until it is approved into the ledger. */
export interface Draft {
  id: string;
  ownerId: string;
  option: string | null;
  polarity: Polarity | null;
  text: string;
  /** The same fact without any option name. */
  neutral: string;
  origin: "notes" | "practice" | "manual";
  /** Practice only: the substring of the memo this draft was prepared from. */
  phrase: string | null;
  /** Practice only: the scenario fact id, so the same fact held by several members becomes one card. */
  factKey: string | null;
}

/** A card that was merged into another one; kept whole so the merge can be undone. */
export interface Absorbed {
  id: string;
  text: string;
  neutral: string;
  ownHolders: string[];
  factKey: string | null;
  by: string;
}

/** An approved card in the shared ledger. */
export interface Card {
  id: string;
  option: string;
  polarity: Polarity;
  text: string;
  neutral: string;
  ownHolders: string[];
  absorbed: Absorbed[];
  factKey: string | null;
}

export interface Room {
  code: string;
  /** Seeds the per-member shuffle of the blind weigh list. */
  seed: string;
  question: string;
  options: OptionDef[];
  creatorId: string;
  /** Set for practice rooms ("Fall into the trap yourself"). `replay`: a practice room already played to its reveal ("See the trap in 20 seconds"). */
  practice: { scenarioId: string; replay?: true } | null;
  phase: Phase;
  members: Member[];
  notes: Record<string, string>;
  initialPicks: Record<string, string>;
  drafts: Draft[];
  cards: Card[];
  ratings: Record<string, Record<string, Weight>>;
  votes: Record<string, string>;
  /** Vote phase, optional (older rooms have none): guesser id -> card id -> the member they say held it. "Not sure" has no entry. */
  whoGuesses?: Record<string, Record<string, string>>;
  /** Optional: member id -> how many of the other members they expected to pick their option (sent with the vote). */
  aloneGuesses?: Record<string, number>;
}
