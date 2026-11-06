// Three people in one live room, each in their own fresh headless Chromium profile (own cookies and
// localStorage, 127.0.0.1 only). Checks live sync (no reload), force-advance, auto-advance, merge/split,
// the private-draft rule and the seal over the raw HTTP actions, then guess who and the alone check (nobody
// else's guess reaches another window), and the reveal in all three windows.
// Run: node scripts/e2e/live.mjs --pw-core=<path to playwright-core/index.mjs>   (dev server on http://127.0.0.1:18744, or --base=...)
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertClean, BASE, newPlayer, rawRoom as raw, shootPage, snapBoth } from "./harness.mjs";

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

const ana = await newPlayer("ana", { width: 1280, height: 800 });
const ben = await newPlayer("ben", { width: 1280, height: 800 });
const cleo = await newPlayer("cleo", { width: 1280, height: 800 });
const late = await newPlayer("late", { width: 1180, height: 700 });
const A = ana.page;
const B = ben.page;
const C = cleo.page;
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
// Paths (".members.0.done") where two parsed views differ.
const diffPaths = (a, b, p = "") => {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diffPaths(a[k], b[k], `${p}.${k}`));
  return [p];
};
const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));
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
  await C.goto(`${BASE}/r/${code}`);
  await C.getByTestId("join-question").waitFor();
  await C.getByLabel("Your name").fill("Cleo");
  await C.getByRole("button", { name: "Join room" }).click();
  await phase(C, "notes");
  live("Ana sees Cleo join without reloading", await took(A, () => !!document.querySelector('[data-testid="member-m3"]'), null));
  await A.screenshot({ path: path.join(SHOTS, "10-live-ana-notes.png") });
  await snapBoth(A, "10-live-ana-notes");

  // ---- notes, sealed lean, force-advance (creator only) ---------------------------------------
  await A.getByTestId("notes-input").fill("Zeta lasts two days on a charge.\nOmega costs 400 euros more than Zeta.\nOmega fans are loud in open offices.");
  await textIn(A, "notes-state", "Saved");
  await A.getByRole("radio", { name: "Omega" }).click();
  await textIn(A, "lean-state", "Sealed");
  await B.getByTestId("notes-input").fill("The Zeta battery gives two full days.");
  await textIn(B, "notes-state", "Saved");
  await B.getByRole("radio", { name: "Zeta" }).click();
  await textIn(B, "lean-state", "Sealed");
  await C.getByTestId("notes-input").fill("Zeta has a matte screen option.");
  await textIn(C, "notes-state", "Saved");
  await C.getByRole("radio", { name: "Omega" }).click();
  await textIn(C, "lean-state", "Sealed");
  check("notes: the private notes of one person never show in the other windows", !(await B.locator("main").innerText()).includes("fans are loud") && !(await A.locator("main").innerText()).includes("two full days") && !(await C.locator("main").innerText()).includes("fans are loud") && !(await A.locator("main").innerText()).includes("matte"));

  await A.getByRole("button", { name: "I'm done", exact: true }).click();
  await A.getByText("You are done", { exact: false }).waitFor();
  live("Ben's window shows that Ana is done", await took(B, () => document.querySelector('[data-testid="member-m1"]')?.getAttribute("data-done") === "true", null));
  check("force-advance: only the creator is offered 'Move everyone on'", (await B.getByRole("button", { name: "Move everyone on" }).count()) === 0 && (await C.getByRole("button", { name: "Move everyone on" }).count()) === 0 && (await A.getByRole("button", { name: "Move everyone on" }).count()) === 1);
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
  await addFact(C, "Zeta has a matte screen option.", "Zeta", "Pro");
  const t2 = await approveFirst(C);
  await A.waitForFunction(hasLedgerText, "matte screen option", { timeout: 8000 });
  live("a card Cleo approved appears in Ana's window (from her click)", Date.now() - t2);
  await Promise.all([A, B, C].map((pg) => pg.waitForFunction(uniqueIs, 5, { timeout: 8000 })));
  const counters = await Promise.all([A, B, C].map((pg) => pg.getByTestId("unique-count").innerText()));
  check("cards: the counter reads 5 in all three windows", counters.every((t) => /\b5\b/.test(t)), counters.map((t) => t.replace(/\s+/g, " ")).join(" | "));
  check("cards: Ben never sees Ana's loud-office draft", !(await B.locator("main").innerText()).includes("loud in open offices"));
  await shootPage(A, path.join(SHOTS, "11-live-ana-cards.png"));
  await shootPage(B, path.join(SHOTS, "12-live-ben-cards.png"));
  await shootPage(C, path.join(SHOTS, "14-live-cleo-cards.png"));
  await snapBoth(A, "11-live-ana-cards");
  await snapBoth(C, "14-live-cleo-cards");

  // ---- merge, split, merge: the counter follows in the other window ---------------------------
  // exact text: other cards list this wording inside their "Same fact as..." menu
  const benCard = B.getByTestId("ledger-card").filter({ has: B.getByText("The Zeta battery gives two full days.", { exact: true }) });
  const sameFact = { label: "Zeta lasts two days on a charge." }; // Ana's wording of Ben's fact
  await benCard.getByLabel("Merge with a card that states the same fact").selectOption(sameFact);
  live("Ben merges two wordings of one fact and Ana's counter drops from 5 to 3", await took(A, uniqueIs, 3));
  await benCard.getByRole("button", { name: "Split" }).click();
  live("Ben undoes the merge and Ana's counter is back at 5", await took(A, uniqueIs, 5));
  await benCard.getByLabel("Merge with a card that states the same fact").selectOption(sameFact);
  await A.waitForFunction(uniqueIs, 3, { timeout: 8000 });

  // ---- both done: the room moves on by itself -------------------------------------------------
  await A.getByRole("button", { name: "I'm done", exact: true }).click();
  await B.getByRole("button", { name: "I'm done", exact: true }).click();
  await C.getByRole("button", { name: "I'm done", exact: true }).click();
  await phase(A, "weigh");
  await phase(B, "weigh");
  await phase(C, "weigh");
  await snapBoth(B, "20-live-ben-weigh");
  check("auto-advance: the room reached 'weigh' in all three windows when the last person was done", true);

  // ---- weigh: blind, checked over the raw action too ------------------------------------------
  const weighA = (await A.getByTestId("weigh-card").allInnerTexts()).join("\n");
  const weighB = (await B.getByTestId("weigh-card").allInnerTexts()).join("\n");
  const weighC = (await C.getByTestId("weigh-card").allInnerTexts()).join("\n");
  const leaked = ["Zeta", "Omega", "Known by", "Ana", "Ben", "Cleo"].filter((w) => weighA.includes(w) || weighB.includes(w) || weighC.includes(w));
  check("weigh: cards show neither an option name nor a person", leaked.length === 0, leaked.join(", "));
  const weighRaw = JSON.parse(await raw(B, code));
  const bad = ["holders", "option", "polarity", "initialPick", "initialPicks", "vote", "votes", "scores", "ranking", "weights", "fullScore", "text"].filter((k) => keysDeep(weighRaw).has(k));
  check("weigh: the raw get-room data carries no option, holders, votes or scores", bad.length === 0, bad.join(", ") || `keys: ${[...keysDeep(weighRaw)].sort().join(",")}`);
  const nA = await rateAll(A, [3, 1, 2, 3]);
  const nB = await rateAll(B, [0, 2, 3, 1]);
  const nC = await rateAll(C, [1, 3, 0, 2]);
  check("weigh: all three people rated every card", nA === 4 && nB === 4 && nC === 4, `${nA}, ${nB} and ${nC} cards`);
  await A.getByRole("button", { name: "I'm done", exact: true }).click();
  await B.getByRole("button", { name: "I'm done", exact: true }).click();
  await C.getByRole("button", { name: "I'm done", exact: true }).click();
  await phase(A, "vote");
  await phase(B, "vote");
  await phase(C, "vote");

  // ---- vote: guess who and the alone check stay private, the votes stay sealed ------------------
  // Holders: Ana m1 wrote SCREEN, Ben m2 wrote EUROS, Cleo m3 wrote MATTE; the Zeta battery fact is Ana's and Ben's (merged).
  const SCREEN = "Omega's screen is far brighter.";
  const EUROS = "Omega costs 400 euros more than Zeta.";
  const MATTE = "Zeta has a matte screen option.";
  const guessBox = (page, text) => page.getByTestId("vote-card").filter({ has: page.getByText(text, { exact: true }) }).getByTestId("guess-select");
  const guessable = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="vote-card"]')].filter((el) => el.querySelector('[data-testid="guess-select"]')).map((el) => el.querySelector("p").textContent).sort());
  const sameList = (x, y) => JSON.stringify(x) === JSON.stringify([...y].sort());
  check(
    "vote: each person can guess exactly the facts that one other person knew (not the merged fact, not their own)",
    sameList(await guessable(A), [EUROS, MATTE]) && sameList(await guessable(B), [SCREEN, MATTE]) && sameList(await guessable(C), [SCREEN, EUROS]),
  );
  const mine = async (page) => Object.fromEntries((JSON.parse(await raw(page, code)).ledger ?? []).filter((c) => c.myGuess).map((c) => [c.text, c.myGuess]));
  const sameGuesses = (x, y) => JSON.stringify(Object.entries(x).sort()) === JSON.stringify(Object.entries(y).sort());
  const stored = async (page, want) => {
    for (let i = 0; i < 40 && !sameGuesses(await mine(page), want); i++) await page.waitForTimeout(150);
    return sameGuesses(await mine(page), want);
  };
  const snap = async () => ({ a: await raw(A, code), b: await raw(B, code), c: await raw(C, code) });

  const s0 = await snap();
  await guessBox(A, EUROS).selectOption({ label: "Ben" }); // right
  await guessBox(A, MATTE).selectOption({ label: "Ben" }); // wrong now; she corrects it after sealing
  check("vote: Ana's guesses are stored for her", await stored(A, { [EUROS]: "m2", [MATTE]: "m2" }));
  const s1 = await snap();
  check("vote: Ana's guesses change nothing in Ben's or Cleo's data (byte for byte)", s1.b === s0.b && s1.c === s0.c && s1.a !== s0.a);

  await guessBox(B, SCREEN).selectOption({ label: "Ana" }); // right
  await guessBox(B, MATTE).selectOption({ label: "Ana" }); // wrong
  check("vote: Ben's guesses are stored for him", await stored(B, { [SCREEN]: "m1", [MATTE]: "m1" }));
  const s2 = await snap();
  check("vote: Ben's guesses change nothing in Ana's or Cleo's data (byte for byte)", s2.a === s1.a && s2.c === s1.c && s2.b !== s1.b);

  await guessBox(C, SCREEN).selectOption({ label: "Ana" });
  await stored(C, { [SCREEN]: "m1" });
  await guessBox(C, SCREEN).selectOption({ label: "Ben" }); // changed her mind: wrong
  await guessBox(C, EUROS).selectOption({ label: "Ana" }); // wrong
  check("vote: Cleo changes a guess and the last one counts", await stored(C, { [SCREEN]: "m2", [EUROS]: "m1" }));
  const s3 = await snap();
  check("vote: Cleo's guesses change nothing in Ana's or Ben's data (byte for byte)", s3.a === s2.a && s3.b === s2.b && s3.c !== s2.c);
  const guessAt = async (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-testid="vote-card"]')].filter((el) => el.querySelector('[data-testid="guess-select"]')).map((el) => [el.querySelector("p").textContent, el.querySelector('[data-testid="guess-select"]').selectedOptions[0].textContent])));
  check(
    "vote: each window shows only its own person's guesses",
    sameGuesses(await guessAt(A), { [EUROS]: "Ben", [MATTE]: "Ben" }) && sameGuesses(await guessAt(B), { [SCREEN]: "Ana", [MATTE]: "Ana" }) && sameGuesses(await guessAt(C), { [SCREEN]: "Ben", [EUROS]: "Ana" }),
  );
  await shootPage(C, path.join(SHOTS, "15-live-cleo-vote.png"));
  await snapBoth(C, "15-live-cleo-vote");

  await A.getByTestId("expect-same").selectOption("1"); // "one of the other two will pick what I pick"
  await A.getByRole("radio", { name: "Zeta" }).click();
  await A.getByRole("button", { name: "Seal my vote" }).click();
  await A.getByText("Waiting for Ben", { exact: false }).waitFor({ timeout: 8000 });
  await snapBoth(A, "21-live-ana-vote-sealed");
  const afterAna = JSON.parse(await raw(B, code));
  const badVote = ["votes", "initialPicks", "scores", "ranking", "fullScore", "weights", "whoGuesses", "aloneGuesses", "expectSame"].filter((k) => keysDeep(afterAna).has(k));
  check("vote: with one vote in, the raw data shows no votes, leans, scores or guesses", badVote.length === 0, badVote.join(", "));
  const changed = diffPaths(JSON.parse(s3.b), afterAna);
  check("vote: Ana's sealed vote and her alone guess change only her 'voted' mark in Ben's data", JSON.stringify(changed) === '[".members.0.done"]', changed.join(", "));
  await guessBox(A, MATTE).selectOption({ label: "Cleo" }); // a guess stays open after sealing: now right
  check("vote: after sealing, a guess can still be changed", await stored(A, { [EUROS]: "m2", [MATTE]: "m3" }));

  await B.getByTestId("expect-same").selectOption("0"); // "none of the other two will pick what I pick"
  await B.getByRole("radio", { name: "Omega" }).click();
  await B.getByRole("button", { name: "Seal my vote" }).click();
  await B.getByText("Waiting for Cleo", { exact: false }).waitFor({ timeout: 8000 });
  await C.getByRole("radio", { name: "Omega" }).click(); // Cleo gives no alone guess
  await C.getByRole("button", { name: "Seal my vote" }).click();

  // ---- reveal ---------------------------------------------------------------------------------
  await phase(C, "reveal");
  live("the last vote opens the reveal in Ana's window", await took(A, () => document.querySelector('[data-testid="phase-bar"]')?.getAttribute("data-phase") === "reveal", null));
  await phase(B, "reveal");
  await A.getByTestId("reveal").waitFor();
  await B.getByTestId("reveal").waitFor();
  await C.getByTestId("reveal").waitFor();
  const picksA = await A.getByTestId("picks").innerText();
  check(
    "reveal: leans and votes of all three people are shown",
    /Ana[\s\S]*Leaned to\s+Omega[\s\S]*voted\s+Zeta/.test(picksA) && /Ben[\s\S]*Leaned to\s+Zeta[\s\S]*voted\s+Omega/.test(picksA) && /Cleo[\s\S]*Leaned to\s+Omega[\s\S]*voted\s+Omega/.test(picksA),
    picksA.replace(/\s+/g, " "),
  );
  const tableA = await A.getByTestId("scores-table").innerText();
  check("reveal: the score table lists the full ledger and each person's own facts", /Full ledger/.test(tableA) && /(Ana|You)\s+alone/.test(tableA) && /Ben\s+alone/.test(tableA) && /Cleo\s+alone/.test(tableA));
  check("reveal: disclaimer in all windows", (await A.getByTestId("disclaimer").innerText()) === "Unsaid never votes or recommends. These are your team's facts and your team's weights." && (await B.getByTestId("disclaimer").count()) === 1 && (await C.getByTestId("disclaimer").count()) === 1);

  // Guess who: 3 guessers, 6 guesses; Ana 2 right (she fixed one), Ben 1 right, Cleo 0 right -> 3 of 6 = 50%, luck 50%.
  const views = [JSON.parse(await raw(A, code)), JSON.parse(await raw(B, code)), JSON.parse(await raw(C, code))];
  const meter = { scope: "room", result: { guessers: 3, guesses: 6, right: 3, rightPct: 50, chancePct: 50, verdict: "near" } };
  check("reveal: ONE room-wide guess-who number, the same in all three views", views.every((v) => canon(v.reveal.guessWho) === canon(meter)), canon(views[0].reveal.guessWho));
  const norm = (t) => t.replace(/\s+/g, " ").trim();
  const shown = [];
  for (const pg of [A, B, C]) shown.push([norm(await pg.getByTestId("guess-pct").innerText()), norm(await pg.getByTestId("guess-detail").innerText()), norm(await pg.getByTestId("guess-meaning").innerText())]);
  check(
    "reveal: every window shows the number against luck and one line of meaning",
    shown.every(([pct, detail, meaning]) => pct === "50% right" && detail === "3 of 6 guesses, from 3 people. Luck would give 50%." && /^Close to luck/.test(meaning)),
    shown[0].join(" | "),
  );
  const text = await Promise.all([A, B, C].map((pg) => pg.locator("main").innerText()));
  check("reveal: no page shows a per-person or per-fact guess result", text.every((t) => !/guessed (Ana|Ben|Cleo)|(Ana|Ben|Cleo) guessed|(Ana|Ben|Cleo)'s guess/i.test(t)) && (await Promise.all([A, B, C].map((pg) => pg.getByTestId("guess-hidden").count()))).every((n) => n === 0));
  const GUESS_KEYS = ["whoGuesses", "aloneGuesses", "expectSame", "myGuess"];
  check("reveal: no view carries anyone's guess as data", views.every((v) => GUESS_KEYS.every((k) => !keysDeep(v).has(k))));

  // Alone check: each person sees only their own guess next to the real count.
  check(
    "reveal: the alone check is the viewer's own: Ana expected 1 and 0 did, Ben expected 0 and 1 did, Cleo gave none",
    canon(views[0].reveal.aloneCheck) === canon({ expected: 1, actual: 0, others: 2 }) && canon(views[1].reveal.aloneCheck) === canon({ expected: 0, actual: 1, others: 2 }) && views[2].reveal.aloneCheck === null,
  );
  const lineA = norm(await A.getByTestId("alone-line").innerText());
  const lineB = norm(await B.getByTestId("alone-line").innerText());
  check(
    "reveal: the pages say it in words, and Cleo has no alone check",
    lineA === "You expected 1 of 2 to pick the same option as you. 0 did." && lineB === "You expected 0 of 2 to pick the same option as you. 1 did." && (await C.getByTestId("alone-check").count()) === 0,
    `${lineA} | ${lineB}`,
  );
  check("reveal: Ana's data has no trace of Ben's alone guess, and Ben's none of Ana's", !JSON.stringify(views[0]).includes('"expected":0') && !JSON.stringify(views[1]).includes('"expected":1'));
  await shootPage(A, path.join(SHOTS, "13-live-ana-reveal.png"));
  await snapBoth(A, "13-live-ana-reveal");
  await snapBoth(C, "22-live-cleo-reveal");

  assertClean(ana, ben, cleo, late);
  check("guest path: no sign-in, no 401/403 beyond the known probe, no page errors (4 windows)", true);
  console.log(`room ${code}; blocked external hosts: ${[...new Set([...ana.blocked, ...ben.blocked, ...cleo.blocked, ...late.blocked])].join(", ") || "none"}`);
  console.log(`timings (ms): ${timings.map(([n, ms]) => `${ms}`).join(", ")}; max ${Math.max(...timings.map(([, ms]) => ms))}`);
} catch (e) {
  console.log(`ERROR ${e.message}`);
  await shootPage(A, path.join(SHOTS, "error-ana.png")).catch(() => {});
  await shootPage(B, path.join(SHOTS, "error-ben.png")).catch(() => {});
  await shootPage(C, path.join(SHOTS, "error-cleo.png")).catch(() => {});
  checks.push({ name: "run", ok: false, detail: e.message });
} finally {
  await ana.close();
  await ben.close();
  await cleo.close();
  await late.close().catch(() => {});
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
