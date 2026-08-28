import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          PAIRING_BOOTSTRAP_SECRET: "test-bootstrap-secret-that-is-long-enough",
          PAIRING_CREDENTIAL_SECRET: "test-credential-secret-that-is-long-enough",
          FIREBASE_PROJECT_ID: "test-project",
          FIREBASE_CLIENT_EMAIL: "test@example.invalid",
          FIREBASE_PRIVATE_KEY: "unused-in-direct-do-tests",
          MAX_PENDING_PAIRS: "3",
          MAX_PAIR_ATTEMPTS_PER_MINUTE: "20",
        },
      },
    }),
  ],
});
