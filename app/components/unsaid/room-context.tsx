import { createContext, useContext } from "react";

import type { RunAction } from "@/hooks/use-room";

import type { RoomView } from "../../../server/domain/view";

export interface RoomCtx {
  room: RoomView;
  run: RunAction;
  busy: boolean;
  /** A phase panel can register work that must reach the server before the member marks "done" (unsaved notes). */
  beforeDone: { current: (() => Promise<void>) | null };
}

const Ctx = createContext<RoomCtx | null>(null);
export const RoomProvider = Ctx.Provider;

export function useRoomCtx(): RoomCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRoomCtx outside a room");
  return v;
}
