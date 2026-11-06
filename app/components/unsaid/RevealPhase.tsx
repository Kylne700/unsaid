import { cn } from "@/lib/utils";

import type { RevealView } from "../../../server/domain/view";
import { listNames, meName, nameOfOption, OptionTag, PolarityMark, SectionTitle, Tag, Who } from "./bits";
import { useRoomCtx } from "./room-context";

type Ranking = RevealView["fullRanking"];

const ORDINAL = ["1st", "2nd", "3rd", "4th"];
const fmt = (x: number) => String(Math.round(x * 100) / 100);

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
      <span className={cn("text-lg tabular-nums", first ? "font-semibold" : "text-muted-foreground")}>{fmt(score)}</span>
      <span className={cn("ml-2 text-xs", first ? "font-medium text-foreground" : "text-muted-foreground")}>
        {p.label}
        {p.tied ? " (tie)" : ""}
      </span>
    </td>
  );
}

export function RevealPhase() {
  const { room } = useRoomCtx();
  const rv = room.reveal;
  if (!rv) return null;

  const options = room.options;
  const names = (ids: string[]) => listNames(ids.map((id) => nameOfOption(options, id)));
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const v = rv.viewer;
  const simulatedByName = new Map(rv.members.map((m) => [m.name, m.simulated]));
  // The viewer's own column first, then the others in the room's order.
  const columns = [...rv.members].sort((a, b) => Number(b.id === v.id) - Number(a.id === v.id));
  const topShared = rv.sharedRanking.groups[0]?.options ?? [];

  return (
    <div className="space-y-10" data-testid="reveal">
      <section className="rounded-xl border bg-card p-6" data-testid="reveal-headline">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">The reveal</p>
        <h2 className="mt-1 text-2xl font-semibold leading-snug tracking-tight">
          {v.initialPick ? (
            <>
              You leaned to <span data-testid="headline-lean">{nameOfOption(options, v.initialPick)}</span>.{" "}
            </>
          ) : null}
          The full ledger {v.fullTied ? "is tied between" : "points to"} <span data-testid="headline-full">{names(v.fullTop)}</span>.
        </h2>
        <p className="mt-3 text-muted-foreground" data-testid="headline-own">
          Your own facts alone {v.ownTied ? "are tied between" : "point to"} <strong className="text-foreground">{names(v.ownTop)}</strong>.{" "}
          {sameSet(v.ownTop, v.fullTop) ? "Your facts and the team's facts agree." : "Your facts and the team's facts disagree."}
        </p>
        <p className="mt-1 text-muted-foreground" data-testid="headline-vote">
          {v.vote ? (
            <>
              You voted <strong className="text-foreground">{nameOfOption(options, v.vote)}</strong>.{" "}
            </>
          ) : (
            "You did not vote. "
          )}
          Final votes: {rv.options.map((o) => `${o.name} ${o.votes}`).join(", ")}.
        </p>
      </section>

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

      <section aria-labelledby="unique-title">
        <SectionTitle
          hint={
            rv.uniqueCount === 0
              ? "Every fact was known by at least two of you."
              : rv.moved
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

      <details className="rounded-lg border bg-card px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">All {rv.cards.length} cards with their team weights</summary>
        <table className="mt-3 w-full text-left text-sm">
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
      </details>

      <p className="border-t pt-4 text-center text-sm text-muted-foreground" data-testid="disclaimer">
        {rv.disclaimer}
      </p>
    </div>
  );
}
