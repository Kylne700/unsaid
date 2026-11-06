import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { DraftView, LedgerCardView } from "../../../server/domain/view";
import { knownBy, OptionTag, PolarityMark, SectionTitle, selectClass, Tag } from "./bits";
import { useRoomCtx } from "./room-context";

type Polarity = "pro" | "con";
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}...` : s);

function PolarityPick({ value, onPick }: { value: Polarity | null; onPick: (p: Polarity) => void }) {
  return (
    <div role="group" aria-label="Pro or con" className="flex gap-1">
      {(["pro", "con"] as const).map((p) => (
        <Button key={p} type="button" size="sm" variant={value === p ? "default" : "outline"} aria-pressed={value === p} onClick={() => onPick(p)}>
          {p === "pro" ? "Pro" : "Con"}
        </Button>
      ))}
    </div>
  );
}

function OptionPick({ value, onPick, label }: { value: string | null; onPick: (id: string | null) => void; label: string }) {
  const { room } = useRoomCtx();
  return (
    <select aria-label={label} className={selectClass} value={value ?? ""} onChange={(e) => onPick(e.target.value || null)}>
      <option value="">Which option?</option>
      {room.options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

function DraftRow({ d }: { d: DraftView }) {
  const { run } = useRoomCtx();
  const [text, setText] = useState(d.text);
  const [neutral, setNeutral] = useState(d.neutral);
  const [neutralTouched, setNeutralTouched] = useState(false);
  const [option, setOption] = useState<string | null>(d.option);
  const [polarity, setPolarity] = useState<Polarity | null>(d.polarity);
  const [working, setWorking] = useState(false);

  const cleanText = text.trim() || d.text;
  const textChanged = cleanText !== d.text;
  const dirty = textChanged || (neutralTouched && neutral !== d.neutral) || option !== d.option || polarity !== d.polarity;

  function save(next: { option?: string | null; polarity?: Polarity | null } = {}) {
    const body: Record<string, unknown> = {
      draftId: d.id,
      text: cleanText,
      option: next.option !== undefined ? next.option : option,
      polarity: next.polarity !== undefined ? next.polarity : polarity,
    };
    // An edited fact with an untouched blind version gets a fresh blind version made from the new words.
    if (neutralTouched || !textChanged) body.neutral = neutral;
    return run("save-draft", body);
  }

  async function approve() {
    setWorking(true);
    try {
      if (dirty && !(await save()).ok) return;
      await run("approve-draft", { draftId: d.id });
    } finally {
      setWorking(false);
    }
  }

  const ready = option !== null && polarity !== null;
  return (
    <li className="rounded-lg border bg-card p-4" data-testid="draft">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {d.origin === "practice" ? <Tag className="border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200">prepared for practice</Tag> : null}
        {d.origin === "notes" ? <Tag className="text-muted-foreground">from your notes</Tag> : null}
        <span className="text-xs text-muted-foreground">Private until you approve it.</span>
      </div>
      <Textarea
        aria-label="Card text: one fact"
        rows={2}
        className="min-h-0"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (dirty) void save();
        }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <OptionPick
          label="Which option is this fact about?"
          value={option}
          onPick={(v) => {
            setOption(v);
            void save({ option: v });
          }}
        />
        <PolarityPick
          value={polarity}
          onPick={(p) => {
            setPolarity(p);
            void save({ polarity: p });
          }}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void run("delete-draft", { draftId: d.id })}>
            Delete
          </Button>
          <Button size="sm" disabled={!ready || working} onClick={() => void approve()}>
            Approve to ledger
          </Button>
        </div>
      </div>
      <label className="mt-3 block text-xs text-muted-foreground">
        Same fact without the option name (this is all teammates see while they weigh)
        <Input
          className="mt-1 h-9 text-sm text-foreground"
          value={neutral}
          onChange={(e) => {
            setNeutral(e.target.value);
            setNeutralTouched(true);
          }}
          onBlur={() => {
            if (dirty) void save();
          }}
        />
      </label>
      {d.leak ? (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400" data-testid="draft-leak">
          This wording may still give the option away. Reword it so the blind weigh stays blind.
        </p>
      ) : null}
      {!ready ? <p className="mt-2 text-xs text-muted-foreground">Choose the option and pro or con to approve this card.</p> : null}
    </li>
  );
}

function NewDraft() {
  const { run } = useRoomCtx();
  const [text, setText] = useState("");
  const [option, setOption] = useState<string | null>(null);
  const [polarity, setPolarity] = useState<Polarity | null>(null);

  async function add() {
    if (!text.trim()) return;
    const r = await run("save-draft", { text: text.trim(), option, polarity });
    if (r.ok) {
      setText("");
      setOption(null);
      setPolarity(null);
    }
  }
  return (
    <form
      className="rounded-lg border border-dashed p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <label className="block text-sm font-medium" htmlFor="new-draft-text">
        Add a fact by hand
      </label>
      <Input id="new-draft-text" className="mt-2" placeholder="One fact, e.g. The vendor charges per seat after 50 seats" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <OptionPick label="Which option is the new fact about?" value={option} onPick={setOption} />
        <PolarityPick value={polarity} onPick={setPolarity} />
        <Button type="submit" size="sm" variant="secondary" className="ml-auto" disabled={!text.trim()}>
          Add as draft
        </Button>
      </div>
    </form>
  );
}

function LedgerItem({ c, all }: { c: LedgerCardView; all: LedgerCardView[] }) {
  const { run, room } = useRoomCtx();
  // A live room shows only your own cards in this phase, so "only you knew this" cannot be told yet: it shows from two
  // holders on. A practice room knows every fact, so there it holds from the start.
  const known = room.practice !== null || c.holderCount > 1;
  const only = room.practice !== null && c.holderCount === 1;
  const same = all.filter((o) => o.id !== c.id && o.option === c.option && o.polarity === c.polarity && (c.mine || o.mine));
  return (
    <li className={cn("rounded-lg border bg-card p-3 text-sm", only && "border-amber-500/60")} data-testid="ledger-card" data-card-id={c.id} data-holders={c.holderCount}>
      <div className="flex items-start gap-2">
        <PolarityMark polarity={c.polarity} />
        <p className="flex-1 leading-snug">{c.text}</p>
      </div>
      {known ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>
            Known by <span className="font-medium text-foreground">{knownBy(c.mine, c.holderCount)}</span>
          </span>
          {only ? <Tag className="border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200">{c.mine ? "only you knew this" : "only one person knew this"}</Tag> : null}
        </p>
      ) : null}
      {c.merged.length ? (
        <ul className="mt-2 space-y-1 border-l-2 pl-3 text-xs text-muted-foreground" aria-label="Merged wordings">
          {c.merged.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-2">
              <span>
                Also worded: "{m.text}" (known by {knownBy(m.mine, m.holderCount)})
              </span>
              {c.mine ? (
                <Button variant="ghost" size="xs" onClick={() => void run("unmerge-card", { cardId: c.id, absorbedId: m.id })}>
                  Split
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {same.length || (c.mine && !c.merged.length) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {same.length ? (
            <select
              aria-label="Merge with a card that states the same fact"
              className={cn(selectClass, "h-8 max-w-full text-xs")}
              value=""
              onChange={(e) => {
                if (e.target.value) void run("merge-cards", { keepId: c.id, absorbId: e.target.value });
              }}
            >
              <option value="">Same fact as...</option>
              {same.map((o) => (
                <option key={o.id} value={o.id}>
                  {truncate(o.text, 60)}
                  {o.mine ? " (yours)" : ""}
                </option>
              ))}
            </select>
          ) : null}
          {c.mine && !c.merged.length ? (
            <Button variant="ghost" size="xs" onClick={() => void run("withdraw-card", { cardId: c.id })}>
              Withdraw
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function CardsPhase() {
  const { room, run } = useRoomCtx();
  const drafts = room.drafts ?? [];
  const ledger = room.ledger ?? [];
  const othersCount = room.othersCardCount ?? 0;
  const [extractNote, setExtractNote] = useState<string | null>(null);

  async function extract() {
    setExtractNote(null);
    const r = await run<{ added: number; source: "gemini" | "splitter" }>("extract-cards");
    if (!r.ok) return;
    const n = `${r.data.added} draft${r.data.added === 1 ? "" : "s"}`;
    setExtractNote(!r.data.added ? "No new facts found in your notes." : r.data.source === "gemini" ? `Gemini drafted ${n} from your notes.` : `Added ${n}, one per sentence (AI unavailable right now).`);
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="drafts-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionTitle hint="Only you see drafts. Turn each fact into a card and approve it to put it in the shared ledger.">
            <span id="drafts-title">Your draft cards</span>
          </SectionTitle>
          <div className="mb-3 flex items-center gap-3">
            {extractNote ? (
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {extractNote}
              </span>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void extract()}>
              Draft cards from my notes
            </Button>
          </div>
        </div>
        {room.practice && drafts.some((d) => d.origin === "practice") ? (
          <p className="mb-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            These cards were prepared for practice from your memo. Approve, edit or delete each one, as you would with your own.
          </p>
        ) : null}
        {room.notes ? (
          <details className="mb-3 rounded-lg border bg-card px-4 py-2 text-sm">
            <summary className="cursor-pointer font-medium">Your notes (private)</summary>
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{room.notes}</p>
          </details>
        ) : null}
        <ul className="space-y-3" aria-label="Your draft cards" data-testid="drafts">
          {drafts.map((d) => (
            <DraftRow key={`${d.id}|${d.text}|${d.neutral}|${d.option}|${d.polarity}`} d={d} />
          ))}
        </ul>
        {drafts.length === 0 ? <p className="mb-3 text-sm text-muted-foreground">No drafts right now.</p> : null}
        <div className="mt-3">
          <NewDraft />
        </div>
      </section>

      <section aria-labelledby="ledger-title">
        <SectionTitle hint="The cards you approved. The cards the others approve stay hidden until the room moves on to weigh; you see only how many there are.">
          <span id="ledger-title">Your approved cards</span>
        </SectionTitle>
        <p className="mb-3 text-sm text-muted-foreground" data-testid="others-card-count" data-count={othersCount} aria-live="polite">
          {othersCount === 0 ? "The others have not approved any cards yet." : `${othersCount} card${othersCount === 1 ? "" : "s"} approved by the others so far.`}
        </p>
        {ledger.length === 0 ? <p className="text-sm text-muted-foreground">You have not approved any cards yet.</p> : null}
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${room.options.length}, minmax(0, 1fr))` }}>
          {room.options.map((o) => {
            const cards = [...ledger.filter((c) => c.option === o.id)].sort((a, b) => (a.polarity === b.polarity ? 0 : a.polarity === "pro" ? -1 : 1));
            return (
              <div key={o.id} data-testid={`ledger-col-${o.id}`}>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <OptionTag options={room.options} id={o.id} />
                  <span className="font-normal text-muted-foreground">{cards.length} card{cards.length === 1 ? "" : "s"}</span>
                </h3>
                <ul className="space-y-2">
                  {cards.map((c) => (
                    <LedgerItem key={c.id} c={c} all={ledger} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
