import { IconCheck, IconLock } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { SectionTitle } from "./bits";
import { useRoomCtx } from "./room-context";

type SaveState = "saved" | "typing" | "saving";

// The server refuses more than 8,000 characters (MAX_NOTES in server/domain/room.ts); the box stops there, and a counter shows from 7,000.
const NOTES_MAX = 8000;
const NOTES_WARN = 7000;

export function NotesPhase() {
  const { room, run, beforeDone } = useRoomCtx();
  const [text, setText] = useState(room.notes ?? "");
  const [state, setState] = useState<SaveState>("saved");
  const [pick, setPick] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(text);
  const dirty = useRef(false);
  const role = room.members.find((m) => m.id === room.me.id)?.role ?? null;

  // True when everything typed so far is on the server, false when a save failed (the person is told why by the room's alert).
  // One save runs at a time and repeats while more was typed meanwhile, so an older text can never land after a newer one.
  const flight = useRef<Promise<boolean> | null>(null);
  const save = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current);
    if (flight.current) return flight.current;
    const p = (async () => {
      try {
        while (dirty.current) {
          const value = latest.current;
          setState("saving");
          const r = await run("save-notes", { text: value });
          if (!r.ok) {
            setState("typing");
            return false;
          }
          if (latest.current === value) dirty.current = false;
        }
        setState("saved");
        return true;
      } finally {
        flight.current = null;
      }
    })();
    flight.current = p;
    return p;
  }, [run]);

  // The pick request in flight: "I'm done" waits for it, else the room can move on first and refuse the pick (409).
  const picking = useRef<Promise<unknown> | null>(null);
  useEffect(() => {
    beforeDone.current = async () => {
      await picking.current;
      return save();
    };
    return () => {
      beforeDone.current = null;
      clearTimeout(timer.current);
    };
  }, [beforeDone, save]);

  // The same person can have the room open in a second tab. While nothing typed here is unsaved, the box follows what the server holds,
  // so a second tab never starts from an empty box and never saves over the first tab's notes.
  useEffect(() => {
    if (dirty.current) return;
    const server = room.notes ?? "";
    if (server === latest.current) return;
    latest.current = server;
    setText(server);
  }, [room.notes]);

  function onChange(value: string) {
    setText(value);
    latest.current = value;
    dirty.current = true;
    setState("typing");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 600);
  }

  async function choose(optionId: string) {
    setPick(optionId);
    const request = run("set-initial-pick", { optionId });
    picking.current = request;
    const r = await request;
    if (!r.ok) setPick(null);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section aria-labelledby="notes-title">
        <SectionTitle hint={role ? `You are the ${role}. Only you can see these notes.` : "Only you can see these notes. Write what you know, in your own words."}>
          <span id="notes-title">Your private notes</span>
        </SectionTitle>
        <Textarea
          aria-label="Your private notes"
          data-testid="notes-input"
          rows={14}
          dir="auto"
          className="min-h-72 text-base leading-relaxed sm:text-sm"
          placeholder="What do you know that bears on this decision? Prices, past incidents, promises, doubts. One sentence per fact works best."
          value={text}
          maxLength={NOTES_MAX}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => void save()}
        />
        {text.length > NOTES_WARN ? (
          <p className="mt-1 text-xs text-muted-foreground" aria-live="polite" data-testid="notes-count">
            {text.length.toLocaleString("en-US")} of {NOTES_MAX.toLocaleString("en-US")} characters.{text.length >= NOTES_MAX ? " That is the limit: anything past it is not kept." : ""}
          </p>
        ) : null}
        <p className="mt-1.5 text-xs text-muted-foreground" aria-live="polite" data-testid="notes-state">
          {state === "saved" ? "Saved." : state === "saving" ? "Saving..." : "Not saved yet."} Next you turn these notes into cards, one fact each.
        </p>
        <div className="mt-1 text-xs text-muted-foreground" data-testid="gemini-notice">
          <p>Notes you turn into cards, and chat messages, go to Google's Gemini API (free tier). Use made-up or non-sensitive text.</p>
          <details>
            <summary className="inline-block cursor-pointer py-1 underline">Google's terms</summary>
            <p>
              Google's terms for it say "human reviewers may read, annotate, and process your API input and output." and "Do not submit
              sensitive, confidential, or personal information to the Unpaid Services."
            </p>
          </details>
        </div>
      </section>

      <section aria-labelledby="lean-title">
        <SectionTitle hint={room.practice ? "Required in practice: you will compare it with the reveal." : "Optional."}>
          <span id="lean-title">Which option do you lean to now? Nobody sees this until the reveal.</span>
        </SectionTitle>
        <div role="radiogroup" aria-labelledby="lean-title" className="grid gap-2">
          {room.options.map((o) => {
            const on = pick === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => void choose(o.id)}
                className={cn(
                  "flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on && "border-primary bg-primary/5",
                )}
              >
                {o.name}
                {on ? <IconCheck size={18} aria-hidden /> : null}
              </button>
            );
          })}
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="lean-state">
          <IconLock size={14} aria-hidden />
          {pick || room.me.hasInitialPick ? "Sealed. Choose again to change it until this phase ends." : "Not sealed yet."}
        </p>
      </section>
    </div>
  );
}
