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
