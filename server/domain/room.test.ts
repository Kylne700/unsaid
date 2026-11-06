import { describe, expect, it } from "vitest";
import { splitNotes } from "./extract-cards";
import { holdersOf, uniqueCount } from "./ledger";
import { addExtractedDrafts, approveDraft, castVote, createRoom, forceAdvance, joinRoom, memberByToken, mergeCards, rateCard, saveDraft, saveNotes, setDone, setInitialPick, unmergeCard, withdrawCard } from "./room";
import type { Member, Room } from "./types";
import { RoomError } from "./util";

const must = <T>(x: T | undefined | null): T => {
  if (x === undefined || x === null) throw new Error("expected a value");
  return x;
};

/** A live room with three members, still in the notes phase. */
function live() {
  const made = createRoom({ code: "TESTR2", question: "Which city should we move to?", options: ["Lisbon", "Berlin", "Oslo"], creatorName: "Ana" });
  const room = made.room;
  const ana = must(memberByToken(room, made.token));
  const b = joinRoom(room, "Ben");
  const c = joinRoom(room, "Cy");
  return { room, ana, ben: must(memberByToken(room, b.token)), cy: must(memberByToken(room, c.token)) };
}
const all = (t: ReturnType<typeof live>): Member[] => [t.ana, t.ben, t.cy];
const throwsKind = (fn: () => unknown, kind: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RoomError);
    expect((e as RoomError).kind).toBe(kind);
    return;
  }
  throw new Error(`expected a ${kind} error`);
};
const card = (room: Room, owner: Member, text: string, option: string, polarity: "pro" | "con") => {
  const d = saveDraft(room, owner, { text, option, polarity });
  return approveDraft(room, owner, d.id);
};

describe("phase machine", () => {
  it("walks notes -> cards -> weigh -> vote -> reveal only when everyone is done", () => {
    const t = live();
    expect(t.room.phase).toBe("notes");
    setDone(t.room, t.ana, true);
    setDone(t.room, t.ben, true);
    expect(t.room.phase).toBe("notes"); // Cy is not done
    setDone(t.room, t.cy, true);
    expect(t.room.phase).toBe("cards");
    expect(all(t).every((m) => !m.done)).toBe(true); // done flags reset on every phase

    const c1 = card(t.room, t.ana, "Lisbon has cheap flights.", "A", "pro");
    card(t.room, t.ben, "Berlin rents are rising.", "B", "con");
    for (const m of all(t)) setDone(t.room, m, true);
    expect(t.room.phase).toBe("weigh");

    throwsKind(() => setDone(t.room, t.ana, true), "invalid"); // has not rated every card
    for (const m of all(t)) {
      for (const c of t.room.cards) rateCard(t.room, m, c.id, 2);
      setDone(t.room, m, true);
    }
    expect(t.room.phase).toBe("vote");

    castVote(t.room, t.ana, "A");
    castVote(t.room, t.ben, "B");
    expect(t.room.phase).toBe("vote");
    throwsKind(() => castVote(t.room, t.ana, "B"), "conflict"); // one final vote
    castVote(t.room, t.cy, "A");
    expect(t.room.phase).toBe("reveal");
    expect(c1.id).toBeTruthy();
  });

  it("lets only the creator force the room on, and stops at the reveal", () => {
    const t = live();
    throwsKind(() => forceAdvance(t.room, t.ben), "forbidden");
    forceAdvance(t.room, t.ana);
    expect(t.room.phase).toBe("cards");
    forceAdvance(t.room, t.ana);
    forceAdvance(t.room, t.ana);
    forceAdvance(t.room, t.ana);
    expect(t.room.phase).toBe("reveal");
    throwsKind(() => forceAdvance(t.room, t.ana), "bad_phase");
  });

  it("closes joining after the notes phase and keeps names unique", () => {
    const t = live();
    throwsKind(() => joinRoom(t.room, "ben"), "conflict");
    forceAdvance(t.room, t.ana);
    throwsKind(() => joinRoom(t.room, "Dee"), "bad_phase");
  });

  it("refuses every move outside its phase", () => {
    const t = live();
    const c = (() => {
      forceAdvance(t.room, t.ana);
      return card(t.room, t.ana, "Oslo is expensive.", "C", "con");
    })();
    throwsKind(() => saveNotes(t.room, t.ana, "late"), "bad_phase");
    throwsKind(() => setInitialPick(t.room, t.ana, "A"), "bad_phase");
    throwsKind(() => rateCard(t.room, t.ana, c.id, 1), "bad_phase");
    throwsKind(() => castVote(t.room, t.ana, "A"), "bad_phase");
    forceAdvance(t.room, t.ana); // weigh
    throwsKind(() => saveDraft(t.room, t.ana, { text: "x", option: null, polarity: null }), "bad_phase");
    throwsKind(() => rateCard(t.room, t.ana, c.id, 4), "invalid");
  });

  it("requires the sealed initial pick in practice rooms only", async () => {
    const { createPractice } = await import("./room");
    const p = createPractice("PRACT2");
    const me = must(memberByToken(p.room, p.token));
    throwsKind(() => setDone(p.room, me, true), "invalid");
    setInitialPick(p.room, me, "B");
    setDone(p.room, me, true);
    expect(p.room.phase).toBe("cards");
    const t = live();
    setDone(t.room, t.ana, true); // live rooms: optional
    expect(t.room.initialPicks[t.ana.id]).toBeUndefined();
  });
});

describe("cards, merge and the unique count", () => {
  it("only approved cards reach the ledger, and approval needs an option and a side", () => {
    const t = live();
    forceAdvance(t.room, t.ana);
    const d = saveDraft(t.room, t.ana, { text: "Lisbon is sunny.", option: null, polarity: null });
    expect(t.room.cards).toHaveLength(0);
    throwsKind(() => approveDraft(t.room, t.ana, d.id), "invalid");
    saveDraft(t.room, t.ana, { draftId: d.id, text: "Lisbon is sunny.", option: "A", polarity: "pro" });
    approveDraft(t.room, t.ana, d.id);
    expect(t.room.cards).toHaveLength(1);
    expect(t.room.drafts).toHaveLength(0);
    throwsKind(() => approveDraft(t.room, t.ben, d.id), "not_found"); // not Ben's draft
  });

  it("keeps option names out of the neutral text, even a hand-written one", () => {
    const t = live();
    forceAdvance(t.room, t.ana);
    const d = saveDraft(t.room, t.ana, { text: "Lisbon's rent is low.", option: "A", polarity: "pro", neutral: "Lisbon rent is low, says Berlin." });
    expect(d.neutral).toBe("This option rent is low, says another option.");
    const auto = saveDraft(t.room, t.ana, { text: "Oslo is dark in winter.", option: "C", polarity: "con" });
    expect(auto.neutral).toBe("This option is dark in winter.");
  });

  it("cards phase: a member merges two of their own cards, unmerge restores both, and the unique count follows", () => {
    const t = live();
    forceAdvance(t.room, t.ana);
    const x = card(t.room, t.ana, "Lisbon flights are cheap.", "A", "pro");
    const y = card(t.room, t.ana, "Cheap flights to Lisbon.", "A", "pro"); // Ana wrote the same fact twice
    const hot = card(t.room, t.ana, "Lisbon is hot.", "A", "con");
    card(t.room, t.cy, "Oslo is expensive.", "C", "con");
    expect(uniqueCount(t.room.cards)).toBe(4);

    throwsKind(() => mergeCards(t.room, t.ana, x.id, hot.id), "conflict"); // same option, but a con is not a pro
    throwsKind(() => mergeCards(t.room, t.ana, x.id, x.id), "invalid");
    mergeCards(t.room, t.ana, x.id, y.id);
    expect(t.room.cards).toHaveLength(3);
    expect(holdersOf(x)).toEqual([t.ana.id]);
    expect(uniqueCount(t.room.cards)).toBe(3);

    unmergeCard(t.room, t.ana, x.id, y.id);
    expect(t.room.cards).toHaveLength(4);
    expect(holdersOf(must(t.room.cards.find((c) => c.id === y.id)))).toEqual([t.ana.id]);
    expect(uniqueCount(t.room.cards)).toBe(4);
  });

  it("cards phase: nobody can merge across members, because the others' cards are not visible yet", () => {
    const t = live();
    forceAdvance(t.room, t.ana);
    const x = card(t.room, t.ana, "Lisbon flights are cheap.", "A", "pro");
    const y = card(t.room, t.ben, "Cheap flights to Lisbon.", "A", "pro");
    const mine = card(t.room, t.ana, "Cheap Lisbon airfares.", "A", "pro");
    throwsKind(() => mergeCards(t.room, t.ana, x.id, y.id), "forbidden"); // absorbing Ben's card
    throwsKind(() => mergeCards(t.room, t.ana, y.id, mine.id), "bad_phase"); // folding her own card into Ben's, before weigh
    throwsKind(() => mergeCards(t.room, t.cy, x.id, y.id), "forbidden"); // Cy holds neither
    expect(t.room.cards).toHaveLength(3);
    expect(uniqueCount(t.room.cards)).toBe(3);
  });

  it("a card merged twice splits back out one card at a time", () => {
    const t = live();
    forceAdvance(t.room, t.ana);
    const x = card(t.room, t.ana, "Berlin is lively.", "B", "pro");
    const y = card(t.room, t.ana, "Berlin has nightlife.", "B", "pro");
    const z = card(t.room, t.ana, "Berlin feels alive.", "B", "pro");
    mergeCards(t.room, t.ana, x.id, y.id);
    mergeCards(t.room, t.ana, x.id, z.id);
    expect(x.absorbed).toHaveLength(2);
    throwsKind(() => withdrawCard(t.room, t.ana, x.id), "conflict"); // split first
    unmergeCard(t.room, t.ana, x.id, z.id);
    expect(x.absorbed.map((a) => a.id)).toEqual([y.id]);
    expect(t.room.cards).toHaveLength(2);
  });

  it("practice: an edited wording of a fact already on the ledger is kept as 'also worded', and Split undoes it", async () => {
    const { createPractice } = await import("./room");
    const p = createPractice("PRACT3");
    const me = must(memberByToken(p.room, p.token));
    setInitialPick(p.room, me, "B");
    setDone(p.room, me, true);
    const [plain, edited] = p.room.drafts.filter((d) => d.ownerId === me.id && d.factKey && p.room.cards.some((c) => c.factKey === d.factKey));
    const target = p.room.cards.find((c) => c.factKey === must(edited).factKey)!;
    const before = p.room.cards.length;
    const original = must(edited).text;
    approveDraft(p.room, me, must(plain).id); // same wording: simply joins
    const joined = p.room.cards.find((c) => c.factKey === must(plain).factKey)!;
    expect(joined.ownHolders).toContain(me.id);
    expect(joined.absorbed).toHaveLength(0);
    saveDraft(p.room, me, { draftId: must(edited).id, text: `${original} I checked this myself.`, option: must(edited).option!, polarity: must(edited).polarity! });
    approveDraft(p.room, me, must(edited).id);
    expect(p.room.cards).toHaveLength(before); // still one card per fact
    expect(target.absorbed.map((a) => a.text)).toEqual([`${original} I checked this myself.`]);
    expect(holdersOf(target)).toContain(me.id);
    unmergeCard(p.room, me, target.id, must(target.absorbed[0]).id);
    expect(p.room.cards).toHaveLength(before + 1);
  });
  it("withdraw hands a card back to its holder as a draft", () => {
    const t = live();
    forceAdvance(t.room, t.ana);
    const x = card(t.room, t.ana, "Oslo is clean.", "C", "pro");
    throwsKind(() => withdrawCard(t.room, t.ben, x.id), "forbidden");
    withdrawCard(t.room, t.ana, x.id);
    expect(t.room.cards).toHaveLength(0);
    expect(t.room.drafts.filter((d) => d.ownerId === t.ana.id)).toHaveLength(1);
  });
});

/** Ana and Ben wrote the same Lisbon pro (x, y); Ben also wrote a Lisbon con (v) and Cy an Oslo con (z). The room is in the weigh phase. */
function weighRoom() {
  const t = live();
  forceAdvance(t.room, t.ana);
  const x = card(t.room, t.ana, "Lisbon flights are cheap.", "A", "pro");
  const y = card(t.room, t.ben, "Cheap flights to Lisbon.", "A", "pro");
  const v = card(t.room, t.ben, "Lisbon is hot.", "A", "con");
  const z = card(t.room, t.cy, "Oslo is expensive.", "C", "con");
  forceAdvance(t.room, t.ana);
  return { ...t, x, y, v, z };
}

describe("merging a duplicate in the weigh phase", () => {
  it("a member folds their own card into someone else's: both hold it, the unique count follows, splitting is a cards-phase move", () => {
    const t = weighRoom();
    expect(uniqueCount(t.room.cards)).toBe(4);
    mergeCards(t.room, t.ben, t.x.id, t.y.id); // Ben says his wording is Ana's fact
    expect(t.room.cards.map((c) => c.id)).toEqual([t.x.id, t.v.id, t.z.id]);
    expect(holdersOf(t.x).sort()).toEqual([t.ana.id, t.ben.id].sort());
    expect(t.x.absorbed.map((a) => a.id)).toEqual([t.y.id]);
    expect(uniqueCount(t.room.cards)).toBe(2); // only Ben's con and Cy's card are single-holder now
    throwsKind(() => unmergeCard(t.room, t.ben, t.x.id, t.y.id), "bad_phase");
    expect(t.room.cards).toHaveLength(3);
  });

  it("only a card the caller wrote can be folded away", () => {
    const t = weighRoom();
    throwsKind(() => mergeCards(t.room, t.ana, t.x.id, t.y.id), "forbidden"); // Ana would absorb Ben's card
    throwsKind(() => mergeCards(t.room, t.cy, t.x.id, t.y.id), "forbidden"); // Cy holds neither
    throwsKind(() => mergeCards(t.room, t.cy, t.y.id, t.x.id), "forbidden");
    expect(t.room.cards).toHaveLength(4);
  });

  it("joining a card does not make it yours to fold away: after Ben joins Ana's card he cannot move it, Ana can", () => {
    const t = live();
    forceAdvance(t.room, t.ana);
    const x = card(t.room, t.ana, "Lisbon flights are cheap.", "A", "pro");
    const y = card(t.room, t.ben, "Cheap flights to Lisbon.", "A", "pro");
    const w = card(t.room, t.cy, "Flights to Lisbon cost little.", "A", "pro"); // same option and side, so only the author check can stop it
    forceAdvance(t.room, t.ana);
    mergeCards(t.room, t.ben, x.id, y.id); // Ben now holds x
    expect(holdersOf(x)).toContain(t.ben.id);
    throwsKind(() => mergeCards(t.room, t.ben, w.id, x.id), "forbidden");
    expect(t.room.cards.map((c) => c.id)).toEqual([x.id, w.id]);
    expect(holdersOf(x).sort()).toEqual([t.ana.id, t.ben.id].sort());
    mergeCards(t.room, t.ana, w.id, x.id); // her own wording: allowed, and Ben's part travels with it
    expect(holdersOf(w).sort()).toEqual(all(t).map((m) => m.id).sort());
  });

  it("the folded card's own merged parts travel with it", () => {
    const t = live();
    forceAdvance(t.room, t.ana);
    const x = card(t.room, t.ana, "Lisbon flights are cheap.", "A", "pro");
    const y = card(t.room, t.ben, "Cheap flights to Lisbon.", "A", "pro");
    const y2 = card(t.room, t.ben, "Lisbon airfares are low.", "A", "pro");
    mergeCards(t.room, t.ben, y.id, y2.id); // both his, in the cards phase
    forceAdvance(t.room, t.ana);
    mergeCards(t.room, t.ben, x.id, y.id);
    expect(x.absorbed.map((a) => a.id)).toEqual([y.id, y2.id]);
    expect(t.room.cards).toHaveLength(1);
  });

  it("the two cards must be about the same option and the same side", () => {
    const t = weighRoom();
    throwsKind(() => mergeCards(t.room, t.ben, t.x.id, t.v.id), "conflict"); // a pro and a con
    throwsKind(() => mergeCards(t.room, t.cy, t.x.id, t.z.id), "conflict"); // another option
    throwsKind(() => mergeCards(t.room, t.ben, t.y.id, t.y.id), "invalid");
    throwsKind(() => mergeCards(t.room, t.ben, "nope", t.y.id), "not_found");
    expect(t.room.cards).toHaveLength(4);
  });

  it("is refused in the notes, vote and reveal phases", () => {
    const n = live();
    throwsKind(() => mergeCards(n.room, n.ana, "x", "y"), "bad_phase");
    const t = weighRoom();
    forceAdvance(t.room, t.ana); // vote
    throwsKind(() => mergeCards(t.room, t.ben, t.x.id, t.y.id), "bad_phase");
    for (const m of all(t)) castVote(t.room, m, "A");
    expect(t.room.phase).toBe("reveal");
    throwsKind(() => mergeCards(t.room, t.ben, t.x.id, t.y.id), "bad_phase");
    expect(t.room.cards).toHaveLength(4);
  });

  it("ratings on the folded card move to the surviving card unless that member already rated it, and none stay behind", () => {
    const t = weighRoom();
    rateCard(t.room, t.ana, t.y.id, 3); // Ana rated only Ben's wording
    rateCard(t.room, t.ben, t.y.id, 2); // Ben rated his own wording, not Ana's
    rateCard(t.room, t.cy, t.x.id, 1); // Cy rated both: the surviving card's rating wins
    rateCard(t.room, t.cy, t.y.id, 3);
    mergeCards(t.room, t.ben, t.x.id, t.y.id);
    expect(all(t).map((m) => t.room.ratings[m.id]?.[t.x.id])).toEqual([3, 2, 1]);
    for (const m of all(t)) expect(Object.keys(t.room.ratings[m.id] ?? {}), m.name).not.toContain(t.y.id);
  });

  it("a rating of 0 moves like any other and is never overwritten", () => {
    const t = weighRoom();
    rateCard(t.room, t.ana, t.y.id, 0); // moves: Ana has not rated the surviving card
    rateCard(t.room, t.cy, t.x.id, 0); // stays: Cy rated the surviving card 0 and the folded one 3
    rateCard(t.room, t.cy, t.y.id, 3);
    mergeCards(t.room, t.ben, t.x.id, t.y.id);
    expect(t.room.ratings[t.ana.id]?.[t.x.id]).toBe(0);
    expect(t.room.ratings[t.cy.id]?.[t.x.id]).toBe(0);
  });

  it("a member who rated every remaining card can then mark done, with the rating they gave the folded card counting for the survivor", () => {
    const t = weighRoom();
    for (const id of [t.y.id, t.v.id, t.z.id]) rateCard(t.room, t.ana, id, 2); // Ana never rated x
    throwsKind(() => setDone(t.room, t.ana, true), "invalid");
    mergeCards(t.room, t.ben, t.x.id, t.y.id);
    setDone(t.room, t.ana, true);
    expect(t.ana.done).toBe(true);
  });
});

describe("splitNotes (the fallback without AI)", () => {
  const options = [
    { id: "A", name: "Lisbon", aliases: [] },
    { id: "B", name: "Berlin", aliases: ["BER"] },
  ];
  it("splits bullets and sentences, guesses the option by name, never the side", () => {
    const out = splitNotes("- Lisbon has cheap flights. Rent is low!\n2) Berlin is lively; Lisbon beats Berlin on sun.\nok", options);
    expect(out.map((x) => x.text)).toEqual(["Lisbon has cheap flights.", "Rent is low!", "Berlin is lively; Lisbon beats Berlin on sun."]);
    expect(out.map((x) => x.option)).toEqual(["A", null, null]); // none or two named: unset
    expect(out.every((x) => x.polarity === null)).toBe(true);
    expect(out[0]?.neutral).toBe("This option has cheap flights.");
    expect(out[2]?.neutral).toBe("This option is lively; another option beats this option on sun.");
  });

  it("adds drafts once: running it twice does not duplicate", () => {
    const t = live();
    forceAdvance(t.room, t.ana);
    const found = splitNotes("Lisbon has cheap flights. Oslo is dark.", t.room.options);
    expect(addExtractedDrafts(t.room, t.ana, found)).toBe(2);
    expect(addExtractedDrafts(t.room, t.ana, found)).toBe(0);
  });
});
