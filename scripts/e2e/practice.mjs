// Practice run end to end in a fresh headless Chromium (own temp profile, 127.0.0.1 only):
// home -> "Do it yourself (3 min)" -> notes + sealed lean -> cards -> blind weigh -> vote (ratings and one vote, no guess questions) -> reveal;
// then the 20-second replay ("See the trap in 20 seconds"): its numbers are locked and it must cost zero model calls.
// Run: node scripts/e2e/practice.mjs --pw-core=<path to playwright-core/index.mjs>   (dev server on http://127.0.0.1:18744, or --base=...)
// The zero-model-calls check reads the audit stub's log: pass STUB_LOG=<that file> (the server under test must run with the stub); without it that one check is skipped.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import scenario from "../../server/scenarios/vendor.json" with { type: "json" };
import { assertClean, BASE, newPlayer, rawRoom, shootPage, snapBoth } from "./harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, "../../docs/shots");
mkdirSync(SHOTS, { recursive: true });

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` -- ${detail}` : ""}`);
};

// Model calls the server under test has made so far (one ` GEMINI ` line each in the stub's log); null when no log was given.
const modelCalls = () => {
  const file = process.env.STUB_LOG;
  if (!file) return null;
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.includes(" GEMINI ")).length : 0;
};
const norm = (t) => t.replace(/\s+/g, " ").trim();

const p = await newPlayer("practice", { width: 1280, height: 800 });
const { page } = p;
const shot = async (name, full = false) => {
  if (!full) return page.screenshot({ path: path.join(SHOTS, name) });
  await shootPage(page, path.join(SHOTS, name));
  await snapBoth(page, name.replace(/\.png$/, ""));
};
const phase = (name) => page.waitForSelector(`[data-testid="phase-bar"][data-phase="${name}"]`, { timeout: 15000 });

try {
  await page.goto(`${BASE}/`);
  await page.getByTestId("try-trap").waitFor();
  // The dev server may reload once while it optimizes dependencies; let the page settle before clicking.
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

  // ---- home: the result first, ONE filled button --------------------------------------------------
  const proofResult = norm(await page.getByTestId("proof-result").innerText());
  check("home: the proof strip states the result, with the numbers of the scripted team", /Alone, each of three teammates leans to Brightpane Chat\. With all 15 facts on the table, the ledger points to Kelvane Desk\./.test(proofResult), proofResult);
  check("home: the two start buttons say what they do", norm(await page.getByTestId("see-trap").innerText()) === "See the trap in 20 seconds" && norm(await page.getByTestId("try-trap").innerText()) === "Do it yourself (3 min)");
  const fill = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [fillSee, fillTry, fillStart, fillJoin] = [await fill(page.getByTestId("see-trap")), await fill(page.getByTestId("try-trap")), await fill(page.getByTestId("start-room")), await fill(page.getByRole("button", { name: "Join", exact: true }))];
  check("home: exactly one filled button (See the trap); the other three are outlines", fillSee !== "rgba(0, 0, 0, 0)" && new Set([fillTry, fillStart, fillJoin]).size === 1 && fillSee !== fillTry, `see=${fillSee}; others=${[fillTry, fillStart, fillJoin].join(" | ")}`);
  const links = await page.locator('[data-testid="proof-study"] a, [data-testid="proof-structure"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  check("home: the two sources are links and the limit is stated", links.join() === "https://doi.org/10.1037/0022-3514.48.6.1467,https://arxiv.org/abs/2508.08242" && (await page.getByText("We have not tested whether it helps real teams.").count()) === 1, links.join(" "));
  await shot("01-home.png", true);

  // ---- notes ---------------------------------------------------------------------------------
  await page.getByTestId("try-trap").click();
  await page.waitForURL(/\/r\/[A-Z0-9]{4,12}$/);
  await phase("notes");
  const code = page.url().split("/r/")[1];
  const memo = await page.getByTestId("notes-input").inputValue();
  check("notes: the memo is prefilled", memo.length > 100, `${memo.length} chars`);
  const banner = page.getByTestId("practice-banner");
  check("practice banner is one closed line with the reason one click away; teammates are labelled simulated", (await banner.count()) === 1 && (await banner.evaluate((el) => el.tagName === "DETAILS" && !el.open)) && /Why simulated\?/.test(await banner.innerText()) && (await page.getByText("simulated").count()) >= 2);
  await banner.locator("summary").click();
  check("practice banner: one click shows that their notes, ratings and votes are scripted", /Their notes, ratings and votes are scripted/.test(await banner.innerText()));
  await banner.locator("summary").click();
  const barText = await page.getByTestId("phase-bar").innerText();
  check("phase bar: the player is shown as 'You', not 'You (you)'", /\bYou\b/.test(barText) && !/You \(you\)/.test(barText));

  // ---- polling: a visible tab reads the room every 2 s, a hidden tab reads nothing, showing it again reads once --------
  // Headless Chromium never hides a tab, so a hidden tab is stood in for: visibilityState and hidden are overridden and
  // visibilitychange is fired, which is all the polling library listens to. A real background tab is NOT VERIFIED here.
  const requests = [];
  page.on("request", (r) => requests.push({ at: Date.now(), path: new URL(r.url()).pathname }));
  const readsSince = (from) => requests.filter((x) => x.at >= from && x.path.endsWith("/get-room")).length;
  const setHidden = (hidden) =>
    page.evaluate((h) => {
      if (h) {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      } else {
        delete document.visibilityState;
        delete document.hidden;
      }
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    }, hidden);
  let from = Date.now();
  await page.waitForTimeout(6000);
  const visibleReads = readsSince(from);
  check("polling: a visible tab reads the room every 2 s, not every second (control)", visibleReads >= 2 && visibleReads <= 4, `${visibleReads} reads in 6 s`);
  await setHidden(true);
  await page.waitForTimeout(600); // a read already on its way may still land
  from = Date.now();
  await page.waitForTimeout(7000);
  const whileHidden = requests.filter((x) => x.at >= from);
  check("polling: a hidden tab sends no request at all in 7 s", whileHidden.length === 0, whileHidden.length ? `${whileHidden.length}: ${[...new Set(whileHidden.map((x) => x.path))].join(", ")}` : "0 requests");
  // Twice, because one interval tick could land by chance within 250 ms of showing the tab.
  const firstReadAfterShowing = async () => {
    const t = Date.now();
    await setHidden(false);
    await page.waitForTimeout(600);
    const r = requests.find((x) => x.at >= t && x.path.endsWith("/get-room"));
    return r ? r.at - t : null;
  };
  const back1 = await firstReadAfterShowing();
  await setHidden(true);
  await page.waitForTimeout(2500);
  const back2 = await firstReadAfterShowing();
  check("polling: showing the tab again reads the room right away, both times", back1 !== null && back1 < 250 && back2 !== null && back2 < 250, `first read ${back1} ms and ${back2} ms after showing`);
  from = Date.now();
  await page.waitForTimeout(5000);
  check("polling: ... and the polling carries on every 2 s", readsSince(from) >= 2 && readsSince(from) <= 4, `${readsSince(from)} reads in 5 s`);

  const doneBtn = page.getByRole("button", { name: "I'm done", exact: true });
  check("notes: 'I'm done' is blocked until the lean is sealed", await doneBtn.isDisabled());
  await page.getByRole("radio", { name: "Brightpane Chat" }).click();
  await page.getByTestId("lean-state").getByText("Sealed", { exact: false }).waitFor();
  await doneBtn.waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('[data-testid="phase-bar"] button[disabled]'), null, { timeout: 5000 });
  await shot("02-notes.png", true);
  await doneBtn.click();
  await phase("cards");

  // ---- cards ---------------------------------------------------------------------------------
  const drafts = await page.getByTestId("draft").count();
  check("cards: drafts prepared for practice", drafts === 9 && (await page.getByText("prepared for practice").count()) >= 9, `${drafts} drafts`);
  const edited = "Edited by me: this one I checked myself.";
  const first = page.getByLabel("Card text: one fact").first();
  const firstText = await first.inputValue();
  await first.fill(`${firstText} ${edited}`);
  while ((await page.getByTestId("draft").count()) > 0) {
    const n = await page.getByTestId("draft").count();
    await page.getByRole("button", { name: "Approve to ledger" }).first().click();
    await page.waitForFunction((k) => document.querySelectorAll('[data-testid="draft"]').length < k, n, { timeout: 10000 });
  }
  // The simulated teammates hold 6 more facts that are theirs alone. In the cards phase they are a number, not text.
  const cards = await page.getByTestId("ledger-card").count();
  check("cards: my ledger lists the 9 cards I approved, not the others'", cards === 9, `${cards} cards`);
  await page.waitForFunction(() => document.querySelector('[data-testid="others-card-count"]')?.getAttribute("data-count") === "6", null, { timeout: 5000 }).catch(() => {});
  const othersLine = page.getByTestId("others-card-count");
  check("cards: the others' cards are shown as a number only (6)", (await othersLine.getAttribute("data-count")) === "6" && /^6 cards approved by the others so far/.test((await othersLine.innerText()).trim()), (await othersLine.innerText()).trim());
  const theirs = scenario.facts.filter((f) => !f.holders.includes("m1"));
  const cardsPageText = await page.locator("body").innerText();
  const cardsRawText = await rawRoom(page, code);
  const seen = theirs.filter((f) => [f.text, f.neutral].some((t) => cardsPageText.includes(t) || cardsRawText.includes(t)));
  check("cards: none of the 6 facts only the others knew is on the page or in the raw get-room answer", theirs.length === 6 && seen.length === 0, `${seen.length} of ${theirs.length} found`);
  const menu = await page.getByLabel("Merge with a card that states the same fact").evaluateAll((sels) => sels.flatMap((s) => [...s.options].map((o) => o.textContent.trim()).filter((t) => t !== "Same fact as...")));
  check("cards: control: a merge menu exists and offers only my own cards", menu.length > 0 && menu.every((t) => t.endsWith("(yours)")), `${menu.length} entries`);
  const cardsRaw = JSON.parse(cardsRawText);
  check("cards: the raw ledger holds only my own cards and carries the count", cardsRaw.ledger.length === 9 && cardsRaw.ledger.every((c) => c.mine === true) && cardsRaw.othersCardCount === 6, `${cardsRaw.ledger.length} cards; othersCardCount ${cardsRaw.othersCardCount}`);
  check("cards: my edited wording of a fact the others also knew is kept as an 'also worded' line", (await page.getByLabel("Merged wordings").getByText(edited, { exact: false }).count()) === 1);
  const unique = await page.getByTestId("unique-count").innerText();
  check("cards: counter says 9", /Facts only one of you knew:\s*9/.test(unique), unique.replace(/\s+/g, " "));
  const sharedCards = await page.locator('[data-testid="ledger-card"][data-holders="3"]').count();
  check("cards: same fact held by all three is one card", sharedCards === 6, `${sharedCards} cards with 3 holders`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("03-cards.png", true);
  await page.getByRole("button", { name: "I'm done", exact: true }).click();
  await phase("weigh");

  // ---- weigh (blind) -------------------------------------------------------------------------
  const weighCards = page.getByTestId("weigh-card");
  const n = await weighCards.count();
  check("weigh: every ledger card is listed", n === 15, `${n} cards`);
  const weighText = (await page.getByTestId("weigh-card").allInnerTexts()).join("\n");
  const leaks = ["Kelvane", "Brightpane", "Cobbleline", "Noa", "Idris", "Known by"].filter((w) => weighText.includes(w));
  check("weigh: cards show no option name or holder", leaks.length === 0, leaks.join(", "));
  const missing = theirs.filter((f) => !weighText.includes(f.neutral));
  check("weigh: control: the 6 facts only the others knew are on the page now (neutral wording)", missing.length === 0, `${theirs.length - missing.length} of ${theirs.length} found`);
  const bodyText = await page.locator("main").innerText();
  check("weigh: no ledger totals or scores on the page", !/Scores by option|Full ledger|points to|own facts only/i.test(bodyText));
  const RATINGS = [3, 2, 1, 0, 3, 2, 1, 2, 3, 1, 2, 3, 0, 1, 2];
  for (let i = 0; i < n; i++) await weighCards.nth(i).getByRole("radio", { name: new RegExp(`^${RATINGS[i % RATINGS.length]},`) }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="weigh-progress"] strong')?.textContent === "15", null, { timeout: 10000 });
  await page.waitForTimeout(600); // let the progress bar and button transitions finish before the picture
  await shot("04-weigh.png", true);
  await page.waitForFunction(() => !document.querySelector('[data-testid="phase-bar"] button[disabled]'), null, { timeout: 8000 });
  await page.getByRole("button", { name: "I'm done", exact: true }).click();
  await phase("vote");

  // ---- vote ----------------------------------------------------------------------------------
  const voteText = await page.locator("main").innerText();
  check("vote: no scores or totals before the reveal", !/Full ledger|own facts only|points to/i.test(voteText));
  // A practice room (and its replay) asks for ratings and one vote only. The two optional guesses belong to live rooms.
  const guessUi = { select: await page.getByTestId("guess-select").count(), expect: await page.getByTestId("expect-same").count(), box: await page.getByTestId("optional-guesses").count() };
  check("vote: practice asks neither 'who knew it' nor 'how many will pick the same'", guessUi.select === 0 && guessUi.expect === 0 && guessUi.box === 0 && !/Who knew it|pick the same option|Optional/i.test(voteText), JSON.stringify(guessUi));
  check("vote: the 15 facts are still listed next to the options", (await page.getByTestId("vote-card").count()) === 15);
  await page.getByRole("radio", { name: "Kelvane Desk" }).click();
  await shot("05-vote.png", true);
  await page.getByRole("button", { name: "Seal my vote" }).click();

  // ---- reveal --------------------------------------------------------------------------------
  await phase("reveal");
  await page.getByTestId("reveal").waitFor();
  const lean = await page.getByTestId("headline-lean").innerText();
  const full = await page.getByTestId("headline-full").innerText();
  check("reveal: headline compares the sealed lean with the full ledger", lean === "Brightpane Chat" && full === "Kelvane Desk", `lean=${lean}; full ledger points to=${full}`);
  const own = await page.getByTestId("headline-own").innerText();
  check("reveal: own facts alone point to the lean", /point to\s+Brightpane Chat/.test(own), own.replace(/\s+/g, " "));
  const firstOf = (col) => page.locator(`[data-testid="scores-table"] tbody tr`).evaluateAll((rows, c) => rows.filter((r) => r.querySelectorAll("td")[c]?.getAttribute("data-first") === "true").map((r) => r.querySelector("th").innerText.trim()), col);
  const fullFirst = await firstOf(0);
  const ownFirst = await firstOf(1);
  check("reveal: table ranks Kelvane first on the full ledger and Brightpane first on your own facts", fullFirst.join() === "Kelvane Desk" && ownFirst.join() === "Brightpane Chat", `full=${fullFirst}; own=${ownFirst}`);
  check("reveal: counter says 9", (await page.getByTestId("reveal-unique").innerText()) === "9");
  check("reveal: changed facts are listed with their holders", (await page.getByTestId("changed-card").count()) >= 1, `${await page.getByTestId("changed-card").count()} facts`);
  const disclaimer = await page.getByTestId("disclaimer").innerText();
  check("reveal: disclaimer line", disclaimer === "Unsaid never votes or recommends. These are your team's facts and your team's weights.", disclaimer);
  check("reveal: practice shows neither the guess-who panel nor the alone check nor a room-wide number", (await page.getByTestId("guess-who").count()) === 0 && (await page.getByTestId("alone-check").count()) === 0 && (await page.getByTestId("guess-pct").count()) === 0);
  const more = page.getByTestId("more-detail");
  const moreSummary = norm(await page.getByTestId("more-detail-summary").innerText());
  check("reveal: 'More detail' is closed and holds only the table of all 15 cards", (await more.evaluate((el) => !el.open)) && moreSummary === "More detail (all 15 cards)", moreSummary);
  await page.getByTestId("more-detail-summary").click();
  check("reveal: opening 'More detail' shows the 15 cards with their holders", (await more.locator("tbody tr").count()) === 15 && /Noa/.test(await more.innerText()));
  await page.getByTestId("more-detail-summary").click();
  const revealRaw = JSON.parse(await rawRoom(page, code));
  check("reveal: the view carries your own picks and the full ledger", revealRaw.reveal.viewer.vote === "A" && revealRaw.reveal.viewer.initialPick === "B" && revealRaw.reveal.cards.length === 15 && revealRaw.reveal.uniqueCount === 9);
  const picks = await page.getByTestId("picks").innerText();
  check("reveal: leans and votes of simulated teammates are shown", /Noa[\s\S]*simulated[\s\S]*Leaned to\s+Brightpane Chat[\s\S]*voted\s+Kelvane Desk/i.test(picks));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("06-reveal.png", false);
  await shot("07-reveal-full.png", true);

  // ---- replay: "See the trap in 20 seconds" opens a finished scripted room at its reveal -------------------------------
  // The numbers below are the scenario's own (server/domain/replay.test.ts computes them from the same file); a change to the
  // scoring or the scenario must fail here before it reaches a video or a README.
  const callsBefore = modelCalls();
  const fits = (sel) =>
    page.evaluate((s) => {
      for (const el of document.querySelectorAll("*")) if (el.scrollTop) el.scrollTop = 0; // the page scrolls inside the sidebar layout's container
      const els = [...document.querySelectorAll(s)];
      const last = els.at(-1)?.getBoundingClientRect();
      return { n: els.length, bottom: last ? Math.round(last.bottom) : null, height: window.innerHeight, width: window.innerWidth };
    }, sel);
  for (const [w, h] of [[1280, 720], [375, 812]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${BASE}/`);
    await page.getByTestId("see-trap").waitFor();
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const f = await fits('[data-testid="see-trap"]');
    check(`home ${w}x${h}: the main button is on the first screen without scrolling`, f.n === 1 && f.bottom !== null && f.bottom <= f.height, `button bottom ${f.bottom} of ${f.height}`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${BASE}/`);
  await page.getByTestId("see-trap").waitFor();
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

  // A slow failure first: the button says it is working, then the error appears next to a way out, and nothing navigates.
  await page.route("**/create-replay-room", async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "The replay could not be opened.", errorCode: "internal" }) });
  });
  await page.getByTestId("see-trap").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="see-trap"]')?.getAttribute("aria-busy") === "true", null, { timeout: 2000 });
  const busyButton = page.getByTestId("see-trap");
  check("replay button: while the room opens it says so and cannot be pressed twice", (await busyButton.isDisabled()) && norm(await busyButton.innerText()) === "Opening...");
  await page.getByTestId("see-trap-error").waitFor({ timeout: 6000 });
  const errText = norm(await page.getByTestId("see-trap-error").innerText());
  check("replay button: a failure shows a message and the 3-minute practice as the way out, and the button works again", /\S/.test(errText) && !/undefined|\[object/.test(errText) && /Start the 3-minute practice instead/.test(errText) && (await busyButton.isEnabled()) && !page.url().includes("/r/"), errText);
  await page.unroute("**/create-replay-room");

  await page.getByTestId("see-trap").click();
  await page.waitForURL(/\/r\/[A-Z0-9]{4,12}$/);
  await phase("reveal");
  await page.getByTestId("proof-panel").waitFor();
  const replayCode = page.url().split("/r/")[1];
  const text = (id) => page.getByTestId(id).innerText().then(norm);
  const num = async (ids) => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await text(`proof-${id}`)])));
  const alone = await num(["alone-m1", "alone-m2", "alone-m3"]);
  check("replay: each person alone points to Brightpane Chat (You 4.67, Noa 5.00, Idris 5.00)", alone["alone-m1"] === "4.67" && alone["alone-m2"] === "5.00" && alone["alone-m3"] === "5.00", JSON.stringify(alone));
  const shared = await num(["shared-A", "shared-B", "shared-C"]);
  check("replay: with only the facts everyone already knew, Brightpane Chat 7.33 leads Kelvane Desk -2.33 and Cobbleline Basic -1.67", shared["shared-A"] === "-2.33" && shared["shared-B"] === "7.33" && shared["shared-C"] === "-1.67", JSON.stringify(shared));
  const fullScores = await num(["full-A", "full-B", "full-C"]);
  check("replay: with every fact, Kelvane Desk 10.33 leads Brightpane Chat 0.00 and Cobbleline Basic -1.67", fullScores["full-A"] === "10.33" && fullScores["full-B"] === "0.00" && fullScores["full-C"] === "-1.67", JSON.stringify(fullScores));
  const votes = await num(["votes-A", "votes-B", "votes-C"]);
  check("replay: final votes are Kelvane Desk 3, Brightpane Chat 0, Cobbleline Basic 0", votes["votes-A"] === "3" && votes["votes-B"] === "0" && votes["votes-C"] === "0", JSON.stringify(votes));
  const head = await text("reveal-headline");
  check("replay: the headline is the whole claim in two sentences, merged into the proof panel", head.startsWith("In this replay all three (one scripted, two simulated) leaned to Brightpane Chat. With every fact on the table the ledger points to Kelvane Desk."), head.slice(0, 170));
  check("replay: four proof rows, the headline on the same card, the scripted caption", (await page.locator('[data-testid^="proof-row-"]').count()) === 4 && (await page.getByTestId("reveal-headline").getByTestId("proof-panel").count()) === 1 && /^Scripted example, not a measurement of a real team/.test(await text("replay-caption")));
  check("replay: the team's own-facts line is there", /Your own facts alone point to Brightpane Chat\. Your facts and the team's facts disagree\./.test(await text("headline-own")));
  check("replay: no guess-who, alone check or guess question", (await page.getByTestId("guess-who").count()) === 0 && (await page.getByTestId("alone-check").count()) === 0 && (await page.getByTestId("guess-select").count()) === 0);
  const rb = page.getByTestId("practice-banner");
  check("replay: the banner says scripted and simulated and offers the 3-minute practice", (await rb.getAttribute("data-replay")) === "true" && /Replay of a scripted team/.test(await rb.innerText()) && /simulated/.test(await rb.innerText()) && /Do it yourself \(3 min\)/.test(await rb.innerText()), norm(await rb.innerText()));
  const replayRaw = JSON.parse(await rawRoom(page, replayCode));
  check("replay: the view says replay, reveal, 15 cards, 9 known by one person", replayRaw.practice?.replay === true && replayRaw.phase === "reveal" && replayRaw.reveal.cards.length === 15 && replayRaw.reveal.uniqueCount === 9 && replayRaw.reveal.members.filter((m) => m.simulated).length === 2);
  for (const [w, h] of [[1280, 720], [375, 812]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300);
    const f = await fits('[data-testid^="proof-row-"]');
    check(`replay ${w}x${h}: all 4 proof rows are on the first screen without scrolling`, f.n === 4 && f.bottom !== null && f.bottom <= f.height, `last row bottom ${f.bottom} of ${f.height} (innerWidth ${f.width})`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  const callsAfter = modelCalls();
  if (callsBefore === null) console.log("SKIP replay: zero model calls (no STUB_LOG given)");
  else check("replay: the whole replay path, from the click to the reveal, made zero model calls", callsAfter === callsBefore, `${callsBefore} calls before, ${callsAfter} after`);

  // The way on: "Do it yourself (3 min)" in the replay banner opens a normal practice room at the notes.
  await page.getByTestId("replay-to-practice").click();
  await page.waitForURL((u) => /\/r\/[A-Z0-9]{4,12}$/.test(u.pathname) && !u.pathname.endsWith(replayCode));
  await phase("notes");
  const nb = page.getByTestId("practice-banner");
  check("replay: 'Do it yourself (3 min)' opens a normal practice room at the notes", (await nb.getAttribute("data-replay")) === null && (await page.getByTestId("notes-input").inputValue()).length > 100);

  assertClean(p);
  check("guest path: no sign-in, no 401/403 beyond the known probe, no page errors", true);
  console.log(`room ${code}; blocked external hosts: ${[...new Set(p.blocked)].join(", ") || "none"}`);
} catch (e) {
  console.log(`ERROR ${e.message}`);
  await shot("error.png", true).catch(() => {});
  checks.push({ name: "run", ok: false, detail: e.message });
} finally {
  await p.close();
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
