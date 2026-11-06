// The daily Gemini caps, counted in the database per UTC day.
import { getDbExec } from "@agent-native/core/db";
import { beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../db/migrations";
import { APP_DAILY_CAP, hasLlmRoom, MEMBER_DAILY_CAP, pauseLlm, takeLlmRequest } from "./llm-quota";

beforeAll(async () => {
  for (const m of MIGRATIONS) await getDbExec().execute(m.sql as string);
});

// Fixed past days, so the tests share no bucket and a pause set here has ended long before "now".
const at = (iso: string) => new Date(iso);
const used = async (day: string, bucket: string) =>
  Number((await getDbExec().execute({ sql: "SELECT count FROM unsaid_llm_usage WHERE day = ? AND bucket = ?", args: [day, bucket] })).rows[0]?.count ?? 0);
const setUsed = (day: string, bucket: string, count: number) =>
  getDbExec().execute({ sql: "INSERT INTO unsaid_llm_usage (day, bucket, count) VALUES (?, ?, ?)", args: [day, bucket, count] });

describe("llm quota", () => {
  it(`a member gets ${MEMBER_DAILY_CAP} requests a UTC day, even when they all arrive at once`, async () => {
    const now = at("2020-03-01T12:00:00Z");
    const got = await Promise.all(Array.from({ length: MEMBER_DAILY_CAP + 10 }, () => takeLlmRequest("member:Q1:m1", now)));
    expect(got.filter(Boolean)).toHaveLength(MEMBER_DAILY_CAP);
    expect(await used("2020-03-01", "member:Q1:m1")).toBe(MEMBER_DAILY_CAP);
    expect(await hasLlmRoom("member:Q1:m1", now)).toBe(false);
    expect(await hasLlmRoom("member:Q1:m2", now)).toBe(true); // other members are not affected
    expect(await used("2020-03-01", "app")).toBe(MEMBER_DAILY_CAP); // a refused member request takes nothing from the app
  });

  it("starts again at 00:00 UTC, whatever the server's time zone", async () => {
    await setUsed("2020-03-02", "member:Q2:m1", MEMBER_DAILY_CAP);
    expect(await takeLlmRequest("member:Q2:m1", at("2020-03-02T23:59:59.999Z"))).toBe(false);
    expect(await takeLlmRequest("member:Q2:m1", at("2020-03-03T00:00:00.000Z"))).toBe(true);
    expect(await used("2020-03-03", "member:Q2:m1")).toBe(1);
  });

  it(`stops every member at the app cap of ${APP_DAILY_CAP}`, async () => {
    const now = at("2020-03-04T08:00:00Z");
    await setUsed("2020-03-04", "app", APP_DAILY_CAP - 1);
    expect(await hasLlmRoom("member:Q3:m1", now)).toBe(true);
    expect(await takeLlmRequest("member:Q3:m1", now)).toBe(true);
    expect(await hasLlmRoom("member:Q3:m2", now)).toBe(false);
    expect(await takeLlmRequest("member:Q3:m2", now)).toBe(false);
    expect(await used("2020-03-04", "app")).toBe(APP_DAILY_CAP);
  });

  it("hasLlmRoom only reads", async () => {
    const now = at("2020-03-05T08:00:00Z");
    for (let i = 0; i < 3; i++) expect(await hasLlmRoom("member:Q4:m1", now)).toBe(true);
    expect(await used("2020-03-05", "member:Q4:m1")).toBe(0);
  });

  it("a 429 pause stops all requests until it ends", async () => {
    const t = Date.parse("2020-03-06T10:00:00Z");
    pauseLlm(60_000, t);
    expect(await takeLlmRequest("member:Q5:m1", new Date(t + 59_000))).toBe(false);
    expect(await hasLlmRoom("member:Q5:m1", new Date(t + 59_000))).toBe(false);
    expect(await takeLlmRequest("member:Q5:m1", new Date(t + 60_000))).toBe(true);
  });
});
