import { defineAction } from "@agent-native/core/action";
import { extractCards } from "../server/domain/extract-cards";
import { addExtractedDrafts } from "../server/domain/room";
import { completeForSeat } from "../server/lib/gemini";
import { seatBucket } from "../server/lib/guest";
import { asMember, memberSchemas, readOwnNotes, who, WRITE } from "../server/lib/room-api";

export default defineAction({
  description:
    "Turn your private notes into draft cards (cards phase): Gemini drafts one card per fact; if AI is unavailable the notes are split into sentences. " +
    "Drafts stay private until you approve each one.",
  ...memberSchemas({}),
  ...WRITE,
  run: async ({ code, token }, ctx) => {
    const w = await who({ code, token }, ctx);
    // A valid member (token or bound seat) is checked before the model call; the call runs outside the room's save
    // loop so a slow model never holds the version check open.
    const { notes, room, me } = await readOwnNotes(w);
    const bucket = seatBucket({ room, me });
    const { cards, source } = await extractCards(notes, room.options, (prompt) => completeForSeat(bucket, prompt));
    const added = await asMember(w, (r, m) => addExtractedDrafts(r, m, cards));
    return { added, source };
  },
});
