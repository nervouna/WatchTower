import { describe, expect, it } from "vitest";
import source from "../wrangler.jsonc?raw";

interface QueueBinding { binding: string; queue: string }
interface QueueConsumer { queue: string }
interface EnvironmentConfig {
  name: string;
  routes: Array<{ pattern: string; custom_domain: boolean }>;
  d1_databases: Array<{ binding: string; database_name: string }>;
  r2_buckets: Array<{ binding: string; bucket_name: string }>;
  queues: { producers: QueueBinding[]; consumers: QueueConsumer[] };
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
    expect(config.name).toBe("watchtower-daily-brief");
    expect(dev.name).toBe("watchtower-daily-brief-dev");
    expect(productionRoute).toEqual({ pattern: "watchtower.damao.io", custom_domain: true });
    expect(devRoute).toEqual({ pattern: "dev.watchtower.damao.io", custom_domain: true });
    expect(productionDatabase).toMatchObject({ binding: "DB", database_name: "watchtower-daily-brief-db" });
    expect(devDatabase).toMatchObject({ binding: "DB", database_name: "watchtower-daily-brief-dev-db" });
    expect(productionBucket).toEqual({ binding: "BRIEF_AUDIO", bucket_name: "watchtower-brief-audio" });
    expect(devBucket).toEqual({ binding: "BRIEF_AUDIO", bucket_name: "watchtower-brief-audio-dev" });
    expect(config.queues.producers).toEqual([
      { binding: "BRIEF_AUDIO_QUEUE", queue: "watchtower-brief-audio-jobs" },
      { binding: "BRIEF_PUSH_QUEUE", queue: "watchtower-brief-push-jobs" },
      { binding: "ITEM_EXPLORATION_QUEUE", queue: "watchtower-item-exploration-jobs" },
    ]);
    expect(dev.queues.producers).toEqual([
      { binding: "BRIEF_AUDIO_QUEUE", queue: "watchtower-brief-audio-jobs-dev" },
      { binding: "BRIEF_PUSH_QUEUE", queue: "watchtower-brief-push-jobs-dev" },
      { binding: "ITEM_EXPLORATION_QUEUE", queue: "watchtower-item-exploration-jobs-dev" },
      { binding: "DEV_PIPELINE_QUEUE", queue: "watchtower-dev-pipeline-runs" },
    ]);
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
    expect(dev.secrets.required).toEqual([
      "TAVILY_API_KEY", "DEEPSEEK_API_KEY", "MIMO_API_KEY", "FAL_API_KEY", "APNS_TEAM_ID",
      "APNS_SANDBOX_KEY_ID", "APNS_SANDBOX_PRIVATE_KEY", "PUSH_TOKEN_ENCRYPTION_KEY", "PUSH_TOKEN_HMAC_KEY",
    ]);
    expect(config.secrets.required).toEqual([
      "TAVILY_API_KEY", "DEEPSEEK_API_KEY", "AUTH0_MANAGEMENT_CLIENT_ID", "AUTH0_MANAGEMENT_CLIENT_SECRET",
      "MIMO_API_KEY", "FAL_API_KEY", "APNS_TEAM_ID", "APNS_PRODUCTION_KEY_ID", "APNS_PRODUCTION_PRIVATE_KEY",
      "PUSH_TOKEN_ENCRYPTION_KEY", "PUSH_TOKEN_HMAC_KEY",
    ]);
    expect(Object.keys(dev.vars)).not.toContain("TAVILY_API_KEY");
  });
});
