import { defineAppConfig } from "@agent-native/core/server";

import { ENGINE_NAME, GEMINI_MODEL } from "../lib/gemini";

export default defineAppConfig({
  app: {
    // This name appears in transactional emails. Change it to your product name.
    name: "Unsaid",
    // The source template keeps a renamed app from inheriting first-party email branding.
    sourceTemplate: "chat",
    // Unsaid opens on its public home page.
    homePath: "/",
    // Optional: use your own absolute HTTPS logo URL in transactional emails.
    // logoUrl: "https://example.com/logo.png",
  },
  // The room chat runs only on Unsaid's guarded Gemini engine (server/lib/gemini.ts).
  agent: { engine: ENGINE_NAME, model: GEMINI_MODEL },
});
