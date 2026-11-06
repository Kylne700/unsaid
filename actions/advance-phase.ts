import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { forceAdvance } from "../server/domain/room";
import { asMember, memberArgs, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Room creator only: move the room to the next phase without waiting for everyone to be done.",
  schema: z.object({ ...memberArgs }),
  ...WRITE,
  run: async ({ code, token }) => {
    const phase = await asMember({ code, token }, (room, me) => {
      forceAdvance(room, me);
      return room.phase;
    });
    return { ok: true, phase };
  },
});
