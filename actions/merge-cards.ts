import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { mergeCards } from "../server/domain/room";
import { asMember, memberArgs, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Merge two ledger cards that state the same fact (same option, same pro/con): one card remains, held by everyone who held either. Undo with unmerge-card.",
  schema: z.object({ ...memberArgs, keepId: z.string().min(1).max(40), absorbId: z.string().min(1).max(40) }),
  ...WRITE,
  run: async ({ code, token, keepId, absorbId }) => {
    await asMember({ code, token }, (room, me) => mergeCards(room, me, keepId, absorbId));
    return { ok: true };
  },
});
