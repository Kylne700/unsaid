import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { guessWho } from "../server/domain/room";
import { asMember, memberArgs, requireOwnJudgment, who, WRITE } from "../server/lib/room-api";

export default defineAction({
  description:
    "Guess which member knew a fact that exactly one other member knew (vote phase; editable until the reveal). candidateId null means not sure. A member's own judgment: the agent cannot call this.",
  schema: z.object({ ...memberArgs, cardId: z.string().min(1).max(40), candidateId: z.string().min(1).max(16).nullable() }),
  ...WRITE,
  agentTool: false,
  run: async ({ code, token, cardId, candidateId }, ctx) => {
    requireOwnJudgment(ctx);
    await asMember(await who({ code, token }, ctx), (room, me) => guessWho(room, me, cardId, candidateId));
    return { ok: true };
  },
});
