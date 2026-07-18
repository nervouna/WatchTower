import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { createApnsJwt, sendApnsNotification } from "../src/push/apns";
import { decryptToken, encryptToken, hmacHex } from "../src/push/crypto";
import { handleRequest } from "../src/http/router";
import { enqueueBriefPush, processPushDelivery, processPushFanout } from "../src/push/jobs";
import { createPushDelivery } from "../src/push/repository";

const encryptionKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const hmacKey = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
const emptyQueueMetrics = { backlogCount: 0, backlogBytes: 0 };
const devAppId = "io.damao.watchtower.dev";
const productionAppId = "io.damao.watchtower";

function queueWithSend(send: Queue["send"]): Queue {
  return {
    send,
    sendBatch: async () => ({ metadata: { metrics: emptyQueueMetrics } }),
    metrics: async () => emptyQueueMetrics,
  };
}

async function privateKeyPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const body = btoa(binary).match(/.{1,64}/gu)?.join("\n") ?? "";
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}

describe("mobile push", () => {
  it("does not reserve a batch or send a queue message when brief push is disabled", async () => {
    const now = new Date("2026-07-20T00:31:00.000Z");
    await env.DB.prepare(
      `INSERT INTO briefs (brief_date, status, publish_at, generated_at, headline, intro, missing_sources_json, model, prompt_version)
       VALUES (?, 'partial', ?, ?, ?, 'intro', '["kickstarter"]', 'test', 'v1')`,
    ).bind("2026-07-20", "2026-07-20T00:00:00.000Z", now.toISOString(), "静默恢复标题").run();
    const send = vi.fn<Queue["send"]>();
    expect(await enqueueBriefPush({ DB: env.DB, BRIEF_PUSH_QUEUE: queueWithSend(send), BRIEF_PUSH_ENABLED: "false" }, "2026-07-20", now)).toBe("disabled");
    expect(send).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM brief_push_batches WHERE brief_date = ?").bind("2026-07-20").first("count")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM brief_push_deliveries WHERE brief_date = ?").bind("2026-07-20").first("count")).toBe(0);
  });

  it("encrypts tokens and creates stable HMAC values", async () => {
    const encrypted = await encryptToken(encryptionKey, "a".repeat(64));
    expect(encrypted.ciphertext).not.toContain("a".repeat(16));
    expect(await decryptToken(encryptionKey, encrypted.ciphertext, encrypted.iv)).toBe("a".repeat(64));
    expect(await hmacHex(hmacKey, "installation")).toMatch(/^[a-f0-9]{64}$/u);
    expect(await hmacHex(hmacKey, "installation")).toBe(await hmacHex(hmacKey, "installation"));
  });

  it("registers, rotates, and removes an encrypted iOS subscription", async () => {
    const installationSecret = "A".repeat(43);
    const request = (deviceToken: string) => new Request("https://example.com/api/mobile/v1/push-subscriptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" },
      body: JSON.stringify({ installationSecret, deviceToken, environment: "sandbox", appId: devAppId, appVersion: "1.0.0+1" }),
    });
    expect((await handleRequest(request("a".repeat(64)), env)).status).toBe(204);
    expect((await handleRequest(request("b".repeat(64)), env)).status).toBe(204);

    const rows = await env.DB.prepare(
      "SELECT installation_hmac, token_hmac, token_ciphertext, token_iv, environment, app_id, app_version, active FROM push_subscriptions",
    ).all();
    expect(rows.results).toHaveLength(1);
    expect(JSON.stringify(rows.results[0])).not.toContain("b".repeat(32));
    expect(rows.results[0]).toMatchObject({ environment: "sandbox", app_id: devAppId, app_version: "1.0.0+1", active: 1 });

    const removed = await handleRequest(new Request("https://example.com/api/mobile/v1/push-subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" },
      body: JSON.stringify({ installationSecret }),
    }), env);
    expect(removed.status).toBe(204);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM push_subscriptions").first<{ count: number }>())?.count).toBe(0);
  });

  it("rejects malformed subscription requests without CORS or caching", async () => {
    const response = await handleRequest(new Request("https://example.com/api/mobile/v1/push-subscriptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installationSecret: "short", deviceToken: "bad" }),
    }), env);
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("accepts only supported app and APNs environment pairs", async () => {
    const request = (appId: string, environment: string) => new Request("https://example.com/api/mobile/v1/push-subscriptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.10" },
      body: JSON.stringify({
        installationSecret: "D".repeat(43),
        deviceToken: "e".repeat(64),
        appId,
        environment,
        appVersion: "1.0.0+2",
      }),
    });

    expect((await handleRequest(request(devAppId, "production"), env)).status).toBe(400);
    const mismatchedProduction = await handleRequest(request(productionAppId, "sandbox"), env);
    expect(mismatchedProduction.status).toBe(400);
    expect(await mismatchedProduction.json()).toMatchObject({
      error: { code: "INVALID_PUSH_APP_ENVIRONMENT" },
    });
    expect((await handleRequest(request("io.example.watchtower", "sandbox"), env)).status).toBe(400);
  });

  it("requires an explicit appId for push subscriptions", async () => {
    const response = await handleRequest(new Request("https://example.com/api/mobile/v1/push-subscriptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.11" },
      body: JSON.stringify({
        installationSecret: "E".repeat(43),
        deviceToken: "f".repeat(64),
        environment: "sandbox",
        appVersion: "1.0.0+1",
      }),
    }), env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_SUBSCRIPTION" },
    });
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM push_subscriptions").first<{ count: number }>())?.count).toBe(0);
  });

  it("creates ES256 provider tokens and classifies APNs responses", async () => {
    const config = { teamId: "TEAM123", keyId: "KEY123", privateKey: await privateKeyPem(), topic: "io.damao.watchtower" };
    const jwt = await createApnsJwt(config, new Date("2026-07-17T00:00:00.000Z"));
    expect(jwt.split(".")).toHaveLength(3);

    let captured: RequestInit | undefined;
    const delivered = await sendApnsNotification(
      config,
      { deviceToken: "a".repeat(64), environment: "sandbox", briefDate: "2026-07-17", headline: "今日热点" },
      async (_url, init) => {
        captured = init;
        return new Response(null, { status: 200 });
      },
      new Date("2026-07-17T00:00:00.000Z"),
    );
    expect(delivered).toEqual({ kind: "delivered" });
    expect(new Headers(captured?.headers).get("apns-collapse-id")).toBe("2026-07-17");
    expect(captured?.body).toContain('"briefDate":"2026-07-17"');

    const invalid = await sendApnsNotification(
      config,
      { deviceToken: "a".repeat(64), environment: "production", briefDate: "2026-07-17", headline: "今日热点" },
      async () => Response.json({ reason: "Unregistered" }, { status: 410 }),
    );
    expect(invalid).toEqual({ kind: "invalid", errorCode: "Unregistered" });
    const retry = await sendApnsNotification(
      config,
      { deviceToken: "a".repeat(64), environment: "production", briefDate: "2026-07-17", headline: "今日热点" },
      async () => Response.json({ reason: "TooManyRequests" }, { status: 429 }),
    );
    expect(retry).toEqual({ kind: "retry", errorCode: "TooManyRequests" });
  });

  it("fans out one idempotent delivery and marks successful APNs sends", async () => {
    const now = new Date("2026-07-17T00:01:00.000Z");
    await env.DB.prepare(
      `INSERT INTO briefs (brief_date, status, publish_at, generated_at, headline, intro, missing_sources_json, model, prompt_version)
       VALUES (?, 'complete', ?, ?, ?, 'intro', '[]', 'test', 'v1')`,
    ).bind("2026-07-17", "2026-07-17T00:00:00.000Z", now.toISOString(), "今日发布标题").run();
    const registration = new Request("https://example.com/api/mobile/v1/push-subscriptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.2" },
      body: JSON.stringify({ installationSecret: "B".repeat(43), deviceToken: "c".repeat(64), environment: "sandbox", appId: devAppId, appVersion: "1.0.0+1" }),
    });
    expect((await handleRequest(registration, env, now)).status).toBe(204);
    expect(await enqueueBriefPush({ ...env, BRIEF_PUSH_ENABLED: "true" }, "2026-07-17", now)).toBe("queued");
    expect(await enqueueBriefPush({ ...env, BRIEF_PUSH_ENABLED: "true" }, "2026-07-17", now)).toBe("already-queued");

    await processPushFanout(env, { kind: "brief-push-fanout", briefDate: "2026-07-17" }, now);
    const delivery = await env.DB.prepare("SELECT id, status FROM brief_push_deliveries").first<{ id: string; status: string }>();
    expect(delivery?.status).toBe("queued");
    let capturedConfig: { keyId: string; topic: string } | undefined;
    const pushEnv = {
      ...env,
      APNS_SANDBOX_KEY_ID: "SANDBOX123",
      APNS_SANDBOX_PRIVATE_KEY: "sandbox-private-key",
      APNS_PRODUCTION_KEY_ID: "PRODUCTION",
      APNS_PRODUCTION_PRIVATE_KEY: "production-private-key",
    };
    const result = await processPushDelivery(
      pushEnv,
      { kind: "brief-push-delivery", deliveryId: delivery!.id, briefDate: "2026-07-17", headline: "今日发布标题" },
      now,
      false,
      async (config) => {
        capturedConfig = config;
        return { kind: "delivered" };
      },
    );
    expect(result).toBe("delivered");
    expect(capturedConfig).toMatchObject({ keyId: "SANDBOX123", topic: devAppId });
    expect((await env.DB.prepare("SELECT status FROM brief_push_deliveries WHERE id = ?").bind(delivery!.id).first<{ status: string }>())?.status).toBe("delivered");
    expect((await env.DB.prepare(
      `SELECT subscription.last_success_at
       FROM push_subscriptions AS subscription
       JOIN brief_push_deliveries AS delivery ON delivery.subscription_id = subscription.id
       WHERE delivery.id = ?`,
    ).bind(delivery!.id).first<{ last_success_at: string | null }>())?.last_success_at).toBe(now.toISOString());
  });

  it("uses the production key and topic for a production subscription", async () => {
    const now = new Date("2026-07-19T00:01:00.000Z");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM brief_push_deliveries"),
      env.DB.prepare("DELETE FROM brief_push_batches"),
      env.DB.prepare("DELETE FROM push_subscriptions"),
    ]);
    await env.DB.prepare(
      `INSERT INTO briefs (brief_date, status, publish_at, generated_at, headline, intro, missing_sources_json, model, prompt_version)
       VALUES (?, 'complete', ?, ?, ?, 'intro', '[]', 'test', 'v1')`,
    ).bind("2026-07-19", "2026-07-19T00:00:00.000Z", now.toISOString(), "生产标题").run();
    const registration = new Request("https://example.com/api/mobile/v1/push-subscriptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.19" },
      body: JSON.stringify({
        installationSecret: "F".repeat(43),
        deviceToken: "1".repeat(64),
        environment: "production",
        appId: productionAppId,
        appVersion: "1.0.0+2",
      }),
    });
    expect((await handleRequest(registration, env, now)).status).toBe(204);
    const subscription = await env.DB.prepare("SELECT id FROM push_subscriptions").first<{ id: string }>();
    expect(await createPushDelivery(env.DB, {
      id: "production-delivery",
      briefDate: "2026-07-19",
      subscriptionId: subscription!.id,
      now: now.toISOString(),
    })).toBe(true);

    let capturedConfig: { keyId: string; topic: string } | undefined;
    const result = await processPushDelivery(
      {
        ...env,
        APNS_SANDBOX_KEY_ID: "SANDBOX123",
        APNS_SANDBOX_PRIVATE_KEY: "sandbox-private-key",
        APNS_PRODUCTION_KEY_ID: "PRODUCTION",
        APNS_PRODUCTION_PRIVATE_KEY: "production-private-key",
      },
      { kind: "brief-push-delivery", deliveryId: "production-delivery", briefDate: "2026-07-19", headline: "生产标题" },
      now,
      false,
      async (config) => {
        capturedConfig = config;
        return { kind: "delivered" };
      },
    );

    expect(result).toBe("delivered");
    expect(capturedConfig).toMatchObject({ keyId: "PRODUCTION", topic: productionAppId });
  });

  it("re-enqueues an existing queued delivery after a fanout send failure", async () => {
    const now = new Date("2026-07-18T00:01:00.000Z");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM brief_push_deliveries"),
      env.DB.prepare("DELETE FROM brief_push_batches"),
      env.DB.prepare("DELETE FROM push_subscriptions"),
    ]);
    await env.DB.prepare(
      `INSERT INTO briefs (brief_date, status, publish_at, generated_at, headline, intro, missing_sources_json, model, prompt_version)
       VALUES (?, 'complete', ?, ?, ?, 'intro', '[]', 'test', 'v1')`,
    ).bind("2026-07-18", "2026-07-18T00:00:00.000Z", now.toISOString(), "重试标题").run();
    const registration = new Request("https://example.com/api/mobile/v1/push-subscriptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.3" },
      body: JSON.stringify({ installationSecret: "C".repeat(43), deviceToken: "d".repeat(64), environment: "sandbox", appId: devAppId, appVersion: "1.0.0+1" }),
    });
    expect((await handleRequest(registration, env, now)).status).toBe(204);

    await env.DB.prepare(
      "INSERT INTO brief_push_batches (brief_date, status, created_at, updated_at) VALUES (?, 'queued', ?, ?)",
    ).bind("2026-07-18", now.toISOString(), now.toISOString()).run();
    const failedQueue = queueWithSend(async () => {
      throw new Error("QUEUE_SEND_FAILED");
    });
    await expect(processPushFanout(
      { DB: env.DB, BRIEF_PUSH_QUEUE: failedQueue },
      { kind: "brief-push-fanout", briefDate: "2026-07-18" },
      now,
    )).rejects.toThrow("QUEUE_SEND_FAILED");
    const existing = await env.DB.prepare(
      "SELECT id, subscription_id, status FROM brief_push_deliveries WHERE brief_date = ?",
    ).bind("2026-07-18").first<{ id: string; subscription_id: string; status: string }>();
    expect(existing).toMatchObject({ status: "queued" });
    expect(await createPushDelivery(env.DB, {
      id: existing!.id,
      briefDate: "2026-07-18",
      subscriptionId: existing!.subscription_id,
      now: now.toISOString(),
    })).toBe(false);

    const sent: unknown[] = [];
    const recoveredQueue = queueWithSend(async (body: unknown) => {
      sent.push(body);
      return { metadata: { metrics: emptyQueueMetrics } };
    });
    await processPushFanout(
      { DB: env.DB, BRIEF_PUSH_QUEUE: recoveredQueue },
      { kind: "brief-push-fanout", briefDate: "2026-07-18" },
      now,
      true,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "brief-push-delivery",
      deliveryId: existing!.id,
      briefDate: "2026-07-18",
    });
  });
});
