import { IconCheck } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { meName, Who } from "./bits";
import { useRoomCtx } from "./room-context";

const STEPS = [
  { id: "notes", label: "Notes" },
  { id: "cards", label: "Cards" },
  { id: "weigh", label: "Weigh" },
  { id: "vote", label: "Vote" },
  { id: "reveal", label: "Reveal" },
] as const;

export function PhaseBar() {
  const { room, run, beforeDone, error } = useRoomCtx();
  const [confirming, setConfirming] = useState(false);
  const [notSaved, setNotSaved] = useState(false);
  const at = STEPS.findIndex((s) => s.id === room.phase);
  const { me, phase } = room;
  const waitingFor = room.members.filter((m) => !m.done && m.id !== me.id);
  const canMarkDone = phase === "notes" || phase === "cards" || phase === "weigh";

  let blocked: string | null = null;
  if (phase === "notes" && room.practice && !me.hasInitialPick) blocked = "Seal your lean first: which option do you lean to now?";
  if (phase === "weigh" && room.weigh && room.weigh.rated < room.weigh.total) blocked = `Rate every card first (${room.weigh.total - room.weigh.rated} left).`;

  return (
    <section aria-label="Room progress" className={cn("rounded-lg border bg-card p-4", room.practice?.replay && "sr-only")} data-testid="phase-bar" data-phase={phase}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {STEPS.map((s, i) => (
            <li key={s.id} className="flex items-center">
              <span
                aria-current={i === at ? "step" : undefined}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-3 py-1 font-medium",
                  i === at ? "bg-primary text-primary-foreground" : i < at ? "bg-muted text-foreground" : "text-muted-foreground",
                )}
              >
                {i < at ? <IconCheck size={14} stroke={2.5} aria-hidden /> : null}
                {s.label}
              </span>
            </li>
          ))}
        </ol>
        {room.uniqueCount !== null ? (
          <p className="text-sm text-muted-foreground" data-testid="unique-count">
            Facts only one of you knew: <strong className="text-base font-semibold text-foreground">{room.uniqueCount}</strong>
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Members">
          {room.members.map((m) => (
            <li key={m.id} className="flex items-center gap-1.5" data-testid={`member-${m.id}`} data-done={m.done}>
              <span className={cn("inline-block size-2 rounded-full", m.done ? "bg-emerald-500" : "bg-muted-foreground/40")} aria-hidden />
              <Who name={m.id === me.id ? meName(m.name) : m.name} simulated={m.simulated} />
              <span className="text-xs text-muted-foreground">{phase === "reveal" ? "" : m.done ? (phase === "vote" ? "voted" : "done") : phase === "vote" ? "not yet" : "working"}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          {canMarkDone && !me.done ? (
            <Button
              disabled={blocked !== null}
              onClick={async () => {
                // Work that failed (unsaved notes) stops "done"; the room's alert says why and stays up because nothing else runs.
                const saved = (await beforeDone.current?.()) !== false;
                setNotSaved(!saved);
                if (saved) await run("mark-done", { done: true });
              }}
            >
              I'm done
            </Button>
          ) : null}
          {canMarkDone && me.done ? (
            <>
              <span className="text-sm text-muted-foreground">
                You are done.{waitingFor.length ? ` Waiting for ${waitingFor.map((m) => m.name).join(", ")}.` : ""}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void run("mark-done", { done: false })}>
                Not done yet
              </Button>
            </>
          ) : null}
          {phase === "vote" && me.hasVoted && waitingFor.length ? (
            <span className="text-sm text-muted-foreground">Waiting for {waitingFor.map((m) => m.name).join(", ")}.</span>
          ) : null}
          {me.isCreator && !room.practice && phase !== "reveal" ? (
            confirming ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Move on without waiting?</span>
                <Button
                  size="sm"
                  onClick={async () => {
                    setConfirming(false);
                    await run("advance-phase");
                  }}
                >
                  Move everyone on
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                Move everyone on
              </Button>
            )
          ) : null}
        </div>
      </div>
      {blocked && canMarkDone && !me.done ? <p className="mt-2 text-sm text-muted-foreground">{blocked}</p> : null}
      {notSaved && error && canMarkDone && !me.done ? (
        <p className="mt-2 text-sm text-muted-foreground" data-testid="not-saved">
          Your notes are not saved yet, so you are not marked done. Try I'm done again in a moment.
        </p>
      ) : null}
    </section>
  );
}
