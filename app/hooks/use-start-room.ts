// Starts a room that needs no input (the 3-minute practice or the 20-second replay), keeps its token and opens it.
import { useActionMutation } from "@agent-native/core/client/hooks";
import { useNavigate } from "react-router";

import { friendlyError } from "@/lib/friendly-error";
import { saveToken } from "@/lib/room-token";

export function useStartRoom(action: "create-practice-room" | "create-replay-room") {
  const navigate = useNavigate();
  const make = useActionMutation(action);
  async function go() {
    try {
      const r = await make.mutateAsync({});
      saveToken(r.code, r.token);
      navigate(`/r/${r.code}`);
    } catch {
      // `error` carries the message
    }
  }
  return { go, pending: make.isPending, error: make.error ? friendlyError(make.error) : null };
}
