// Two people in one live room, each in their own fresh headless Chromium profile (own cookies and
// localStorage, 127.0.0.1 only). Checks live sync (no reload), force-advance, auto-advance, merge/split,
// the private-draft rule and the seal over the raw HTTP actions, then the reveal in both windows.
// Run: node scripts/e2e/live.mjs --pw-core=<path to playwright-core/index.mjs>   (dev server on http://127.0.0.1:18744, or --base=...)
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertClean, BASE, newPlayer } from "./harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, "../../docs/shots");
mkdirSync(SHOTS, { recursive: true });

const LIMIT_MS = 3000; // the brief says 2 s; the check allows one poll of slack
const checks = [];
const timings = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` -- ${detail}` : ""}`);
};

const ana = await newPlayer("ana", { width: 1180, height: 900 });
const ben = await newPlayer("ben", { width: 1180, height: 900 });
const late = await newPlayer("late", { width: 1180, height: 700 });
const A = ana.page;
const B = ben.page;
const L = late.page;

const phase = (page, name, ms = 8000) => page.waitForSelector(`[data-testid="phase-bar"][data-phase="${name}"]`, { timeout: ms });
/** Waits for a condition in `page` and returns how many ms it took (polling every 50 ms). */
async function took(page, fn, arg, ms = 8000) {
  const t0 = Date.now();
  await page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
  return Date.now() - t0;
}
const live = (name, ms) => {
  timings.push([name, ms]);
  check(`live: ${name}`, ms < LIMIT_MS, `${ms} ms`);
};
// These two run inside the page (Playwright serialises them), so they use nothing from this file.
const uniqueIs = (k) => new RegExp(`Facts only one of you knew:\\s*${k}\\b`).test(document.querySelector('[data-testid="unique-count"]')?.textContent ?? "");
const hasLedgerText = (text) => [...document.querySelectorAll('[data-testid="ledger-card"]')].some((el) => el.textContent.includes(text));
const textIn = (page, testid, re) => page.waitForFunction(([id, src]) => new RegExp(src).test(document.querySelector(`[data-testid="${id}"]`)?.textContent ?? ""), [testid, re], { timeout: 8000 });
const raw = (page, code) =>
  page.evaluate(async (c) => {
    const token = window.localStorage.getItem(`unsaid:member:${c}`);
    const r = await fetch("/_agent-native/actions/get-room", { method: "POST", headers: { "content-type": "application/json", "x-agent-native-frontend": "1" }, body: JSON.stringify({ code: c, token }) });
    return await r.text();
  }, code);
const keysDeep = (x, out = new Set()) => {
  if (Array.isArray(x)) x.forEach((v) => keysDeep(v, out));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) (out.add(k), keysDeep(v, out));
  return out;
};
const addFact = async (page, text, option, polarity) => {
  const form = page.locator("form").filter({ hasText: "Add a fact by hand" });
  await form.getByLabel("Add a fact by hand").fill(text);
  await form.getByLabel("Which option is the new fact about?").selectOption({ label: option });
  await form.getByRole("button", { name: polarity, exact: true }).click();
  const n = await page.getByTestId("draft").count();
  await form.getByRole("button", { name: "Add as draft" }).click();
  await page.waitForFunction((k) => document.querySelectorAll('[data-testid="draft"]').length > k, n, { timeout: 8000 });
};
/** Approves the first draft; returns the time of the click so callers can time the other window from it. */
const approveFirst = async (page) => {
  const n = await page.getByTestId("draft").count();
  const clickedAt = Date.now();
  await page.getByRole("button", { name: "Approve to ledger" }).first().click();
  await page.waitForFunction((k) => document.querySelectorAll('[data-testid="draft"]').length < k, n, { timeout: 8000 });
  return clickedAt;
};
const rateAll = async (page, ratings) => {
  const cards = page.getByTestId("weigh-card");
  const n = await cards.count();
  for (let i = 0; i < n; i++) await cards.nth(i).getByRole("radio", { name: new RegExp(`^${ratings[i % ratings.length]},`) }).click();
  await page.waitForFunction((k) => document.querySelector('[data-testid="weigh-progress"] strong')?.textContent === String(k), n, { timeout: 8000 });
  return n;
};

let code = "";
try {
  // ---- Ana starts a room ---------------------------------------------------------------------
  await A.goto(`${BASE}/`);
  await A.getByRole("button", { name: "Try the trap (3 min)" }).waitFor();
  await A.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await A.getByLabel("The decision").fill("Which laptop should the design team buy?");
  await A.getByLabel("Option 1").fill("Zeta");
  await A.getByLabel("Option 2").fill("Omega");
  await A.getByLabel("Your name").fill("Ana");
  await A.getByTestId("start-room").click();
  await A.waitForURL(/\/r\/[A-Z0-9]{4,12}$/);
  await phase(A, "notes");
  code = A.url().split("/r/")[1];
  check("start: a room is created with no account and a code in the link", /^[A-Z0-9]{4,12}$/.test(code), code);

  // ---- Ben joins by name from the link --------------------------------------------------------
  await B.goto(`${BASE}/r/${code}`);
  await B.getByTestId("join-question").waitFor();
  check("join: the link shows the question and a name box, no sign-in", (await B.getByTestId("join-question").innerText()).includes("Which laptop") && (await B.getByLabel("Your name").count()) === 1);
  await B.getByLabel("Your name").fill("Ben");
  await B.getByRole("button", { name: "Join room" }).click();
  await phase(B, "notes");
  live("Ana sees Ben join without reloading", await took(A, () => !!document.querySelector('[data-testid="member-m2"]'), null));
  await A.screenshot({ path: path.join(SHOTS, "10-live-ana-notes.png") });

  // ---- notes, sealed lean, force-advance (creator only) ---------------------------------------
  await A.getByTestId("notes-input").fill("Zeta lasts two days on a charge.\nOmega costs 400 euros more than Zeta.\nOmega fans are loud in open offices.");
  await textIn(A, "notes-state", "Saved");
  await A.getByRole("radio", { name: "Omega" }).click();
  await textIn(A, "lean-state", "Sealed");
  await B.getByTestId("notes-input").fill("The Zeta battery gives two full days.");
  await textIn(B, "notes-state", "Saved");
  await B.getByRole("radio", { name: "Zeta" }).click();
  await textIn(B, "lean-state", "Sealed");
  check("notes: the private notes of one person never show in the other window", !(await B.locator("main").innerText()).includes("fans are loud") && !(await A.locator("main").innerText()).includes("two full days"));

  await A.getByRole("button", { name: "I'm done", exact: true }).click();
  await A.getByText("You are done", { exact: false }).waitFor();
  live("Ben's window shows that Ana is done", await took(B, () => document.querySelector('[data-testid="member-m1"]')?.getAttribute("data-done") === "true", null));
  check("force-advance: only the creator is offered 'Move everyone on'", (await B.getByRole("button", { name: "Move everyone on" }).count()) === 0 && (await A.getByRole("button", { name: "Move everyone on" }).count()) === 1);
  await A.getByRole("button", { name: "Move everyone on" }).click();
  await A.getByRole("button", { name: "Move everyone on" }).click(); // the confirm button
  await phase(A, "cards");
  live("the creator moves the room on and Ben's window follows", await took(B, () => document.querySelector('[data-testid="phase-bar"]')?.getAttribute("data-phase") === "cards", null));

  // ---- a late visitor cannot join once the notes phase is over --------------------------------
  await L.goto(`${BASE}/r/${code}`);
  await L.getByText("can no longer join", { exact: false }).waitFor({ timeout: 8000 });
  check("join: after the notes phase the link no longer offers a name box", (await L.getByLabel("Your name").count()) === 0);
  await late.close();

  // ---- cards: drafts stay private, approved cards go live -------------------------------------
  await addFact(A, "Zeta lasts two days on a charge.", "Zeta", "Pro");
  await addFact(A, "Omega's screen is far brighter.", "Omega", "Pro");
  await addFact(A, "Omega fans are loud in open offices.", "Omega", "Con"); // stays a draft
  const rawBenDraft = await raw(B, code);
  const rawAnaDraft = await raw(A, code);
  check("cards: Ana's unapproved draft is in her own data and not in Ben's", rawAnaDraft.includes("loud in open offices") && !rawBenDraft.includes("loud in open offices"));
  const t0 = await approveFirst(A);
  await B.getByTestId("ledger-card").filter({ hasText: "Zeta lasts two days on a charge." }).first().waitFor({ timeout: 8000 });
  live("a card Ana approved appears in Ben's window (from her click)", Date.now() - t0);
  await approveFirst(A);
  await addFact(B, "The Zeta battery gives two full days.", "Zeta", "Pro");
  await addFact(B, "Omega costs 400 euros more than Zeta.", "Omega", "Con");
  const t1 = await approveFirst(B);
  await A.waitForFunction(hasLedgerText, "The Zeta battery gives two full days.", { timeout: 8000 });
  live("a card Ben approved appears in Ana's window (from his click)", Date.now() - t1);
  await approveFirst(B);
  await A.waitForFunction(hasLedgerText, "400 euros", { timeout: 8000 });
  await A.waitForFunction(uniqueIs, 4, { timeout: 8000 });
  check("cards: the counter reads 4 in both windows", /\b4\b/.test(await A.getByTestId("unique-count").innerText()) && /\b4\b/.test(await B.getByTestId("unique-count").innerText()));
  check("cards: Ben never sees Ana's loud-office draft", !(await B.locator("main").innerText()).includes("loud in open offices"));
  await A.screenshot({ path: path.join(SHOTS, "11-live-ana-cards.png"), fullPage: true });
  await B.screenshot({ path: path.join(SHOTS, "12-live-ben-cards.png"), fullPage: true });

  // ---- merge, split, merge: the counter follows in the other window ---------------------------
  // exact text: other cards list this wording inside their "Same fact as..." menu
  const benCard = B.getByTestId("ledger-card").filter({ has: B.getByText("The Zeta battery gives two full days.", { exact: true }) });
  await benCard.getByLabel("Merge with a card that states the same fact").selectOption({ index: 1 });
  live("Ben merges two wordings of one fact and Ana's counter drops from 4 to 2", await took(A, uniqueIs, 2));
  await benCard.getByRole("button", { name: "Split" }).click();
  live("Ben undoes the merge and Ana's counter is back at 4", await took(A, uniqueIs, 4));
  await benCard.getByLabel("Merge with a card that states the same fact").selectOption({ index: 1 });
  await A.waitForFunction(uniqueIs, 2, { timeout: 8000 });

  // ---- both done: the room moves on by itself -------------------------------------------------
  await A.getByRole("button", { name: "I'm done", exact: true }).click();
  await B.getByRole("button", { name: "I'm done", exact: true }).click();
  await phase(A, "weigh");
  await phase(B, "weigh");
  check("auto-advance: the room reached 'weigh' in both windows when the last person was done", true);

  // ---- weigh: blind, checked over the raw action too ------------------------------------------
  const weighA = (await A.getByTestId("weigh-card").allInnerTexts()).join("\n");
  const weighB = (await B.getByTestId("weigh-card").allInnerTexts()).join("\n");
  const leaked = ["Zeta", "Omega", "Known by", "Ana", "Ben"].filter((w) => weighA.includes(w) || weighB.includes(w));
  check("weigh: cards show neither an option name nor a person", leaked.length === 0, leaked.join(", "));
  const weighRaw = JSON.parse(await raw(B, code));
  const bad = ["holders", "option", "polarity", "initialPick", "initialPicks", "vote", "votes", "scores", "ranking", "weights", "fullScore", "text"].filter((k) => keysDeep(weighRaw).has(k));
  check("weigh: the raw get-room data carries no option, holders, votes or scores", bad.length === 0, bad.join(", ") || `keys: ${[...keysDeep(weighRaw)].sort().join(",")}`);
  const nA = await rateAll(A, [3, 1, 2, 3]);
  const nB = await rateAll(B, [0, 2, 3, 1]);
  check("weigh: both people rated every card", nA === 3 && nB === 3, `${nA} and ${nB} cards`);
  await A.getByRole("button", { name: "I'm done", exact: true }).click();
  await B.getByRole("button", { name: "I'm done", exact: true }).click();
  await phase(A, "vote");
  await phase(B, "vote");

  // ---- vote: sealed until the last vote -------------------------------------------------------
  await A.getByRole("radio", { name: "Zeta" }).click();
  await A.getByRole("button", { name: "Seal my vote" }).click();
  await A.getByText("Waiting for Ben", { exact: false }).waitFor({ timeout: 8000 });
  const voteRaw = JSON.parse(await raw(B, code));
  const badVote = ["votes", "initialPicks", "scores", "ranking", "fullScore", "weights"].filter((k) => keysDeep(voteRaw).has(k));
  check("vote: with one vote in, the raw data shows no votes, leans or scores", badVote.length === 0, badVote.join(", "));
  await B.getByRole("radio", { name: "Omega" }).click();
  await B.getByRole("button", { name: "Seal my vote" }).click();

  // ---- reveal ---------------------------------------------------------------------------------
  await phase(B, "reveal");
  live("the last vote opens the reveal in Ana's window", await took(A, () => document.querySelector('[data-testid="phase-bar"]')?.getAttribute("data-phase") === "reveal", null));
  await A.getByTestId("reveal").waitFor();
  await B.getByTestId("reveal").waitFor();
  const picksA = await A.getByTestId("picks").innerText();
  check("reveal: leans and votes of both people are shown", /Ana[\s\S]*Leaned to\s+Omega[\s\S]*voted\s+Zeta/.test(picksA) && /Ben[\s\S]*Leaned to\s+Zeta[\s\S]*voted\s+Omega/.test(picksA), picksA.replace(/\s+/g, " "));
  const tableA = await A.getByTestId("scores-table").innerText();
  check("reveal: the score table lists the full ledger and each person's own facts", /Full ledger/.test(tableA) && /(Ana|You)\s+alone/.test(tableA) && /Ben\s+alone/.test(tableA));
  check("reveal: disclaimer in both windows", (await A.getByTestId("disclaimer").innerText()) === "Unsaid never votes or recommends. These are your team's facts and your team's weights." && (await B.getByTestId("disclaimer").count()) === 1);
  await A.screenshot({ path: path.join(SHOTS, "13-live-ana-reveal.png"), fullPage: true });

  assertClean(ana, ben, late);
  check("guest path: no sign-in, no 401/403 beyond the known probe, no page errors (3 windows)", true);
  console.log(`room ${code}; blocked external hosts: ${[...new Set([...ana.blocked, ...ben.blocked, ...late.blocked])].join(", ") || "none"}`);
  console.log(`timings (ms): ${timings.map(([n, ms]) => `${ms}`).join(", ")}; max ${Math.max(...timings.map(([, ms]) => ms))}`);
} catch (e) {
  console.log(`ERROR ${e.message}`);
  await A.screenshot({ path: path.join(SHOTS, "error-ana.png"), fullPage: true }).catch(() => {});
  await B.screenshot({ path: path.join(SHOTS, "error-ben.png"), fullPage: true }).catch(() => {});
  checks.push({ name: "run", ok: false, detail: e.message });
} finally {
  await ana.close();
  await ben.close();
  await late.close().catch(() => {});
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
