import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { deleteDraft } from "../server/domain/room";
import { asMember, memberArgs, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Delete one of your private draft cards (cards phase).",
  schema: z.object({ ...memberArgs, draftId: z.string().min(1).max(40) }),
  ...WRITE,
  run: async ({ code, token, draftId }) => {
    await asMember({ code, token }, (room, me) => deleteDraft(room, me, draftId));
    return { ok: true };
  },
});
