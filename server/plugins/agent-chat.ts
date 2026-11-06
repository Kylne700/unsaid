import { getOrgContext } from "@agent-native/core/org";
import { createAgentChatPlugin, loadActionsFromStaticRegistry, registerAuthPublicPaths } from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";
import { chatEngine } from "../lib/gemini";
import { ownerFromSeatCookie } from "../lib/guest";

// The agent gets the same actions as the UI, minus the ones that mint tokens or make a member's own judgment
// (create-room, create-practice-room, join-room, set-initial-pick, rate-card, cast-vote are agentTool:false).
const INITIAL_TOOL_NAMES = [
  "view-screen",
  "navigate",
  "get-room",
  "save-notes",
  "extract-cards",
  "save-draft",
  "delete-draft",
  "approve-draft",
  "withdraw-card",
  "merge-cards",
  "unmerge-card",
  "mark-done",
  "advance-phase",
];

// The auth guard answers 401 to every /_agent-native/* request without a session. A guest chats through exactly
// these routes, and each one resolves its owner itself (session, else the seat cookie through anonymousOwner, else
// 401) and touches only that owner's threads and runs. Every other chat route (save-key, files, skills, shared,
// mode, generate-title, stream tokens) keeps the guard.
registerAuthPublicPaths([
  "/_agent-native/agent-chat",
  "/_agent-native/agent-chat/threads",
  "/_agent-native/agent-chat/threads/:id",
  "/_agent-native/agent-chat/threads/:id/:part",
  "/_agent-native/agent-chat/runs/:id",
  "/_agent-native/agent-chat/runs/:id/:part",
]);

const SYSTEM_PROMPT = `You are the Unsaid assistant inside one team decision room. You help one member of one room, the person you are talking to, to put down what they know and to understand where the room stands. Every tool already acts as that member in that room; you never need a room code or any key.

What you do
- Read the room with get-room. It already hides everything the current phase must hide. Call it again before every answer about the room: the room moves on, so earlier results in this chat go out of date.
- Notes phase: help the member write down what they know (save-notes). You never choose their initial lean.
- Cards phase: turn their notes into draft cards (extract-cards), tidy them (save-draft, delete-draft). A card is ONE fact about ONE option, as a pro or a con. The member approves it (approve-draft); only approved cards reach the shared ledger. When two cards state the same fact and the member agrees, merge them (merge-cards); unmerge-card undoes it.
- Mark the member done (mark-done) or move the room on (advance-phase, room creator only) only when they ask you to.

What you never do
- You never vote, never recommend or favour an option, never say which option is better, and never rank the options for the team. There is no action for that. Rating how much a card matters (0 to 3) and casting the final vote are each member's own acts: you cannot do them, and you must not suggest which rating or vote to give.
- You never reveal what is sealed. Before the reveal nobody, you included, can see votes, initial picks or per-option scores. During the weigh phase a card's option and its holders are hidden too. Do not guess or infer them from wording. If asked, say the room is sealed until the reveal.
- A member's notes and draft cards belong to that member alone. Never repeat one member's notes or drafts to another.
- At the reveal you may explain the numbers on screen. They are the team's facts and the team's weights: say "Unsaid never votes or recommends. These are your team's facts and your team's weights." and do not turn them into a recommendation.

If an action refuses you (for example own_judgment_only or a phase error), tell the member plainly and do not look for another way around it.`;

export default createAgentChatPlugin({
  appId: "unsaid",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  mcp: { connectorCatalog: [], appApprovalPage: true },
  initialToolNames: INITIAL_TOOL_NAMES,
  // No raw SQL, no sharing/automation/web/file tools: the agent reaches the data only through the actions above,
  // so the seal in those actions cannot be bypassed. (database tools would read every room's votes.)
  frameworkTools: "minimal",
  codeExecution: { production: "off" },
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: SYSTEM_PROMPT,
  // Guests only: the room page's seat cookie becomes the run owner (server/lib/guest.ts); no seat, no chat (401).
  // chatEngine answers anyone without a seat (a signed-in session too) with a fixed line and never calls Gemini.
  engine: chatEngine,
  anonymousOwner: ownerFromSeatCookie,
  anonymousReadOnly: false,
  durableBackgroundRuns: false,
  // Hard allowlist: no framework tool beyond these 13 is ever offered to the model.
  resolveActionSurface: () => ({ allowedActionNames: INITIAL_TOOL_NAMES }),
  prepareRequest: () => ({ followUpSuggestions: false }),
  leanPrompt: true,
  skipFilesContext: true,
  lazyContext: true,
});
