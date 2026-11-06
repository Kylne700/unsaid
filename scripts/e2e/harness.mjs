// Playwright helper for the local checks. Every player is a fresh headless Chromium with its own
// temp profile; it never attaches to another browser. Only 127.0.0.1 is reachable (no Google, no
// third-party hosts). Any 401, visit to /sign-in or page error is recorded as a problem.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Framework noise: session-gated endpoints that answer 401 to a guest. The engine-readiness probe runs on every
// public page; the rest are the chat sidebar's account/settings probes on the room page (voice, uploads, org, dev
// mode, title generation, checkpoints, ...). The sidebar offers no switch for them; only the model, Builder and key-status
// probes are gone, through RoomScreen's empty model list. The guest chat itself (threads, runs, messages) must never be here.
const KNOWN_401 = new Set(
  [
    "agent-engine/status",
    "agent-chat/mode",
    "agent-chat/capabilities",
    "agent-chat/generate-title",
    "agent-chat/checkpoints",
    "org/me",
    "connection-status/builder",
    "voice-providers/status",
    "file-upload/status",
    "actions/context-manifest-get",
  ].map((p) => `/_agent-native/${p}`),
);

// Options come from the command line: --base=http://127.0.0.1:18744  --pw-core=<path to playwright-core/index.mjs>
// (playwright-core is not an app dependency; without --pw-core the bare package name is imported).
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
export const BASE = arg("base", "http://127.0.0.1:18744");
const PW_CORE = arg("pw-core", "playwright-core");

export async function newPlayer(label, { width = 1280, height = 860 } = {}) {
  const { chromium } = await import(PW_CORE);
  const profile = mkdtempSync(path.join(tmpdir(), `unsaid-e2e-${label}-`));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width, height },
  });
  const problems = [];
  const blocked = [];
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1" || u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    blocked.push(u.hostname);
    return route.abort();
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on("response", (r) => {
    const pathname = new URL(r.url()).pathname;
    if ((r.status() === 401 || r.status() === 403) && !KNOWN_401.has(pathname)) problems.push(`${label}: HTTP ${r.status()} ${pathname}`);
  });
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame() && f.url().includes("/sign-in")) problems.push(`${label}: navigated to /sign-in`);
  });
  page.on("pageerror", (e) => problems.push(`${label}: pageerror ${String(e.message).slice(0, 160)}`));
  return {
    label,
    ctx,
    page,
    problems,
    blocked,
    async close() {
      await ctx.close();
    },
  };
}

export function assertClean(...players) {
  const all = players.flatMap((p) => p.problems);
  if (all.length) throw new Error(`guest-path problems:\n${all.join("\n")}`);
}

/** The room exactly as this page's member gets it from get-room (the call the screen polls), as text. */
export const rawRoom = (page, code) =>
  page.evaluate(async (c) => {
    const token = window.localStorage.getItem(`unsaid:member:${c}`);
    const r = await fetch("/_agent-native/actions/get-room", { method: "POST", headers: { "content-type": "application/json", "x-agent-native-frontend": "1" }, body: JSON.stringify({ code: c, token }) });
    return await r.text();
  }, code);

/** Whole page as one image. With the chat sidebar the page scrolls inside a container (the document does not), so
 *  fullPage alone gives only the viewport: grow the viewport by what is hidden, shoot, put it back. */
export async function shootPage(page, file) {
  const vp = page.viewportSize();
  const hidden = await page.evaluate(() => {
    let most = 0;
    for (const el of document.querySelectorAll("*")) {
      const o = getComputedStyle(el).overflowY;
      if ((o === "auto" || o === "scroll") && el.scrollHeight > el.clientHeight) most = Math.max(most, el.scrollHeight - el.clientHeight);
    }
    return most;
  });
  if (hidden > 0) await page.setViewportSize({ width: vp.width, height: vp.height + hidden });
  await page.screenshot({ path: file, fullPage: true });
  if (hidden > 0) await page.setViewportSize(vp);
}

/** What a reader would call broken in the main column: things sticking out of it, text cut off by a clipping box,
 *  controls lying on top of each other. A list of plain sentences; empty means nothing found. */
export const auditLayout = (page) =>
  page.evaluate(() => {
    const out = [];
    const main = document.querySelector("main") ?? document.body;
    const mr = main.getBoundingClientRect();
    const name = (el) => `${el.tagName.toLowerCase()}${el.dataset?.testid ? `[${el.dataset.testid}]` : ""} "${(el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40)}"`;
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    const all = [...main.querySelectorAll("*")].filter(shown);
    if (main.scrollWidth > main.clientWidth + 1) out.push(`sideways scroll: main is ${main.scrollWidth}px wide in ${main.clientWidth}px`);
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.right > mr.right + 1 || r.left < mr.left - 1) out.push(`sticks out: ${name(el)} at ${Math.round(r.left)}..${Math.round(r.right)}, column is ${Math.round(mr.left)}..${Math.round(mr.right)}`);
      const cs = getComputedStyle(el);
      const clipX = cs.overflowX === "hidden" || cs.overflowX === "clip";
      const clipY = cs.overflowY === "hidden" || cs.overflowY === "clip";
      if ((clipX && el.scrollWidth > el.clientWidth + 1) || (clipY && el.scrollHeight > el.clientHeight + 1)) out.push(`cut off: ${name(el)} holds ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
    }
    const ctl = all.filter((e) => e.matches("button, a[href], input, select, textarea, [role=radio]"));
    for (let i = 0; i < ctl.length; i++)
      for (let j = i + 1; j < ctl.length; j++) {
        if (ctl[i].contains(ctl[j]) || ctl[j].contains(ctl[i])) continue;
        const a = ctl[i].getBoundingClientRect();
        const b = ctl[j].getBoundingClientRect();
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) out.push(`overlap: ${name(ctl[i])} and ${name(ctl[j])}`);
      }
    return out;
  });

/** Only with --shots-dir=<dir>: the page with the chat sidebar open and again collapsed, whole page each, plus the
 *  layout audit of both. The sidebar is left open, as it was. */
export const SHOTS_DIR = arg("shots-dir", "");
export async function snapBoth(page, name) {
  if (!SHOTS_DIR) return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  for (const state of ["open", "closed"]) {
    if (state === "closed") {
      const collapse = page.getByRole("button", { name: "Collapse sidebar" });
      if (!(await collapse.count())) break;
      await collapse.click();
      await page.waitForTimeout(600);
    }
    const found = await auditLayout(page);
    console.log(`AUDIT ${name} (${state}): ${found.length ? `${found.length} found\n  ${found.slice(0, 12).join("\n  ")}` : "nothing found"}`);
    await shootPage(page, path.join(SHOTS_DIR, `${name}-${state}.png`));
  }
  const reopen = page.getByRole("button", { name: "Toggle agent" });
  if (await reopen.count()) {
    await reopen.click();
    await page.waitForTimeout(600);
  }
}
