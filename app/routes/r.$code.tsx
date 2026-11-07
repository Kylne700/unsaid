import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoomQuery } from "@/hooks/use-room";
import { friendlyError, isRetryable } from "@/lib/friendly-error";
import { normalizeCodeInput, useRoomToken } from "@/lib/room-token";

import { JoinGate } from "@/components/unsaid/JoinGate";
import { RoomScreen } from "@/components/unsaid/RoomScreen";
import { Shell } from "@/components/unsaid/Shell";

export function meta() {
  return [{ title: "Unsaid room" }];
}

export default function RoomRoute() {
  const params = useParams();
  const code = normalizeCodeInput(params.code ?? "");
  const seat = useRoomToken(code);
  const q = useRoomQuery(code, seat.token, seat.ready);
  const data = q.data;
  // A room that never opened keeps its last error on screen while the automatic retries run: each retry flips the query back to
  // "pending" and would otherwise blink the error away and show the skeleton again.
  const lastError = useRef<{ error: unknown } | null>(null);
  if (data) lastError.current = null;
  else if (q.isError) lastError.current = { error: q.error };
  const failed = lastError.current;
  // A room that takes longer than 8 s to open gets a plain line and a retry button instead of a skeleton that never ends.
  const [slow, setSlow] = useState(false);
  const waiting = !data && !failed;
  useEffect(() => {
    setSlow(false);
    if (!waiting) return;
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [waiting, code]);

  if (!data && failed) {
    return (
      <Shell right={<span className="font-mono tracking-widest">{code}</span>}>
        <div className="mx-auto max-w-lg" role="alert">
          <h1 className="text-xl font-semibold">We could not open this room</h1>
          <p className="mt-2 text-sm text-muted-foreground">{friendlyError(failed.error, "open")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {isRetryable(failed.error) ? (
              <Button type="button" disabled={q.isFetching} aria-busy={q.isFetching} onClick={() => void q.refetch()}>
                {q.isFetching ? "Trying..." : "Try again"}
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link to="/">Back to the start</Link>
            </Button>
          </div>
        </div>
      </Shell>
    );
  }
  if (!seat.ready || !data) {
    return (
      <Shell right={<span className="font-mono tracking-widest">{code}</span>}>
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
          {slow ? (
            <p role="status" className="text-sm text-muted-foreground">
              Still opening the room...{" "}
              {/* A reload, because a request that is still in flight cannot be asked again; nothing is lost before the room has opened. */}
              <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
                Try again
              </Button>
            </p>
          ) : null}
        </div>
      </Shell>
    );
  }
  if (data.guest) return <JoinGate view={data} onJoined={seat.set} />;
  // A member view only ever comes back for a valid token, so the token is set here.
  return seat.token ? <RoomScreen code={code} token={seat.token} room={data} refresh={q.refetch} /> : null;
}
