import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { unmergeCard } from "../server/domain/room";
import { asMember, memberSchemas, who, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Undo a merge: split one absorbed card back out of a merged ledger card, with its own holders.",
  ...memberSchemas({ cardId: z.string().min(1).max(40), absorbedId: z.string().min(1).max(40) }),
  ...WRITE,
  run: async ({ code, token, cardId, absorbedId }, ctx) => {
    await asMember(await who({ code, token }, ctx), (room, me) => unmergeCard(room, me, cardId, absorbedId));
    return { ok: true };
  },
});
