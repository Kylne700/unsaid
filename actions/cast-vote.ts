import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { castVote } from "../server/domain/room";
import { asMember, memberArgs, requireOwnJudgment, who, WRITE } from "../server/lib/room-api";

export default defineAction({
  description:
    "Cast your one final, sealed vote (vote phase). Hidden from everyone until the reveal. expectSame (optional): how many of the other members you expect to pick the same option. A member's own judgment: the agent cannot call this.",
  schema: z.object({ ...memberArgs, optionId: z.string().min(1).max(8), expectSame: z.number().int().min(0).max(7).optional() }),
  ...WRITE,
  agentTool: false,
  run: async ({ code, token, optionId, expectSame }, ctx) => {
    requireOwnJudgment(ctx);
    const phase = await asMember(await who({ code, token }, ctx), (room, me) => {
      castVote(room, me, optionId, expectSame);
      return room.phase;
    });
    return { ok: true, phase };
  },
});
