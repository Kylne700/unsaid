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

/** True once another tab of this browser has the same room open. The seat is kept per browser, so that tab is the same person. */
function useSecondTab(code: string) {
  const [second, setSecond] = useState(false);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const me = Math.random().toString(36).slice(2);
    const channel = new BroadcastChannel(`unsaid-room-${code}`);
    channel.onmessage = (e: MessageEvent<{ from?: string; hello?: boolean }>) => {
      if (!e.data?.from || e.data.from === me) return;
      setSecond(true);
      if (e.data.hello) channel.postMessage({ from: me });
    };
    channel.postMessage({ from: me, hello: true });
    return () => channel.close();
  }, [code]);
  return second;
}

function InviteLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [asked, setAsked] = useState(false);
  const second = useSecondTab(code);
  async function copy() {
    setAsked(true);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/r/${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the code in the header still works
    }
  }
  return (
    <div className="flex flex-col items-start sm:items-end">
      <Button variant="outline" size="sm" onClick={() => void copy()}>
        {copied ? <IconCheck size={16} aria-hidden /> : <IconCopy size={16} aria-hidden />}
        {copied ? "Link copied" : "Copy invite link"}
      </Button>
      {/* Shown only after the link was copied, or when this room is open in a second tab: that tab is the same person, not a new one. */}
      <div role="status">
        {asked || second ? (
          <p className="mt-1.5 max-w-xs text-xs text-muted-foreground sm:text-right" data-testid="private-window-hint">
            {second ? "This room is open in another tab, and that tab is you. " : ""}To try it alone, open the link in a private window.
          </p>
        ) : null}
      </div>
    </div>
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

export function RoomScreen({ code, token, room, refresh, paused }: { code: string; token: string; room: RoomView; refresh: () => Promise<unknown>; paused: boolean }) {
  const { run, busy, error, clearError } = useRoomActions(code, token, refresh);
  const beforeDone = useRef<(() => Promise<boolean | void>) | null>(null);
  const ctx = useMemo(() => ({ room, run, busy, error, beforeDone }), [room, run, busy, error]);
  useSeatCookie(code, token);
  // A new phase is a new screen: start it at the top (the reveal used to open scrolled past its own headline).
  useEffect(() => {
    // shortcut: reaches the framework's scroll box by its class name; use a ref if the framework adds one
    document.querySelector(".agent-sidebar-main-surface")?.scrollTo({ top: 0 });
  }, [room.phase]);

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
              <h1 className="text-lg font-semibold tracking-tight sm:text-2xl" data-testid="question" dir="auto">
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

        {paused ? (
          // Reading the room stopped after a long quiet time; any click or key press starts it again, and so does this button.
          <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md bg-muted px-3 py-2 text-sm text-foreground" data-testid="updates-paused">
            <span>Updates paused.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              Resume
            </Button>
          </div>
        ) : null}

        {error ? (
          <div role="alert" className={`mt-4 flex items-start justify-between gap-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm ${errorText}`}>
            <span>{error}</span>
            <button type="button" className="px-2 py-1.5 underline" onClick={clearError}>
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
