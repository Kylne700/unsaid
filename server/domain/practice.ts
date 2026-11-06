// Practice mode ("Fall into the trap yourself"): one real member (m1) plus scripted, labelled-simulated teammates.
import { rank, scoreOptions } from "./ledger";
import type { Scenario } from "./scenario";
import { addCardOrJoin, emptyRoom, pushMember } from "./state";
import { getScenario } from "./scenario";
import type { Phase, Room, Weight } from "./types";
import { newId } from "./util";

export function buildPracticeRoom(code: string, sc: Scenario): { room: Room; token: string; memberId: string } {
  const room = emptyRoom(code, sc.question, sc.options.map((o) => ({ id: o.id, name: o.name, aliases: [...o.aliases] })));
  room.practice = { scenarioId: sc.id };
  let token = "";
  let memberId = "";
  for (const m of sc.members) {
    const added = pushMember(room, m.name, { id: m.id, role: m.role, simulated: m.simulated });
    room.notes[m.id] = sc.packets[m.id]?.memo ?? "";
    const pick = sc.simulatedInitialPick[m.id];
    if (m.simulated && pick) room.initialPicks[m.id] = pick;
    if (!m.simulated) {
      token = added.token ?? "";
      memberId = m.id;
    }
  }
  room.creatorId = memberId;
  practiceEnter(room, "notes");
  return { room, token, memberId };
}

/** What the simulated teammates do when the room enters a phase. A no-op for live rooms. */
export function practiceEnter(room: Room, phase: Phase): void {
  const sc = room.practice ? getScenario(room.practice.scenarioId) : null;
  if (!sc) return;
  const sims = room.members.filter((m) => m.simulated);
  const human = room.members.find((m) => !m.simulated);

  if (phase === "cards") {
    // Facts held by simulated members are approved straight away; a fact held by several becomes one card.
    for (const f of sc.facts) {
      for (const h of f.holders) {
        if (sims.some((s) => s.id === h)) addCardOrJoin(room, h, { option: f.option, polarity: f.polarity, text: f.text, neutral: f.neutral, factKey: f.id });
      }
    }
    // m1's cards are drafts prepared from the memo; m1 approves or edits them.
    if (human && !room.drafts.some((d) => d.ownerId === human.id)) {
      for (const f of sc.facts.filter((x) => x.holders.includes(human.id))) {
        room.drafts.push({
          id: newId("d"),
          ownerId: human.id,
          option: f.option,
          polarity: f.polarity,
          text: f.text,
          neutral: f.neutral,
          origin: "practice",
          phrase: sc.packets[human.id]?.factPhrases[f.id] ?? null,
          factKey: f.id,
        });
      }
    }
  }
  if (phase === "weigh") {
    for (const s of sims) {
      const mine: Record<string, Weight> = {};
      for (const c of room.cards) {
        const w = c.factKey ? sc.simulatedRatings[s.id]?.[c.factKey] : undefined;
        if (w !== undefined) mine[c.id] = w as Weight;
      }
      room.ratings[s.id] = mine;
    }
  }
  if (phase === "vote") {
    // Each simulated member votes for the option their own weights put first on the full ledger
    // (an exact tie goes to the tied option listed first; the scripted data has none).
    for (const s of sims) {
      const own = room.ratings[s.id] ?? {};
      const weights = Object.fromEntries(room.cards.map((c) => [c.id, own[c.id] ?? 0]));
      const top = rank(scoreOptions(room.cards, weights, room.options), room.options).groups[0]?.options[0];
      if (top) room.votes[s.id] = top;
    }
  }
  for (const s of sims) s.done = true;
}
