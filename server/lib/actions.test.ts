// The seal at the action layer: the same functions the UI and the chat agent call, through a real (in-memory) database.
import type { ActionCaller, ActionRunContext } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { beforeAll, describe, expect, it } from "vitest";
import advancePhase from "../../actions/advance-phase";
import approveDraft from "../../actions/approve-draft";
import castVote from "../../actions/cast-vote";
import createPracticeRoom from "../../actions/create-practice-room";
import createRoom from "../../actions/create-room";
import extractCardsAction from "../../actions/extract-cards";
import getRoom from "../../actions/get-room";
import joinRoom from "../../actions/join-room";
import markDone from "../../actions/mark-done";
import mergeCards from "../../actions/merge-cards";
import rateCard from "../../actions/rate-card";
import saveDraft from "../../actions/save-draft";
import saveNotes from "../../actions/save-notes";
import setInitialPick from "../../actions/set-initial-pick";
import { MIGRATIONS } from "../db/migrations";
import { keysDeep, must, SEALED_KEYS } from "../domain/test-helpers";

type Act<I, R> = { run: (args: I, ctx?: ActionRunContext) => Promise<R> | R };
const call = <I, R>(a: Act<I, R>, args: I, caller: ActionCaller = "http"): Promise<R> => Promise.resolve(a.run(args, { caller }));
const ALL_CALLERS: ActionCaller[] = ["tool", "http", "frontend", "mcp", "a2a", "cli", "automation", "webmcp", "mcp-widget", "mcp-widget-write"];

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
  const view = (token?: string, caller: ActionCaller = "http") => call(getRoom, token === undefined ? { code: made.code } : { code: made.code, token }, caller) as Promise<AnyView>;
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
    expect(hidden).toEqual(["cast-vote", "create-practice-room", "create-room", "join-room", "rate-card", "set-initial-pick"]);
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
      // a guest, or a wrong token, only ever gets the join preview
      for (const g of [await r.view(undefined, "tool"), await r.view("not-a-real-token-1234567890", "tool")]) {
        expect(Object.keys(g).sort()).toEqual(["code", "guest", "joinable", "memberCount", "options", "phase", "practice", "question", "tokenInvalid"]);
        expect(JSON.stringify(g)).not.toMatch(/Ana|Ben|Cy|SENTINEL/);
      }
      return v;
    };

    // notes
    for (const [name, text] of [["ana", "ANA-SENTINEL Lisbon has cheap flights."], ["ben", "BEN-SENTINEL Berlin rents are rising. Berlin has a big tech scene."], ["cy", "CY-SENTINEL Oslo is dark in winter."]] as const) {
      await call(saveNotes, { ...both(r.code, r.who[name]), text }, name === "ben" ? "tool" : "frontend"); // the agent may help with notes
      await call(setInitialPick, { ...both(r.code, r.who[name]), optionId: name === "ana" ? "A" : name === "ben" ? "B" : "C" }, "frontend");
    }
    const notes = await checkPhase("notes");
    expect(notes.notes).toContain("ANA-SENTINEL");
    expect(JSON.stringify(notes)).not.toMatch(/BEN-SENTINEL|CY-SENTINEL/);
    for (const t of Object.values(r.who)) await call(markDone, { ...both(r.code, t), done: true });

    // cards: extraction and approval
    const ex = await call(extractCardsAction, both(r.code, r.who.ben), "tool");
    expect(ex.added).toBe(2);
    expect(await call(extractCardsAction, both(r.code, r.who.ben), "tool")).toEqual({ added: 0 }); // running it twice adds nothing
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
    const ledger = (await r.view(r.who.ana)).ledger as AnyView[];
    expect(ledger).toHaveLength(5);
    const [x, y] = [ledger.find((c) => c.text === "Lisbon has cheap flights."), ledger.find((c) => c.text === "Lisbon cheap flights.")];
    await call(mergeCards, { ...both(r.code, r.who.ana), keepId: must(x).id, absorbId: must(y).id });
    expect(((await r.view(r.who.ana)).ledger as AnyView[]).length).toBe(4);
    expect((await r.view(r.who.ana)).uniqueCount).toBe(3); // the merged card has two holders
    await call(advancePhase, both(r.code, r.who.ana), "tool"); // the creator moves the room on

    // weigh: nothing about the cards but neutral text
    const weigh = await checkPhase("weigh");
    expect(weigh.ledger).toBeNull();
    expect(JSON.stringify(weigh.weigh)).not.toMatch(/Lisbon|Berlin|Oslo|"holders"|"option"/);
    await expect(call(markDone, { ...both(r.code, r.who.ana), done: true })).rejects.toMatchObject({ errorCode: "invalid", message: expect.stringContaining("Rate every card") });
    // every member rates every card, all at once: no rating may be lost
    await Promise.all(
      Object.values(r.who).flatMap((t, i) => (weigh.weigh.cards as AnyView[]).map((c) => call(rateCard, { ...both(r.code, t), cardId: c.id, weight: i + 1 }, "frontend"))),
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
    const v = (await call(getRoom, { code: made.code, token: made.token }, "tool")) as AnyView;
    expect(v.practice).toEqual({ title: expect.any(String) });
    expect(v.me).toMatchObject({ id: "m1", isCreator: true, hasInitialPick: false });
    expect(v.members.map((m: AnyView) => [m.id, m.simulated])).toEqual([["m1", false], ["m2", true], ["m3", true]]);
    expect(v.notes.length).toBeGreaterThan(200);
    await expect(call(joinRoom, { code: made.code, name: "Dee" })).rejects.toMatchObject({ errorCode: "forbidden" });
    await expect(call(markDone, { ...both(made.code, made.token), done: true })).rejects.toMatchObject({ message: expect.stringContaining("Seal your lean") });
  });
});
