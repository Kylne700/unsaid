import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useRoomActions } from "@/hooks/use-room";

import type { RoomView } from "../../../server/domain/view";
import { errorText, OptionTag } from "./bits";
import { CardsPhase } from "./CardsPhase";
import { NotesPhase } from "./NotesPhase";
import { PhaseBar } from "./PhaseBar";
import { RevealPhase } from "./RevealPhase";
import { RoomProvider } from "./room-context";
import { Shell } from "./Shell";
import { VotePhase } from "./VotePhase";
import { WeighPhase } from "./WeighPhase";

function InviteLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/r/${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the code in the header still works
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={() => void copy()}>
      {copied ? <IconCheck size={16} aria-hidden /> : <IconCopy size={16} aria-hidden />}
      {copied ? "Link copied" : "Copy invite link"}
    </Button>
  );
}

export function RoomScreen({ code, token, room, refresh }: { code: string; token: string; room: RoomView; refresh: () => Promise<unknown> }) {
  const { run, busy, error, clearError } = useRoomActions(code, token, refresh);
  const beforeDone = useRef<(() => Promise<void>) | null>(null);
  const ctx = useMemo(() => ({ room, run, busy, beforeDone }), [room, run, busy]);

  return (
    <RoomProvider value={ctx}>
      <Shell right={<span className="font-mono tracking-widest" data-testid="room-code">{room.code}</span>}>
        <header className="mb-6">
          {room.practice ? (
            <p className="mb-2 rounded-md bg-sky-500/10 px-3 py-2 text-sm text-sky-900 dark:text-sky-100" data-testid="practice-banner">
              <strong>Practice room:</strong> {room.practice.title}. Your two teammates are simulated: their notes, ratings and votes are scripted so you can feel how a decision goes wrong, then right.
            </p>
          ) : null}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight" data-testid="question">
                {room.question}
              </h1>
              <p className="mt-2 flex flex-wrap items-center gap-2">
                {room.options.map((o) => (
                  <OptionTag key={o.id} options={room.options} id={o.id} />
                ))}
              </p>
            </div>
            {room.practice ? null : <InviteLink code={room.code} />}
          </div>
        </header>

        <PhaseBar />

        {error ? (
          <div role="alert" className={`mt-4 flex items-start justify-between gap-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm ${errorText}`}>
            <span>{error}</span>
            <button type="button" className="underline" onClick={clearError}>
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="mt-8" key={room.phase}>
          {room.phase === "notes" ? <NotesPhase /> : null}
          {room.phase === "cards" ? <CardsPhase /> : null}
          {room.phase === "weigh" ? <WeighPhase /> : null}
          {room.phase === "vote" ? <VotePhase /> : null}
          {room.phase === "reveal" ? <RevealPhase /> : null}
        </div>
      </Shell>
    </RoomProvider>
  );
}
