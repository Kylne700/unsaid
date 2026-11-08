// The only way into Gemini: no bound seat or no quota means no model call. Gemini itself is never reached here.
import type { AgentEngine, EngineEvent, EngineStreamOptions } from "@agent-native/core/agent/engine";
import { getAgentEngineEntry } from "@agent-native/core/agent/engine";
import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import createRoom from "../../actions/create-room";
import { MIGRATIONS } from "../db/migrations";
import { loadRoom } from "../db/store";
import { memberByToken } from "../domain/room";
import { must } from "../domain/test-helpers";
import { assertNoStandardKey, BUSY, CHAT_TIMEOUT_MS, chatEngine, completeForSeat, ENGINE_NAME, GEMINI_MODEL, guardedChatEngine, MAX_OUTPUT_TOKENS, NOT_ANSWERING, NOT_IN_A_ROOM, NOTHING_TO_ADD, OUT_OF_QUOTA, quotaFetch, SAVED_NO_SUMMARY, SUMMARY_PROMPT } from "./gemini";
import { guestOwner, seatBucket } from "./guest";
import { MEMBER_DAILY_CAP, pauseLlm } from "./llm-quota";

beforeAll(async () => {
  for (const m of MIGRATIONS) await getDbExec().execute(m.sql as string);
});
// No test may reach Gemini: no key, no network. A test that needs either stubs it itself.
beforeEach(() => {
  vi.stubEnv("UNSAID_GEMINI_API_KEY", "");
  vi.stubGlobal("fetch", async () => {
    throw new Error("no network in these tests");
  });
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
const ASKED = "Please draft cards from my notes.";
// A chat turn that ran tools: the member's message, the model's tool calls, and the tools' results that the next model call must read.
const toolTurn = (isError = false, names = ["extract-cards"]) => [
  { role: "user", content: [{ type: "text", text: ASKED }] },
  { role: "assistant", content: names.map((name, i) => ({ type: "tool-call", id: `call_${i}`, name, input: {} })) },
  { role: "user", content: names.map((name, i) => ({ type: "tool-result", toolCallId: `call_${i}`, toolName: name, toolInput: "{}", content: name === "get-room" ? '{"phase":"cards"}' : '{"saved":4}', isError })) },
];

// Gemini's stream as the network gives it: each string is one chunk.
const enc = new TextEncoder();
const sseOf = (...chunks: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const s of chunks) c.enqueue(enc.encode(s));
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
const textChunk = (text: string) => `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 } })}\r\n\r\n`;
// What the API sends when the model wrote a broken tool call: no content, the reason, and a message that can quote the room.
const MALFORMED = `data: ${JSON.stringify({ candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL", finishMessage: "Malformed function call: CANARY-room-note", index: 0 }], usageMetadata: { promptTokenCount: 5, totalTokenCount: 5 } })}\r\n\r\n`;
/** `s` as two chunks, cut in the middle of `word`. */
const splitIn = (s: string, word: string): [string, string] => {
  const at = s.indexOf(word) + Math.floor(word.length / 2);
  return [s.slice(0, at), s.slice(at)];
};

describe("quotaFetch: why a call ended, in the server log", () => {
  /** The answer quotaFetch gives for `res`, read to the end as the SDK reads it, and what it logged meanwhile. */
  async function through(res: Response) {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => res);
    const s = await seat();
    const got = await quotaFetch(s.bucket)("https://generativelanguage.googleapis.com/v1beta/models/x:streamGenerateContent?alt=sse", { method: "POST", body: "{}" });
    const bytes = new Uint8Array(await got.arrayBuffer());
    const calls = [...log.mock.calls];
    log.mockRestore();
    return { got, bytes, calls };
  }

  it("passes a stream on byte for byte and logs an abnormal reason once, even cut across two chunks, and never the text around it", async () => {
    const chunks = [textChunk("hello"), ...splitIn(MALFORMED, "MALFORMED_FUNCTION_CALL"), MALFORMED]; // the same reason twice: one line
    const { bytes, calls } = await through(sseOf(...chunks));
    expect(bytes).toEqual(enc.encode(chunks.join("")));
    expect(calls).toEqual([["[unsaid-gemini]", "finish MALFORMED_FUNCTION_CALL"]]);
    expect(JSON.stringify(calls)).not.toContain("CANARY");
  });

  it("logs nothing for a normal end (STOP, MAX_TOKENS), and finds an abnormal reason written with spaces", async () => {
    expect((await through(sseOf('data: {"candidates": [{"finishReason": "STOP", "index": 0}]}\r\n\r\n', 'data: {"candidates":[{"finishReason":"MAX_TOKENS"}]}\r\n\r\n'))).calls).toEqual([]);
    expect((await through(sseOf('data: {"candidates": [{"finishReason" : "SAFETY", "index": 0}]}\r\n\r\n'))).calls).toEqual([["[unsaid-gemini]", "finish SAFETY"]]);
  });

  it("reads a JSON answer from a copy and hands on the answer itself, and leaves anything but a 200 alone", async () => {
    const body = { promptFeedback: { blockReason: "PROHIBITED_CONTENT" } };
    const blocked = new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json; charset=UTF-8" } });
    const json = await through(blocked);
    expect(json.got).toBe(blocked);
    expect(JSON.parse(new TextDecoder().decode(json.bytes))).toEqual(body);
    expect(json.calls).toEqual([["[unsaid-gemini]", "finish PROHIBITED_CONTENT"]]);
    const failed = new Response('{"candidates":[{"finishReason":"OTHER"}]}', { status: 500, headers: { "content-type": "application/json" } });
    const other = await through(failed);
    expect(other.got).toBe(failed);
    expect(other.calls).toEqual([]);
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

  it("after a broken tool call (MALFORMED_FUNCTION_CALL) shows the model's summary from one call without tools, and logs only reason words", async () => {
    vi.stubEnv("UNSAID_GEMINI_API_KEY", "test-key-not-real");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return sent.length === 1 ? sseOf(...splitIn(MALFORMED, "MALFORMED_FUNCTION_CALL")) : sseOf(textChunk("I drafted 4 cards from your notes."));
    });
    const s = await seat();
    expect(await asSeat(s, () => textOf(chatEngine, asOpts(toolTurn())))).toBe("I drafted 4 cards from your notes.");
    expect(sent.length).toBe(2);
    expect(JSON.stringify(sent[0])).toContain("functionResponse");
    expect(JSON.stringify(sent[1])).not.toMatch(/functionDeclarations|functionCall|functionResponse/);
    expect(log.mock.calls).toEqual([["[unsaid-gemini]", "finish MALFORMED_FUNCTION_CALL"], ["[unsaid-gemini]", "model error; summary used"]]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("CANARY");
    log.mockRestore();
  });
});

describe("the chat engine when a call fails after a tool ran", () => {
  const silenced = () => vi.spyOn(console, "error").mockImplementation(() => {});
  const throwing = (text: string) =>
    modelThat(async function* () {
      throw new Error(text);
    });

  /** A key and a network for the summary call: each request body is kept, and `reply` answers it. */
  function summaryNet(reply: () => Response) {
    vi.stubEnv("UNSAID_GEMINI_API_KEY", "test-key-not-real");
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return reply();
    });
    return sent;
  }
  // The live failure: the call after the tools ends with an error stop and no text.
  const textless = () =>
    modelThat(async function* () {
      yield { type: "stop", reason: "error" };
    });

  it("shows the model's own summary when the call after the tools failed: one call without tools, the results as data", async () => {
    const log = silenced();
    const sent = summaryNet(() => sseOf(textChunk("  I drafted 4 cards from your notes.  ")));
    const s = await seat();
    const turn = toolTurn(false, ["get-room", "extract-cards"]);
    turn[0] = { role: "user", content: [{ type: "text", text: `${ASKED}\n\n<current-time>2026-11-08T09:00:00Z</current-time>` }] }; // the framework's block after the member's words
    expect(await asSeat(s, () => textOf(textless(), asOpts(turn)))).toBe("I drafted 4 cards from your notes.");
    expect(sent.length).toBe(1);
    const body = sent[0] as { contents: { parts: { text?: string }[] }[]; systemInstruction?: { parts: { text?: string }[] } };
    expect(body.contents.flatMap((c) => c.parts).map((p) => p.text ?? "").join("")).toBe(`<notes>\n${ASKED}\nget-room: {"phase":"cards"}\nextract-cards: {"saved":4}\n</notes>`);
    expect(body.systemInstruction?.parts.map((p) => p.text ?? "").join("")).toBe(SUMMARY_PROMPT);
    expect(JSON.stringify(body)).not.toMatch(/functionDeclarations|functionCall|functionResponse|current-time/);
    expect(log.mock.calls).toEqual([["[unsaid-gemini]", "model error; summary used"]]);
    log.mockRestore();
  });

  it("says the change is saved, not that the AI is silent, when the summary call fails too (an error, only blanks, no key), and logs why", async () => {
    const log = silenced();
    const s = await seat();
    const refused = () => new Response(JSON.stringify({ error: { code: 400, message: "bad request", status: "INVALID_ARGUMENT" } }), { status: 400, headers: { "content-type": "application/json" } });
    for (const reply of [refused, () => sseOf(textChunk("   "))]) {
      summaryNet(reply);
      expect(await asSeat(s, () => textOf(textless(), asOpts(toolTurn())))).toBe(SAVED_NO_SUMMARY);
    }
    vi.stubEnv("UNSAID_GEMINI_API_KEY", "");
    expect(await asSeat(s, () => textOf(throwing("model said no"), asOpts(toolTurn())))).toBe(SAVED_NO_SUMMARY);
    const reported = modelThat(async function* () {
      yield { type: "stop", reason: "error", error: "Function call is missing a thought_signature", statusCode: 400 };
    });
    expect(await asSeat(s, () => textOf(reported, asOpts(toolTurn())))).toBe(SAVED_NO_SUMMARY);
    expect(log.mock.calls.filter((c) => c[0] === "[unsaid-gemini]")).toEqual([
      ["[unsaid-gemini]", "model error; summary failed"],
      ["[unsaid-gemini]", "model error; summary failed"],
      ["[unsaid-gemini]", "model said no; summary failed"],
      ["[unsaid-gemini]", "HTTP 400: Function call is missing a thought_signature; summary failed"],
    ]);
    log.mockRestore();
  });

  it("says nothing was saved when only tools that read had run, and that the change is saved when one of them wrote", async () => {
    const log = silenced();
    const s = await seat();
    expect(await asSeat(s, () => textOf(textless(), asOpts(toolTurn(false, ["get-room", "view-screen"]))))).toBe(NOT_ANSWERING);
    expect(await asSeat(s, () => textOf(textless(), asOpts(toolTurn(false, ["view-screen", "extract-cards"]))))).toBe(SAVED_NO_SUMMARY);
    log.mockRestore();
  });

  it("keeps the old sentence, with no summary call, when the last message is the member's, when the tool itself failed, or when the run has no messages", async () => {
    const log = silenced();
    const sent = summaryNet(() => sseOf(textChunk("never shown")));
    const s = await seat();
    for (const opts of [asOpts([toolTurn()[0]]), asOpts(toolTurn(true)), asOpts([]), {}]) {
      expect(await asSeat(s, () => textOf(throwing("x"), opts))).toBe(NOT_ANSWERING);
    }
    expect(sent).toEqual([]);
    expect(log.mock.calls.flat().join(" ")).not.toContain("summary");
    log.mockRestore();
  });

  it("tries no summary when the model ran out of time or had already spoken: the sentence, after its words", async () => {
    const log = silenced();
    const sent = summaryNet(() => sseOf(textChunk("never shown")));
    const s = await seat();
    const hangs = modelThat(async function* (o) {
      await new Promise((resolve) => o.abortSignal.addEventListener("abort", resolve));
    }, 80);
    expect(await asSeat(s, () => textOf(hangs, asOpts(toolTurn())))).toBe(SAVED_NO_SUMMARY);
    const spoke = modelThat(async function* () {
      yield { type: "text-delta", text: "Drafting now." };
      yield { type: "stop", reason: "error" };
    });
    expect(await asSeat(s, () => textOf(spoke, asOpts(toolTurn())))).toBe(`Drafting now.\n\n${SAVED_NO_SUMMARY}`);
    expect(sent).toEqual([]);
    expect(log.mock.calls.flat().join(" ")).not.toContain("summary");
    log.mockRestore();
  });

  it("keeps the busy sentence, with no summary call, when a 429 started the pause during that call", async () => {
    const log = silenced();
    summaryNet(() => sseOf(textChunk("never shown")));
    const s = await seat();
    const engine = modelThat(async function* () {
      pauseLlm(400);
      yield { type: "stop", reason: "error", error: PROVIDER_DETAIL, statusCode: 429, providerRetryable: true };
    });
    expect(await asSeat(s, () => textOf(engine, asOpts(toolTurn())))).toBe(BUSY);
    expect(log.mock.calls.flat().join(" ")).not.toContain("summary");
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
