import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { setInitialPick } from "../server/domain/room";
import { asMember, memberArgs, requireOwnJudgment, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Seal your own first lean (which option you lean to now). Nobody sees it until the reveal. A member's own judgment: the agent cannot call this.",
  schema: z.object({ ...memberArgs, optionId: z.string().min(1).max(8) }),
  ...WRITE,
  agentTool: false,
  run: async ({ code, token, optionId }, ctx) => {
    requireOwnJudgment(ctx);
    await asMember({ code, token }, (room, me) => setInitialPick(room, me, optionId));
    return { ok: true };
  },
});
