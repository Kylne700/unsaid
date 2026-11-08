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
import { assertNoStandardKey, BUSY, CHAT_TIMEOUT_MS, chatEngine, completeForSeat, ENGINE_NAME, GEMINI_MODEL, guardedChatEngine, MAX_OUTPUT_TOKENS, NOT_ANSWERING, NOT_IN_A_ROOM, NOTHING_TO_ADD, OUT_OF_QUOTA, quotaFetch, SAVED_NO_SUMMARY } from "./gemini";
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

const SKIP = "skip_thought_signature_validator";
const asOpts = (messages: unknown) => ({ systemPrompt: "s", messages, tools: [] }) as unknown as Partial<EngineStreamOptions>;
const toolCall = (name: string, extra: Record<string, unknown> = {}) => ({ functionCall: { name, args: { a: 1 } }, ...extra });
// A chat turn that ran a tool: the member's message, the model's tool call, and the tool's result that the next model call must read.
const toolTurn = (isError = false) => [
  { role: "user", content: [{ type: "text", text: "Please draft cards from my notes." }] },
  { role: "assistant", content: [{ type: "tool-call", id: "call_1", name: "extract-cards", input: {} }] },
  { role: "user", content: [{ type: "tool-result", toolCallId: "call_1", toolName: "extract-cards", toolInput: "{}", content: '{"saved":4}', isError }] },
];

describe("quotaFetch: the thought signature on a replayed tool call", () => {
  /** What the network gets when `init` goes through quotaFetch for one seat. */
  async function sendThrough(bucket: string, init?: RequestInit) {
    const got: (RequestInit | undefined)[] = [];
    vi.stubGlobal("fetch", async (_input: unknown, i?: RequestInit) => {
      got.push(i);
      return new Response("{}");
    });
    await quotaFetch(bucket)("https://generativelanguage.googleapis.com/v1beta/models/x:streamGenerateContent?alt=sse", init);
    return got[0];
  }

  it("adds the dummy to each functionCall part that has none, and leaves a real signature and everything else as it was", async () => {
    const s = await seat();
    const body = {
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [toolCall("one"), toolCall("two", { thoughtSignature: "REAL-SIGNATURE" }), { text: "t" }] },
        { role: "user", parts: [{ functionResponse: { name: "one", response: { ok: true } } }] },
      ],
      generationConfig: { maxOutputTokens: 9 },
    };
    const sent = await sendThrough(s.bucket, { method: "POST", headers: { "x-goog-api-key": "k" }, body: JSON.stringify(body) });
    const expected = structuredClone(body);
    (expected.contents[1]!.parts[0] as Record<string, unknown>).thoughtSignature = SKIP;
    expect(JSON.parse(String(sent?.body))).toEqual(expected);
    expect(sent?.method).toBe("POST");
    expect(sent?.headers).toEqual({ "x-goog-api-key": "k" });
  });

  it("sends everything else exactly as it came: no functionCall, an odd shape, not JSON, no body", async () => {
    const s = await seat();
    const bodies = [
      JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
      JSON.stringify({ contents: [{ role: "model", parts: [toolCall("one", { thoughtSignature: "REAL" })] }] }),
      JSON.stringify({ contents: "nope" }),
      JSON.stringify({ contents: [null, { parts: 5 }, { parts: [null, 3, "x"] }] }),
      JSON.stringify([1, 2]),
      "null",
      "not json {",
      "",
    ];
    for (const body of bodies) {
      const init = { method: "POST", body };
      expect(await sendThrough(s.bucket, init)).toBe(init); // the very same request, not a copy
    }
    const noBody = { method: "GET" };
    expect(await sendThrough(s.bucket, noBody)).toBe(noBody);
    expect(await sendThrough(s.bucket, undefined)).toBeUndefined();
    const bytes = { method: "POST", body: new Uint8Array([1, 2, 3]) };
    expect(await sendThrough(s.bucket, bytes)).toBe(bytes);
  });
});

describe("a tool turn through the real engine (stubbed network that refuses like the API)", () => {
  /** The API answers HTTP 400 to a replayed functionCall part without a thoughtSignature, and streams a text answer otherwise. */
  function apiLike() {
    const sent: { contents: { parts: Record<string, unknown>[] }[] }[] = [];
    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      sent.push(body);
      if (body.contents.some((c: { parts: Record<string, unknown>[] }) => c.parts.some((p) => p.functionCall && !p.thoughtSignature))) {
        const error = { code: 400, message: "Function call is missing a thought_signature in functionCall parts.", status: "INVALID_ARGUMENT" };
        return new Response(JSON.stringify({ error }), { status: 400, headers: { "content-type": "application/json" } });
      }
      const chunk = { candidates: [{ content: { role: "model", parts: [{ text: "FROM-GEMINI" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 } };
      return new Response(`data: ${JSON.stringify(chunk)}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    return sent;
  }

  it("ends with the model's own text after the tool result, not a fixed sentence", async () => {
    vi.stubEnv("UNSAID_GEMINI_API_KEY", "test-key-not-real");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const sent = apiLike();
    const s = await seat();
    expect(await asSeat(s, () => textOf(chatEngine, asOpts(toolTurn())))).toBe("FROM-GEMINI");
    expect(sent.length).toBe(1);
    expect(sent[0]!.contents[1]!.parts[0]).toMatchObject({ functionCall: { name: "extract-cards" }, thoughtSignature: SKIP });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("answers a turn that has no tool call as before: nothing added", async () => {
    vi.stubEnv("UNSAID_GEMINI_API_KEY", "test-key-not-real");
    const sent = apiLike();
    const s = await seat();
    expect(await asSeat(s, () => textOf(chatEngine, asOpts([toolTurn()[0]])))).toBe("FROM-GEMINI");
    expect(JSON.stringify(sent[0])).not.toContain("thoughtSignature");
  });
});

describe("the chat engine when a call fails after a tool ran", () => {
  const silenced = () => vi.spyOn(console, "error").mockImplementation(() => {});
  const throwing = (text: string) =>
    modelThat(async function* () {
      throw new Error(text);
    });

  it("says the change is saved, not that the AI is silent, and logs why", async () => {
    const log = silenced();
    const s = await seat();
    expect(await asSeat(s, () => textOf(throwing("model said no"), asOpts(toolTurn())))).toBe(SAVED_NO_SUMMARY);
    const reported = modelThat(async function* () {
      yield { type: "stop", reason: "error", error: "Function call is missing a thought_signature", statusCode: 400 };
    });
    expect(await asSeat(s, () => textOf(reported, asOpts(toolTurn())))).toBe(SAVED_NO_SUMMARY);
    expect(log.mock.calls).toEqual([["[unsaid-gemini]", "model said no"], ["[unsaid-gemini]", "HTTP 400: Function call is missing a thought_signature"]]);
    log.mockRestore();
  });

  it("keeps the old sentence when the last message is the member's, when the tool itself failed, or when the run has no messages", async () => {
    const log = silenced();
    const s = await seat();
    for (const opts of [asOpts([toolTurn()[0]]), asOpts(toolTurn(true)), asOpts([]), {}]) {
      expect(await asSeat(s, () => textOf(throwing("x"), opts))).toBe(NOT_ANSWERING);
    }
    log.mockRestore();
  });

  it("keeps the busy sentence when a 429 started the pause during that call", async () => {
    const log = silenced();
    const s = await seat();
    const engine = modelThat(async function* () {
      pauseLlm(400);
      yield { type: "stop", reason: "error", error: PROVIDER_DETAIL, statusCode: 429, providerRetryable: true };
    });
    expect(await asSeat(s, () => textOf(engine, asOpts(toolTurn())))).toBe(BUSY);
    await sleep(450);
    log.mockRestore();
  });

  it("logs the reason cut short and without the key, while the member reads only the fixed sentence", async () => {
    vi.stubEnv("UNSAID_GEMINI_API_KEY", "test-key-not-real");
    const log = silenced();
    const s = await seat();
    const engine = modelThat(async function* () {
      yield { type: "stop", reason: "error", error: `bad key test-key-not-real ${"x".repeat(500)}`, statusCode: 403 };
    });
    const events = await asSeat(s, () => eventsOf(engine));
    expect(log).toHaveBeenCalledTimes(1);
    const [tag, reason] = log.mock.calls[0] as [string, string];
    expect(tag).toBe("[unsaid-gemini]");
    expect(reason).toMatch(/^HTTP 403: bad key \[key\] x+$/);
    expect(reason.length).toBe(300);
    expect(JSON.stringify(events)).not.toMatch(/test-key-not-real|HTTP 403|bad key/);
    log.mockRestore();
  });

  it("logs nothing when the member pressed Stop", async () => {
    const log = silenced();
    const s = await seat();
    const stop = new AbortController();
    const engine = modelThat(async function* (o) {
      await new Promise((resolve) => o.abortSignal.addEventListener("abort", resolve));
      throw new Error("aborted");
    });
    const run = asSeat(s, () => eventsOf(engine, { abortSignal: stop.signal }));
    await sleep(50);
    stop.abort();
    await run;
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
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
