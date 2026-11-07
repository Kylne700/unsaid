import { IconCheck, IconLock } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { knownBy, OPTION_COLUMNS, optionColumns, OptionTag, PolarityMark, SectionTitle, selectClass } from "./bits";
import { useRoomCtx } from "./room-context";

export function VotePhase() {
  const { room, run } = useRoomCtx();
  const [choice, setChoice] = useState<string | null>(null);
  // How many of the others will pick the same ("" = no guess). It travels with the vote, so it is final once sealed.
  const [expect, setExpect] = useState("");
  const [sealing, setSealing] = useState(false);
  // What the member just picked for a fact, shown at once while the server confirms it ("" = not sure).
  const [guess, setGuess] = useState<Record<string, string>>({});
  const ledger = room.ledger ?? [];
  const sealed = room.me.hasVoted;
  const others = room.members.filter((m) => m.id !== room.me.id);
  // The two optional guesses are for live rooms. A practice room (and its replay) asks only for ratings and one vote.
  const optional = room.practice === null;
  const guessables = optional ? ledger.filter((c) => c.guessable) : [];
  const canGuess = guessables.length > 0;
  const canExpect = optional && !sealed && others.length > 0;

  async function seal() {
    if (!choice) return;
    setSealing(true);
    try {
      await run("cast-vote", { optionId: choice, ...(expect === "" ? {} : { expectSame: Number(expect) }) });
    } finally {
      setSealing(false);
    }
  }

  async function guessWho(cardId: string, candidateId: string) {
    setGuess((g) => ({ ...g, [cardId]: candidateId }));
    const r = await run("guess-who", { cardId, candidateId: candidateId || null });
    if (!r.ok)
      setGuess((g) => {
        const rest = { ...g };
        delete rest[cardId];
        return rest;
      });
  }

  // The facts come first. Guesses lock when the last vote is in.
  return (
    <div className="space-y-10">
      <section aria-labelledby="facts-title">
        <SectionTitle hint="The ledger as the team approved it, with how many people knew each fact and how much you said it matters. Names come with the reveal.">
          <span id="facts-title">The facts on the table</span>
        </SectionTitle>
        <div className={cn(OPTION_COLUMNS, "gap-4")} style={optionColumns(room.options.length)}>
          {room.options.map((o) => (
            <div key={o.id} className="min-w-0">
              <h3 className="mb-2">
                <OptionTag options={room.options} id={o.id} />
              </h3>
              <ul className="space-y-2">
                {ledger
                  .filter((c) => c.option === o.id)
                  .map((c) => (
                    <li key={c.id} className="rounded-lg border bg-card p-3 text-sm" data-testid="vote-card" data-guessable={c.guessable}>
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

      <section aria-labelledby="vote-title">
        <SectionTitle hint="One vote, and it is final. Nobody sees any vote until the reveal, and nothing here recommends an option.">
          <span id="vote-title">Your final vote</span>
        </SectionTitle>
        <div role="radiogroup" aria-labelledby="vote-title" className={cn(OPTION_COLUMNS, "gap-2")} style={optionColumns(room.options.length)}>
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
        {canGuess || canExpect ? (
          <details className="mt-4 max-w-2xl rounded-lg border bg-card px-4 py-3 text-sm" data-testid="optional-guesses">
            <summary className="cursor-pointer font-medium" data-testid="optional-guesses-summary">
              {canGuess && canExpect ? "Optional: two quick guesses" : "Optional: a quick guess"}
            </summary>
            <div className="mt-4 space-y-6">
              {canGuess ? (
                <div>
                  <p className="font-medium">Who knew it?</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Where only one other person knew a fact, you may guess who. Guesses are private, and you can change them until the last vote is in.
                  </p>
                  <ul className="mt-3 space-y-3">
                    {guessables.map((c) => (
                      <li key={c.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3" data-testid="guess-row">
                        <label htmlFor={`guess-${c.id}`} className="min-w-0 flex-1 leading-snug">
                          <OptionTag options={room.options} id={c.option} /> {c.text}
                        </label>
                        <select
                          id={`guess-${c.id}`}
                          data-testid="guess-select"
                          className={cn(selectClass, "h-8 w-full text-xs sm:w-44")}
                          value={guess[c.id] ?? c.myGuess ?? ""}
                          onChange={(e) => void guessWho(c.id, e.target.value)}
                        >
                          <option value="">Not sure</option>
                          {others.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                              {m.simulated ? " (simulated)" : ""}
                            </option>
                          ))}
                        </select>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {canExpect ? (
                <div className="max-w-xl">
                  <label htmlFor="expect-same" className="block font-medium">
                    How many of the other {others.length} will pick the same option as you?
                  </label>
                  <select id="expect-same" data-testid="expect-same" className={cn(selectClass, "mt-1.5")} value={expect} onChange={(e) => setExpect(e.target.value)}>
                    <option value="">No guess</option>
                    {Array.from({ length: others.length + 1 }, (_, i) => (
                      <option key={i} value={String(i)}>
                        {i}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">Only you see your guess, at the reveal.</p>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {sealed ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="vote-state">
              <IconLock size={16} aria-hidden /> Your vote is sealed. The reveal opens when everyone has voted.{canGuess ? " You can change your guesses until then." : ""}
            </p>
          ) : (
            <>
              <Button disabled={!choice || sealing} onClick={() => void seal()}>
                Seal my vote
              </Button>
              <p className="text-xs text-muted-foreground">You cannot change it afterwards.{canGuess ? " Guesses lock when the last vote is in." : ""}</p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
