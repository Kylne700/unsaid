import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { codeArg, readView } from "../server/lib/room-api";

export default defineAction({
  description:
    "Read your room as you may see it: phase, members, and what this phase allows. " +
    "SEALED: before the reveal it never contains anyone's votes, initial picks or per-option scores; " +
    "during the weigh phase it never shows a card's option or holders; a member's notes and draft cards go only to that member.",
  // UI callers send the code and their token (no valid token: the join preview); the chat agent sends nothing.
  schema: z.object({ code: codeArg.optional(), token: z.string().max(100).optional().describe("The calling member's secret token") }),
  agentInputSchema: z.object({}),
  http: { method: "POST" }, // POST so the token never sits in a URL
  readOnly: true,
  requiresAuth: false,
  persistInBrowser: false, // private views must not be painted from disk on a revisit
  // Kept in chat history: threads belong to one member (seat owner), and `persistInChatHistory: false` makes
  // framework 0.225.0 strip the payload of omission ranges in that run, so every thread save fails (500).
  run: ({ code, token }, ctx) => readView({ code, token }, ctx),
});
