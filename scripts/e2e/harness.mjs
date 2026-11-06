// Playwright helper for the local checks. Every player is a fresh headless Chromium with its own
// temp profile; it never attaches to another browser. Only 127.0.0.1 is reachable (no Google, no
// third-party hosts). Any 401, visit to /sign-in or page error is recorded as a problem.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Framework noise on every public page: the engine-readiness probe is session-gated and answers 401.
const KNOWN_401 = new Set(["/_agent-native/agent-engine/status"]);

export const BASE = process.env.BASE_URL || "http://127.0.0.1:18744";
const PW_CORE =
  process.env.PW_CORE ||
  "playwright-core";

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
