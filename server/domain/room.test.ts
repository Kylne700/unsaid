import { describe, expect, it } from "vitest";
import { extractCards } from "./extract-cards";
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
    throwsKind(() => mergeCards(t.room, t.ana, c.id, c.id), "bad_phase");
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

  it("merge unions the holders, unmerge restores both cards, and the unique count follows", () => {
    const t = live();
    forceAdvance(t.room, t.ana);
    const x = card(t.room, t.ana, "Lisbon flights are cheap.", "A", "pro");
    const y = card(t.room, t.ben, "Cheap flights to Lisbon.", "A", "pro");
    const z = card(t.room, t.cy, "Oslo is expensive.", "C", "con");
    expect(uniqueCount(t.room.cards)).toBe(3);

    throwsKind(() => mergeCards(t.room, t.ana, x.id, z.id), "conflict"); // different option and side
    throwsKind(() => mergeCards(t.room, t.cy, x.id, y.id), "forbidden"); // Cy holds neither
    mergeCards(t.room, t.ana, x.id, y.id);
    expect(t.room.cards).toHaveLength(2);
    expect(holdersOf(x).sort()).toEqual([t.ana.id, t.ben.id].sort());
    expect(uniqueCount(t.room.cards)).toBe(1); // only Cy's card is single-holder now

    unmergeCard(t.room, t.ben, x.id, y.id);
    expect(t.room.cards).toHaveLength(3);
    expect(holdersOf(x)).toEqual([t.ana.id]);
    expect(holdersOf(must(t.room.cards.find((c) => c.id === y.id)))).toEqual([t.ben.id]);
    expect(uniqueCount(t.room.cards)).toBe(3);
  });

  it("a card merged twice splits back out one card at a time", () => {
    const t = live();
    forceAdvance(t.room, t.ana);
    const x = card(t.room, t.ana, "Berlin is lively.", "B", "pro");
    const y = card(t.room, t.ben, "Berlin has nightlife.", "B", "pro");
    const z = card(t.room, t.cy, "Berlin feels alive.", "B", "pro");
    mergeCards(t.room, t.ana, x.id, y.id);
    mergeCards(t.room, t.ana, x.id, z.id);
    expect(holdersOf(x)).toHaveLength(3);
    throwsKind(() => withdrawCard(t.room, t.ana, x.id), "conflict"); // split first
    unmergeCard(t.room, t.cy, x.id, z.id);
    expect(holdersOf(x).sort()).toEqual([t.ana.id, t.ben.id].sort());
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

describe("extractCards stub", () => {
  const options = [
    { id: "A", name: "Lisbon", aliases: [] },
    { id: "B", name: "Berlin", aliases: ["BER"] },
  ];
  it("splits bullets and sentences, guesses the option by name, never the side", () => {
    const out = extractCards("- Lisbon has cheap flights. Rent is low!\n2) Berlin is lively; Lisbon beats Berlin on sun.\nok", options);
    expect(out.map((x) => x.text)).toEqual(["Lisbon has cheap flights.", "Rent is low!", "Berlin is lively; Lisbon beats Berlin on sun."]);
    expect(out.map((x) => x.option)).toEqual(["A", null, null]); // none or two named: unset
    expect(out.every((x) => x.polarity === null)).toBe(true);
    expect(out[0]?.neutral).toBe("This option has cheap flights.");
    expect(out[2]?.neutral).toBe("This option is lively; another option beats this option on sun.");
  });

  it("adds drafts once: running it twice does not duplicate", () => {
    const t = live();
    forceAdvance(t.room, t.ana);
    const found = extractCards("Lisbon has cheap flights. Oslo is dark.", t.room.options);
    expect(addExtractedDrafts(t.room, t.ana, found)).toBe(2);
    expect(addExtractedDrafts(t.room, t.ana, found)).toBe(0);
  });
});
