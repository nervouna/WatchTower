import { Buffer } from "node:buffer";
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
          AUTH0_ISSUER: "https://auth.test.invalid/",
          AUTH0_TENANT_DOMAIN: "tenant.test.invalid",
          AUTH0_AUDIENCE: "https://watchtower.damao.io/api",
          AUTH0_WEB_CLIENT_ID: "test-web-client",
          AUTH0_MOBILE_DEV_CLIENT_ID: "test-mobile-dev-client",
          AUTH0_MOBILE_PROD_CLIENT_ID: "test-mobile-prod-client",
          AUTH0_MANAGEMENT_CLIENT_ID: "test-management-client",
          AUTH0_MANAGEMENT_CLIENT_SECRET: "test-management-secret",
          DEPLOYMENT_ENV: "production",
          ACCOUNT_DELETION_ENABLED: "true",
          VERSION_METADATA: { id: "test-version", tag: "git-test", timestamp: "2026-07-19T00:00:00.000Z" },
          MIMO_API_KEY: process.env.MIMO_API_KEY ?? "test-mimo-key",
          FAL_API_KEY: process.env.FAL_API_KEY ?? "test-fal-key",
          RUN_AUDIO_E2E: process.env.RUN_AUDIO_E2E ?? "false",
          RUN_COVER_E2E: process.env.RUN_COVER_E2E ?? "false",
          APNS_TEAM_ID: "test-team-id",
          APNS_KEY_ID: "test-key-id",
          APNS_PRIVATE_KEY: "test-private-key",
          PUSH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 0x41).toString("base64"),
          PUSH_TOKEN_HMAC_KEY: Buffer.alloc(32, 0x42).toString("base64"),
        },
        queueProducers: { DEV_PIPELINE_QUEUE: { queueName: "watchtower-dev-pipeline-runs" } },
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
