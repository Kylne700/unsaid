// A member's secret token for one room lives in this browser's localStorage. No account, no email.
import { useCallback, useEffect, useState } from "react";

const keyFor = (code: string) => `unsaid:member:${code.toUpperCase()}`;

export function normalizeCodeInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function saveToken(code: string, token: string): void {
  try {
    window.localStorage.setItem(keyFor(code), token);
  } catch {
    // Private mode or blocked storage: the seat then lasts until the page is closed.
  }
}

export function readToken(code: string): string | null {
  try {
    return window.localStorage.getItem(keyFor(code));
  } catch {
    return null;
  }
}

export function forgetToken(code: string): void {
  try {
    window.localStorage.removeItem(keyFor(code));
  } catch {
    // nothing to forget
  }
}

/** The caller's token for this room. `ready` is false on the server and for the first client render. */
export function useRoomToken(code: string) {
  const [state, setState] = useState<{ ready: boolean; token: string | null }>({ ready: false, token: null });
  useEffect(() => {
    setState({ ready: true, token: readToken(code) });
  }, [code]);
  const set = useCallback(
    (token: string) => {
      saveToken(code, token);
      setState({ ready: true, token });
    },
    [code],
  );
  const clear = useCallback(() => {
    forgetToken(code);
    setState({ ready: true, token: null });
  }, [code]);
  return { ...state, set, clear };
}
