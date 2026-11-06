import { createCoreRoutesPlugin, getH3App, getSession, registerAuthPublicPaths } from "@agent-native/core/server";
import { createError, defineEventHandler, type H3Event } from "h3";

import { GEMINI_MODEL, geminiConfigured } from "../lib/gemini";
import { ownerFromSeatCookie } from "../lib/guest";

// The framework default plus two things for a guest with a valid seat cookie (server/lib/guest.ts).
//
// 1. Application state (the URL the agent sees, navigate commands) is kept under their seat owner instead of 401.
// The Builder.io connect routes call the same resolver, so it answers only when the application-state handlers
// called it: they put it on the event first. If the framework renames that key, guests lose application state
// (fails closed).
function appStateGuest(event: H3Event): Promise<string | null> | null {
  return event.context?.agentNativeAppStateAnonymousOwner === appStateGuest ? ownerFromSeatCookie(event) : null;
}

// 2. The chat composer sends only after GET agent-engine/status says `chatEligible`. The framework's answer covers
// signed-in accounts and standard provider keys, not Unsaid's own key, so a guest gets this one. No `engine` field:
// the client would echo it back as a registry engine name.
async function guestEngineStatus(event: H3Event) {
  if (await getSession(event)) return; // signed in: the framework's handler answers
  if (!(await ownerFromSeatCookie(event))) throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  return { configured: true, model: GEMINI_MODEL, chatEligible: geminiConfigured(), openAiBaseUrlConfigured: false };
}

// Past the auth guard for guests: each of these answers from the session, else from the seat cookie, else 401, and
// application state is stored per owner. application-state/compose/* stays guarded.
registerAuthPublicPaths(["/_agent-native/application-state", "/_agent-native/application-state/:key", "/_agent-native/agent-engine/status"]);

const frameworkCoreRoutes = createCoreRoutesPlugin({
  googleOAuthManagedConnection: "not_applicable",
  anonymousApplicationState: true,
  anonymousOwner: appStateGuest,
});

export default async function coreRoutes(nitroApp: unknown) {
  getH3App(nitroApp).use("/_agent-native/agent-engine/status", defineEventHandler(guestEngineStatus));
  await frameworkCoreRoutes(nitroApp);
}
