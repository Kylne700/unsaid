import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { extractCards } from "../server/domain/extract-cards";
import { addExtractedDrafts } from "../server/domain/room";
import { asMember, memberArgs, readOwnNotes, WRITE } from "../server/lib/room-api";

export default defineAction({
  description: "Turn your private notes into draft cards (cards phase). Drafts stay private until you approve each one. Stage 1 splits sentences; it does not use AI.",
  schema: z.object({ ...memberArgs }),
  ...WRITE,
  run: async ({ code, token }) => {
    // Extraction runs before the save so a slow (model-backed) extractor never holds the room's version check open.
    const { notes, room } = await readOwnNotes({ code, token });
    const extracted = await extractCards(notes, room.options);
    const added = await asMember({ code, token }, (r, me) => addExtractedDrafts(r, me, extracted));
    return { added };
  },
});
