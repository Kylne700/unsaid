import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { mergeCards } from "../server/domain/room";
import { asMember, memberSchemas, who, WRITE } from "../server/lib/room-api";

export default defineAction({
  description:
    "Merge two cards that state the same fact (same option, same pro/con): one card remains (keepId), held by everyone who held either. absorbId must be a card the member wrote (get-room marks those mine in weigh; a card they only joined is not theirs to fold). Cards phase: keepId must be the member's too; undo with unmerge-card. Weigh phase: keepId may be another member's card (a duplicate of the member's own); this cannot be undone, so only when the member asks.",
  ...memberSchemas({ keepId: z.string().min(1).max(40), absorbId: z.string().min(1).max(40) }),
  ...WRITE,
  run: async ({ code, token, keepId, absorbId }, ctx) => {
    await asMember(await who({ code, token }, ctx), (room, me) => mergeCards(room, me, keepId, absorbId));
    return { ok: true };
  },
});
