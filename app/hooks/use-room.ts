// Reads a room and runs room actions. How often the room is read (fast while something happens, slower and then not at all when
// it is quiet, never at the reveal or in a hidden tab) is decided by pollPlan (lib/poll-schedule.ts); this file only reports what happened.
// Every call here is one of the framework actions in /actions: the chat agent calls the same ones.
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useCallback, useEffect, useRef, useState } from "react";

import { friendlyError, isRetryable } from "@/lib/friendly-error";
import { FAST_FOR_MS, pollPlan } from "@/lib/poll-schedule";

import type { GuestView, RoomView } from "../../server/domain/view";

export type RoomData = RoomView | GuestView;
export type RunResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type RunAction = <T = unknown>(name: string, args?: Record<string, unknown>) => Promise<RunResult<T>>;

// Signs that somebody is here besides a changed room: a click or a key press, the window in front again, the chat at work
// (the framework sends these events while it streams an answer and while its tools run).
const SIGNS = ["pointerdown", "keydown", "focus", "agent-chat:activity", "agent-chat:stream-progress", "agent-native:tool-start"] as const;

/**
 * Reads the room. `refresh` is for the actions: it reads again at once and counts as a sign of life.
 * `paused` is true when reading stopped because nothing happened for 15 minutes (a click or a key press starts it again) or the server refused the read (only `refresh` retries).
 */
export function useRoomQuery(code: string, token: string | null, enabled: boolean) {
  const lastSign = useRef(Date.now());
  const seen = useRef<RoomData | undefined>(undefined);
  const stopped = useRef(false);
  const [paused, setPaused] = useState(false);

  /** Records a sign of life. True when reading had slowed down or stopped: the caller then reads once, which starts the 2 s clock again. */
  const touch = useCallback((): boolean => {
    const now = Date.now();
    const slowed = now - lastSign.current >= FAST_FOR_MS;
    lastSign.current = now;
    if (stopped.current) {
      stopped.current = false;
      setPaused(false);
    }
    return slowed;
  }, []);

  const q = useActionQuery<RoomData, "get-room">(
    "get-room",
    { code, ...(token ? { token } : {}) },
    {
      method: "POST",
      enabled,
      refetchInterval: (query) => {
        const { data, error, status } = query.state;
        if (data !== seen.current) {
          // A room that changed (another member acted, or the chat did) is a sign of life. The data is the same object when nothing changed.
          seen.current = data;
          touch();
        }
        const plan = pollPlan({
          idleMs: Date.now() - lastSign.current,
          phase: data?.phase,
          failure: status !== "error" ? null : isRetryable(error) ? "retry" : "stop",
        });
        if ("every" in plan) return plan.every;
        if (plan.stop === "idle" && !stopped.current) {
          stopped.current = true;
          queueMicrotask(() => {
            if (stopped.current) setPaused(true);
          });
        }
        return false;
      },
      // A hidden tab does not read (each read costs hosting credits and keeps the database awake). Showing it again reads the room
      // once right away; "always" because the house staleTime (30 s) would otherwise skip that read. Nothing changes after the reveal.
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: (query) => (query.state.data?.phase === "reveal" ? false : "always"),
    },
  );
  const refetch = q.refetch;

  // The room page is a public path, so the framework's sync of agent writes is not running here: when the chat has finished a tool, read now.
  useEffect(() => {
    if (!enabled) return;
    const awake = () => {
      if (touch()) void refetch({ cancelRefetch: false });
    };
    const shown = () => {
      if (document.visibilityState === "visible") awake();
    };
    const toolDone = (e: Event) => {
      awake();
      if ((e as CustomEvent<{ isError?: boolean }>).detail?.isError !== true) void refetch({ cancelRefetch: false });
    };
    for (const name of SIGNS) window.addEventListener(name, awake, { capture: true, passive: true });
    window.addEventListener("agent-native:tool-done", toolDone);
    document.addEventListener("visibilitychange", shown);
    return () => {
      for (const name of SIGNS) window.removeEventListener(name, awake, { capture: true });
      window.removeEventListener("agent-native:tool-done", toolDone);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [enabled, touch, refetch]);

  const refresh = useCallback(() => {
    touch();
    return refetch();
  }, [touch, refetch]);

  // A refused read (the framework itself also ends polling on 401, 403, 410 and a typed not_found) leaves the last room on screen: say so.
  return { q, refresh, paused: paused || (q.isError && !isRetryable(q.error)) };
}

/** Runs actions as the member who owns `token`, then re-reads the room so the screen answers at once. */
export function useRoomActions(code: string, token: string, refresh: () => Promise<unknown>) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const run = useCallback<RunAction>(
    async <T,>(name: string, args: Record<string, unknown> = {}): Promise<RunResult<T>> => {
      setPending((n) => n + 1);
      setError(null);
      try {
        const data = (await callAction(name, { code, token, ...args }, { method: "POST" })) as T;
        await refresh();
        return { ok: true, data };
      } catch (e) {
        const message = friendlyError(e);
        setError(message);
        return { ok: false, error: message };
      } finally {
        setPending((n) => n - 1);
      }
    },
    [code, token, refresh],
  );
  return { run, busy: pending > 0, error, clearError: useCallback(() => setError(null), []) };
}
