import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { withdrawCard } from "../server/domain/room";
import { asMember, memberSchemas, who, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Take your own approved card back out of the shared ledger and into your drafts (cards phase). Split merged cards first.",
  ...memberSchemas({ cardId: z.string().min(1).max(40) }),
  ...WRITE,
  run: async ({ code, token, cardId }, ctx) => {
    await asMember(await who({ code, token }, ctx), (room, me) => withdrawCard(room, me, cardId));
    return { ok: true };
  },
});
