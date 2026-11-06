import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { saveDraft } from "../server/domain/room";
import { asMember, memberArgs, WRITE } from "../server/lib/room-api";

export default defineAction({
  description:
    "Create or edit one of your private draft cards (cards phase): one fact, which option it is about, and whether it is a pro or a con. " +
    "The neutral text (the same fact without any option name) is filled in for you.",
  schema: z.object({
    ...memberArgs,
    draftId: z.string().max(40).optional().describe("Omit to create a new draft"),
    text: z.string().min(1).max(400).describe("One fact. It may name the option."),
    option: z.string().max(8).nullable().describe("Option id this fact is about, or null if not chosen yet"),
    polarity: z.enum(["pro", "con"]).nullable(),
    neutral: z.string().max(400).optional().describe("Only if you want to word the neutral version yourself; option names are removed anyway"),
  }),
  ...WRITE,
  run: async ({ code, token, draftId, text, option, polarity, neutral }) => {
    const draft = await asMember({ code, token }, (room, me) => saveDraft(room, me, { draftId, text, option, polarity, neutral }));
    return { ok: true, draftId: draft.id };
  },
});
