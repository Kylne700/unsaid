import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { codeArg, readView } from "../server/lib/room-api";

export default defineAction({
  description:
    "Read the room as the calling member may see it: phase, members, and what this phase allows. " +
    "SEALED: before the reveal it never contains anyone's votes, initial picks or per-option scores; " +
    "during the weigh phase it never shows a card's option or holders; a member's notes and draft cards go only to that member. " +
    "Without a valid token you only get the join preview.",
  schema: z.object({ code: codeArg, token: z.string().max(100).optional().describe("The calling member's secret token") }),
  http: { method: "POST" }, // POST so the token never sits in a URL
  readOnly: true,
  requiresAuth: false,
  persistInBrowser: false, // private views must not be painted from disk on a revisit
  persistInChatHistory: false,
  run: ({ code, token }) => readView({ code, token }),
});
