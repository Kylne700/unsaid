import { IconCheck, IconLock } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { knownBy, OptionTag, PolarityMark, SectionTitle } from "./bits";
import { useRoomCtx } from "./room-context";

export function VotePhase() {
  const { room, run } = useRoomCtx();
  const [choice, setChoice] = useState<string | null>(null);
  const [sealing, setSealing] = useState(false);
  const ledger = room.ledger ?? [];
  const sealed = room.me.hasVoted;

  async function seal() {
    if (!choice) return;
    setSealing(true);
    try {
      await run("cast-vote", { optionId: choice });
    } finally {
      setSealing(false);
    }
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="vote-title">
        <SectionTitle hint="One vote, and it is final. Nobody sees any vote until the reveal, and nothing here recommends an option.">
          <span id="vote-title">Your final vote</span>
        </SectionTitle>
        <div role="radiogroup" aria-labelledby="vote-title" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${room.options.length}, minmax(0, 1fr))` }}>
          {room.options.map((o) => {
            const on = choice === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={sealed}
                onClick={() => setChoice(o.id)}
                className={cn(
                  "flex items-center justify-between rounded-lg border bg-card px-4 py-4 text-left text-base font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70",
                  on && "border-primary bg-primary/5",
                )}
              >
                {o.name}
                {on ? <IconCheck size={20} aria-hidden /> : null}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex items-center gap-3">
          {sealed ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="vote-state">
              <IconLock size={16} aria-hidden /> Your vote is sealed. The reveal opens when everyone has voted.
            </p>
          ) : (
            <>
              <Button disabled={!choice || sealing} onClick={() => void seal()}>
                Seal my vote
              </Button>
              <p className="text-xs text-muted-foreground">You cannot change it afterwards.</p>
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="facts-title">
        <SectionTitle hint="The ledger as the team approved it, with how many people knew each fact and how much you said it matters. Names come with the reveal.">
          <span id="facts-title">The facts on the table</span>
        </SectionTitle>
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${room.options.length}, minmax(0, 1fr))` }}>
          {room.options.map((o) => (
            <div key={o.id}>
              <h3 className="mb-2">
                <OptionTag options={room.options} id={o.id} />
              </h3>
              <ul className="space-y-2">
                {ledger
                  .filter((c) => c.option === o.id)
                  .map((c) => (
                    <li key={c.id} className="rounded-lg border bg-card p-3 text-sm" data-testid="vote-card">
                      <div className="flex items-start gap-2">
                        <PolarityMark polarity={c.polarity} />
                        <p className="flex-1 leading-snug">{c.text}</p>
                      </div>
                      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>
                          Known by <span className="font-medium text-foreground">{knownBy(c.mine, c.holderCount)}</span>
                        </span>
                        <span className="ml-auto">You rated it {c.myRating ?? "-"}</span>
                      </p>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
