import { env } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { handleRequest } from "../src/http/router";

let authHeader: { Authorization: string };

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(pair.publicKey);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input) === "https://auth.test.invalid/.well-known/jwks.json") {
      return Response.json({ keys: [{ ...jwk, kid: "environment-test", alg: "RS256", use: "sig" }] });
    }
    throw new TypeError(`Unexpected fetch: ${String(input)}`);
  });
  const epoch = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ azp: "test-web-client" })
    .setProtectedHeader({ alg: "RS256", kid: "environment-test" })
    .setIssuer("https://auth.test.invalid/")
    .setAudience("https://watchtower.damao.io/api")
    .setSubject("apple|dev-operator")
    .setIssuedAt(epoch)
    .setExpirationTime(epoch + 3600)
    .sign(pair.privateKey);
  authHeader = { Authorization: `Bearer ${token}` };
});

beforeEach(async () => {
  await env.DB.exec("DELETE FROM dev_pipeline_runs; DELETE FROM feedback_allowlist;");
  await env.DB.prepare("INSERT INTO feedback_allowlist (user_id, note, created_at) VALUES (?, NULL, ?)")
    .bind("apple|dev-operator", "2026-07-19T00:00:00.000Z").run();
});

describe("deployment environment contract", () => {
  it("returns only safe, uncached Worker metadata", async () => {
    const response = await handleRequest(new Request("https://example.com/api/meta"), {
      ...env,
      DEPLOYMENT_ENV: "dev",
      VERSION_METADATA: { id: "version-id", tag: "git-abc123", timestamp: "2026-07-19T01:02:03.000Z" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      environment: "dev",
      workerVersionId: "version-id",
      workerVersionTag: "git-abc123",
      deployedAt: "2026-07-19T01:02:03.000Z",
    });
  });

  it("hides the Dev pipeline API in production", async () => {
    const response = await handleRequest(new Request("https://example.com/api/dev/pipeline-runs", { method: "POST" }), {
      ...env,
      DEPLOYMENT_ENV: "production",
      ACCOUNT_DELETION_ENABLED: "true",
      VERSION_METADATA: { id: "prod", tag: "git-prod", timestamp: "2026-07-19T00:00:00.000Z" },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "API_NOT_FOUND" } });
  });

  it("protects, authorizes, validates, and idempotently queues a Dev pipeline run", async () => {
    const sent: unknown[] = [];
    const devEnv = {
      ...env,
      DEPLOYMENT_ENV: "dev" as const,
      ACCOUNT_DELETION_ENABLED: "false" as const,
      VERSION_METADATA: { id: "dev", tag: "git-candidate", timestamp: "2026-07-19T00:00:00.000Z" },
      DEV_PIPELINE_QUEUE: { send: async (body: unknown) => { sent.push(body); } },
    } as unknown as Env;
    const endpoint = "https://example.com/api/dev/pipeline-runs";
    const request = () => new Request(endpoint, {
      method: "POST", headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ stage: "final", targetDate: "2026-07-19" }),
    });
    expect((await handleRequest(new Request(endpoint, { method: "POST" }), devEnv)).status).toBe(401);
    await env.DB.prepare("DELETE FROM feedback_allowlist WHERE user_id = ?").bind("apple|dev-operator").run();
    expect((await handleRequest(request(), devEnv)).status).toBe(403);
    await env.DB.prepare("INSERT INTO feedback_allowlist (user_id, note, created_at) VALUES (?, NULL, ?)")
      .bind("apple|dev-operator", "2026-07-19T00:00:00.000Z").run();

    const invalid = await handleRequest(new Request(endpoint, {
      method: "POST", headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ stage: "force", targetDate: "2026-07-19" }),
    }), devEnv);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "INVALID_DEV_PIPELINE_RUN" } });

    const queued = await handleRequest(request(), devEnv);
    expect(queued.status).toBe(202);
    const body = await queued.json() as { runId: string };
    expect(body).toMatchObject({ status: "queued", pollAfterSeconds: 3, acceptedNewAttempt: true });
    expect(sent).toHaveLength(1);

    const duplicate = await handleRequest(request(), devEnv);
    expect(duplicate.status).toBe(202);
    expect(await duplicate.json()).toMatchObject({ runId: body.runId, status: "queued", acceptedNewAttempt: false });
    expect(sent).toHaveLength(1);

    const status = await handleRequest(new Request(`${endpoint}/${body.runId}`, { headers: authHeader }), devEnv);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ runId: body.runId, stage: "final", targetDate: "2026-07-19", workerVersionTag: "git-candidate" });
  });

  it("disables account deletion before changing local data in Dev", async () => {
    const response = await handleRequest(new Request("https://example.com/api/auth/account", {
      method: "DELETE", headers: authHeader,
    }), { ...env, DEPLOYMENT_ENV: "dev", ACCOUNT_DELETION_ENABLED: "false" } as Env);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "ACCOUNT_DELETION_DISABLED" } });
    expect(await env.DB.prepare("SELECT 1 FROM feedback_allowlist WHERE user_id = ?").bind("apple|dev-operator").first()).not.toBeNull();
  });
});
