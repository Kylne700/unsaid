// The seal at the action layer: the same functions the UI and the chat agent call, through a real (in-memory) database.
import type { ActionCaller, ActionRunContext } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { beforeAll, describe, expect, it } from "vitest";
import advancePhase from "../../actions/advance-phase";
import approveDraft from "../../actions/approve-draft";
import castVote from "../../actions/cast-vote";
import createPracticeRoom from "../../actions/create-practice-room";
import createRoom from "../../actions/create-room";
import extractCardsAction from "../../actions/extract-cards";
import getRoom from "../../actions/get-room";
import guessWho from "../../actions/guess-who";
import joinRoom from "../../actions/join-room";
import markDone from "../../actions/mark-done";
import mergeCards from "../../actions/merge-cards";
import rateCard from "../../actions/rate-card";
import saveDraft from "../../actions/save-draft";
import saveNotes from "../../actions/save-notes";
import setInitialPick from "../../actions/set-initial-pick";
import { MIGRATIONS } from "../db/migrations";
import { loadRoom } from "../db/store";
import { memberByToken } from "../domain/room";
import { keysDeep, must, SEALED_KEYS } from "../domain/test-helpers";
import { guestOwner } from "./guest";

type Act<I, R> = { run: (args: I, ctx?: ActionRunContext) => Promise<R> | R };
const call = <I, R>(a: Act<I, R>, args: I, caller: ActionCaller = "http"): Promise<R> => Promise.resolve(a.run(args, { caller }));
const ALL_CALLERS: ActionCaller[] = ["tool", "http", "frontend", "mcp", "a2a", "cli", "automation", "webmcp", "mcp-widget", "mcp-widget-write"];

/** The owner id the chat plugin gives the guest run of the member holding `token` (server/lib/guest.ts). */
async function ownerOf(code: string, token: string): Promise<string> {
  const room = must(await loadRoom(code));
  return guestOwner(room, must(memberByToken(room, token)));
}
/** The in-app agent's call: inside a guest run bound to that member's seat, without a code or token (its tool schema has neither). */
const agent = async <I, R>(code: string, token: string, a: Act<I, R>, args: I): Promise<R> => {
  const userEmail = await ownerOf(code, token);
  return runWithRequestContext({ userEmail, agentRunAnonymous: true }, () => call(a, args, "tool"));
};

type AnyView = Record<string, any>; // the action result, read by key like any client would

beforeAll(async () => {
  for (const m of MIGRATIONS) await getDbExec().execute(m.sql as string);
});

/** A live room of three people, all driven through the actions. */
async function newRoom() {
  const made = await call(createRoom, { question: "Which city should we move to?", options: ["Lisbon", "Berlin", "Oslo"], name: "Ana" });
  const ben = await call(joinRoom, { code: made.code, name: "Ben" });
  const cy = await call(joinRoom, { code: made.code, name: "Cy" });
  const who = { ana: made.token, ben: ben.token, cy: cy.token };
  const view = (token?: string, caller: ActionCaller = "http") =>
    (caller === "tool" ? agent(made.code, must(token), getRoom, {}) : call(getRoom, token === undefined ? { code: made.code } : { code: made.code, token }, caller)) as Promise<AnyView>;
  return { code: made.code, who, view };
}
const both = (code: string, token: string) => ({ code, token });

describe("caller allowlist for a member's own judgment", () => {
  it("the in-app agent and every other non-UI caller are refused; the UI and plain HTTP are allowed", async () => {
    const r = await newRoom();
    const pick = (caller: ActionCaller | null) => {
      const args = { ...both(r.code, r.who.ana), optionId: "A" };
      return caller === null ? Promise.resolve(setInitialPick.run(args)) : call(setInitialPick, args, caller);
    };
    for (const caller of ALL_CALLERS.filter((c) => c !== "http" && c !== "frontend")) {
      await expect(pick(caller), caller).rejects.toMatchObject({ errorCode: "own_judgment_only", statusCode: 403 });
    }
    await expect(pick(null)).rejects.toMatchObject({ errorCode: "own_judgment_only" }); // no context at all
    expect((await r.view(r.who.ana)).me.hasInitialPick).toBe(false); // nothing was stored by the refused calls
    await expect(pick("frontend")).resolves.toBeDefined();
    await expect(pick("http")).resolves.toBeDefined();
    expect((await r.view(r.who.ana)).me.hasInitialPick).toBe(true);
  });

  it("rate-card and cast-vote are refused for the agent in the same way", async () => {
    const r = await newRoom();
    for (const t of [r.who.ana, r.who.ben, r.who.cy]) await call(markDone, { ...both(r.code, t), done: true });
    await call(saveDraft, { ...both(r.code, r.who.ana), text: "Lisbon has cheap flights.", option: "A", polarity: "pro" });
    const draftId = must(((await r.view(r.who.ana)).drafts as AnyView[])[0]).id as string;
    await call(approveDraft, { ...both(r.code, r.who.ana), draftId });
    await call(advancePhase, both(r.code, r.who.ana)); // weigh
    const cardId = must(((await r.view(r.who.ana)).weigh as AnyView).cards[0]).id as string;
    const notUi = ALL_CALLERS.filter((c) => c !== "http" && c !== "frontend");
    for (const caller of notUi) await expect(call(rateCard, { ...both(r.code, r.who.ana), cardId, weight: 3 }, caller), caller).rejects.toMatchObject({ errorCode: "own_judgment_only", statusCode: 403 });
    await call(rateCard, { ...both(r.code, r.who.ana), cardId, weight: 3 }, "frontend");
    await call(advancePhase, both(r.code, r.who.ana)); // vote
    for (const caller of notUi) await expect(call(castVote, { ...both(r.code, r.who.ana), optionId: "A" }, caller), caller).rejects.toMatchObject({ errorCode: "own_judgment_only", statusCode: 403 });
    expect(((await r.view(r.who.ana)).me as AnyView).hasVoted).toBe(false);
    await call(castVote, { ...both(r.code, r.who.ana), optionId: "A" }, "frontend");
    expect(((await r.view(r.who.ana)).me as AnyView).hasVoted).toBe(true);
  });
});

describe("the module list: what the chat agent can and cannot call", () => {
  const mods = import.meta.glob(["../../actions/*.ts", "!../../actions/run.ts"], { eager: true }) as Record<string, { default: { agentTool?: boolean } }>;
  const byName = Object.fromEntries(Object.entries(mods).map(([p, m]) => [p.replace(/^.*\/([^/]+)\.ts$/, "$1"), m.default]));
  it("hides the member-only actions from the agent and keeps the rest", () => {
    const hidden = Object.keys(byName).filter((n) => byName[n]?.agentTool === false).sort();
    expect(hidden).toEqual(["cast-vote", "create-practice-room", "create-room", "guess-who", "join-room", "rate-card", "set-initial-pick"]);
    const visible = Object.keys(byName).filter((n) => byName[n]?.agentTool !== false).sort();
    expect(visible).toEqual(["advance-phase", "approve-draft", "delete-draft", "extract-cards", "get-room", "mark-done", "merge-cards", "navigate", "save-draft", "save-notes", "unmerge-card", "view-screen", "withdraw-card"]);
    // no action exists that votes or recommends for the team
    expect(Object.keys(byName).filter((n) => /recommend|suggest|decide|choose/.test(n))).toEqual([]);
  });
});

describe("get-room gives every caller the same sealed view", () => {
  it("walks all five phases; identical for every caller kind; sealed before the reveal", async () => {
    const r = await newRoom();
    const checkPhase = async (phase: string) => {
      const reference = JSON.stringify(await r.view(r.who.ana, "http"));
      for (const caller of ALL_CALLERS) expect(JSON.stringify(await r.view(r.who.ana, caller)), `${phase}/${caller}`).toBe(reference);
      const v = JSON.parse(reference) as AnyView;
      expect(v.phase).toBe(phase);
      if (phase !== "reveal") {
        expect(v.reveal).toBeNull();
        const keys = keysDeep(v);
        for (const k of SEALED_KEYS) expect(keys.has(k), `${phase}: ${k}`).toBe(false);
      }
      // a guest, or a wrong token, only ever gets the join preview; the agent outside a seat gets nothing at all
      await expect(call(getRoom, both(r.code, r.who.ana), "tool")).rejects.toMatchObject({ errorCode: "no_seat", statusCode: 403 });
      for (const g of [await r.view(undefined), await r.view("not-a-real-token-1234567890")]) {
        expect(Object.keys(g).sort()).toEqual(["code", "guest", "joinable", "memberCount", "options", "phase", "practice", "question", "tokenInvalid"]);
        expect(JSON.stringify(g)).not.toMatch(/Ana|Ben|Cy|SENTINEL/);
      }
      return v;
    };

    // notes
    for (const [name, text] of [["ana", "ANA-SENTINEL Lisbon has cheap flights."], ["ben", "BEN-SENTINEL Berlin rents are rising. Berlin has a big tech scene."], ["cy", "CY-SENTINEL Oslo is dark in winter."]] as const) {
      if (name === "ben") await agent(r.code, r.who.ben, saveNotes, { text }); // the agent may help with notes
      else await call(saveNotes, { ...both(r.code, r.who[name]), text }, "frontend");
      await call(setInitialPick, { ...both(r.code, r.who[name]), optionId: name === "ana" ? "A" : name === "ben" ? "B" : "C" }, "frontend");
    }
    const notes = await checkPhase("notes");
    expect(notes.notes).toContain("ANA-SENTINEL");
    expect(JSON.stringify(notes)).not.toMatch(/BEN-SENTINEL|CY-SENTINEL/);
    for (const t of Object.values(r.who)) await call(markDone, { ...both(r.code, t), done: true });

    // cards: extraction and approval
    expect(await agent(r.code, r.who.ben, extractCardsAction, {})).toEqual({ added: 2, source: "splitter" }); // no Gemini key in tests
    expect(await agent(r.code, r.who.ben, extractCardsAction, {})).toEqual({ added: 0, source: "splitter" }); // running it twice adds nothing
    const cards = await checkPhase("cards");
    expect(cards.drafts).toEqual([]); // Ana has none, Ben's two are Ben's alone
    const benDrafts = (await r.view(r.who.ben)).drafts as AnyView[];
    expect(benDrafts).toHaveLength(2);
    for (const d of benDrafts) {
      expect(d.option).toBe("B"); // guessed from the name
      expect(d.polarity).toBeNull(); // never guessed
      await call(saveDraft, { ...both(r.code, r.who.ben), draftId: d.id, text: d.text, option: "B", polarity: d.text.includes("rising") ? "con" : "pro" });
      await call(approveDraft, { ...both(r.code, r.who.ben), draftId: d.id });
    }
    for (const [token, text, option, polarity] of [[r.who.ana, "Lisbon has cheap flights.", "A", "pro"], [r.who.cy, "Oslo is dark in winter.", "C", "con"], [r.who.cy, "Lisbon cheap flights.", "A", "pro"]] as const) {
      const made = await call(saveDraft, { ...both(r.code, token), text, option, polarity });
      await call(approveDraft, { ...both(r.code, token), draftId: made.draftId });
    }
    // 5 approved cards. Each member's view holds only their own, the others come as a number (and no text of theirs)
    const anaCards = (await r.view(r.who.ana)).ledger as AnyView[];
    const cyCards = (await r.view(r.who.cy)).ledger as AnyView[];
    expect(anaCards.map((c) => c.text)).toEqual(["Lisbon has cheap flights."]);
    expect(cyCards.map((c) => c.text).sort()).toEqual(["Lisbon cheap flights.", "Oslo is dark in winter."]);
    expect([(await r.view(r.who.ana)).othersCardCount, (await r.view(r.who.ben)).othersCardCount, (await r.view(r.who.cy)).othersCardCount]).toEqual([4, 3, 3]);
    expect(JSON.stringify(await r.view(r.who.ana))).not.toMatch(/Berlin rents|Berlin has a big tech|Oslo is dark|Lisbon cheap flights/);
    // Across members a merge is a weigh-phase move: before it, Ana can neither absorb Cy's card nor fold her own into it. A member cannot
    // read another member's card id from any view, so the test hands over Cy's id from Cy's own view (Ana's view of that moment holds none of it).
    const [x, y] = [anaCards.find((c) => c.text === "Lisbon has cheap flights."), cyCards.find((c) => c.text === "Lisbon cheap flights.")];
    await expect(call(mergeCards, { ...both(r.code, r.who.ana), keepId: must(x).id, absorbId: must(y).id })).rejects.toMatchObject({ errorCode: "forbidden", statusCode: 403 });
    await expect(call(mergeCards, { ...both(r.code, r.who.ana), keepId: must(y).id, absorbId: must(x).id })).rejects.toMatchObject({ errorCode: "bad_phase", statusCode: 409 });
    expect(((await r.view(r.who.ana)).ledger as AnyView[]).map((c) => c.holderCount)).toEqual([1]); // nothing merged
    expect((await r.view(r.who.ana)).othersCardCount).toBe(4);
    expect((await r.view(r.who.ana)).uniqueCount).toBe(5);
    await agent(r.code, r.who.ana, advancePhase, {}); // the creator moves the room on

    // weigh: nothing about the cards but neutral text
    const weigh = await checkPhase("weigh");
    expect(weigh.ledger).toBeNull();
    expect(weigh.weigh.total).toBe(5);
    expect(JSON.stringify(weigh.weigh)).not.toMatch(/Lisbon|Berlin|Oslo|"holders"|"option"/);
    // The first moment members can see each other's cards, so duplicates are merged here: Cy wrote Ana's Lisbon fact again.
    const weighCards = async (token: string) => ((await r.view(token)).weigh as AnyView).cards as AnyView[];
    const anaOwn = must((await weighCards(r.who.ana)).find((c) => c.mine));
    const cyDup = must((await weighCards(r.who.cy)).find((c) => c.mine && /cheap flights/.test(c.neutral)));
    await expect(call(mergeCards, { ...both(r.code, r.who.ben), keepId: anaOwn.id, absorbId: cyDup.id })).rejects.toMatchObject({ errorCode: "forbidden", statusCode: 403 }); // Ben holds neither
    await expect(agent(r.code, r.who.ana, mergeCards, { keepId: anaOwn.id, absorbId: cyDup.id })).rejects.toMatchObject({ errorCode: "forbidden", statusCode: 403 }); // nor can Ana's agent absorb Cy's card
    expect(await weighCards(r.who.ana)).toHaveLength(5); // nothing merged yet
    await agent(r.code, r.who.cy, mergeCards, { keepId: anaOwn.id, absorbId: cyDup.id }); // Cy's agent, on Cy's request, folds Cy's own card in
    const merged = await weighCards(r.who.ana);
    expect(merged).toHaveLength(4);
    expect(((await r.view(r.who.ana)).weigh as AnyView).total).toBe(4);
    for (const [name, t, mine] of [["Ana", r.who.ana, 1], ["Ben", r.who.ben, 2], ["Cy", r.who.cy, 2]] as const) {
      const cardsOfMember = await weighCards(t);
      expect(cardsOfMember.filter((c) => c.mine), `${name}: cards flagged mine`).toHaveLength(mine); // Cy now holds the merged card as well as the Oslo one
      expect(JSON.stringify(cardsOfMember)).not.toMatch(/Lisbon|Berlin|Oslo|"holders"|"option"|"by"|merged|absorbed/);
    }
    await expect(call(markDone, { ...both(r.code, r.who.ana), done: true })).rejects.toMatchObject({ errorCode: "invalid", message: expect.stringContaining("Rate every card") });
    // every member rates every card, all at once: no rating may be lost
    await Promise.all(
      Object.values(r.who).flatMap((t, i) => merged.map((c) => call(rateCard, { ...both(r.code, t), cardId: c.id, weight: i + 1 }, "frontend"))),
    );
    for (const [i, t] of Object.values(r.who).entries()) {
      const w = (await r.view(t)).weigh as AnyView;
      expect(w.rated, `member ${i}`).toBe(4);
      expect(w.cards.every((c: AnyView) => c.myRating === i + 1)).toBe(true);
    }
    for (const t of Object.values(r.who)) await call(markDone, { ...both(r.code, t), done: true });

    // vote
    const vote = await checkPhase("vote");
    expect(vote.ledger).toHaveLength(4);
    expect((vote.ledger as AnyView[]).map((c) => c.holderCount).sort()).toEqual([1, 1, 1, 2]); // the merged Lisbon fact is known by two
    for (const [t, o] of [[r.who.ana, "A"], [r.who.ben, "B"]] as const) await call(castVote, { ...both(r.code, t), optionId: o }, "http");
    await checkPhase("vote"); // two of three have voted: still sealed
    await call(castVote, { ...both(r.code, r.who.cy), optionId: "C" }, "frontend");

    // reveal
    const reveal = await checkPhase("reveal");
    expect(reveal.reveal.members.map((m: AnyView) => [m.name, m.initialPick, m.vote])).toEqual([["Ana", "A", "A"], ["Ben", "B", "B"], ["Cy", "C", "C"]]);
    expect(reveal.reveal.disclaimer).toBe("Unsaid never votes or recommends. These are your team's facts and your team's weights.");
    expect(reveal.drafts).toBeNull();
    expect(reveal.notes).toBeNull();
  });

  it("a wrong token cannot write, and unknown rooms say so", async () => {
    const r = await newRoom();
    await expect(call(saveNotes, { ...both(r.code, "not-a-real-token-1234567890"), text: "x" })).rejects.toMatchObject({ errorCode: "forbidden", statusCode: 403 });
    await expect(call(getRoom, { code: "ZZZZZZ" })).rejects.toMatchObject({ errorCode: "not_found", statusCode: 404 });
    await expect(call(joinRoom, { code: r.code, name: "ana" })).rejects.toMatchObject({ errorCode: "conflict" });
  });

  it("only hashes of the tokens are stored", async () => {
    const r = await newRoom();
    const { rows } = await getDbExec().execute({ sql: "SELECT doc FROM unsaid_rooms WHERE code = ?", args: [r.code] });
    const doc = String(rows[0]?.doc);
    for (const t of Object.values(r.who)) expect(doc).not.toContain(t);
    expect(doc).toContain("tokenHash");
  });
});

describe("practice room through the actions", () => {
  it("gives the visitor m1 with a prepared memo, and no way to see the simulated teammates' private notes", async () => {
    const made = await call(createPracticeRoom, {});
    const v = (await agent(made.code, made.token, getRoom, {})) as AnyView;
    expect(v.practice).toEqual({ title: expect.any(String) });
    expect(v.me).toMatchObject({ id: "m1", isCreator: true, hasInitialPick: false });
    expect(v.members.map((m: AnyView) => [m.id, m.simulated])).toEqual([["m1", false], ["m2", true], ["m3", true]]);
    expect(v.notes.length).toBeGreaterThan(200);
    await expect(call(joinRoom, { code: made.code, name: "Dee" })).rejects.toMatchObject({ errorCode: "forbidden" });
    await expect(call(markDone, { ...both(made.code, made.token), done: true })).rejects.toMatchObject({ message: expect.stringContaining("Seal your lean") });
  });
});

describe("the chat agent acts only as the seat its run is bound to", () => {
  const mods = import.meta.glob(["../../actions/*.ts", "!../../actions/run.ts"], { eager: true }) as Record<string, { default: Act<Record<string, unknown>, unknown> & { agentTool?: boolean } }>;
  const byName = Object.fromEntries(Object.entries(mods).map(([p, m]) => [p.replace(/^.*\/([^/]+)\.ts$/, "$1"), m.default]));
  // Every room tool the agent has, with valid arguments for it.
  const ROOM_TOOLS: Record<string, Record<string, unknown>> = {
    "advance-phase": {},
    "approve-draft": { draftId: "d1" },
    "delete-draft": { draftId: "d1" },
    "extract-cards": {},
    "get-room": {},
    "mark-done": { done: true },
    "merge-cards": { keepId: "c1", absorbId: "c2" },
    "save-draft": { text: "Lisbon has cheap flights.", option: "A", polarity: "pro" },
    "save-notes": { text: "SEATLESS-WRITE" },
    "unmerge-card": { cardId: "c1", absorbedId: "c2" },
    "withdraw-card": { cardId: "c1" },
  };
  const docOf = async (code: string) => String((await getDbExec().execute({ sql: "SELECT doc FROM unsaid_rooms WHERE code = ?", args: [code] })).rows[0]?.doc);

  it("covers every agent tool except navigation", () => {
    const visible = Object.keys(byName).filter((n) => byName[n]?.agentTool !== false && n !== "navigate" && n !== "view-screen");
    expect(Object.keys(ROOM_TOOLS).sort()).toEqual(visible.sort());
  });

  it("refuses every room tool without a bound seat, even with a member's code and token in its arguments", async () => {
    const r = await newRoom();
    const anaOwner = await ownerOf(r.code, r.who.ana);
    const benTag = must(/-[0-9a-f]{16}@/.exec(await ownerOf(r.code, r.who.ben)))[0];
    const practice = await call(createPracticeRoom, {});
    const practiceRoom = must(await loadRoom(practice.code));
    const runs: [string, (fn: () => Promise<unknown>) => Promise<unknown>][] = [
      ["no run context", (fn) => fn()],
      ["a signed-in session, even with a seat-shaped email", (fn) => Promise.resolve(runWithRequestContext({ userEmail: anaOwner }, fn))],
      ["a guest run with a made-up tag", (fn) => Promise.resolve(runWithRequestContext({ userEmail: anaOwner.replace(/-[0-9a-f]{16}@/, "-0123456789abcdef@"), agentRunAnonymous: true }, fn))],
      ["a guest run with another member's tag", (fn) => Promise.resolve(runWithRequestContext({ userEmail: anaOwner.replace(/-[0-9a-f]{16}@/, benTag), agentRunAnonymous: true }, fn))],
      ["a guest run of a simulated teammate", (fn) => Promise.resolve(runWithRequestContext({ userEmail: guestOwner(practiceRoom, must(practiceRoom.members.find((m) => m.simulated))), agentRunAnonymous: true }, fn))],
      ["a framework guest run without a seat", (fn) => Promise.resolve(runWithRequestContext({ userEmail: "anon-1234@guest.agent-native.invalid", agentRunAnonymous: true }, fn))],
    ];
    const before = await docOf(r.code);
    for (const [label, inRun] of runs) {
      for (const [name, args] of Object.entries(ROOM_TOOLS)) {
        const act = must(byName[name]);
        await expect(inRun(() => call(act, { ...both(r.code, r.who.ana), ...args }, "tool")), `${label}: ${name}`).rejects.toMatchObject({ errorCode: "no_seat", statusCode: 403 });
      }
    }
    expect(await docOf(r.code)).toBe(before); // nothing was written
  });

  it("ignores a code or token in its arguments: it acts as its own seat, in its own room", async () => {
    const r = await newRoom();
    const other = await newRoom();
    await agent(r.code, r.who.ben, saveNotes, { ...both(r.code, r.who.ana), text: "BEN-SEAT-1" });
    await agent(r.code, r.who.ben, saveNotes, { ...both(other.code, other.who.ana), text: "BEN-SEAT-2" });
    expect((await r.view(r.who.ben)).notes).toBe("BEN-SEAT-2");
    expect((await r.view(r.who.ana)).notes).toBe("");
    expect((await other.view(other.who.ana)).notes).toBe("");
    // and inside its seat it still never makes a member's own judgment
    await expect(agent(r.code, r.who.ben, setInitialPick, { optionId: "A" })).rejects.toMatchObject({ errorCode: "own_judgment_only" });
  });

  it("two seats of one room each get exactly their member's view", async () => {
    const r = await newRoom();
    await call(saveNotes, { ...both(r.code, r.who.ana), text: "ANA-ONLY" });
    await call(saveNotes, { ...both(r.code, r.who.ben), text: "BEN-ONLY" });
    for (const t of [r.who.ana, r.who.ben]) expect(await r.view(t, "tool")).toEqual(await r.view(t));
    expect(JSON.stringify(await r.view(r.who.ana, "tool"))).not.toContain("BEN-ONLY");
    expect(JSON.stringify(await r.view(r.who.ben, "tool"))).not.toContain("ANA-ONLY");
  });

  it("every other caller needs the code and the member's token", async () => {
    const r = await newRoom();
    for (const caller of ALL_CALLERS.filter((c) => c !== "tool")) {
      await expect(call(saveNotes, { code: r.code, text: "x" }, caller), caller).rejects.toMatchObject({ errorCode: "forbidden", statusCode: 403 });
      await expect(call(extractCardsAction, { token: r.who.ana }, caller), caller).rejects.toMatchObject({ errorCode: "forbidden", statusCode: 403 });
      expect(((await call(getRoom, { code: r.code }, caller)) as AnyView).guest, caller).toBe(true);
    }
  });
});

describe("guess who and the alone check through the actions", () => {
  /** A live room in the vote phase: Ana holds one card (Lisbon), Ben holds one (Berlin), Cy none. */
  async function voteRoom() {
    const r = await newRoom();
    const guess = (token: string, args: { cardId: string; candidateId: string | null }, caller: ActionCaller = "frontend") => call(guessWho, { ...both(r.code, token), ...args }, caller);
    for (const t of Object.values(r.who)) await call(markDone, { ...both(r.code, t), done: true }); // cards
    for (const [token, text, option, polarity] of [[r.who.ana, "Lisbon has cheap flights.", "A", "pro"], [r.who.ben, "Berlin rents are rising.", "B", "con"]] as const) {
      const made = await call(saveDraft, { ...both(r.code, token), text, option, polarity });
      await call(approveDraft, { ...both(r.code, token), draftId: made.draftId });
    }
    const early = await guess(r.who.cy, { cardId: "c_x", candidateId: null }).catch((e) => e);
    await call(advancePhase, both(r.code, r.who.ana)); // weigh
    await call(advancePhase, both(r.code, r.who.ana)); // vote
    const ids = { ana: ((await r.view(r.who.ana)).me as AnyView).id as string, ben: ((await r.view(r.who.ben)).me as AnyView).id as string, cy: ((await r.view(r.who.cy)).me as AnyView).id as string };
    const cardOf = async (token: string, text: string) => must(((await r.view(token)).ledger as AnyView[]).find((c) => c.text === text)).id as string;
    return { ...r, guess, ids, early, lisbon: await cardOf(r.who.cy, "Lisbon has cheap flights."), berlin: await cardOf(r.who.cy, "Berlin rents are rising.") };
  }

  it("refuses the agent and every other non-UI caller, and the wrong phase, cards and members", async () => {
    const r = await voteRoom();
    expect(r.early).toMatchObject({ errorCode: "bad_phase" });
    const notUi = ALL_CALLERS.filter((c) => c !== "http" && c !== "frontend");
    for (const caller of notUi) await expect(r.guess(r.who.cy, { cardId: r.lisbon, candidateId: r.ids.ana }, caller), caller).rejects.toMatchObject({ errorCode: "own_judgment_only", statusCode: 403 });
    await expect(agent(r.code, r.who.cy, guessWho, { cardId: r.lisbon, candidateId: r.ids.ana })).rejects.toMatchObject({ errorCode: "own_judgment_only" }); // inside its own seat too
    await expect(r.guess(r.who.cy, { cardId: "c_nope", candidateId: r.ids.ana })).rejects.toMatchObject({ errorCode: "not_found" });
    await expect(r.guess(r.who.cy, { cardId: r.lisbon, candidateId: "m9" })).rejects.toMatchObject({ errorCode: "invalid" });
    await expect(r.guess(r.who.cy, { cardId: r.lisbon, candidateId: r.ids.cy })).rejects.toMatchObject({ errorCode: "invalid" }); // not yourself
    await expect(r.guess(r.who.ana, { cardId: r.lisbon, candidateId: r.ids.ben })).rejects.toMatchObject({ errorCode: "invalid" }); // your own card
    await expect(call(guessWho, { code: r.code, cardId: r.lisbon, candidateId: r.ids.ana })).rejects.toMatchObject({ errorCode: "forbidden" }); // no token
    await expect(r.guess("not-a-real-token-1234567890", { cardId: r.lisbon, candidateId: r.ids.ana })).rejects.toMatchObject({ errorCode: "forbidden" });
    expect(String(await docOfRoom(r.code))).not.toContain("whoGuesses"); // nothing was stored by any refused call
  });

  it("keeps a member's guess in that member's own view only, never in the agent's", async () => {
    const r = await voteRoom();
    const [ana0, ben0] = [JSON.stringify(await r.view(r.who.ana)), JSON.stringify(await r.view(r.who.ben))];
    await r.guess(r.who.cy, { cardId: r.lisbon, candidateId: r.ids.ben }, "http"); // wrong on purpose
    await r.guess(r.who.cy, { cardId: r.berlin, candidateId: r.ids.ben }, "frontend");
    const mine = (await r.view(r.who.cy)).ledger as AnyView[];
    expect(mine.map((c) => [c.text, c.guessable, c.myGuess])).toEqual(expect.arrayContaining([["Lisbon has cheap flights.", true, r.ids.ben], ["Berlin rents are rising.", true, r.ids.ben]]));
    const theirs = (await r.view(r.who.cy, "tool")).ledger as AnyView[];
    expect(theirs.map((c) => c.myGuess)).toEqual([null, null]);
    expect(theirs.map((c) => c.guessable)).toEqual([true, true]);
    // Ana and Ben see exactly what they saw before, from the UI and from the agent
    expect(JSON.stringify(await r.view(r.who.ana))).toBe(ana0);
    expect(JSON.stringify(await r.view(r.who.ben))).toBe(ben0);
    expect(JSON.stringify(await r.view(r.who.ana, "tool"))).toBe(ana0);
    // Ana's own card is not hers to guess; Ben's is
    expect(((await r.view(r.who.ana)).ledger as AnyView[]).map((c) => [c.text, c.guessable])).toEqual(expect.arrayContaining([["Lisbon has cheap flights.", false], ["Berlin rents are rising.", true]]));
    await r.guess(r.who.cy, { cardId: r.lisbon, candidateId: null }); // not sure takes it back
    expect(((await r.view(r.who.cy)).ledger as AnyView[]).find((c) => c.id === r.lisbon)?.myGuess).toBeNull();
  });

  it("seals the alone-check number with the vote, refuses a bad one, and shows each member only their own at the reveal", async () => {
    const r = await voteRoom();
    await expect(call(castVote, { ...both(r.code, r.who.ana), optionId: "A", expectSame: 3 }, "frontend")).rejects.toMatchObject({ errorCode: "invalid", message: expect.stringContaining("0 to 2") });
    await expect(call(castVote, { ...both(r.code, r.who.ana), optionId: "A", expectSame: 1.5 }, "frontend")).rejects.toBeDefined();
    expect(((await r.view(r.who.ana)).me as AnyView).hasVoted).toBe(false); // the refused vote sealed nothing
    await call(castVote, { ...both(r.code, r.who.ana), optionId: "A", expectSame: 2 }, "frontend");
    await call(castVote, { ...both(r.code, r.who.ben), optionId: "A" }, "http"); // no guess given
    const sealed = JSON.stringify(await r.view(r.who.cy));
    expect(sealed).not.toMatch(/expectSame|aloneGuesses|aloneCheck/);
    await call(castVote, { ...both(r.code, r.who.cy), optionId: "C", expectSame: 0 }, "frontend");
    const ana = (await r.view(r.who.ana)).reveal as AnyView;
    expect(ana.aloneCheck).toEqual({ expected: 2, actual: 1, others: 2 }); // only Ben voted A too
    expect(((await r.view(r.who.ben)).reveal as AnyView).aloneCheck).toBeNull();
    expect(((await r.view(r.who.cy)).reveal as AnyView).aloneCheck).toEqual({ expected: 0, actual: 0, others: 2 });
    expect(JSON.stringify(await r.view(r.who.cy))).not.toMatch(/aloneGuesses|expectSame/);
    expect(((await r.view(r.who.ana, "tool")).reveal as AnyView).aloneCheck).toBeNull(); // not in the chat
    expect(ana.guessWho).toEqual({ scope: "room", result: null }); // nobody guessed
    await expect(r.guess(r.who.cy, { cardId: r.lisbon, candidateId: r.ids.ana })).rejects.toMatchObject({ errorCode: "bad_phase" }); // locked
  });
});

async function docOfRoom(code: string) {
  return (await getDbExec().execute({ sql: "SELECT doc FROM unsaid_rooms WHERE code = ?", args: [code] })).rows[0]?.doc;
}
