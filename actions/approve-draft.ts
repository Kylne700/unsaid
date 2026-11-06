import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { approveDraft } from "../server/domain/room";
import { asMember, memberSchemas, who, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Approve one of your draft cards into the shared ledger (cards phase). It needs an option and a pro/con. Only approved cards reach the ledger.",
  ...memberSchemas({ draftId: z.string().min(1).max(40) }),
  ...WRITE,
  run: async ({ code, token, draftId }, ctx) => {
    const card = await asMember(await who({ code, token }, ctx), (room, me) => approveDraft(room, me, draftId));
    return { ok: true, cardId: card.id };
  },
});
