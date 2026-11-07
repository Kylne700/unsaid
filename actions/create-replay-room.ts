import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { createReplay } from "../server/domain/room";
import { createUnderFreshCode } from "../server/lib/room-api";

export default defineAction({
  description: "Start the replay: the practice room already played to its reveal by a scripted You and two simulated teammates. Returns the room code and your member token. Needs no account and calls no model.",
  schema: z.object({}),
  http: { method: "POST" },
  requiresAuth: false,
  changeEvents: false,
  agentTool: false, // mints a member token: for the UI only
  run: () => createUnderFreshCode((code) => createReplay(code)),
});
