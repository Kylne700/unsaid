// The only way into Gemini: no bound seat or no quota means no model call. Gemini itself is never reached here.
import type { AgentEngine, EngineEvent, EngineStreamOptions } from "@agent-native/core/agent/engine";
import { getAgentEngineEntry } from "@agent-native/core/agent/engine";
import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import createRoom from "../../actions/create-room";
import { MIGRATIONS } from "../db/migrations";
import { loadRoom } from "../db/store";
import { memberByToken } from "../domain/room";
import { must } from "../domain/test-helpers";
import { assertNoStandardKey, chatEngine, completeForSeat, ENGINE_NAME, GEMINI_MODEL, guardedChatEngine, MAX_OUTPUT_TOKENS, NOT_IN_A_ROOM, OUT_OF_QUOTA } from "./gemini";
import { guestOwner, seatBucket } from "./guest";
import { MEMBER_DAILY_CAP } from "./llm-quota";

beforeAll(async () => {
  for (const m of MIGRATIONS) await getDbExec().execute(m.sql as string);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const today = () => new Date().toISOString().slice(0, 10);
async function seat() {
  const made = await createRoom.run({ question: "Lunch?", options: ["Soup", "Salad"], name: "Ana" }, { caller: "http" });
  const room = must(await loadRoom(made.code));
  const me = must(memberByToken(room, made.token));
  return { owner: guestOwner(room, me), bucket: seatBucket({ room, me }) };
}
const exhaust = (bucket: string) => getDbExec().execute({ sql: "INSERT INTO unsaid_llm_usage (day, bucket, count) VALUES (?, ?, ?)", args: [today(), bucket, MEMBER_DAILY_CAP] });

/** A stand-in model that records every call it gets. */
function fakeModel() {
  const calls: { bucket: string; opts: EngineStreamOptions }[] = [];
  const make = (bucket: string) =>
    ({
      name: "fake",
      label: "Fake",
      capabilities: {},
      async *stream(opts: EngineStreamOptions): AsyncGenerator<EngineEvent> {
        calls.push({ bucket, opts });
        yield { type: "text-delta", text: "FROM-MODEL" };
        yield { type: "stop", reason: "end_turn" };
      },
    }) as unknown as AgentEngine;
  return { calls, engine: guardedChatEngine(make, make("meta")) };
}
const textOf = async (engine: AgentEngine, opts: Partial<EngineStreamOptions> = {}) => {
  let text = "";
  for await (const e of engine.stream({ model: "gemini-2.5-pro", maxOutputTokens: 100_000, ...opts } as EngineStreamOptions)) if (e.type === "text-delta") text += e.text;
  return text;
};

describe("the chat engine", () => {
  it("answers with a fixed text, without calling the model, unless the run is a guest bound to a seat", async () => {
    const s = await seat();
    const { calls, engine } = fakeModel();
    expect(await textOf(engine)).toBe(NOT_IN_A_ROOM);
    expect(await runWithRequestContext({ userEmail: s.owner }, () => textOf(engine))).toBe(NOT_IN_A_ROOM); // a signed-in session
    expect(await runWithRequestContext({ userEmail: "someone@example.com", agentRunAnonymous: true }, () => textOf(engine))).toBe(NOT_IN_A_ROOM);
    expect(calls.filter((c) => c.bucket !== "meta")).toEqual([]);
  });

  it("calls the model for a bound seat, charged to that seat, always with GEMINI_MODEL and capped output", async () => {
    const s = await seat();
    const { calls, engine } = fakeModel();
    expect(await runWithRequestContext({ userEmail: s.owner, agentRunAnonymous: true }, () => textOf(engine))).toBe("FROM-MODEL");
    expect(calls.map((c) => [c.bucket, c.opts.model, c.opts.maxOutputTokens])).toEqual([[s.bucket, GEMINI_MODEL, MAX_OUTPUT_TOKENS]]);
  });

  it("answers with a fixed text, without calling the model, once the seat's daily cap is used", async () => {
    const s = await seat();
    await exhaust(s.bucket);
    const { calls, engine } = fakeModel();
    expect(await runWithRequestContext({ userEmail: s.owner, agentRunAnonymous: true }, () => textOf(engine))).toBe(OUT_OF_QUOTA);
    expect(calls).toEqual([]);
  });

  it("is what the registered engine name resolves to, and holds no key of its own", () => {
    expect(getAgentEngineEntry(ENGINE_NAME)?.create({})).toBe(chatEngine);
    expect(chatEngine.name).toBe(ENGINE_NAME);
    expect((chatEngine as unknown as { apiKey?: string }).apiKey).toBe("");
  });
});

describe("completeForSeat (card extraction)", () => {
  const prompt = { systemPrompt: "s", input: "i", timeoutMs: 2_000 };

  it("makes no request without a key or once the seat's cap is used", async () => {
    const net = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", net);
    const s = await seat();
    vi.stubEnv("UNSAID_GEMINI_API_KEY", "");
    expect(await completeForSeat(s.bucket, prompt)).toBeNull();
    vi.stubEnv("UNSAID_GEMINI_API_KEY", "test-key-not-real");
    await exhaust(s.bucket);
    expect(await completeForSeat(s.bucket, prompt)).toBeNull();
    expect(net).not.toHaveBeenCalled();
  });

  it("charges every real request to the seat and the app, and asks for GEMINI_MODEL with the key in a header", async () => {
    const seen: { url: string; key: string | null }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input instanceof Request ? input.url : input), key: new Headers(init?.headers).get("x-goog-api-key") });
      return new Response(JSON.stringify({ error: { code: 400, message: "stub", status: "INVALID_ARGUMENT" } }), { status: 400, headers: { "content-type": "application/json" } });
    });
    vi.stubEnv("UNSAID_GEMINI_API_KEY", "test-key-not-real");
    const s = await seat();
    await expect(completeForSeat(s.bucket, prompt)).rejects.toThrow();
    expect(seen.length).toBeGreaterThan(0);
    for (const r of seen) {
      expect(r.url).toContain(`/models/${GEMINI_MODEL}:`);
      expect(r.url).not.toContain("test-key-not-real");
      expect(r.key).toBe("test-key-not-real");
    }
    const count = async (bucket: string) => Number((await getDbExec().execute({ sql: "SELECT count FROM unsaid_llm_usage WHERE day = ? AND bucket = ?", args: [today(), bucket] })).rows[0]?.count ?? 0);
    expect(await count(s.bucket)).toBe(seen.length);
  });
});

describe("assertNoStandardKey", () => {
  it("refuses the framework's standard Google key names, so the framework never finds a key", () => {
    expect(() => assertNoStandardKey({ GOOGLE_GENERATIVE_AI_API_KEY: "x" })).toThrow(/UNSAID_GEMINI_API_KEY/);
    expect(() => assertNoStandardKey({ GEMINI_API_KEY: "x" })).toThrow();
    expect(() => assertNoStandardKey({ GEMINI_API_KEY: "  ", UNSAID_GEMINI_API_KEY: "x" })).not.toThrow();
  });
});
