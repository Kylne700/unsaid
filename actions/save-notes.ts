import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { saveNotes } from "../server/domain/room";
import { asMember, memberSchemas, who, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Save your private notes for the decision (notes phase only). Nobody else ever sees them.",
  ...memberSchemas({ text: z.string().max(8000) }),
  ...WRITE,
  run: async ({ code, token, text }, ctx) => {
    await asMember(await who({ code, token }, ctx), (room, me) => saveNotes(room, me, text));
    return { ok: true };
  },
});
