import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { Link, useParams } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { useRoomQuery } from "@/hooks/use-room";
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

  if (!data && q.isError) {
    return (
      <Shell right={<span className="font-mono tracking-widest">{code}</span>}>
        <div className="mx-auto max-w-lg" role="alert">
          <h1 className="text-xl font-semibold">We could not open this room</h1>
          <p className="mt-2 text-sm text-muted-foreground">{actionErrorMessage(q.error) ?? "Check the code and try again."}</p>
          <Link to="/" className="mt-4 inline-block text-sm underline">
            Back to the start
          </Link>
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
        </div>
      </Shell>
    );
  }
  if (data.guest) return <JoinGate view={data} onJoined={seat.set} />;
  // A member view only ever comes back for a valid token, so the token is set here.
  return seat.token ? <RoomScreen code={code} token={seat.token} room={data} refresh={q.refetch} /> : null;
}
