import path from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./test/worker.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          WATCHTOWER_FEEDBACK_TOKEN: "test-feedback-token",
          MIMO_API_KEY: process.env.MIMO_API_KEY ?? "test-mimo-key",
          RUN_AUDIO_E2E: process.env.RUN_AUDIO_E2E ?? "false",
          APNS_TEAM_ID: "test-team-id",
          APNS_KEY_ID: "test-key-id",
          APNS_PRIVATE_KEY: "test-private-key",
          PUSH_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          PUSH_TOKEN_HMAC_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
        },
        serviceBindings: {
          ASSETS: () => new Response("asset"),
        },
      },
    })),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
    coverage: { reporter: ["text", "json", "html"] },
  },
});
