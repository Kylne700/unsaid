import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { createPractice } from "../server/domain/room";
import { createUnderFreshCode } from "../server/lib/room-api";

export default defineAction({
  description: "Start the practice room: you plus two simulated teammates from a scripted scenario. Returns the room code and your member token. Needs no account.",
  schema: z.object({}),
  http: { method: "POST" },
  requiresAuth: false,
  changeEvents: false,
  agentTool: false, // mints a member token: for the UI only
  run: () => createUnderFreshCode((code) => createPractice(code)),
});
