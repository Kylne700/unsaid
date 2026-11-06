import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { deleteDraft } from "../server/domain/room";
import { asMember, memberSchemas, who, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Delete one of your private draft cards (cards phase).",
  ...memberSchemas({ draftId: z.string().min(1).max(40) }),
  ...WRITE,
  run: async ({ code, token, draftId }, ctx) => {
    await asMember(await who({ code, token }, ctx), (room, me) => deleteDraft(room, me, draftId));
    return { ok: true };
  },
});
