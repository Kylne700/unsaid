import { defineAgentNativeConfig } from "@agent-native/core/config";

export default defineAgentNativeConfig({
  changelog: { enabled: false },
  harness: false, // no local coding-agent runtimes in this app's chat
});
