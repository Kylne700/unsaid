// The only file that reads the Gemini key, and the only way into the model. Two callers: the chat agent
// (chatEngine, guests bound to a seat only) and card extraction (completeForSeat). Both take quota per real HTTP
// request (server/lib/llm-quota.ts) and always send GEMINI_MODEL, whatever a request asks for.
//
// The key lives in UNSAID_GEMINI_API_KEY, not in the framework's GOOGLE_GENERATIVE_AI_API_KEY: under the standard
// name the framework would also hand it to signed-in accounts, chat titles, embeddings and voice, with no seat check
// and no quota. Setting a standard Google key name is therefore refused at start.
import { createAISDKEngine, registerAgentEngine, type AgentEngine, type EngineEvent, type EngineStreamOptions } from "@agent-native/core/agent/engine";
import { completeText } from "@agent-native/core/server";
import { boundSeat, seatBucket } from "./guest";
import { hasLlmRoom, llmRoom, pauseLlm, takeLlmRequest, type LlmRoom } from "./llm-quota";

export const GEMINI_MODEL = "gemini-3.5-flash-lite";
/** The registered engine the chat runs on (selected in server/plugins/agent-native-email-branding.ts). */
export const ENGINE_NAME = "unsaid-gemini";
export const MAX_OUTPUT_TOKENS = 4096;
/** One chat answer gets this long in total: under the 60 s limit of the free hosting, far above a normal answer. */
export const CHAT_TIMEOUT_MS = 40_000;
const STANDARD_KEY_NAMES = ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"];

export function assertNoStandardKey(env: Record<string, string | undefined> = process.env): void {
  const set = STANDARD_KEY_NAMES.filter((k) => env[k]?.trim()); // guard:allow-env-credential -- presence check only: these names must stay unset so the framework never finds a key.
  if (set.length) throw new Error(`Unset ${set.join(", ")}: Unsaid reads its Gemini key from UNSAID_GEMINI_API_KEY only.`);
}
assertNoStandardKey();

const apiKey = () => process.env.UNSAID_GEMINI_API_KEY?.trim() ?? ""; // guard:allow-env-credential -- the app's own Gemini key; read only here, used only through the seat and quota checks below.
/** Whether a key is set (never the key itself). */
export const geminiConfigured = () => apiKey() !== "";

// Google's documented dummy for a replayed tool call's thought signature (the API answers HTTP 400 without one): the framework drops the real one, and @ai-sdk/google 3.0.141 swaps in this dummy itself, so this only keeps it if a provider update stops doing that.
// shortcut: the dummy drops the model's own reasoning context; capture real signatures from the stream if follow-up answers degrade
const SKIP_SIGNATURE = "skip_thought_signature_validator";

/** The request as it goes out: a JSON body gets the dummy on each functionCall part that has no signature; anything else is untouched. */
function withSignatures(init?: RequestInit): RequestInit | undefined {
  if (typeof init?.body !== "string") return init;
  let body: { contents?: { parts?: Record<string, unknown>[] }[] };
  try {
    body = JSON.parse(init.body);
  } catch {
    return init;
  }
  let changed = false;
  for (const content of Array.isArray(body?.contents) ? body.contents : []) {
    for (const part of Array.isArray(content?.parts) ? content.parts : []) {
      if (part?.functionCall && !part.thoughtSignature) {
        part.thoughtSignature = SKIP_SIGNATURE;
        changed = true;
      }
    }
  }
  return changed ? { ...init, body: JSON.stringify(body) } : init;
}

/** fetch for one quota bucket: every real request (retries included) takes a slot first; a 429 pauses all calls. */
export function quotaFetch(bucket: string): typeof fetch {
  return async (input, init) => {
    if (!(await takeLlmRequest(bucket))) throw new Error("unsaid_llm_quota: no request slot (429 pause or daily limit)");
    const res = await fetch(input, withSignatures(init));
    if (res.status !== 429) return res;
    pauseLlm(60_000);
    // The pause already refuses the SDK's retry, so a Retry-After header must not make it wait (up to a minute) to find that out.
    const headers = new Headers(res.headers);
    headers.delete("retry-after");
    headers.delete("retry-after-ms");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}

/** A Gemini engine whose requests are charged to `bucket`. */
export function geminiFor(bucket: string): AgentEngine {
  return createAISDKEngine("google", {
    apiKey: apiKey(),
    allowEnvFallback: false,
    model: GEMINI_MODEL,
    supportedModels: [GEMINI_MODEL],
    acceptsCustomModels: false,
    requestFetch: quotaFetch(bucket),
  });
}

// What the member reads when the model gives nothing usable. Fixed sentences: a provider's own error text never reaches the chat.
export const NOT_IN_A_ROOM = "I only work inside an Unsaid room you have joined. Open your room and ask me there.";
export const OUT_OF_QUOTA = "The free AI allowance for today is used up, so I can't answer right now. Everything in the room still works by hand; try me again tomorrow.";
export const BUSY = "The AI is busy, try again in a minute; the room works without it.";
export const NOT_ANSWERING = "The AI is not answering right now. Everything in the room still works by hand.";
/** Instead of NOT_ANSWERING when the failed call came after a tool had run: the work is done, only the summary is missing. */
export const SAVED_NO_SUMMARY = "Done: the change is saved in the room. The AI could not add a summary right now.";
export const NOTHING_TO_ADD = "I have nothing to add. Try asking in other words.";

/** The whole answer as a fixed text. `before` is what the model had already said: the text then closes that message. */
async function* fixedReply(text: string, before = ""): AsyncGenerator<EngineEvent> {
  const shown = before.trim() ? `\n\n${text}` : text;
  yield { type: "text-delta", text: shown };
  yield { type: "assistant-content", parts: [{ type: "text", text: before + shown }] };
  yield { type: "stop", reason: "end_turn" };
}

/**
 * One model call with a deadline. The member reads the model's text or a fixed sentence: never a raw error, never silence.
 * The deadline and the member's own Stop both reach the request through one abort signal; the race below also ends the chat
 * when an engine ignores that signal.
 */
async function* answer(model: AgentEngine, bucket: string, opts: EngineStreamOptions, timeoutMs: number): AsyncGenerator<EngineEvent> {
  if (opts.abortSignal.aborted) return;
  const cancel = new AbortController();
  const relay = () => cancel.abort(opts.abortSignal.reason);
  opts.abortSignal.addEventListener("abort", relay, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), timeoutMs);
  });
  const events = model.stream({ ...opts, abortSignal: cancel.signal, model: GEMINI_MODEL, maxOutputTokens: Math.min(opts.maxOutputTokens ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS) })[Symbol.asyncIterator]();
  let said = ""; // the text streamed so far
  let spoke = false; // text or a tool call came out
  const closing: EngineEvent[] = []; // assistant-content and stop wait until it is known that the model said something
  let problem: "late" | "error" | undefined;
  let why = ""; // what went wrong, for the server log only
  try {
    for (;;) {
      const next = await Promise.race([events.next(), late]);
      if (next === "late") {
        problem = "late";
        why = `no answer within ${timeoutMs} ms`;
        break;
      }
      if (next.done) break;
      const e = next.value;
      if (e.type === "stop" && e.reason === "error") {
        problem = "error";
        why = `${e.statusCode ? `HTTP ${e.statusCode}: ` : ""}${e.error ?? "model error"}`;
        break;
      }
      if (e.type === "stop" || e.type === "assistant-content") {
        closing.push(e);
        continue;
      }
      if (e.type === "text-delta") {
        said += e.text;
        if (e.text.trim()) spoke = true;
      } else if (e.type === "tool-call") spoke = true;
      yield e;
    }
  } catch (err) {
    problem = "error";
    why = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
    opts.abortSignal.removeEventListener("abort", relay);
    if (problem) cancel.abort();
    void events.return?.()?.catch(() => {});
  }
  if (opts.abortSignal.aborted) return; // the member pressed Stop: nothing more to say
  if (problem) {
    const key = apiKey();
    console.error("[unsaid-gemini]", (key ? why.split(key).join("[key]") : why).slice(0, 300)); // the reason only: never the request, its headers or the key
    // A 429 sets the pause and a used-up day shows in the counters: the quota module knows which of them it was, if any.
    const room: LlmRoom = await llmRoom(bucket).catch(() => "ok");
    // A call that failed right after a tool ran: the work is done, so the sentence must not read like a failed action.
    const last = opts.messages?.[opts.messages.length - 1];
    const afterTool = !!last?.content?.some((part) => part.type === "tool-result" && !part.isError);
    return yield* fixedReply(room === "busy" ? BUSY : room === "capped" ? OUT_OF_QUOTA : afterTool ? SAVED_NO_SUMMARY : NOT_ANSWERING, said);
  }
  if (!spoke) return yield* fixedReply(NOTHING_TO_ADD);
  yield* closing;
}

/** Wraps an engine for the chat: only a guest bound to a seat, within quota, reaches `make(bucket)`. */
export function guardedChatEngine(make: (bucket: string) => AgentEngine, meta: AgentEngine = make("meta"), timeoutMs = CHAT_TIMEOUT_MS): AgentEngine {
  // Metadata only (models, capabilities); the wrapper keeps no key and no fetch of its own.
  const engine = Object.assign(Object.create(Object.getPrototypeOf(meta)) as AgentEngine, meta, { name: ENGINE_NAME, label: "Gemini (Unsaid)", apiKey: "", requestFetch: undefined });
  return Object.assign(engine, {
    async *stream(opts: EngineStreamOptions): AsyncGenerator<EngineEvent> {
      const seat = await boundSeat();
      if (!seat) return yield* fixedReply(NOT_IN_A_ROOM);
      const bucket = seatBucket(seat);
      const room = await llmRoom(bucket);
      if (room !== "ok") return yield* fixedReply(room === "busy" ? BUSY : OUT_OF_QUOTA);
      yield* answer(make(bucket), bucket, opts, timeoutMs);
    },
  });
}

export const chatEngine = guardedChatEngine(geminiFor);

// The chat plugin's own `engine` option does not reach its main chat handler (framework 0.225.0), which resolves the
// engine by name from the app config, so the guarded engine is registered under ENGINE_NAME. Every framework feature
// that resolves that name gets the same guard: no bound seat, no model call.
registerAgentEngine({
  name: ENGINE_NAME,
  label: "Gemini (Unsaid)",
  description: "Unsaid's Gemini key, only for a guest bound to a room seat, within the daily caps.",
  capabilities: chatEngine.capabilities,
  defaultModel: GEMINI_MODEL,
  supportedModels: [GEMINI_MODEL],
  acceptsCustomModels: false,
  requiredEnvVars: [],
  create: () => chatEngine,
});

/** One plain completion for a member's seat (card extraction). Null when out of quota or without a key. */
export async function completeForSeat(bucket: string, prompt: { systemPrompt: string; input: string; timeoutMs: number }): Promise<string | null> {
  if (!apiKey() || !(await hasLlmRoom(bucket))) return null;
  const out = await completeText({ engine: geminiFor(bucket), model: GEMINI_MODEL, systemPrompt: prompt.systemPrompt, input: prompt.input, maxOutputTokens: 2048, temperature: 0, timeoutMs: prompt.timeoutMs });
  return out.text;
}
