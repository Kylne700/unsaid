// Reads a room (polling once a second, so every open window follows within 2 s) and runs room actions.
// Every call here is one of the framework actions in /actions: the chat agent calls the same ones.
import { actionErrorMessage, callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useCallback, useState } from "react";

import type { GuestView, RoomView } from "../../server/domain/view";

export type RoomData = RoomView | GuestView;
export type RunResult<T> = { ok: true; data: T } | { ok: false };
export type RunAction = <T = unknown>(name: string, args?: Record<string, unknown>) => Promise<RunResult<T>>;

const POLL_MS = 1000;
const POLL_AFTER_ERROR_MS = 5000;

export function useRoomQuery(code: string, token: string | null, enabled: boolean) {
  return useActionQuery<RoomData, "get-room">(
    "get-room",
    { code, ...(token ? { token } : {}) },
    {
      method: "POST",
      enabled,
      refetchInterval: (query) => (query.state.status === "error" ? POLL_AFTER_ERROR_MS : POLL_MS),
      refetchIntervalInBackground: true,
    },
  );
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
        setError(actionErrorMessage(e) ?? "That did not work. Try again.");
        return { ok: false };
      } finally {
        setPending((n) => n - 1);
      }
    },
    [code, token, refresh],
  );
  return { run, busy: pending > 0, error, clearError: useCallback(() => setError(null), []) };
}
