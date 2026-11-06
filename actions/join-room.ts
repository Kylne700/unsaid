import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { joinRoom } from "../server/domain/room";
import { codeArg, inRoom, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Join a room by code with just a name (no account). Only possible while the room is still in the notes phase. Returns your secret member token.",
  schema: z.object({ code: codeArg, name: z.string().min(1).max(40).describe("Your display name") }),
  ...WRITE,
  agentTool: false, // mints a member token: for the UI only
  run: ({ code, name }) => inRoom(code, (room) => joinRoom(room, name)),
});
