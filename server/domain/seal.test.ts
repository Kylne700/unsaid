import { describe, expect, it } from "vitest";
import { approveDraft, castVote, createPractice, createRoom, deleteDraft, forceAdvance, joinRoom, memberByToken, rateCard, saveDraft, saveNotes, setDone, setInitialPick } from "./room";
import type { Member, Phase, Room } from "./types";
import { expectSealed, must } from "./test-helpers";
import { guestView, viewRoom, type RoomView } from "./view";

const NOTES = { ana: "ANA-NOTES-SENTINEL Lisbon has cheap flights.", ben: "BEN-NOTES-SENTINEL Berlin rents are rising.", cy: "CY-NOTES-SENTINEL Oslo is dark in winter." };
const DRAFT = { ana: "ANA-DRAFT-SENTINEL Lisbon is hilly.", ben: "BEN-DRAFT-SENTINEL Berlin is loud.", cy: "CY-DRAFT-SENTINEL Oslo is pricey." };

/** A live room with three members, brought to `upTo` with the creator's force-advance. */
function build(upTo: Phase) {
  const made = createRoom({ code: "SEALT1", question: "Which city should we move to?", options: ["Lisbon", "Berlin", "Oslo"], creatorName: "Ana" });
  const room: Room = made.room;
  room.seed = "fixed-seed";
  const ana = must(memberByToken(room, made.token));
  const ben = must(memberByToken(room, joinRoom(room, "Ben").token));
  const cy = must(memberByToken(room, joinRoom(room, "Cy").token));
  saveNotes(room, ana, NOTES.ana);
  saveNotes(room, ben, NOTES.ben);
  saveNotes(room, cy, NOTES.cy);
  setInitialPick(room, ana, "A");
  setInitialPick(room, ben, "B");
  setInitialPick(room, cy, "C");
  const t = { room, ana, ben, cy, all: [ana, ben, cy] as Member[] };
  if (upTo === "notes") return t;

  forceAdvance(room, ana); // cards
  const give = (m: Member, drafts: [string, string, "pro" | "con"][], keep: string) => {
    for (const [text, option, polarity] of drafts) approveDraft(room, m, saveDraft(room, m, { text, option, polarity }).id);
    saveDraft(room, m, { text: keep, option: null, polarity: null }); // stays a private draft
  };
  give(ana, [["Lisbon has cheap flights.", "A", "pro"], ["Lisbon summers are very hot.", "A", "con"], ["Oslo has great transit.", "C", "pro"]], DRAFT.ana);
  give(ben, [["Berlin rents are rising.", "B", "con"], ["Berlin has a big tech scene.", "B", "pro"], ["Lisbon has a tiny office market.", "A", "con"]], DRAFT.ben);
  give(cy, [["Oslo is dark in winter.", "C", "con"], ["Berlin nightlife is lively.", "B", "pro"]], DRAFT.cy);
  if (upTo === "cards") return t;

  forceAdvance(room, ana); // weigh
  const rating = new Map<string, 1 | 2 | 3>([[ana.id, 2], [ben.id, 3], [cy.id, 1]]);
  for (const m of t.all) for (const c of room.cards) rateCard(room, m, c.id, rating.get(m.id) ?? 0);
  if (upTo === "weigh") return t;

  forceAdvance(room, ana); // vote
  if (upTo === "vote") return t;

  castVote(room, ana, "A");
  castVote(room, ben, "B");
  castVote(room, cy, "C"); // last vote: the room reveals by itself
  return t;
}
const asView = (room: Room, m: Member): RoomView => viewRoom(room, m);

describe("the seal, phase by phase (view level)", () => {
  it.each(["notes", "cards", "weigh", "vote"] as Phase[])("%s: no votes, initial picks, scores or weights in anyone's view", (phase) => {
    const t = build(phase);
    expect(t.room.phase).toBe(phase);
    for (const m of t.all) {
      const v = asView(t.room, m);
      expect(v.reveal).toBeNull();
      expectSealed(v, `${phase}/${m.name}`);
    }
    // only the caller's own flags about their sealed choices
    expect(asView(t.room, t.ana).me.hasInitialPick).toBe(true);
    expect(asView(t.room, t.ana).me.hasVoted).toBe(false);
  });

  it("the guest preview carries no member data at all", () => {
    const t = build("vote");
    const g = guestView(t.room, false);
    expect(Object.keys(g).sort()).toEqual(["code", "guest", "joinable", "memberCount", "options", "phase", "practice", "question", "tokenInvalid"]);
    expect(JSON.stringify(g)).not.toMatch(/Ana|Ben|Cy|SENTINEL/);
  });

  it("weigh: neutral text only, no option, no holder, no total, shuffled per member and stable per poll", () => {
    const t = build("weigh");
    const a = asView(t.room, t.ana);
    expect(a.ledger).toBeNull();
    expect(a.drafts).toBeNull();
    expect(a.notes).toBeNull();
    const weigh = must(a.weigh);
    expect(weigh.total).toBe(8);
    expect(weigh.cards).toHaveLength(8);
    for (const c of weigh.cards) expect(Object.keys(c).sort()).toEqual(["id", "myRating", "neutral"]);
    const text = JSON.stringify(weigh);
    for (const word of ["Lisbon", "Berlin", "Oslo", "Ana", "Ben", "Cy", "holders", "polarity"]) expect(text, word).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
    expect(weigh.cards.some((c) => /this option/i.test(c.neutral))).toBe(true);

    const order = (m: Member) => must(asView(t.room, m).weigh).cards.map((c) => c.id);
    expect(order(t.ana)).toEqual(order(t.ana)); // same list on every poll
    expect(order(t.ana)).not.toEqual(order(t.ben)); // different list per member (fixed seed)
    expect([...order(t.ana)].sort()).toEqual([...order(t.ben)].sort());
  });

  it("weigh: a member sees only their own rating", () => {
    const t = build("weigh");
    expect(must(asView(t.room, t.ana).weigh).cards.every((c) => c.myRating === 2)).toBe(true);
    expect(must(asView(t.room, t.ben).weigh).cards.every((c) => c.myRating === 3)).toBe(true);
  });

  it("vote: the ledger returns (option and holders) with the caller's own ratings only", () => {
    const t = build("vote");
    const v = asView(t.room, t.ana);
    const ledger = must(v.ledger);
    expect(ledger).toHaveLength(8);
    for (const c of ledger) expect(Object.keys(c).sort()).toEqual(["holders", "id", "merged", "mine", "myRating", "option", "polarity", "text"]);
    expect(ledger.every((c) => c.myRating === 2)).toBe(true);
    expect(v.weigh).toBeNull();
  });

  it("reveal: votes, initial picks, scores and the changed facts finally appear", () => {
    const t = build("reveal");
    expect(t.room.phase).toBe("reveal");
    const r = must(asView(t.room, t.ben).reveal);
    expect(r.disclaimer).toBe("Unsaid never votes or recommends. These are your team's facts and your team's weights.");
    expect(r.members.map((m) => [m.name, m.initialPick, m.vote])).toEqual([["Ana", "A", "A"], ["Ben", "B", "B"], ["Cy", "C", "C"]]);
    expect(r.options.map((o) => o.votes)).toEqual([1, 1, 1]);
    expect(r.viewer.initialPick).toBe("B");
    expect(r.cards).toHaveLength(8);
  });

  it("viewing never changes the room", () => {
    const t = build("weigh");
    const before = JSON.stringify(t.room);
    for (const m of t.all) asView(t.room, m);
    guestView(t.room, true);
    expect(JSON.stringify(t.room)).toBe(before);
  });
});

describe("notes and draft cards go only to their owner", () => {
  it("notes phase: each member sees only their own notes", () => {
    const t = build("notes");
    expect(asView(t.room, t.ana).notes).toBe(NOTES.ana);
    const json = JSON.stringify(asView(t.room, t.ana));
    expect(json).not.toContain("BEN-NOTES-SENTINEL");
    expect(json).not.toContain("CY-NOTES-SENTINEL");
    expect(JSON.stringify(asView(t.room, t.ben))).not.toContain("ANA-NOTES-SENTINEL");
  });

  it("cards phase: drafts and notes are the caller's own; approved cards are shared", () => {
    const t = build("cards");
    const a = asView(t.room, t.ana);
    expect(a.drafts?.map((d) => d.text)).toEqual([DRAFT.ana]);
    expect(a.notes).toBe(NOTES.ana);
    const json = JSON.stringify(a);
    for (const other of ["BEN-DRAFT-SENTINEL", "CY-DRAFT-SENTINEL", "BEN-NOTES-SENTINEL", "CY-NOTES-SENTINEL"]) expect(json).not.toContain(other);
    expect(a.ledger).toHaveLength(8); // everyone's approved cards
    expect(a.ledger?.some((c) => c.text === "Berlin rents are rising.")).toBe(true);
    expect(a.uniqueCount).toBe(8); // no card has two holders yet
  });

  it("a member cannot edit, delete or approve someone else's draft", () => {
    const t = build("cards");
    const benDraft = must(t.room.drafts.find((d) => d.ownerId === t.ben.id));
    expect(() => saveDraft(t.room, t.ana, { draftId: benDraft.id, text: "hijack", option: "A", polarity: "pro" })).toThrow(/not found/i);
    expect(() => deleteDraft(t.room, t.ana, benDraft.id)).toThrow(/not found/i);
    expect(() => approveDraft(t.room, t.ana, benDraft.id)).toThrow(/not found/i);
    expect(benDraft.text).toBe(DRAFT.ben);
  });

  it("a draft that is not approved never reaches the ledger or later phases", () => {
    const t = build("reveal");
    const json = JSON.stringify(asView(t.room, t.ana));
    expect(json).not.toContain("DRAFT-SENTINEL");
    expect(json).not.toContain("NOTES-SENTINEL BEN");
    expect(asView(t.room, t.ana).drafts).toBeNull();
    expect(asView(t.room, t.ana).notes).toBeNull();
  });

  it("a token of another room, or none, opens nothing", () => {
    const t = build("cards");
    const other = createRoom({ code: "OTHER2", question: "Another question?", options: ["X1", "Y2"], creatorName: "Zed" });
    expect(memberByToken(t.room, other.token)).toBeNull();
    expect(memberByToken(t.room, undefined)).toBeNull();
    expect(memberByToken(t.room, "")).toBeNull();
  });
});

describe("practice mode, end to end in the domain", () => {
  it("walks the trap: the pooled facts point away from the sealed lean", () => {
    const p = createPractice("PRACT1");
    const room = p.room;
    const me = must(memberByToken(room, p.token));
    expect(room.members.map((m) => [m.id, m.simulated])).toEqual([["m1", false], ["m2", true], ["m3", true]]);
    expect(room.creatorId).toBe("m1");
    expect(room.initialPicks).toEqual({ m2: "B", m3: "B" }); // scripted lean of the simulated teammates
    expect(room.notes.m1?.length).toBeGreaterThan(200); // the memo
    // the teammates' memos stay private
    const memo2 = must(room.notes.m2).slice(0, 40);
    expect(JSON.stringify(viewRoom(room, me))).not.toContain(memo2);

    setInitialPick(room, me, "B"); // m1 falls for it
    setDone(room, me, true);
    expect(room.phase).toBe("cards");
    expect(room.cards).toHaveLength(12); // the teammates' facts, pre-approved
    expect(room.drafts.filter((d) => d.ownerId === "m1")).toHaveLength(9); // prepared from the memo
    expect(room.drafts.every((d) => d.origin === "practice" && d.phrase)).toBe(true);
    expect(viewRoom(room, me).uniqueCount).toBe(6);

    for (const d of [...room.drafts]) approveDraft(room, me, d.id);
    expect(room.cards).toHaveLength(15);
    expect(room.cards.filter((c) => c.ownHolders.length === 3)).toHaveLength(6); // same fact id = one card, three holders
    expect(viewRoom(room, me).uniqueCount).toBe(9);
    setDone(room, me, true);

    expect(room.phase).toBe("weigh");
    expect(Object.keys(room.ratings).sort()).toEqual(["m2", "m3"]);
    for (const c of room.cards) rateCard(room, me, c.id, 2);
    setDone(room, me, true);

    expect(room.phase).toBe("vote");
    expect(room.votes).toEqual({ m2: "A", m3: "A" }); // each votes for what their own weights put first on the full ledger
    expectSealed(viewRoom(room, me), "practice/vote");
    castVote(room, me, "B");

    expect(room.phase).toBe("reveal");
    const rv = must(viewRoom(room, me).reveal);
    expect(rv.viewer).toMatchObject({ initialPick: "B", vote: "B", ownTop: ["B"], ownTied: false, fullTop: ["A"], fullTied: false });
    expect(rv.fullRanking.groups[0]?.options).toEqual(["A"]);
    for (const m of rv.members) expect(m.ownRanking.groups[0]?.options, `${m.name} own facts only`).toEqual(["B"]);
    expect(rv.sharedRanking.groups[0]?.options).toEqual(["B"]);
    expect(rv.moved).toEqual({ up: ["A"], down: ["B"] });
    expect(rv.changed).toHaveLength(9);
    expect(rv.changed.every((c) => c.holders.length === 1)).toBe(true);
    expect(rv.members.map((m) => m.vote)).toEqual(["B", "A", "A"]);
  });

  it("is single-player: nobody can join", () => {
    const p = createPractice("PRACT2");
    expect(() => joinRoom(p.room, "Dee")).toThrow(/single-player/i);
  });
});
