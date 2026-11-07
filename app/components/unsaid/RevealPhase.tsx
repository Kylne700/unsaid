import { Fragment, type ReactNode } from "react";

import { proofGrid, topOf } from "@/lib/proof-grid";
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

/** A score for the eye (real minus sign, hidden from screen readers) and a plain twin with the test id (screen readers, copy and the checks read "-2.33"). */
function Num({ text, id }: { text: string; id?: string | undefined }) {
  return (
    <>
      <span aria-hidden>{text.replace("-", "−")}</span>
      <span className="sr-only" data-testid={id}>
        {text}
      </span>
    </>
  );
}

type GridCell = { key: string; on: boolean; node: ReactNode };

/** One way of counting, as a row of the grid: a label, one cell per option. The cells that point (`on`) are bold on a light tint. */
function ProofRow({ id, label, note, cells }: { id: string; label: string; note?: string | undefined; cells: GridCell[] }) {
  return (
    <tr className="border-t" data-testid={`proof-row-${id}`}>
      <th scope="row" className="px-1.5 py-1.5 text-left align-top text-sm font-medium leading-5 [overflow-wrap:anywhere] sm:px-3 sm:py-2">
        {label}
        {note ? <span className="block text-xs font-normal text-muted-foreground">{note}</span> : null}
      </th>
      {cells.map((c) => (
        <td
          key={c.key}
          data-pointed={c.on}
          className={cn("px-1 py-1.5 text-right align-top text-base leading-5 tabular-nums sm:px-3 sm:py-2 sm:text-lg", c.on ? "bg-foreground/5 font-semibold text-foreground" : "text-muted-foreground")}
        >
          {c.node}
          {c.on ? <span className="sr-only">, points here</span> : null}
        </td>
      ))}
    </tr>
  );
}

/** The headline and the grid that proves it: one column per option, four ways of counting, the pointed cell of each row tinted. The tint jumps from column to column when the claim flips. Every number is a field of the reveal view. */
function ProofPanel({ rv }: { rv: RevealView }) {
  const { room } = useRoomCtx();
  const options = room.options;
  const names = (ids: string[]) => listNames(ids.map((id) => nameOfOption(options, id)));
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const v = rv.viewer;
  const n = rv.members.length;
  const replay = room.practice?.replay === true;
  const everyoneLeaned = replay && v.initialPick !== null && rv.members.every((m) => m.initialPick === v.initialPick);
  // The viewer first, then the others in the room's order.
  const people = [...rv.members].sort((a, b) => Number(b.id === v.id) - Number(a.id === v.id));
  const aloneTop = (m: (typeof people)[number]) => (m.cardCount ? topOf(m.ownRanking) : []);
  const sharedCards = rv.cards.filter((c) => c.holders.length >= 2);
  const everyoneKnew = sharedCards.every((c) => c.holders.length === n);
  const grid = proofGrid(rv);
  const cells = (node: (o: RevealView["options"][number], i: number) => ReactNode, on: boolean[]): GridCell[] => rv.options.map((o, i) => ({ key: o.id, on: on[i] ?? false, node: node(o, i) }));
  const aloneOf = (m: (typeof people)[number]) => {
    const top = aloneTop(m);
    const first = top[0];
    return { score: first === undefined ? null : fixed(m.ownScores[first] ?? 0), tied: top.length > 1 };
  };

  return (
    <section className="rounded-xl border bg-card p-3 sm:p-6" data-testid="reveal-headline">
      <h2 className="text-lg font-semibold leading-snug tracking-tight sm:text-3xl">
        {everyoneLeaned ? (
          <>
            Alone, all {NUMBER_WORD[n] ?? n} leaned to <span data-testid="headline-lean">{nameOfOption(options, v.initialPick)}</span>. The full ledger{" "}
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
      <div className="mt-3 overflow-hidden rounded-lg border bg-background sm:mt-4">
        <table className="w-full table-fixed border-collapse" data-testid="proof-panel">
          <caption className="sr-only">Four ways of counting the facts, and what each one points to</caption>
          <colgroup>
            <col className="w-[28%] sm:w-[34%]" />
          </colgroup>
          <thead>
            <tr>
              <td className="p-0">
                <span className="sr-only">Way of counting</span>
              </td>
              {rv.options.map((o) => (
                <th key={o.id} scope="col" className="px-1 py-1.5 text-right align-bottom text-xs font-medium leading-4 hyphens-auto [overflow-wrap:anywhere] sm:px-3 sm:py-2 sm:text-sm">
                  {o.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <ProofRow id="alone" label="Each person alone" cells={cells((_o, i) => `${grid.lean[i] ?? 0} of ${n}`, grid.leanOn)} />
            {rv.uniqueCount > 0 && sharedCards.length > 0 ? (
              <ProofRow
                id="shared"
                label={`Only what ${everyoneKnew ? `all ${NUMBER_WORD[n] ?? n}` : "at least two"} knew`}
                note={`(${sharedCards.length} of ${rv.cards.length} facts)`}
                cells={cells((o) => <Num text={fixed(o.sharedScore)} id={`proof-shared-${o.id}`} />, grid.sharedOn)}
              />
            ) : null}
            <ProofRow id="full" label={`All ${rv.cards.length} facts`} cells={cells((o) => <Num text={fixed(o.fullScore)} id={`proof-full-${o.id}`} />, grid.fullOn)} />
            <ProofRow id="votes" label="Final votes" cells={cells((o) => <span data-testid={`proof-votes-${o.id}`}>{o.votes}</span>, grid.votesOn)} />
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Each person's own top score:{" "}
        {people.map((m, i) => {
          const a = aloneOf(m);
          return (
            <Fragment key={m.id}>
              {i ? " · " : ""}
              <span className="whitespace-nowrap">
                <Who name={m.id === v.id ? "You" : m.name} simulated={m.simulated} className="align-baseline" />{" "}
                <span className="tabular-nums">
                  <span data-testid={`proof-alone-${m.id}`}>{a.score ?? "no cards"}</span>
                  {a.tied ? " (tied)" : ""}
                </span>
              </span>
            </Fragment>
          );
        })}
      </p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground" data-testid="headline-vote">
        {v.vote ? (
          <>
            You voted <strong className="font-semibold text-foreground">{nameOfOption(options, v.vote)}</strong>.
          </>
        ) : (
          "You did not vote."
        )}
        <span className="sr-only">
          {" "}
          Final votes:{" "}
          {rv.options.map((o, i) => (
            <Fragment key={o.id}>
              {i ? ", " : ""}
              {o.name} {o.votes}
            </Fragment>
          ))}
          .
        </span>
      </p>
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
