import { describe, expect, it } from "vitest";
import { approveDraft, castVote, createPractice, createRoom, deleteDraft, joinRoom, memberByToken, rateCard, saveDraft, setDone, setInitialPick } from "./room";
import { holdersOf } from "./ledger";
import type { Member, Phase, Room } from "./types";
import { buildRoom as build, DRAFT, expectSealed, must, NOTES } from "./test-helpers";
import { guestView, viewRoom, type RoomView } from "./view";

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

  it("vote: the ledger returns (option, whether you hold it, how many hold it) with the caller's own ratings and guesses only", () => {
    const t = build("vote");
    const v = asView(t.room, t.ana);
    const ledger = must(v.ledger);
    expect(ledger).toHaveLength(8);
    for (const c of ledger) expect(Object.keys(c).sort()).toEqual(["guessable", "holderCount", "id", "merged", "mine", "myGuess", "myRating", "option", "polarity", "text"]);
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

/** The same room, but the two other members have traded every card they hold (nothing the viewer holds or counts changes). */
function swapOthers(room: Room, a: Member, b: Member): Room {
  const copy = JSON.parse(JSON.stringify(room)) as Room;
  const swap = (ids: string[]) => ids.map((id) => (id === a.id ? b.id : id === b.id ? a.id : id));
  for (const c of copy.cards) {
    c.ownHolders = swap(c.ownHolders);
    for (const p of c.absorbed) p.ownHolders = swap(p.ownHolders);
  }
  return copy;
}

describe("the ledger is anonymous until the reveal", () => {
  const seats = (t: ReturnType<typeof build>) => [[t.ana, t.ben, t.cy], [t.ben, t.ana, t.cy], [t.cy, t.ana, t.ben]] as const;

  it.each(["notes", "cards", "weigh", "vote"] as Phase[])("%s: if the other two members had held each other's cards, nobody's view would differ", (phase) => {
    const t = build(phase, { merge: true });
    for (const [viewer, a, b] of seats(t)) {
      const swapped = swapOthers(t.room, a, b);
      if (t.room.cards.length) expect(JSON.stringify(swapped.cards), `${phase}: the swap must change something`).not.toBe(JSON.stringify(t.room.cards));
      const same = must(swapped.members.find((m) => m.id === viewer.id));
      expect(JSON.stringify(viewRoom(swapped, same)), `${phase}/${viewer.name}`).toBe(JSON.stringify(viewRoom(t.room, viewer)));
    }
  });

  it.each(["cards", "vote"] as Phase[])("%s: a ledger card or merged part names nobody and carries nobody's id", (phase) => {
    const t = build(phase, { merge: true });
    for (const m of t.all) {
      const v = asView(t.room, m);
      const { members: _members, me: _me, ...rest } = v;
      for (const [label, json] of [["ledger", JSON.stringify(v.ledger)], ["rest of the view", JSON.stringify(rest)]] as const) {
        for (const p of t.all) {
          expect(json, `${phase}/${m.name}/${label}: name ${p.name}`).not.toMatch(new RegExp(`\\b${p.name}\\b`));
          expect(json, `${phase}/${m.name}/${label}: id ${p.id}`).not.toContain(`"${p.id}"`);
        }
      }
    }
    // only the counts: Ben and Cy's merged card has two holders, its merged part one, and Ana is on neither
    const anaList = must(asView(t.room, t.ana).ledger);
    if (phase === "cards") expect(anaList.some((c) => c.merged.length), "cards: Ana does not hold the merged card, so her list has none").toBe(false);
    else {
      const merged = must(anaList.find((c) => c.merged.length));
      expect([merged.mine, merged.holderCount, merged.merged[0]?.mine, merged.merged[0]?.holderCount]).toEqual([false, 2, false, 1]);
    }
    expect(must(must(asView(t.room, t.cy).ledger).find((c) => c.merged.length)).merged[0]).toMatchObject({ mine: true, holderCount: 1 });
  });

  it("cards: a member gets their own approved cards in full and only a number for the others; the vote list then holds all of them", () => {
    const t = build("cards", { merge: true });
    for (const m of t.all) {
      const v = asView(t.room, m);
      const own = t.room.cards.filter((c) => holdersOf(c).includes(m.id));
      const others = t.room.cards.filter((c) => !holdersOf(c).includes(m.id));
      expect(must(v.ledger).map((c) => c.id).sort(), `${m.name}: own cards`).toEqual(own.map((c) => c.id).sort());
      expect(must(v.ledger).every((c) => c.mine), `${m.name}: every listed card is theirs`).toBe(true);
      expect(v.othersCardCount, `${m.name}: number of the others' cards`).toBe(others.length);
      const json = JSON.stringify(v);
      for (const c of others) {
        for (const secret of [c.id, c.text, ...c.absorbed.flatMap((a) => [a.id, a.text])]) expect(json, `${m.name} must not see ${secret}`).not.toContain(secret);
      }
      // the chat agent gets exactly the same
      expect(JSON.stringify(viewRoom(t.room, m, { agent: true })), `${m.name}: agent view`).toBe(json);
    }
    // positive control: the same strings do reach the screen once the room is at the vote list
    const later = build("vote", { merge: true });
    const vote = asView(later.room, later.ana);
    expect(must(vote.ledger)).toHaveLength(7);
    expect(vote.othersCardCount).toBeNull();
    expect(JSON.stringify(vote)).toContain("Berlin rents are rising.");
  });

  it("vote: the list is shuffled so the order the cards were approved in tells nothing; the same for everyone, stable per poll", () => {
    const t = build("vote");
    const order = (m: Member) => must(asView(t.room, m).ledger).map((c) => c.id);
    const approved = t.room.cards.map((c) => c.id);
    expect(order(t.ana)).not.toEqual(approved);
    expect([...order(t.ana)].sort()).toEqual([...approved].sort());
    expect(order(t.ana)).toEqual(order(t.ana));
    expect(order(t.ben)).toEqual(order(t.ana));
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

  it("cards phase: drafts, notes and approved cards are the caller's own; the others' approved cards are a number", () => {
    const t = build("cards");
    const a = asView(t.room, t.ana);
    expect(a.drafts?.map((d) => d.text)).toEqual([DRAFT.ana]);
    expect(a.notes).toBe(NOTES.ana);
    const json = JSON.stringify(a);
    for (const other of ["BEN-DRAFT-SENTINEL", "CY-DRAFT-SENTINEL", "BEN-NOTES-SENTINEL", "CY-NOTES-SENTINEL"]) expect(json).not.toContain(other);
    expect(a.ledger?.map((c) => c.text)).toEqual(["Lisbon has cheap flights.", "Lisbon summers are very hot.", "Oslo has great transit."]); // Ana's three
    expect(a.othersCardCount).toBe(5); // Ben's three and Cy's two
    expect(json).not.toContain("Berlin rents are rising.");
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
