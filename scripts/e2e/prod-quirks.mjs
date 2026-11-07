// Two production-only problems that a plain local run cannot show, replayed on purpose.
//  A. Netlify's free plan adds "\n<!-- ... -->" to <head> of every HTML page. React 19 reads that whitespace text node as a
//     hydration mismatch (error #418) and rebuilds the page, wiping anything typed in the first moments. Here every HTML
//     response gets the same insertion: the page must hydrate with zero page errors.
//  B. The framework's cookie banner for EU visitors (chosen by time zone, or by the host's country header) must not show
//     on any screen of a practice run, nothing may lie on top of an action button, and no request may leave for another host
//     (the harness aborts every host but 127.0.0.1 and lists it in `blocked`).
//  C. The connection drops while notes are being typed: the page must stay (no reload into the browser's offline page).
//  D. A click before the page's scripts have arrived (the buttons are on screen about 1 s before React answers, longer on a phone):
//     it must count exactly once, not vanish and not start two rooms.
// Run: node scripts/e2e/prod-quirks.mjs --base=http://127.0.0.1:<port> --pw-core=<path to playwright-core/index.mjs>
import { assertClean, BASE, newPlayer } from "./harness.mjs";

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` -- ${detail}` : ""}`);
};

const BANNER = "[data-agent-native-consent-banner]";
const phase = (page, name) => page.waitForSelector(`[data-testid="phase-bar"][data-phase="${name}"]`, { timeout: 15000 });

/** Whether the middle of the control is really the control (or something inside it), not a banner or another box on top. */
const reachable = (loc) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (el === top || el.contains(top));
  });

/** One screen: after the region answer had time to arrive, no banner, and every given control is reachable. */
async function screen(p, name, controls) {
  await p.page.waitForTimeout(1200);
  const banners = await p.page.locator(BANNER).count();
  const covered = [];
  for (const [label, loc] of controls) {
    await loc.scrollIntoViewIfNeeded();
    if (!(await reachable(loc))) covered.push(label);
  }
  check(`${p.label} ${name}: no cookie banner, nothing on top of ${controls.map(([l]) => l).join(" / ")}`, banners === 0 && covered.length === 0, `banners ${banners}; covered: ${covered.join(", ") || "none"}`);
}

/** Home -> practice room -> notes -> cards -> weigh -> vote -> reveal, calling `screen` on each. */
async function walkPractice(p) {
  const { page } = p;
  const done = page.getByRole("button", { name: "I'm done", exact: true });
  await page.goto(`${BASE}/`);
  await page.getByTestId("try-trap").waitFor();
  await screen(p, "home", [["See the trap", page.getByTestId("see-trap")], ["Do it yourself", page.getByTestId("try-trap")]]);
  await page.getByTestId("try-trap").click();
  await page.waitForURL(/\/r\/[A-Z0-9]{4,12}$/);
  await phase(page, "notes");
  await page.getByRole("radio", { name: "Brightpane Chat" }).click();
  await page.getByTestId("lean-state").getByText("Sealed", { exact: false }).waitFor();
  await screen(p, "notes", [["I'm done", done]]);
  await done.click();
  await phase(page, "cards");
  while ((await page.getByTestId("draft").count()) > 0) {
    const n = await page.getByTestId("draft").count();
    await page.getByRole("button", { name: "Approve to ledger" }).first().click();
    await page.waitForFunction((k) => document.querySelectorAll('[data-testid="draft"]').length < k, n, { timeout: 10000 });
  }
  await screen(p, "cards", [["I'm done", done]]);
  await done.click();
  await phase(page, "weigh");
  const cards = page.getByTestId("weigh-card");
  const n = await cards.count();
  for (let i = 0; i < n; i++) await cards.nth(i).getByRole("radio", { name: /^2,/ }).click();
  await page.waitForFunction((k) => document.querySelector('[data-testid="weigh-progress"] strong')?.textContent === String(k), n, { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="phase-bar"] button[disabled]'), null, { timeout: 8000 });
  await screen(p, "weigh", [["I'm done", done]]);
  await done.click();
  await phase(page, "vote");
  await page.getByRole("radio", { name: "Kelvane Desk" }).click();
  const seal = page.getByRole("button", { name: "Seal my vote" });
  await screen(p, "vote", [["Seal my vote", seal]]);
  await seal.click();
  await phase(page, "reveal");
  await page.getByTestId("reveal").waitFor();
  await screen(p, "reveal", [["More detail", page.getByTestId("more-detail-summary")]]);
}

// ---- A. the head insertion ------------------------------------------------------------------------------------------
const a = await newPlayer("head");
try {
  let inserted = 0;
  await a.page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const res = await route.fetch();
    const html = await res.text();
    const out = html.replace(/(<meta\s+charset[^>]*>)/i, "$1\n<!-- x -->");
    if (out !== html) inserted++;
    await route.fulfill({ response: res, body: out, headers: { ...res.headers(), "content-length": String(Buffer.byteLength(out)) } });
  });
  await a.page.goto(`${BASE}/`);
  await a.page.getByTestId("try-trap").waitFor();
  await a.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await a.page.getByTestId("try-trap").click();
  await a.page.waitForURL(/\/r\/[A-Z0-9]{4,12}$/);
  await phase(a.page, "notes");
  await a.page.reload(); // a room page that is a document response with the insertion
  await phase(a.page, "notes");
  await a.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await a.page.goto(`${BASE}/r/ZZQ170`); // a room that does not exist
  await a.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  const pageErrors = a.problems.filter((x) => x.includes("pageerror"));
  check("head insertion: the insertion happened on every document load (home, room after a reload, missing room)", inserted === 3, `${inserted} of 3`);
  check("head insertion: zero page errors (no React #418) on all three loads", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 160) || "0 page errors");
} catch (e) {
  check("head insertion: run", false, e.message);
} finally {
  await a.close();
}

// ---- B. the EU banner: by time zone, then by the host's country header -----------------------------------------------
for (const [label, opts] of [
  ["Nicosia", { timezoneId: "Europe/Nicosia" }],
  ["CY-header", { extraHTTPHeaders: { "x-country": "CY" } }],
]) {
  const p = await newPlayer(label, { width: 1280, height: 800, ...opts });
  try {
    await walkPractice(p);
    check(`${label}: no request left for another host`, p.blocked.length === 0, [...new Set(p.blocked)].join(", ") || "0 external requests");
    assertClean(p);
    check(`${label}: no sign-in, no 401/403 beyond the known probe, no page errors`, true);
  } catch (e) {
    check(`${label}: run`, false, e.message);
  } finally {
    await p.close();
  }
}

// ---- C. the connection drops while someone is typing notes ----------------------------------------------------------------
// The first failed call makes the framework load a script chunk; offline that load fails, and the framework's head script used to
// reload the page into the browser's offline page, with the unsaved notes gone. Rounds, because it did not happen every time.
// The framework runs different recovery code on a local host (127.0.0.1) and on a real one, so the check runs on both: for the second
// the browser maps a made-up name to the test server (nothing leaves the machine).
async function offlineWhileTyping(title, origin, rounds, options = {}) {
  let blank = 0;
  let lost = 0;
  for (let i = 0; i < rounds; i++) {
    const c = await newPlayer("offline" + i, options);
    try {
      await c.page.goto(`${origin}/`);
      await c.page.getByTestId("try-trap").click();
      await c.page.waitForURL(/\/r\/[A-Z0-9]{4,12}$/);
      await phase(c.page, "notes");
      const box = c.page.getByTestId("notes-input");
      await box.fill("saved while online");
      await c.page.getByTestId("notes-state").getByText("Saved", { exact: false }).waitFor();
      await c.ctx.setOffline(true);
      await box.fill("saved while online\ntyped after the connection dropped");
      await c.page.waitForTimeout(2200);
      if (!c.page.url().startsWith(origin)) blank++;
      else if ((await box.inputValue().catch(() => "")) !== "saved while online\ntyped after the connection dropped") lost++;
    } catch (e) {
      lost++;
    } finally {
      await c.close();
    }
  }
  check(`${title} (${rounds} rounds)`, blank === 0 && lost === 0, `${blank} browser offline pages, ${lost} lost texts`);
}
await offlineWhileTyping("offline while typing: the page stays and keeps the typed notes", BASE, 10);
const ALIAS = "unsaid-test.example";
const aliasOrigin = BASE.replace("127.0.0.1", ALIAS);
await offlineWhileTyping("offline while typing on a real host name: the page stays and keeps the typed notes", aliasOrigin, 6, {
  allowHost: ALIAS,
  args: [`--host-resolver-rules=MAP ${ALIAS} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${aliasOrigin}`],
});

// ---- D. clicks before the scripts have arrived ---------------------------------------------------------------------------------
// Every script file is held back until the clicks are made, so they come first for certain (DOMContentLoaded does not wait for them).
// "Before React" is proved, not assumed: React puts its props on a node when it hydrates it, and the button has none yet.
const CREATE = /\/_agent-native\/actions\/create-(replay-room|practice-room|room)$/;
const hydrated = (loc) => loc.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps")));
const opensReplay = (page) => page.waitForSelector('[data-testid="proof-panel"]', { timeout: 20000 });
const opensPractice = async (page) => {
  await page.waitForURL(/\/r\/[A-Z0-9]{4,12}$/, { timeout: 20000 });
  await phase(page, "notes");
};

async function clickScenario(title, { testid, early, clicks, opens }) {
  const p = await newPlayer("click");
  const created = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const cap = setTimeout(release, 25000); // a failing run must not hold the scripts forever
  try {
    p.page.on("request", (r) => CREATE.test(new URL(r.url()).pathname) && created.push(new URL(r.url()).pathname.split("/").pop()));
    if (early) await p.page.route(/\.js(\?|$)/, async (route) => (await gate, route.fallback().catch(() => {})));
    await p.page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    const button = p.page.getByTestId(testid);
    if (!early) await p.page.waitForFunction((id) => Object.keys(document.querySelector(`[data-testid="${id}"]`) ?? {}).some((k) => k.startsWith("__reactProps")), testid, { timeout: 20000 });
    for (let i = 0; i < clicks; i++) await button.click();
    const before = early ? !(await hydrated(button)) : true; // early: the click came before React had touched the button
    release();
    await opens(p.page);
    await p.page.waitForTimeout(2000); // a late second request would show up here
    const errors = p.problems.filter((x) => x.includes("pageerror"));
    check(title, before && created.length === 1 && errors.length === 0, `${early ? `${clicks} click(s) before React: ${before}; ` : ""}create requests ${created.length} (${created.join(", ") || "none"}); page errors ${errors.length}`);
  } catch (e) {
    check(title, false, `${e.message.split("\n")[0]}; create requests ${created.length}`);
  } finally {
    clearTimeout(cap);
    release();
    await p.close();
  }
}
await clickScenario("early click on See the trap: the replay opens (proof-panel within 20 s), 1 request, 0 page errors", { testid: "see-trap", early: true, clicks: 1, opens: opensReplay });
await clickScenario("early click on Do it yourself: the practice room opens, 1 request, 0 page errors", { testid: "try-trap", early: true, clicks: 1, opens: opensPractice });
await clickScenario("two early clicks on See the trap: exactly 1 request, 0 page errors", { testid: "see-trap", early: true, clicks: 2, opens: opensReplay });
await clickScenario("a normal click once the page is ready: exactly 1 room, 0 page errors", { testid: "try-trap", early: false, clicks: 1, opens: opensPractice });

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
