import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { forceAdvance } from "../server/domain/room";
import { asMember, memberSchemas, who, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Room creator only: move the room to the next phase without waiting for everyone to be done.",
  ...memberSchemas({}),
  ...WRITE,
  run: async ({ code, token }, ctx) => {
    const phase = await asMember(await who({ code, token }, ctx), (room, me) => {
      forceAdvance(room, me);
      return room.phase;
    });
    return { ok: true, phase };
  },
});
