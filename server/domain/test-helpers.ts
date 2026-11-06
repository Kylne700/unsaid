// Shared by the tests only (nothing in the app imports this file).
import { expect } from "vitest";

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
export const SEALED_KEYS = ["vote", "votes", "initialPick", "initialPicks", "fullScore", "sharedScore", "ownScores", "ownRanking", "fullRanking", "sharedRanking", "scores", "ranking", "weight", "weights", "raters", "ratings", "changed", "moved", "viewer", "tokenHash", "token", "seed"];
export const expectSealed = (view: unknown, label: string) => {
  const keys = keysDeep(view);
  for (const k of SEALED_KEYS) expect(keys.has(k), `${label}: key "${k}" must not be present before the reveal`).toBe(false);
};
