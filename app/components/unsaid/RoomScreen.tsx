import { appServerPath } from "@agent-native/core/client/api-path";
import { AgentSidebar, AgentToggleButton } from "@agent-native/toolkit/app/chat";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useRoomActions } from "@/hooks/use-room";
import { useStartRoom } from "@/hooks/use-start-room";
import { TAB_ID } from "@/lib/tab-id";

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

// What the chat offers depends on the phase. The sidebar reads this prop on every render, so there is no remount.
const CHIPS: Record<RoomView["phase"], string[]> = {
  notes: ["Help me write down what I know", "What can you do for me?"],
  cards: ["Draft cards from my notes", "Which of my cards say the same thing?", "What can you do for me?"],
  weigh: ["Where does the room stand?", "What can you do for me?"],
  vote: ["Where does the room stand?", "What can you do for me?"],
  reveal: ["How were these numbers worked out?", "What can you do for me?"],
};

const BANNER = "mb-2 rounded-md bg-sky-500/10 px-3 py-2 text-sm text-sky-900 dark:text-sky-100";

/** A practice room is one line (the reason is one click away); the replay says what was scripted and offers the 3-minute path. */
function PracticeBanner({ room }: { room: RoomView }) {
  const practice = useStartRoom("create-practice-room");
  if (!room.practice) return null;
  if (!room.practice.replay) {
    return (
      <details className={BANNER} data-testid="practice-banner">
        <summary className="cursor-pointer">
          <strong>Practice room:</strong> {room.practice.title}. Your two teammates are simulated. <span className="underline">Why simulated?</span>
        </summary>
        <p className="mt-1">Their notes, ratings and votes are scripted so you can feel how a decision leans one way alone and points another way with every fact on the table.</p>
      </details>
    );
  }
  return (
    <p className={BANNER} data-testid="practice-banner" data-replay="true">
      <strong>Replay of a scripted team.</strong> Your two teammates are simulated.<span className="hidden sm:inline"> Want to do it with your own ratings?</span>{" "}
      <button type="button" className="font-medium underline" onClick={() => void practice.go()} disabled={practice.pending} aria-busy={practice.pending} data-testid="replay-to-practice">
        {practice.pending ? "Opening..." : "Do it yourself (3 min)"}
      </button>
      {practice.error ? <span role="alert"> {practice.error}</span> : null}
    </p>
  );
}

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

/** Binds the chat to this seat. Only the server reads the cookie (server/lib/guest.ts); the agent never sees it. */
function setSeatCookie(code: string, token: string) {
  const path = new URL(appServerPath("/_agent-native"), window.location.href).pathname;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `unsaid_seat=${code}.${token}; Path=${path}; SameSite=Strict${secure}`;
}

/** Set during render (idempotent), so it is there before the sidebar below mounts and makes its first chat request.
 *  Set again on focus, so with two rooms open the chat follows the window in front. */
function useSeatCookie(code: string, token: string) {
  if (typeof document !== "undefined") setSeatCookie(code, token);
  useEffect(() => {
    const set = () => setSeatCookie(code, token);
    window.addEventListener("focus", set);
    return () => window.removeEventListener("focus", set);
  }, [code, token]);
}

export function RoomScreen({ code, token, room, refresh }: { code: string; token: string; room: RoomView; refresh: () => Promise<unknown> }) {
  const { run, busy, error, clearError } = useRoomActions(code, token, refresh);
  const beforeDone = useRef<(() => Promise<void>) | null>(null);
  const ctx = useMemo(() => ({ room, run, busy, beforeDone }), [room, run, busy]);
  useSeatCookie(code, token);

  return (
    <RoomProvider value={ctx}>
      {/* A fixed, empty model list (the model is set on the server): without it the sidebar asks the account-only model, Builder and key-status routes, which answer 401 to a guest. */}
      <AgentSidebar
        position="right"
        defaultOpen
        storageKey={`unsaid-${room.code}`}
        browserTabId={TAB_ID}
        showMissingApiKeySetup={false}
        showModelSelector={false}
        availableModels={[]}
        modelListLoading={false}
        composerPlaceholder="Ask about your notes or this room"
        emptyStateText="I help you put down what you know and turn it into cards. I never vote, rate or recommend."
        suggestions={CHIPS[room.phase]}
      >
      <Shell
        right={
          <span className="flex items-center gap-3">
            <span className="font-mono tracking-widest" data-testid="room-code">{room.code}</span>
            <AgentToggleButton />
          </span>
        }
      >
        <header className="mb-3 sm:mb-6">
          <PracticeBanner room={room} />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold tracking-tight sm:text-2xl" data-testid="question">
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

        <div className="mt-4 sm:mt-8" key={room.phase}>
          {room.phase === "notes" ? <NotesPhase /> : null}
          {room.phase === "cards" ? <CardsPhase /> : null}
          {room.phase === "weigh" ? <WeighPhase /> : null}
          {room.phase === "vote" ? <VotePhase /> : null}
          {room.phase === "reveal" ? <RevealPhase /> : null}
        </div>
      </Shell>
      </AgentSidebar>
    </RoomProvider>
  );
}
