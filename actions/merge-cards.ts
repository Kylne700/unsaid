import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { mergeCards } from "../server/domain/room";
import { asMember, memberSchemas, who, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Merge two ledger cards that state the same fact (same option, same pro/con): one card remains, held by everyone who held either. Undo with unmerge-card.",
  ...memberSchemas({ keepId: z.string().min(1).max(40), absorbId: z.string().min(1).max(40) }),
  ...WRITE,
  run: async ({ code, token, keepId, absorbId }, ctx) => {
    await asMember(await who({ code, token }, ctx), (room, me) => mergeCards(room, me, keepId, absorbId));
    return { ok: true };
  },
});
