import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

// Judges and teammates join with no account: "/" and "/r/<code>" are public pages, and the
// room actions are requiresAuth:false. A member proves who they are with a per-room token
// (hashed in server/domain/state.ts, checked by memberByToken in server/domain/room.ts). Every other page keeps the scaffold's sign-in.
export default createToolkitAuthPlugin({
  publicPaths: ["/", "/r"],
  workspaceAppPublicPaths: ["/", "/r"],
  rootAuth: false,
  marketing: false,
});
