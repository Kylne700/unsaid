import { describe, expect, it } from "vitest";

import { FRIENDLY, friendlyError, isRetryable } from "./friendly-error";

const TOKEN = "kT9xQ2mV7pLw4RzN8aYb1cDe5FgHjUsX";
const TYPED = "my private note about Zeta pricing";

/** What the framework attaches to a failed call: status, errorCode and the server's own text, which can repeat the request. */
const failed = (status: number | undefined, errorCode: string | undefined, text: string) =>
  Object.assign(new Error(`Action x returned ${status}: ${text}`), { status, errorCode, actionMessage: text });

const hostile = `Invalid action parameters - code: Too small: expected string to have >=4 characters. Received: {"code":"ABC","token":"${TOKEN}","text":"${TYPED}"}`;

describe("friendlyError", () => {
  const values = Object.values(FRIENDLY) as string[];

  it("only ever returns one of the fixed sentences, never typed text, a token or validation output", () => {
    const cases: unknown[] = [
      failed(400, undefined, hostile),
      failed(400, "invalid", hostile),
      failed(404, "not_found", hostile),
      failed(403, "forbidden", hostile),
      failed(409, "bad_phase", hostile),
      failed(409, "conflict", hostile),
      failed(408, undefined, hostile),
      failed(429, "rate_limited", hostile),
      failed(500, "action_failed", hostile),
      failed(502, undefined, hostile),
      failed(418, "teapot", hostile),
      new Error(`Action save-notes failed: ${hostile}`),
      new Error(hostile),
      hostile,
      { actionMessage: hostile },
      null,
      undefined,
    ];
    for (const c of cases) {
      for (const about of ["action", "open", "join"] as const) {
        const out = friendlyError(c, about);
        expect(values, `${JSON.stringify(c)} / ${about}`).toContain(out);
        for (const secret of [TOKEN, TYPED, "ABC", "Invalid action", "Received", "{", "}", "token"]) expect(out).not.toContain(secret);
      }
    }
  });

  it("says what happened in plain words", () => {
    expect(friendlyError(new Error("Action get-room failed: Failed to fetch"))).toBe(FRIENDLY.offline);
    expect(friendlyError(failed(408, undefined, ""))).toBe(FRIENDLY.slow);
    expect(friendlyError(failed(429, undefined, ""))).toBe(FRIENDLY.busy);
    expect(friendlyError(failed(500, "action_failed", ""))).toBe(FRIENDLY.server);
    expect(friendlyError(failed(400, undefined, hostile))).toBe(FRIENDLY.invalid);
    expect(friendlyError(failed(409, "bad_phase", ""))).toBe(FRIENDLY.moved);
    expect(friendlyError(failed(403, "forbidden", ""))).toBe(FRIENDLY.forbidden);
    expect(friendlyError(failed(409, "conflict", ""))).toBe(FRIENDLY.conflict);
    expect(friendlyError(failed(409, "conflict", FRIENDLY.mergeRefused))).toBe(FRIENDLY.mergeRefused);
    expect(friendlyError(failed(409, "conflict", `${FRIENDLY.mergeRefused} ${TYPED}`))).toBe(FRIENDLY.conflict);
    expect(friendlyError(new TypeError("x is not a function"))).toBe(FRIENDLY.other);
  });

  it("odd room links read as an unknown room, whatever the server said", () => {
    expect(friendlyError(failed(400, undefined, hostile), "open")).toBe(FRIENDLY.notFound);
    expect(friendlyError(failed(404, "not_found", "Room not found. Check the code."), "open")).toBe(FRIENDLY.notFound);
    expect(friendlyError(failed(403, "forbidden", ""), "open")).toBe(FRIENDLY.notFound);
    expect(friendlyError(failed(500, "action_failed", ""), "open")).toBe(FRIENDLY.server);
  });

  it("only no-answer, timeout, too-many-tries and server faults are worth asking again", () => {
    for (const s of [undefined, 408, 429, 500, 502, 503]) expect(isRetryable(failed(s, undefined, "")), String(s)).toBe(true);
    for (const s of [400, 403, 404, 409]) expect(isRetryable(failed(s, undefined, "")), String(s)).toBe(false);
    expect(isRetryable(null)).toBe(true);
  });

  it("joining: a taken name or full room and a room past the notes phase get their own sentence", () => {
    expect(friendlyError(failed(409, "conflict", ""), "join")).toBe(FRIENDLY.nameTaken);
    expect(friendlyError(failed(409, "bad_phase", ""), "join")).toBe(FRIENDLY.closed);
    expect(friendlyError(failed(400, "invalid", ""), "join")).toBe(FRIENDLY.invalid);
  });
});
