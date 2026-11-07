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
import { assertNoStandardKey, BUSY, CHAT_TIMEOUT_MS, chatEngine, completeForSeat, ENGINE_NAME, GEMINI_MODEL, guardedChatEngine, MAX_OUTPUT_TOKENS, NOT_ANSWERING, NOT_IN_A_ROOM, NOTHING_TO_ADD, OUT_OF_QUOTA } from "./gemini";
import { guestOwner, seatBucket } from "./guest";
import { MEMBER_DAILY_CAP, pauseLlm } from "./llm-quota";

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
const eventsOf = async (engine: AgentEngine, opts: Partial<EngineStreamOptions> = {}) => {
  const out: EngineEvent[] = [];
  for await (const e of engine.stream({ model: "gemini-2.5-pro", maxOutputTokens: 100_000, abortSignal: new AbortController().signal, ...opts } as EngineStreamOptions)) out.push(e);
  return out;
};
const textOf = async (engine: AgentEngine, opts: Partial<EngineStreamOptions> = {}) =>
  (await eventsOf(engine, opts)).reduce((text, e) => (e.type === "text-delta" ? text + e.text : text), "");

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

// A model that misbehaves in a chosen way. The engine under test sits in front of it, as in the app.
const asSeat = <T>(s: { owner: string }, run: () => Promise<T>) => runWithRequestContext({ userEmail: s.owner, agentRunAnonymous: true }, run);
const modelThat = (stream: (opts: EngineStreamOptions) => AsyncGenerator<EngineEvent>, timeoutMs?: number) =>
  guardedChatEngine(() => ({ name: "fake", label: "Fake", capabilities: {}, stream }) as unknown as AgentEngine, undefined, timeoutMs);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PROVIDER_DETAIL = "RESOURCE_EXHAUSTED key=AIza-secret-123 quota metric generate_content_free_tier";

describe("the chat engine when the model misbehaves", () => {
  it("gives the model 40 s, under the 60 s limit of the free hosting", () => {
    expect(CHAT_TIMEOUT_MS).toBe(40_000);
  });

  it("ends a model that never answers with a fixed sentence, and cancels the request", async () => {
    const s = await seat();
    let sent: AbortSignal | undefined;
    const engine = modelThat(async function* (o) {
      sent = o.abortSignal;
      await new Promise(() => {}); // an engine that ignores the abort and never ends
    }, 80);
    const started = Date.now();
    expect(await asSeat(s, () => textOf(engine))).toBe(NOT_ANSWERING);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(sent?.aborted).toBe(true);
  });

  it("keeps what the model said before it went silent, and closes the message with the sentence", async () => {
    const s = await seat();
    const engine = modelThat(async function* () {
      yield { type: "text-delta", text: "Part one." };
      await new Promise(() => {});
    }, 80);
    const events = await asSeat(s, () => eventsOf(engine));
    expect(events.filter((e) => e.type === "text-delta").map((e) => (e as { text: string }).text)).toEqual(["Part one.", `\n\n${NOT_ANSWERING}`]);
    expect(events.find((e) => e.type === "assistant-content")).toEqual({ type: "assistant-content", parts: [{ type: "text", text: `Part one.\n\n${NOT_ANSWERING}` }] });
    expect(events[events.length - 1]).toEqual({ type: "stop", reason: "end_turn" });
  });

  it("says nothing more when the member pressed Stop", async () => {
    const s = await seat();
    const stop = new AbortController();
    const engine = modelThat(async function* (o) {
      yield { type: "text-delta", text: "Hello" };
      await new Promise((resolve) => o.abortSignal.addEventListener("abort", resolve));
      throw new Error("aborted");
    });
    const run = asSeat(s, () => eventsOf(engine, { abortSignal: stop.signal }));
    await sleep(50);
    stop.abort();
    expect((await run).map((e) => e.type)).toEqual(["text-delta"]);
  });

  it("turns a provider error, thrown or reported, into a fixed sentence that repeats none of it", async () => {
    const s = await seat();
    const reported = modelThat(async function* () {
      yield { type: "stop", reason: "error", error: PROVIDER_DETAIL, statusCode: 500, providerRetryable: true };
    });
    const thrown = modelThat(async function* () {
      throw new Error(PROVIDER_DETAIL);
    });
    for (const engine of [reported, thrown]) {
      const events = await asSeat(s, () => eventsOf(engine));
      expect(await asSeat(s, () => textOf(engine))).toBe(NOT_ANSWERING);
      expect(JSON.stringify(events)).not.toMatch(/RESOURCE_EXHAUSTED|AIza|secret|quota metric/);
      expect(events[events.length - 1]).toEqual({ type: "stop", reason: "end_turn" }); // a normal end: the framework does not retry it for minutes
    }
  });

  it("says the AI is busy when a 429 started the pause during the call, and never the day's allowance", async () => {
    const s = await seat();
    const engine = modelThat(async function* () {
      pauseLlm(400); // what quotaFetch does on a 429
      yield { type: "stop", reason: "error", error: PROVIDER_DETAIL, statusCode: 429, providerRetryable: true };
    });
    const said = await asSeat(s, () => textOf(engine));
    expect(said).toBe(BUSY);
    expect(said).not.toMatch(/allowance|tomorrow/);
    await sleep(450);
  });

  it("says the AI is busy while the pause runs, without calling the model, and answers again when it ends", async () => {
    const s = await seat();
    const { calls, engine } = fakeModel();
    pauseLlm(400);
    const said = await asSeat(s, () => textOf(engine));
    expect(said).toBe(BUSY);
    expect(said).not.toMatch(/allowance|tomorrow/);
    expect(calls).toEqual([]);
    await sleep(450);
    expect(await asSeat(s, () => textOf(engine))).toBe("FROM-MODEL");
  });

  it("says the day's allowance is used up only when a cap is really reached", async () => {
    const s = await seat();
    await exhaust(s.bucket);
    const engine = modelThat(async function* () {
      yield { type: "text-delta", text: "never reached" };
    });
    expect(await asSeat(s, () => textOf(engine))).toBe(OUT_OF_QUOTA);
    expect(OUT_OF_QUOTA).toMatch(/allowance for today/);
    expect(BUSY).not.toMatch(/allowance|today|tomorrow/);
  });

  it("answers an empty reply with a fixed sentence, whether it has no text or only blanks", async () => {
    const s = await seat();
    const none = modelThat(async function* () {
      yield { type: "assistant-content", parts: [] };
      yield { type: "stop", reason: "end_turn" };
    });
    const blanks = modelThat(async function* () {
      yield { type: "text-delta", text: "  " };
      yield { type: "text-delta", text: "\n" };
      yield { type: "assistant-content", parts: [{ type: "text", text: "  \n" }] };
      yield { type: "stop", reason: "end_turn" };
    });
    for (const engine of [none, blanks]) {
      const events = await asSeat(s, () => eventsOf(engine));
      expect(events[events.length - 3]).toEqual({ type: "text-delta", text: NOTHING_TO_ADD });
      expect(events[events.length - 2]).toEqual({ type: "assistant-content", parts: [{ type: "text", text: NOTHING_TO_ADD }] });
      expect(events[events.length - 1]).toEqual({ type: "stop", reason: "end_turn" });
    }
  });

  it("passes a good answer through unchanged, closing events last, and a tool call counts as an answer", async () => {
    const s = await seat();
    const answer: EngineEvent[] = [
      { type: "text-delta", text: "Two " },
      { type: "text-delta", text: "facts." },
      { type: "usage", inputTokens: 3, outputTokens: 2 },
      { type: "assistant-content", parts: [{ type: "text", text: "Two facts." }] },
      { type: "stop", reason: "end_turn" },
    ];
    expect(await asSeat(s, () => eventsOf(modelThat(async function* () { yield* answer; })))).toEqual(answer);
    const tool: EngineEvent[] = [
      { type: "tool-call", id: "t1", name: "view-screen", input: {} },
      { type: "assistant-content", parts: [{ type: "tool-call", id: "t1", name: "view-screen", input: {} }] },
      { type: "stop", reason: "tool_use" },
    ];
    expect(await asSeat(s, () => eventsOf(modelThat(async function* () { yield* tool; })))).toEqual(tool);
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

// Last on purpose: a real 429 starts the 60 s pause in this process, and the tests above must not see it.
describe("a real 429 from the model (stubbed network)", () => {
  it("starts the pause, and the chat says the AI is busy, in plain words and without the provider's text", async () => {
    vi.stubEnv("UNSAID_GEMINI_API_KEY", "test-key-not-real");
    let requests = 0;
    vi.stubGlobal("fetch", async () => {
      requests += 1;
      return new Response(JSON.stringify({ error: { code: 429, message: PROVIDER_DETAIL, status: "RESOURCE_EXHAUSTED" } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "30" } }); // a Retry-After must not hold the chat for 30 s
    });
    const s = await seat();
    const opts = { systemPrompt: "s", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], tools: [] };
    const started = Date.now();
    const events = await asSeat(s, () => eventsOf(chatEngine, opts as unknown as Partial<EngineStreamOptions>));
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(events.filter((e) => e.type === "text-delta").map((e) => (e as { text: string }).text)).toEqual([BUSY]);
    expect(JSON.stringify(events)).not.toMatch(/RESOURCE_EXHAUSTED|AIza|secret|allowance/);
    expect(requests).toBe(1); // the SDK's one retry was refused by the pause: the model is not asked again
    // The next message in the same minute gets the same sentence without any request.
    expect(await asSeat(s, () => textOf(chatEngine, opts as unknown as Partial<EngineStreamOptions>))).toBe(BUSY);
    expect(requests).toBe(1);
  }, 20_000);
});
