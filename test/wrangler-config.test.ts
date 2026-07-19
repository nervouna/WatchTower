import { describe, expect, it } from "vitest";
import source from "../wrangler.jsonc?raw";

interface QueueConsumer { queue: string }
interface EnvironmentConfig {
  routes: Array<{ pattern: string }>;
  d1_databases: Array<{ database_name: string }>;
  r2_buckets: Array<{ bucket_name: string }>;
  queues: { consumers: QueueConsumer[] };
  vars: Record<string, string>;
  secrets: { required: string[] };
  triggers: { crons: string[] };
  version_metadata: { binding: string };
}
interface WranglerConfig extends EnvironmentConfig { env: { dev: EnvironmentConfig } }
const config = JSON.parse(source) as WranglerConfig;

describe("Wrangler environment isolation", () => {
  it("maps production and Dev to distinct resources and deployment identities", () => {
    const dev = config.env.dev;
    const productionRoute = config.routes[0]!;
    const devRoute = dev.routes[0]!;
    const productionDatabase = config.d1_databases[0]!;
    const devDatabase = dev.d1_databases[0]!;
    const productionBucket = config.r2_buckets[0]!;
    const devBucket = dev.r2_buckets[0]!;
    expect(config.vars).toMatchObject({ DEPLOYMENT_ENV: "production", ACCOUNT_DELETION_ENABLED: "true" });
    expect(dev.vars).toMatchObject({ DEPLOYMENT_ENV: "dev", ACCOUNT_DELETION_ENABLED: "false" });
    expect(productionRoute.pattern).toBe("watchtower.damao.io");
    expect(devRoute.pattern).toBe("dev.watchtower.damao.io");
    expect(productionDatabase.database_name).not.toBe(devDatabase.database_name);
    expect(productionBucket.bucket_name).not.toBe(devBucket.bucket_name);
    expect(dev.triggers.crons).toEqual([]);
    expect(config.version_metadata.binding).toBe("VERSION_METADATA");
    expect(dev.version_metadata.binding).toBe("VERSION_METADATA");
  });

  it("gives Dev complete consumers and only sandbox APNs secrets", () => {
    const dev = config.env.dev;
    expect(dev.vars).toMatchObject({ BRIEF_AUDIO_ENABLED: "true", BRIEF_COVER_ENABLED: "true", BRIEF_PUSH_ENABLED: "true", ITEM_EXPLORATION_ENABLED: "true" });
    expect(dev.queues.consumers.map((item) => item.queue)).toEqual(expect.arrayContaining([
      "watchtower-brief-audio-jobs-dev", "watchtower-brief-push-jobs-dev", "watchtower-item-exploration-jobs-dev", "watchtower-dev-pipeline-runs",
    ]));
    expect(dev.secrets.required).toEqual(expect.arrayContaining(["APNS_SANDBOX_KEY_ID", "APNS_SANDBOX_PRIVATE_KEY"]));
    expect(dev.secrets.required).not.toContain("APNS_PRODUCTION_PRIVATE_KEY");
    expect(config.secrets.required).toContain("APNS_PRODUCTION_PRIVATE_KEY");
    expect(config.secrets.required).not.toContain("APNS_SANDBOX_PRIVATE_KEY");
    expect(Object.keys(dev.vars)).not.toContain("TAVILY_API_KEY");
  });
});
