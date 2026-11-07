// One plain sentence for a failed call. The words are fixed here and never taken from the error: the server's validation text
// repeats the whole request (what the person typed, and their secret seat token), so nothing from the error is ever shown.

export type ErrorAbout = "action" | "open" | "join";

export const FRIENDLY = {
  offline: "Could not reach the server. Check your connection and try again.",
  slow: "That took too long. Try again.",
  busy: "Too many tries just now. Wait a minute and try again.",
  server: "Something went wrong on our side. Try again in a moment.",
  notFound: "Room not found. Check the code.",
  forbidden: "You cannot do that in this room.",
  moved: "The room has moved on to the next step. Try again once the page has updated.",
  conflict: "The room changed at the same moment. Try again.",
  nameTaken: "Someone in this room already uses that name, or the room is full. Try another name.",
  closed: "This room has moved past the notes phase, so new people can no longer join.",
  invalid: "That did not look right. Check it and try again.",
  other: "That did not work. Try again.",
} as const;

/** Whether asking again can help: no answer at all, a timeout, "too many tries" or a server fault. A 4xx will answer the same. */
export function isRetryable(error: unknown): boolean {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status !== "number" || status === 408 || status === 429 || status >= 500;
}

/**
 * `about` says what the person was doing: "open" = opening a room by its link or code, "join" = adding a name to a room.
 * The server's answers carry a status and a short `errorCode` (not_found, forbidden, bad_phase, invalid, conflict);
 * a 400 with any other code is the framework's own validation failure.
 */
export function friendlyError(error: unknown, about: ErrorAbout = "action"): string {
  const e = error as { status?: unknown; errorCode?: unknown; message?: unknown } | null | undefined;
  const status = typeof e?.status === "number" ? e.status : undefined;
  const code = typeof e?.errorCode === "string" ? e.errorCode : undefined;
  if (status === undefined) return typeof e?.message === "string" && /^Action .+ failed: /.test(e.message) ? FRIENDLY.offline : FRIENDLY.other;
  if (status === 408) return FRIENDLY.slow;
  if (status === 429) return FRIENDLY.busy;
  if (status >= 500) return FRIENDLY.server;
  if (about === "open" && (status === 400 || status === 403 || status === 404)) return FRIENDLY.notFound;
  if (about === "join" && code === "conflict") return FRIENDLY.nameTaken;
  if (about === "join" && code === "bad_phase") return FRIENDLY.closed;
  if (code === "not_found") return FRIENDLY.notFound;
  if (code === "forbidden") return FRIENDLY.forbidden;
  if (code === "bad_phase") return FRIENDLY.moved;
  if (code === "conflict") return FRIENDLY.conflict;
  if (status === 400) return FRIENDLY.invalid;
  return FRIENDLY.other;
}
