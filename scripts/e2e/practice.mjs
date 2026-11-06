// Practice run end to end in a fresh headless Chromium (own temp profile, 127.0.0.1 only):
// home -> "Try the trap" -> notes + sealed lean -> cards -> blind weigh -> vote -> reveal.
// Run: node scripts/e2e/practice.mjs --pw-core=<path to playwright-core/index.mjs>   (dev server on http://127.0.0.1:18744, or --base=...)
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertClean, BASE, newPlayer } from "./harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, "../../docs/shots");
mkdirSync(SHOTS, { recursive: true });

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` -- ${detail}` : ""}`);
};

const p = await newPlayer("practice", { width: 1280, height: 900 });
const { page } = p;
const shot = (name, full = false) => page.screenshot({ path: path.join(SHOTS, name), fullPage: full });
const phase = (name) => page.waitForSelector(`[data-testid="phase-bar"][data-phase="${name}"]`, { timeout: 15000 });

try {
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "Try the trap (3 min)" }).waitFor();
  // The dev server may reload once while it optimizes dependencies; let the page settle before clicking.
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await shot("01-home.png", true);

  // ---- notes ---------------------------------------------------------------------------------
  await page.getByRole("button", { name: "Try the trap (3 min)" }).click();
  await page.waitForURL(/\/r\/[A-Z0-9]{4,12}$/);
  await phase("notes");
  const code = page.url().split("/r/")[1];
  const memo = await page.getByTestId("notes-input").inputValue();
  check("notes: the memo is prefilled", memo.length > 100, `${memo.length} chars`);
  check("practice banner and simulated labels", (await page.getByTestId("practice-banner").count()) === 1 && (await page.getByText("simulated").count()) >= 2);
  const barText = await page.getByTestId("phase-bar").innerText();
  check("phase bar: the player is shown as 'You', not 'You (you)'", /\bYou\b/.test(barText) && !/You \(you\)/.test(barText));

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
  const cards = await page.getByTestId("ledger-card").count();
  check("cards: ledger holds 15 cards after approving", cards === 15, `${cards} cards`);
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
  const picks = await page.getByTestId("picks").innerText();
  check("reveal: leans and votes of simulated teammates are shown", /Noa[\s\S]*simulated[\s\S]*Leaned to\s+Brightpane Chat[\s\S]*voted\s+Kelvane Desk/i.test(picks));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("06-reveal.png", false);
  await shot("07-reveal-full.png", true);

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
