import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { setDone } from "../server/domain/room";
import { asMember, memberArgs, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Mark yourself done with the current phase (or undo it). When every member is done the room moves to the next phase by itself.",
  schema: z.object({ ...memberArgs, done: z.boolean() }),
  ...WRITE,
  run: async ({ code, token, done }) => {
    const phase = await asMember({ code, token }, (room, me) => {
      setDone(room, me, done);
      return room.phase;
    });
    return { ok: true, phase };
  },
});
