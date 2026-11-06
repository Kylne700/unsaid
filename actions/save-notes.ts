import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { saveNotes } from "../server/domain/room";
import { asMember, memberArgs, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Save your private notes for the decision (notes phase only). Nobody else ever sees them.",
  schema: z.object({ ...memberArgs, text: z.string().max(8000) }),
  ...WRITE,
  run: async ({ code, token, text }) => {
    await asMember({ code, token }, (room, me) => saveNotes(room, me, text));
    return { ok: true };
  },
});
