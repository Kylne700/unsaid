import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { approveDraft } from "../server/domain/room";
import { asMember, memberArgs, requireOwnJudgment, who, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Approve one of your draft cards into the shared ledger (cards phase). It needs an option and a pro/con. Only approved cards reach the ledger. A member's own act: the agent cannot call this.",
  schema: z.object({ ...memberArgs, draftId: z.string().min(1).max(40) }),
  ...WRITE,
  agentTool: false,
  run: async ({ code, token, draftId }, ctx) => {
    requireOwnJudgment(ctx);
    const card = await asMember(await who({ code, token }, ctx), (room, me) => approveDraft(room, me, draftId));
    return { ok: true, cardId: card.id };
  },
});
