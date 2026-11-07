import { describe, expect, it } from "vitest";

import { FAST_FOR_MS, pollPlan, SLOW_FOR_MS, STOP_AFTER_MS } from "./poll-schedule";

const MIN = 60_000;

describe("pollPlan", () => {
  it("reads every 2 s for the first minute after something happened", () => {
    expect(pollPlan({ idleMs: 0 })).toEqual({ every: 2000 });
    expect(pollPlan({ idleMs: FAST_FOR_MS - 1 })).toEqual({ every: 2000 });
  });

  it("slows to 5 s until 5 minutes, then to 15 s until 15 minutes", () => {
    expect(pollPlan({ idleMs: FAST_FOR_MS })).toEqual({ every: 5000 });
    expect(pollPlan({ idleMs: 4 * MIN })).toEqual({ every: 5000 });
    expect(pollPlan({ idleMs: SLOW_FOR_MS - 1 })).toEqual({ every: 5000 });
    expect(pollPlan({ idleMs: SLOW_FOR_MS })).toEqual({ every: 15000 });
    expect(pollPlan({ idleMs: 14 * MIN })).toEqual({ every: 15000 });
    expect(pollPlan({ idleMs: STOP_AFTER_MS - 1 })).toEqual({ every: 15000 });
  });

  it("stops after 15 minutes without a sign of life", () => {
    expect(pollPlan({ idleMs: STOP_AFTER_MS })).toEqual({ stop: "idle" });
    expect(pollPlan({ idleMs: 3 * 60 * MIN })).toEqual({ stop: "idle" });
  });

  it("stops at the reveal, however active the room was a moment ago", () => {
    expect(pollPlan({ idleMs: 0, phase: "reveal" })).toEqual({ stop: "reveal" });
    expect(pollPlan({ idleMs: 30 * MIN, phase: "reveal" })).toEqual({ stop: "reveal" });
    expect(pollPlan({ idleMs: 0, phase: "reveal", failure: "retry" })).toEqual({ stop: "reveal" });
  });

  it("reads on in every phase before the reveal", () => {
    for (const phase of ["notes", "cards", "weigh", "vote"]) expect(pollPlan({ idleMs: 0, phase })).toEqual({ every: 2000 });
  });

  it("backs off to at least 5 s after a read that could be asked again, and keeps the slower tiers", () => {
    expect(pollPlan({ idleMs: 0, failure: "retry" })).toEqual({ every: 5000 });
    expect(pollPlan({ idleMs: 2 * MIN, failure: "retry" })).toEqual({ every: 5000 });
    expect(pollPlan({ idleMs: 6 * MIN, failure: "retry" })).toEqual({ every: 15000 });
    expect(pollPlan({ idleMs: STOP_AFTER_MS, failure: "retry" })).toEqual({ stop: "idle" });
  });

  it("stops when the server refuses the read (it would answer the same again)", () => {
    expect(pollPlan({ idleMs: 0, failure: "stop" })).toEqual({ stop: "failed" });
    expect(pollPlan({ idleMs: 0, phase: "notes", failure: "stop" })).toEqual({ stop: "failed" });
  });

  it("a read that worked clears the failure", () => {
    expect(pollPlan({ idleMs: 0, failure: null })).toEqual({ every: 2000 });
  });
});
