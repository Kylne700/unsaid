import { getOrgContext } from "@agent-native/core/org";
import { createAgentChatPlugin, loadActionsFromStaticRegistry } from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";

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

const SYSTEM_PROMPT = `You are the Unsaid assistant inside one team decision room. You help one member at a time, the member whose secret room token the app gives you, to put down what they know and to understand where the room stands.

What you do
- Read the room with get-room. It already hides everything the current phase must hide.
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
});
