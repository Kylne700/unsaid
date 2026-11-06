import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { createRoom } from "../server/domain/room";
import { createUnderFreshCode } from "../server/lib/room-api";

export default defineAction({
  description: "Start a decision room: a question, 2 to 4 options and your name. Returns the room code and your secret member token. Needs no account.",
  schema: z.object({
    question: z.string().min(3).max(200).describe("The decision, e.g. Which vendor should we sign?"),
    options: z.array(z.string().min(2).max(40)).min(2).max(4).describe("The options being weighed"),
    name: z.string().min(1).max(40).describe("The creator's display name"),
  }),
  http: { method: "POST" },
  requiresAuth: false,
  changeEvents: false,
  agentTool: false, // mints a member token: for the UI only
  run: ({ question, options, name }) => createUnderFreshCode((code) => createRoom({ code, question, options, creatorName: name })),
});
