import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { GuessWhoView, RevealView } from "../../../server/domain/view";
import { listNames, meName, nameOfOption, OptionTag, PolarityMark, SectionTitle, Tag, Who } from "./bits";
import { useRoomCtx } from "./room-context";

type Ranking = RevealView["fullRanking"];

const ORDINAL = ["1st", "2nd", "3rd", "4th"];
const fmt = (x: number) => String(Math.round(x * 100) / 100);
/** Scores always show two decimals ("5.00", "-2.33"), so the rows of the proof panel and the table read the same. */
const fixed = (x: number) => (x.toFixed(2) === "-0.00" ? "0.00" : x.toFixed(2));
const NUMBER_WORD = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];

function placeOf(r: Ranking, optionId: string) {
  const i = r.groups.findIndex((g) => g.options.includes(optionId));
  const g = r.groups[i];
  return { index: i, label: ORDINAL[i] ?? `${i + 1}th`, tied: (g?.options.length ?? 0) > 1 };
}

function Cell({ score, ranking, optionId }: { score: number; ranking: Ranking; optionId: string }) {
  const p = placeOf(ranking, optionId);
  const first = p.index === 0;
  return (
    <td className={cn("px-4 py-3 align-top", first && "bg-primary/5")} data-first={first} data-tied={p.tied}>
      <span className={cn("text-lg tabular-nums", first ? "font-semibold" : "text-muted-foreground")}>{fixed(score)}</span>
      <span className={cn("ml-2 text-xs", first ? "font-medium text-foreground" : "text-muted-foreground")}>
        {p.label}
        {p.tied ? " (tie)" : ""}
      </span>
    </td>
  );
}

const GUESS_MEANING: Record<NonNullable<GuessWhoView["result"]>["verdict"], string> = {
  above: "Well above luck: people could tell who said what.",
  near: "Close to luck: the facts were judged without names.",
  below: "Below luck: no sign that people could tell who said what.",
};

function GuessWho({ gw }: { gw: GuessWhoView }) {
  const r = gw.result;
  const practice = gw.scope === "practice";
  return (
    <section aria-labelledby="guess-title" data-testid="guess-who" data-scope={gw.scope}>
      <SectionTitle hint="On the vote screen you could guess who knew a fact that only one other person knew.">
        <span id="guess-title">Guess who</span>{" "}
        {practice ? <Tag className="ml-1 align-middle text-muted-foreground">Practice</Tag> : null}
      </SectionTitle>
      <div className="rounded-lg border bg-card p-4 text-sm">
        {practice ? (
          <>
            <p data-testid="guess-practice">
              {r ? (
                <>
                  <strong>
                    Your guesses: {r.right} of {r.guesses} right.
                  </strong>{" "}
                  Luck would give {r.chancePct}%.
                </>
              ) : (
                "You made no guesses. On the vote screen you can guess who knew a fact."
              )}
            </p>
            <p className="mt-2 text-muted-foreground" data-testid="guess-meaning">
              In a real room everyone's guesses become one number for the whole room. Close to luck means the facts were judged without names. Well above luck means people could tell who said what.
            </p>
          </>
        ) : r ? (
          <>
            <p className="text-2xl font-semibold tabular-nums" data-testid="guess-pct">
              {r.rightPct}% right
            </p>
            <p className="mt-1 text-muted-foreground" data-testid="guess-detail">
              {r.right} of {r.guesses} guesses, from {r.guessers} people. Luck would give {r.chancePct}%.
            </p>
            <p className="mt-3" data-testid="guess-meaning">
              {GUESS_MEANING[r.verdict]}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground" data-testid="guess-hidden">
            No room-wide number this time. It only shows when enough people guessed and it cannot give away one person's guesses.
          </p>
        )}
      </div>
    </section>
  );
}

function AloneCheck({ a }: { a: NonNullable<RevealView["aloneCheck"]> }) {
  const reading =
    a.actual > a.expected ? "More of them picked your option than you thought." : a.actual < a.expected ? "Fewer of them picked your option than you thought." : "You read the room right.";
  return (
    <section aria-labelledby="alone-title" data-testid="alone-check">
      <SectionTitle hint="Your own guess from the vote screen. Only you see it.">
        <span id="alone-title">Alone check</span>
      </SectionTitle>
      <div className="rounded-lg border bg-card p-4 text-sm">
        <p data-testid="alone-line">
          You expected <strong>{a.expected}</strong> of {a.others} to pick the same option as you. <strong>{a.actual}</strong> did.
        </p>
        <p className="mt-1 text-muted-foreground">{reading}</p>
      </div>
    </section>
  );
}

function ProofRow({ id, label, note, children }: { id: string; label: string; note?: string | undefined; children: ReactNode }) {
  return (
    <li className="px-3 py-1.5 sm:py-2" data-testid={`proof-row-${id}`}>
      <p className="text-sm font-medium leading-5">
        {label}
        {note ? <span className="ml-2 hidden text-xs font-normal text-muted-foreground sm:inline">{note}</span> : null}
      </p>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-sm leading-5">{children}</div>
    </li>
  );
}

/** The headline and the four rows that prove it: each person alone, the shared facts only, the full ledger, the votes. Every number is a field of the reveal view. */
function ProofPanel({ rv }: { rv: RevealView }) {
  const { room } = useRoomCtx();
  const options = room.options;
  const names = (ids: string[]) => listNames(ids.map((id) => nameOfOption(options, id)));
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const topOf = (r: Ranking) => r.groups[0]?.options ?? [];
  const pointsTo = (ids: string[]) => (
    <>
      <span className="text-muted-foreground">{ids.length > 1 ? "Tied between" : "Points to"}</span> <strong>{names(ids)}</strong>
    </>
  );
  const v = rv.viewer;
  const n = rv.members.length;
  const replay = room.practice?.replay === true;
  const everyoneLeaned = replay && v.initialPick !== null && rv.members.every((m) => m.initialPick === v.initialPick);
  // The viewer's own column first, then the others in the room's order; people with the same answer share one line.
  const columns = [...rv.members].sort((a, b) => Number(b.id === v.id) - Number(a.id === v.id));
  const lines: { top: string[]; people: typeof columns }[] = [];
  for (const m of columns) {
    const top = m.cardCount ? topOf(m.ownRanking) : [];
    const line = lines.find((l) => sameSet(l.top, top));
    if (line) line.people.push(m);
    else lines.push({ top, people: [m] });
  }
  const sharedCards = rv.cards.filter((c) => c.holders.length >= 2);
  const everyoneKnew = sharedCards.every((c) => c.holders.length === n);
  const strip = (row: "shared" | "full", top: string[]) => (
    <span className="tabular-nums text-muted-foreground">
      (
      {rv.options.map((o, i) => (
        <Fragment key={o.id}>
          {i ? " · " : ""}
          <span className={top.includes(o.id) ? "font-semibold text-foreground" : ""}>
            {o.name} <span data-testid={`proof-${row}-${o.id}`}>{fixed(row === "shared" ? o.sharedScore : o.fullScore)}</span>
          </span>
        </Fragment>
      ))}
      )
    </span>
  );

  return (
    <section className="rounded-xl border bg-card p-3 sm:p-6" data-testid="reveal-headline">
      <h2 className="text-lg font-semibold leading-snug tracking-tight sm:text-3xl">
        {everyoneLeaned ? (
          <>
            In this replay all {NUMBER_WORD[n] ?? n} (one scripted, two simulated) leaned to <span data-testid="headline-lean">{nameOfOption(options, v.initialPick)}</span>. With every fact on the table the ledger{" "}
          </>
        ) : (
          <>
            {v.initialPick ? (
              <>
                You leaned to <span data-testid="headline-lean">{nameOfOption(options, v.initialPick)}</span>.{" "}
              </>
            ) : null}
            The full ledger{" "}
          </>
        )}
        {v.fullTied ? "is tied between" : "points to"} <span data-testid="headline-full">{names(v.fullTop)}</span>.
      </h2>
      <ol className="mt-3 divide-y rounded-lg border bg-background sm:mt-4" data-testid="proof-panel">
        <ProofRow id="alone" label="Each person alone" note="only the facts that person knew">
          {lines.map((l) => (
            <p key={l.top.join()} className="min-w-0">
              {l.top.length ? pointsTo(l.top) : <strong>No cards</strong>}{" "}
              <span className="tabular-nums text-muted-foreground">
                (
                {l.people.map((m, i) => (
                  <Fragment key={m.id}>
                    {i ? " · " : ""}
                    <Who name={m.id === v.id ? "You" : m.name} simulated={m.simulated} className="align-baseline" />{" "}
                    <span data-testid={`proof-alone-${m.id}`}>{l.top[0] ? fixed(m.ownScores[l.top[0]] ?? 0) : "-"}</span>
                  </Fragment>
                ))}
                )
              </span>
            </p>
          ))}
        </ProofRow>
        {rv.uniqueCount > 0 && sharedCards.length > 0 ? (
          <ProofRow id="shared" label={`If the team had discussed only what ${everyoneKnew ? `all ${NUMBER_WORD[n] ?? n}` : "at least two of you"} already knew`} note={`${sharedCards.length} of ${rv.cards.length} facts`}>
            <p>
              {pointsTo(topOf(rv.sharedRanking))} {strip("shared", topOf(rv.sharedRanking))}
            </p>
          </ProofRow>
        ) : null}
        <ProofRow id="full" label="With every fact on the table" note={`all ${rv.cards.length} facts`}>
          <p>
            {pointsTo(topOf(rv.fullRanking))} {strip("full", topOf(rv.fullRanking))}
          </p>
        </ProofRow>
        <ProofRow id="votes" label="Final votes">
          <p data-testid="headline-vote">
            {v.vote ? (
              <>
                You voted <strong>{nameOfOption(options, v.vote)}</strong>.{" "}
              </>
            ) : (
              "You did not vote. "
            )}
            Final votes:{" "}
            {rv.options.map((o, i) => (
              <Fragment key={o.id}>
                {i ? ", " : ""}
                {o.name} <span data-testid={`proof-votes-${o.id}`}>{o.votes}</span>
              </Fragment>
            ))}
            .
          </p>
        </ProofRow>
      </ol>
      <p className="mt-3 text-sm text-muted-foreground" data-testid="headline-own">
        Your own facts alone {v.ownTied ? "are tied between" : "point to"} <strong className="text-foreground">{names(v.ownTop)}</strong>.{" "}
        {sameSet(v.ownTop, v.fullTop) ? "Your facts and the team's facts agree." : "Your facts and the team's facts disagree."}
      </p>
      {replay ? (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="replay-caption">
          Scripted example, not a measurement of a real team: two simulated teammates, and the scripted You rated every card 2. The second row models a team that only talks about what everyone already knew.
        </p>
      ) : null}
    </section>
  );
}

export function RevealPhase() {
  const { room } = useRoomCtx();
  const rv = room.reveal;
  if (!rv) return null;

  const options = room.options;
  const names = (ids: string[]) => listNames(ids.map((id) => nameOfOption(options, id)));
  const v = rv.viewer;
  // The two optional questions are not asked in a practice room or a replay (VotePhase), so there is nothing to show.
  const alone = room.practice ? null : rv.aloneCheck;
  const guess = room.practice ? null : rv.guessWho;
  const simulatedByName = new Map(rv.members.map((m) => [m.name, m.simulated]));
  // The viewer's own column first, then the others in the room's order.
  const columns = [...rv.members].sort((a, b) => Number(b.id === v.id) - Number(a.id === v.id));
  const topShared = rv.sharedRanking.groups[0]?.options ?? [];

  return (
    <div className="space-y-10" data-testid="reveal">
      <ProofPanel rv={rv} />

      <section aria-labelledby="scores-title">
        <SectionTitle hint="One rule everywhere: a card counts +weight if it is a pro and -weight if it is a con, and its weight is the average of everyone's 0 to 3 rating.">
          <span id="scores-title">Scores by option</span>
        </SectionTitle>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-left text-sm" data-testid="scores-table">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Option
                </th>
                <th scope="col" className="px-4 py-3 font-medium" data-testid="col-full">
                  Full ledger
                  <span className="block font-normal">all {rv.cards.length} cards</span>
                </th>
                {columns.map((m) => (
                  <th key={m.id} scope="col" className="px-4 py-3 font-medium" data-testid={`col-own-${m.id}`}>
                    <Who name={m.id === v.id ? "You" : m.name} simulated={m.simulated} className="text-foreground" /> alone
                    <span className="block font-normal">
                      own facts only, {m.cardCount} card{m.cardCount === 1 ? "" : "s"}
                    </span>
                  </th>
                ))}
                <th scope="col" className="px-4 py-3 font-medium">
                  Final votes
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rv.options.map((o) => (
                <tr key={o.id} data-testid={`row-${o.id}`}>
                  <th scope="row" className="px-4 py-3 text-left align-top font-medium">
                    <OptionTag options={options} id={o.id} />
                  </th>
                  <Cell score={o.fullScore} ranking={rv.fullRanking} optionId={o.id} />
                  {columns.map((m) => (
                    <Cell key={m.id} score={m.ownScores[o.id] ?? 0} ranking={m.ownRanking} optionId={o.id} />
                  ))}
                  <td className="px-4 py-3 align-top text-lg tabular-nums">{o.votes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="picks-title">
        <SectionTitle hint="Sealed until now.">
          <span id="picks-title">What each person leaned to, and what they voted</span>
        </SectionTitle>
        <ul className="divide-y rounded-lg border bg-card text-sm" data-testid="picks">
          {rv.members.map((m) => {
            const changedMind = m.initialPick !== null && m.vote !== null && m.initialPick !== m.vote;
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3" data-testid={`pick-${m.id}`}>
                <span className="w-56 font-medium">
                  <Who name={m.id === v.id ? meName(m.name) : m.name} simulated={m.simulated} />
                </span>
                <span className="text-muted-foreground">
                  Leaned to <span className="text-foreground">{m.initialPick ? nameOfOption(options, m.initialPick) : "no lean sealed"}</span>
                </span>
                <span aria-hidden className="text-muted-foreground">
                  then
                </span>
                <span className="text-muted-foreground">
                  voted <span className="text-foreground">{m.vote ? nameOfOption(options, m.vote) : "nothing"}</span>
                </span>
                {changedMind ? <Tag className="border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200">changed their mind</Tag> : null}
              </li>
            );
          })}
        </ul>
      </section>

      {rv.uniqueCount > 0 ? (
        <section aria-labelledby="unique-title">
          <SectionTitle
            hint={
              rv.moved
                ? `On the facts that at least two of you held, ${rv.sharedRanking.tiedFirst ? `nothing separated ${names(topShared)}` : `${names(topShared)} ranked first`}. The facts below moved ${[
                    rv.moved.up.length ? `${names(rv.moved.up)} up` : "",
                    rv.moved.down.length ? `${names(rv.moved.down)} down` : "",
                  ]
                    .filter(Boolean)
                    .join(" and ")}.`
                : "The facts only one of you knew did not change the ranking."
            }
          >
            <span id="unique-title">
              Facts only one of you knew: <span data-testid="reveal-unique">{rv.uniqueCount}</span>
            </span>
          </SectionTitle>
          {rv.changed.length ? (
            <ul className="space-y-2" data-testid="changed">
              {rv.changed.map((c) => (
                <li key={c.id} className="rounded-lg border border-amber-500/50 bg-card p-3 text-sm" data-testid="changed-card">
                  <div className="flex flex-wrap items-center gap-2">
                    <OptionTag options={options} id={c.option} />
                    <PolarityMark polarity={c.polarity} />
                    <p className="min-w-0 flex-1 basis-72 leading-snug">{c.text}</p>
                  </div>
                  <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>Only</span>
                    {c.holders.map((h) => (
                      <Who key={h} name={h} simulated={simulatedByName.get(h)} className="font-medium text-foreground" />
                    ))}
                    <span>knew this. Team weight {fmt(c.weight)} of 3.</span>
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <details className="rounded-lg border bg-card px-4 py-3 text-sm" data-testid="more-detail">
        <summary className="cursor-pointer font-medium" data-testid="more-detail-summary">
          More detail <span className="font-normal text-muted-foreground">({[alone && "alone check", guess && "guess who", `all ${rv.cards.length} cards`].filter(Boolean).join(", ")})</span>
        </summary>
        <div className="mt-4 space-y-8">
          {alone ? <AloneCheck a={alone} /> : null}
          {guess ? <GuessWho gw={guess} /> : null}
          <section aria-labelledby="cards-title">
            <SectionTitle>
              <span id="cards-title">All {rv.cards.length} cards with their team weights</span>
            </SectionTitle>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Option</th>
                  <th className="py-2 pr-3 font-medium"> </th>
                  <th className="py-2 pr-3 font-medium">Fact</th>
                  <th className="py-2 pr-3 font-medium">Known by</th>
                  <th className="py-2 font-medium">Team weight</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rv.cards.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 pr-3 align-top">{nameOfOption(options, c.option)}</td>
                    <td className="py-2 pr-3 align-top">{c.polarity === "pro" ? "Pro" : "Con"}</td>
                    <td className="py-2 pr-3 align-top">{c.text}</td>
                    <td className="py-2 pr-3 align-top">{c.holders.join(", ")}</td>
                    <td className="py-2 align-top tabular-nums">
                      {fmt(c.weight)} <span className="text-xs text-muted-foreground">({c.raters} rated)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </details>

      <p className="border-t pt-4 text-center text-sm text-muted-foreground" data-testid="disclaimer">
        {rv.disclaimer}
      </p>
    </div>
  );
}
