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
import { hasLlmRoom, pauseLlm, takeLlmRequest } from "./llm-quota";

export const GEMINI_MODEL = "gemini-3.5-flash-lite";
/** The registered engine the chat runs on (selected in server/plugins/agent-native-email-branding.ts). */
export const ENGINE_NAME = "unsaid-gemini";
export const MAX_OUTPUT_TOKENS = 4096;
const STANDARD_KEY_NAMES = ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"];

export function assertNoStandardKey(env: Record<string, string | undefined> = process.env): void {
  const set = STANDARD_KEY_NAMES.filter((k) => env[k]?.trim()); // guard:allow-env-credential -- presence check only: these names must stay unset so the framework never finds a key.
  if (set.length) throw new Error(`Unset ${set.join(", ")}: Unsaid reads its Gemini key from UNSAID_GEMINI_API_KEY only.`);
}
assertNoStandardKey();

const apiKey = () => process.env.UNSAID_GEMINI_API_KEY?.trim() ?? ""; // guard:allow-env-credential -- the app's own Gemini key; read only here, used only through the seat and quota checks below.
/** Whether a key is set (never the key itself). */
export const geminiConfigured = () => apiKey() !== "";

/** fetch for one quota bucket: every real request (retries included) takes a slot first; a 429 pauses all calls. */
function quotaFetch(bucket: string): typeof fetch {
  return async (input, init) => {
    if (!(await takeLlmRequest(bucket))) throw new Error("unsaid_llm_quota: daily Gemini limit reached");
    const res = await fetch(input, init);
    if (res.status === 429) pauseLlm(60_000);
    return res;
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

export const NOT_IN_A_ROOM = "I only work inside an Unsaid room you have joined. Open your room and ask me there.";
export const OUT_OF_QUOTA = "The free AI allowance for today is used up, so I can't answer right now. Everything in the room still works by hand; try me again tomorrow.";

async function* fixedReply(text: string): AsyncGenerator<EngineEvent> {
  yield { type: "text-delta", text };
  yield { type: "assistant-content", parts: [{ type: "text", text }] };
  yield { type: "stop", reason: "end_turn" };
}

/** Wraps an engine for the chat: only a guest bound to a seat, within quota, reaches `make(bucket)`. */
export function guardedChatEngine(make: (bucket: string) => AgentEngine, meta: AgentEngine = make("meta")): AgentEngine {
  // Metadata only (models, capabilities); the wrapper keeps no key and no fetch of its own.
  const engine = Object.assign(Object.create(Object.getPrototypeOf(meta)) as AgentEngine, meta, { name: ENGINE_NAME, label: "Gemini (Unsaid)", apiKey: "", requestFetch: undefined });
  return Object.assign(engine, {
    async *stream(opts: EngineStreamOptions): AsyncGenerator<EngineEvent> {
      const seat = await boundSeat();
      if (!seat) return yield* fixedReply(NOT_IN_A_ROOM);
      const bucket = seatBucket(seat);
      if (!(await hasLlmRoom(bucket))) return yield* fixedReply(OUT_OF_QUOTA);
      yield* make(bucket).stream({ ...opts, model: GEMINI_MODEL, maxOutputTokens: Math.min(opts.maxOutputTokens ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS) });
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
