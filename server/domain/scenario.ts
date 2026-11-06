import { z } from "zod";
import vendor from "../scenarios/vendor.json";

// Practice scenario file schema (see server/scenarios/vendor.json). Strict: a scenario with a typo must not load.
const scenarioSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    question: z.string(),
    options: z.array(z.object({ id: z.string(), name: z.string(), aliases: z.array(z.string()) }).strict()).min(2).max(4),
    best: z.string(),
    bait: z.string(),
    members: z.array(z.object({ id: z.string(), name: z.string(), role: z.string(), simulated: z.boolean() }).strict()).min(2),
    facts: z.array(
      z
        .object({
          id: z.string(),
          option: z.string(),
          polarity: z.enum(["pro", "con"]),
          text: z.string(),
          neutral: z.string(),
          holders: z.array(z.string()).min(1),
        })
        .strict(),
    ),
    packets: z.record(z.string(), z.object({ memo: z.string(), factPhrases: z.record(z.string(), z.string()) }).strict()),
    simulatedRatings: z.record(z.string(), z.record(z.string(), z.number().int().min(0).max(3))),
    simulatedInitialPick: z.record(z.string(), z.string()),
  })
  .strict();

export type Scenario = z.infer<typeof scenarioSchema>;

function parseScenario(raw: unknown): Scenario {
  const s = scenarioSchema.parse(raw);
  const optionIds = new Set(s.options.map((o) => o.id));
  const memberIds = new Set(s.members.map((m) => m.id));
  const humans = s.members.filter((m) => !m.simulated);
  const problems: string[] = [];
  if (humans.length !== 1) problems.push("exactly one non-simulated member is required");
  if (!optionIds.has(s.best) || !optionIds.has(s.bait)) problems.push("best/bait must be option ids");
  for (const f of s.facts) {
    if (!optionIds.has(f.option)) problems.push(`fact ${f.id}: unknown option`);
    if (f.holders.some((h) => !memberIds.has(h))) problems.push(`fact ${f.id}: unknown holder`);
  }
  for (const m of s.members) {
    if (!s.packets[m.id]) problems.push(`no packet for ${m.id}`);
    if (m.simulated && (!s.simulatedRatings[m.id] || !optionIds.has(s.simulatedInitialPick[m.id] ?? ""))) problems.push(`${m.id}: missing scripted ratings or initial pick`);
  }
  if (problems.length) throw new Error(`Bad scenario ${s.id}: ${problems.join("; ")}`);
  return s;
}

const SCENARIOS: Record<string, Scenario> = {};
const first = parseScenario(vendor);
SCENARIOS[first.id] = first;

export const DEFAULT_SCENARIO_ID = first.id;
export const getScenario = (id: string): Scenario | null => SCENARIOS[id] ?? null;
