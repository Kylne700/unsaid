// Gemini free tier: 500 requests per day per project. The app keeps under it with a daily cap in the database
// (so every server instance shares it) and gives each room member a smaller cap of their own.
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { unsaidLlmUsage } from "../db/schema.js";

export const APP_DAILY_CAP = 350;
export const MEMBER_DAILY_CAP = 40;
const APP = "app";

const utcDay = (now: Date) => now.toISOString().slice(0, 10);

// shortcut: the 429 pause lives in one process, so each serverless instance learns it on its own; fine at demo scale.
let pausedUntil = 0;
/** After a 429 from Gemini, no new requests for a while. */
export function pauseLlm(ms: number, now = Date.now()) {
  pausedUntil = Math.max(pausedUntil, now + ms);
}

/** Takes one request from `bucket` only if it has used fewer than `cap` today. */
async function take(day: string, bucket: string, cap: number): Promise<boolean> {
  const rows = await getDb()
    .insert(unsaidLlmUsage)
    .values({ day, bucket, count: 1 })
    .onConflictDoUpdate({
      target: [unsaidLlmUsage.day, unsaidLlmUsage.bucket],
      set: { count: sql`${unsaidLlmUsage.count} + 1` },
      setWhere: sql`${unsaidLlmUsage.count} < ${cap}`,
    })
    .returning({ count: unsaidLlmUsage.count });
  return rows.length === 1;
}

/** True when this member and the app both have requests left today. Reads only; nothing is taken. */
export async function hasLlmRoom(member: string, now = new Date()): Promise<boolean> {
  if (now.getTime() < pausedUntil) return false;
  const rows = await getDb()
    .select({ bucket: unsaidLlmUsage.bucket, count: unsaidLlmUsage.count })
    .from(unsaidLlmUsage)
    .where(and(eq(unsaidLlmUsage.day, utcDay(now)), inArray(unsaidLlmUsage.bucket, [APP, member])));
  const used = (b: string) => rows.find((r) => r.bucket === b)?.count ?? 0;
  return used(APP) < APP_DAILY_CAP && used(member) < MEMBER_DAILY_CAP;
}

/** Takes one real request for `member`. False means a cap is reached and the model must not be called. */
export async function takeLlmRequest(member: string, now = new Date()): Promise<boolean> {
  if (now.getTime() < pausedUntil) return false;
  const day = utcDay(now);
  return (await take(day, member, MEMBER_DAILY_CAP)) && (await take(day, APP, APP_DAILY_CAP));
}
