import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { errorText, SectionTitle, selectClass, Tag } from "./bits";
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
  // The other member's card whose "Same as mine" panel is open, and which of the member's own cards it would absorb.
  const [open, setOpen] = useState<string | null>(null);
  const [own, setOwn] = useState("");
  // Why the server refused the last merge, shown in the panel: the room-wide error banner sits at the top of a long page.
  const [refused, setRefused] = useState("");
  if (!weigh) return null;

  // Cards are blind here, so this is the first place two members can see that they wrote the same fact. A practice room
  // joins its scripted duplicates itself.
  const mineCards = weigh.cards.filter((c) => c.mine);
  const canMerge = room.practice === null && mineCards.length > 0;
  const ownId = mineCards.find((c) => c.id === own)?.id ?? mineCards[0]?.id;
  const position = new Map(weigh.cards.map((c, i) => [c.id, i + 1]));

  async function merge(keepId: string) {
    if (!ownId) return;
    const r = await run("merge-cards", { keepId, absorbId: ownId });
    if (r.ok) setOpen(null);
    else setRefused(r.error);
  }

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
      <SectionTitle hint={`Blind round: you see each fact without its option, without who knew it, and without anyone's ratings. Rate every card.${canMerge ? " If you also knew a fact, press Same as mine under it." : ""}`}>
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
              <div className="min-w-0 flex-1 basis-80">
                <p className="text-sm leading-relaxed">
                  <span className="mr-2 text-xs text-muted-foreground">{i + 1}.</span>
                  {canMerge && c.mine ? <Tag className="mr-2 border-primary/40 text-primary">Yours</Tag> : null}
                  <span dir="auto">{c.neutral}</span>
                </p>
                {canMerge && !c.mine ? (
                  <div className="mt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      data-testid="same-as-mine"
                      aria-expanded={open === c.id}
                      onClick={() => {
                        setOpen(open === c.id ? null : c.id);
                        setOwn(mineCards[0]?.id ?? "");
                        setRefused("");
                      }}
                    >
                      Same as mine
                    </Button>
                    {open === c.id ? (
                      <div className="mt-2 space-y-2 rounded-md border bg-muted/40 p-3 text-xs" data-testid="same-as-mine-panel">
                        <p>
                          Fold one of your cards into card {i + 1}. They are the same fact, so it counts once, as known by both of you. This cannot be undone.
                        </p>
                        {mineCards.length > 1 ? (
                          <select
                            aria-label="Which of your cards states the same fact?"
                            data-testid="same-as-mine-pick"
                            className={cn(selectClass, "h-8 w-full text-base sm:text-xs")}
                            value={ownId}
                            onChange={(e) => {
                              setOwn(e.target.value);
                              setRefused("");
                            }}
                          >
                            {mineCards.map((m) => (
                              <option key={m.id} value={m.id}>
                                {position.get(m.id)}. {m.neutral}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <p>
                            Your card: {position.get(mineCards[0]?.id ?? "")}. {mineCards[0]?.neutral}
                          </p>
                        )}
                        {refused ? (
                          <p className={errorText} data-testid="same-as-mine-refused">
                            {refused}
                          </p>
                        ) : null}
                        <div className="flex gap-2">
                          <Button type="button" size="xs" data-testid="same-as-mine-merge" onClick={() => void merge(c.id)}>
                            Merge
                          </Button>
                          <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
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
