import { useState } from "react";

import { cn } from "@/lib/utils";

import { SectionTitle } from "./bits";
import { useRoomCtx } from "./room-context";

const LEVELS = [
  { value: 0, hint: "not at all" },
  { value: 1, hint: "a little" },
  { value: 2, hint: "quite a lot" },
  { value: 3, hint: "a great deal" },
] as const;

export function WeighPhase() {
  const { room, run } = useRoomCtx();
  const weigh = room.weigh;
  // What the member just clicked, shown at once while the server confirms it.
  const [local, setLocal] = useState<Record<string, number>>({});
  if (!weigh) return null;

  async function rate(cardId: string, weight: number) {
    setLocal((l) => ({ ...l, [cardId]: weight }));
    const r = await run("rate-card", { cardId, weight });
    if (!r.ok)
      setLocal((l) => {
        const rest = { ...l };
        delete rest[cardId];
        return rest;
      });
  }

  const rated = weigh.cards.filter((c) => (local[c.id] ?? c.myRating) !== null).length;

  return (
    <section aria-labelledby="weigh-title">
      <SectionTitle hint="Blind round: you see each fact without its option, without who knew it, and without anyone's ratings. Rate every card.">
        <span id="weigh-title">How much does this matter?</span>
      </SectionTitle>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <p className="text-sm" data-testid="weigh-progress" aria-live="polite">
          Rated <strong>{rated}</strong> of <strong>{weigh.total}</strong>
        </p>
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full bg-primary transition-all" style={{ width: `${weigh.total ? (rated / weigh.total) * 100 : 100}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">0 = does not matter to this decision, 3 = matters a great deal</p>
      </div>
      {weigh.cards.length === 0 ? <p className="text-sm text-muted-foreground">There are no cards to rate. Press "I'm done".</p> : null}
      <ol className="space-y-3">
        {weigh.cards.map((c, i) => {
          const value = local[c.id] ?? c.myRating;
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4" data-testid="weigh-card" data-rated={value ?? ""}>
              <p className="min-w-0 flex-1 basis-80 text-sm leading-relaxed">
                <span className="mr-2 text-xs text-muted-foreground">{i + 1}.</span>
                {c.neutral}
              </p>
              <div role="radiogroup" aria-label={`How much does card ${i + 1} matter?`} className="flex gap-1.5">
                {LEVELS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    role="radio"
                    aria-checked={value === l.value}
                    aria-label={`${l.value}, ${l.hint}`}
                    title={l.hint}
                    onClick={() => void rate(c.id, l.value)}
                    className={cn(
                      "size-10 rounded-md border text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      value === l.value && "border-primary bg-primary text-primary-foreground hover:bg-primary",
                    )}
                  >
                    {l.value}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
