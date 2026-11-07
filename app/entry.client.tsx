import { configureClientRouterBasename } from "@agent-native/core/client/api-path";
import { getConsentChoice, setConsentChoice } from "@agent-native/core/client/consent";
import { installRouteChunkRecovery } from "@agent-native/core/client/route-chunk-recovery";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

installRouteChunkRecovery();

configureClientRouterBasename();

// Netlify adds "\n<!-- ... -->" to <head> on production pages; React 19 reads that whitespace text node as a hydration mismatch (#418).
for (const n of Array.from(document.head.childNodes)) if (n.nodeType === Node.TEXT_NODE && !n.nodeValue?.trim()) n.remove();

// Unsaid uses no analytics or ad cookies. Store "reject all" first, as the banner's own Reject button does, so the EU cookie banner never covers a button.
if (!getConsentChoice()) setConsentChoice({ performance: false, targeting: false });

hydrateRoot(document, <HydratedRouter />);
