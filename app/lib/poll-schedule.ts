// How often an open room page reads the room. Every read costs hosting credits and keeps the database awake, so a quiet page
// slows down and then stops. Pure, so the schedule can be tested without a browser; the hook in hooks/use-room.ts feeds it.

export const FAST_MS = 2_000;
export const SLOW_MS = 5_000;
export const SLOWER_MS = 15_000;
/** 2 s for the first minute after something happened, then 5 s until 5 minutes, then 15 s until 15 minutes, then stop. */
export const FAST_FOR_MS = 60_000;
export const SLOW_FOR_MS = 5 * 60_000;
export const STOP_AFTER_MS = 15 * 60_000;

export type PollState = {
  /** Time since the last sign of life: the member acted, the tab was shown again, the chat did something or the room changed. */
  idleMs: number;
  /** The room's phase when known. The reveal is final, so nothing changes after it. */
  phase?: string | undefined;
  /** How the last read failed: "retry" = no answer, a timeout, "too many tries" or a server fault; "stop" = the server said no (404, 403, ...). */
  failure?: "retry" | "stop" | null | undefined;
};

/** `stop` says why: "reveal" (nothing more can change), "idle" (nobody here for 15 minutes) or "failed" (the server refused the read). */
export type PollPlan = { every: number } | { stop: "reveal" | "idle" | "failed" };

export function pollPlan({ idleMs, phase, failure }: PollState): PollPlan {
  if (phase === "reveal") return { stop: "reveal" };
  if (failure === "stop") return { stop: "failed" };
  if (idleMs >= STOP_AFTER_MS) return { stop: "idle" };
  const every = idleMs < FAST_FOR_MS ? FAST_MS : idleMs < SLOW_FOR_MS ? SLOW_MS : SLOWER_MS;
  // After a failed read, never faster than 5 s: a struggling server is not asked twice a second.
  return { every: failure === "retry" ? Math.max(every, SLOW_MS) : every };
}
