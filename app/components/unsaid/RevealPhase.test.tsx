import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { approveDraft, castVote, createReplay, createRoom, forceAdvance, joinRoom, memberByToken, mergeCards, rateCard, saveDraft, saveNotes, setInitialPick } from "../../../server/domain/room";
import { must } from "../../../server/domain/test-helpers";
import { type RoomView, viewRoom } from "../../../server/domain/view";
import { RevealPhase } from "./RevealPhase";
import { RoomProvider } from "./room-context";

const page = (room: RoomView) =>
  renderToStaticMarkup(
    <RoomProvider value={{ room, run: () => Promise.reject(new Error("not used")), busy: false, error: null, beforeDone: { current: null } }}>
      <RevealPhase />
    </RoomProvider>,
  );

/** A live room of two (Ana, Ben), both leaning to Lisbon. One fact only Ana knows, one both know (Ben's Berlin card with Ana's folded in). */
function twoPersonReveal(): RoomView {
  const made = createRoom({ code: "TWOPPL", question: "Which city should we move to?", options: ["Lisbon", "Berlin"], creatorName: "Ana" });
  const room = made.room;
  const ana = must(memberByToken(room, made.token));
  const ben = must(memberByToken(room, joinRoom(room, "Ben").token));
  for (const m of [ana, ben]) {
    saveNotes(room, m, "Some notes.");
    setInitialPick(room, m, "A");
  }
  forceAdvance(room, ana); // cards
  const give = (m: typeof ana, text: string, option: string, polarity: "pro" | "con") => approveDraft(room, m, saveDraft(room, m, { text, option, polarity }).id);
  give(ana, "Lisbon has cheap flights.", "A", "pro");
  const anas = give(ana, "Berlin nightlife is lively.", "B", "pro");
  const bens = give(ben, "Berlin has a big tech scene.", "B", "pro");
  forceAdvance(room, ana); // weigh
  mergeCards(room, ana, bens.id, anas.id);
  for (const m of [ana, ben]) for (const c of room.cards) rateCard(room, m, c.id, 2);
  forceAdvance(room, ana); // vote
  castVote(room, ana, "A");
  castVote(room, ben, "A"); // last vote: the room reveals by itself
  return viewRoom(room, ana);
}

/** A live room of one (Ana) that approved `cards` facts of her own and voted: every fact is one only she knew. */
function soloReveal(cards: number): RoomView {
  const made = createRoom({ code: "SOLORM", question: "Which city should we move to?", options: ["Lisbon", "Berlin"], creatorName: "Ana" });
  const room = made.room;
  const ana = must(memberByToken(room, made.token));
  saveNotes(room, ana, "Some notes.");
  setInitialPick(room, ana, "A");
  forceAdvance(room, ana); // cards
  for (let i = 1; i <= cards; i++) approveDraft(room, ana, saveDraft(room, ana, { text: `Lisbon fact number ${i}.`, option: "A", polarity: "pro" }).id);
  forceAdvance(room, ana); // weigh
  for (const c of room.cards) rateCard(room, ana, c.id, 2);
  forceAdvance(room, ana); // vote
  castVote(room, ana, "A"); // the last vote: the room reveals by itself
  return viewRoom(room, ana);
}

describe("RevealPhase wording for a room of one", () => {
  it("says why nothing differs, and reads 'The 1 fact' / 'the 1 card', never 'All 1 facts' or 'all 1 cards'", () => {
    const one = page(soloReveal(1));
    expect(one).toContain("You are alone here, so every fact is one only you knew. Invite a teammate to see the difference.");
    expect(one).toContain("The 1 fact");
    expect(one).toContain("the 1 card");
    expect(one).not.toMatch(/all 1 (facts|cards)/i);
    expect(one).not.toContain("at least two of you held");
    const two = page(soloReveal(2));
    expect(two).toContain("You are alone here");
    expect(two).toContain("All 2 facts");
    expect(two).toContain("all 2 cards");
    expect(two).not.toMatch(/the 1 (fact|card)/i);
  });
});

describe("RevealPhase wording for a pair", () => {
  it("two people read 'both' (grid row, replay headline), never 'all two'; three still read 'all three'", () => {
    const two = twoPersonReveal();
    expect(two.reveal?.members).toHaveLength(2);
    const live = page(two);
    expect(live).toContain("Only what both knew");
    expect(live).not.toContain("You are alone here");
    // The headline form exists only in the replay room, so flag the same view as one.
    const replay = page({ ...two, practice: { title: "Replay", replay: true } });
    expect(replay).toContain("Alone, both leaned to");
    expect(live + replay).not.toContain("all two");

    const made = createReplay("REPLAY");
    const three = page(viewRoom(made.room, must(memberByToken(made.room, made.token))));
    expect(three).toContain("Alone, all three leaned to");
    expect(three).toContain("Only what all three knew");
  });
});
