import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { rateCard } from "../server/domain/room";
import { asMember, memberArgs, requireOwnJudgment, who, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Rate how much one card matters, 0 to 3 (weigh phase, blind). A member's own judgment: the agent cannot call this.",
  schema: z.object({ ...memberArgs, cardId: z.string().min(1).max(40), weight: z.number().int().min(0).max(3) }),
  ...WRITE,
  agentTool: false,
  run: async ({ code, token, cardId, weight }, ctx) => {
    requireOwnJudgment(ctx);
    await asMember(await who({ code, token }, ctx), (room, me) => rateCard(room, me, cardId, weight));
    return { ok: true };
  },
});
