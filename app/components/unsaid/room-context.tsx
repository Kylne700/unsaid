import { createContext, useContext } from "react";

import type { RunAction } from "@/hooks/use-room";

import type { RoomView } from "../../../server/domain/view";

export interface RoomCtx {
  room: RoomView;
  run: RunAction;
  busy: boolean;
  /** The sentence of the last failed action (shown in the room's alert), or null. */
  error: string | null;
  /** A phase panel can register work that must reach the server before the member marks "done" (unsaved notes). Resolves false when it failed: then "done" is not sent. */
  beforeDone: { current: (() => Promise<boolean | void>) | null };
}

const Ctx = createContext<RoomCtx | null>(null);
export const RoomProvider = Ctx.Provider;

export function useRoomCtx(): RoomCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRoomCtx outside a room");
  return v;
}
