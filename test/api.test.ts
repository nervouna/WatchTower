import { env } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { handleRequest } from "../src/http/router";
import { replaceBrief, type BriefDraft } from "../src/storage/repository";

function draft(date = "2026-07-16"): BriefDraft {
  return {
    date,
    status: "complete",
    publishAt: `${date}T00:00:00.000Z`,
    generatedAt: `${date}T00:01:00.000Z`,
    headline: "今日开发者热点简报",
    intro: "今天的热点集中在开发工具与新产品发布，以下内容均来自当前候选资料并经过聚合整理，适合快速阅读。",
    missingSources: [],
    model: "deepseek-v4-flash",
    promptVersion: "v1",
    items: [
      {
        entity: { canonicalKey: `github:acme/${date}`, canonicalTitle: "Repo", canonicalUrl: "https://github.com/acme/repo", aliases: [] },
        title: "一个值得关注的新项目",
        summary: "这是一个面向开发者的新项目，提供清晰的核心能力与可验证的发布事实，当前资料表明它正在持续获得社区关注。",
        whyItMatters: "它降低了常见工作流门槛，并提供可以立即尝试的实际价值。",
        tags: ["开发工具", "开源"],
        continuity: { kind: "new" },
        sources: [{ candidateId: null, source: "github", kind: "platform", label: "GitHub", url: "https://github.com/acme/repo" }],
      },
    ],
  };
}

const now = new Date("2026-07-16T01:00:00.000Z");
let authHeader: { Authorization: string };
let deletedManagementUrl: string | null = null;
let managementDeleteStatus = 204;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(pair.publicKey);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "https://auth.test.invalid/.well-known/jwks.json") {
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid: "api-test", alg: "RS256", use: "sig" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://tenant.test.invalid/oauth/token") return Response.json({ access_token: "management-token" });
    if (url.startsWith("https://tenant.test.invalid/api/v2/users/")) {
      deletedManagementUrl = url;
      return new Response(null, { status: managementDeleteStatus });
    }
    throw new TypeError(`Unexpected fetch: ${url}`);
  });
  const epoch = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ azp: "test-web-client" })
    .setProtectedHeader({ alg: "RS256", kid: "api-test" })
    .setIssuer("https://auth.test.invalid/")
    .setAudience("https://watchtower.damao.io/api")
    .setSubject("apple|allowed-user")
    .setIssuedAt(epoch)
    .setExpirationTime(epoch + 3600)
    .sign(pair.privateKey);
  authHeader = { Authorization: `Bearer ${token}` };
});

describe("public API", () => {
  beforeEach(async () => {
    deletedManagementUrl = null;
    managementDeleteStatus = 204;
    await env.DB.exec("DELETE FROM feedback_allowlist; DELETE FROM entity_feedback; DELETE FROM item_explorations; DELETE FROM exploration_daily_usage; DELETE FROM brief_covers; DELETE FROM brief_audio; DELETE FROM item_sources; DELETE FROM brief_items; DELETE FROM briefs; DELETE FROM entities;");
    await env.DB.prepare("INSERT INTO feedback_allowlist (user_id, note, created_at) VALUES (?, NULL, ?)").bind("apple|allowed-user", now.toISOString()).run();
    await env.BRIEF_AUDIO.delete("briefs/2026-07-16/hash.wav");
    await env.BRIEF_AUDIO.delete("briefs/2026-07-16/hash.cover");
  });

  it("returns latest published brief with public caching, CORS, and ETag", async () => {
    await replaceBrief(env.DB, draft());
    const response = await handleRequest(new Request("https://example.com/api/briefs/latest"), env, now);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300, stale-while-revalidate=3600");
    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]+"$/u);
    expect(await response.json()).toMatchObject({ date: "2026-07-16", status: "complete" });
  });

  it("returns public Auth0 config and user capabilities without exposing management credentials", async () => {
    const config = await handleRequest(new Request("https://example.com/api/auth/config"), env, now);
    expect(config.status).toBe(200);
    expect(config.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await config.json()).toMatchObject({ connection: "apple", clientIds: { web: "test-web-client" } });
    const me = await handleRequest(new Request("https://example.com/api/auth/me", { headers: authHeader }), env, now);
    expect(me.status).toBe(200);
    expect(me.headers.get("Cache-Control")).toBe("no-store");
    expect(me.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await me.json()).toEqual({ user: { id: "apple|allowed-user" }, capabilities: { feedback: true, audioRetry: true } });
  });

  it("keeps a valid non-allowlisted session but rejects capability APIs", async () => {
    await env.DB.prepare("DELETE FROM feedback_allowlist WHERE user_id = ?").bind("apple|allowed-user").run();
    const me = await handleRequest(new Request("https://example.com/api/auth/me", { headers: authHeader }), env, now);
    expect(await me.json()).toMatchObject({ capabilities: { feedback: false, audioRetry: false } });
    const feedback = await handleRequest(new Request("https://example.com/api/feedback", { headers: authHeader }), env, now);
    expect(feedback.status).toBe(403);
    expect(await feedback.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("deletes only the authenticated account and clears local audit identity", async () => {
    await replaceBrief(env.DB, draft());
    const brief = await handleRequest(new Request("https://example.com/api/briefs/latest"), env, now);
    const entityId = ((await brief.json()) as { items: Array<{ entityId: string }> }).items[0]!.entityId;
    await env.DB.prepare("INSERT INTO entity_feedback (entity_id, feedback, source_brief_date, created_at, updated_at, updated_by_user_id) VALUES (?, 'follow', '2026-07-16', ?, ?, ?)").bind(entityId, now.toISOString(), now.toISOString(), "apple|allowed-user").run();
    const response = await handleRequest(new Request("https://example.com/api/auth/account", {
      method: "DELETE",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "apple|someone-else" }),
    }), env, now);
    expect(response.status).toBe(204);
    expect(deletedManagementUrl).toBe("https://tenant.test.invalid/api/v2/users/apple%7Callowed-user");
    expect(await env.DB.prepare("SELECT 1 FROM feedback_allowlist WHERE user_id = ?").bind("apple|allowed-user").first()).toBeNull();
    expect(await env.DB.prepare("SELECT updated_by_user_id FROM entity_feedback WHERE entity_id = ?").bind(entityId).first()).toEqual({ updated_by_user_id: null });
  });

  it("treats an already-missing Auth0 user as deleted and stabilizes other upstream failures", async () => {
    managementDeleteStatus = 404;
    expect((await handleRequest(new Request("https://example.com/api/auth/account", { method: "DELETE", headers: authHeader }), env, now)).status).toBe(204);
    await env.DB.prepare("INSERT INTO feedback_allowlist (user_id, note, created_at) VALUES (?, NULL, ?)").bind("apple|allowed-user", now.toISOString()).run();
    managementDeleteStatus = 500;
    const failed = await handleRequest(new Request("https://example.com/api/auth/account", { method: "DELETE", headers: authHeader }), env, now);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ error: { code: "ACCOUNT_DELETE_FAILED" } });
  });

  it("returns 304 for a matching ETag and an empty body for HEAD", async () => {
    await replaceBrief(env.DB, draft());
    const first = await handleRequest(new Request("https://example.com/api/briefs/latest"), env, now);
    const etag = first.headers.get("ETag")!;
    const cached = await handleRequest(new Request("https://example.com/api/briefs/latest", { headers: { "If-None-Match": etag } }), env, now);
    expect(cached.status).toBe(304);
    const head = await handleRequest(new Request("https://example.com/api/briefs/latest", { method: "HEAD" }), env, now);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("distinguishes invalid and missing dates", async () => {
    const invalid = await handleRequest(new Request("https://example.com/api/briefs/2026-02-30"), env, now);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: { code: "INVALID_DATE", message: "日期必须是有效的 YYYY-MM-DD UTC 日期。" } });
    const missing = await handleRequest(new Request("https://example.com/api/briefs/2026-07-15"), env, now);
    expect(missing.status).toBe(404);
  });

  it("paginates summaries and rejects invalid limits and cursors", async () => {
    await replaceBrief(env.DB, draft("2026-07-15"));
    await replaceBrief(env.DB, draft("2026-07-16"));
    const first = await handleRequest(new Request("https://example.com/api/briefs?limit=1"), env, now);
    const payload = (await first.json()) as { briefs: Array<{ date: string }>; nextCursor: string };
    expect(payload.briefs[0]?.date).toBe("2026-07-16");
    const second = await handleRequest(new Request(`https://example.com/api/briefs?limit=1&cursor=${payload.nextCursor}`), env, now);
    expect(await second.json()).toMatchObject({ briefs: [{ date: "2026-07-15" }], nextCursor: null });
    expect((await handleRequest(new Request("https://example.com/api/briefs?limit=101"), env, now)).status).toBe(400);
    expect((await handleRequest(new Request("https://example.com/api/briefs?cursor=tampered"), env, now)).status).toBe(400);
  });

  it("rejects write methods", async () => {
    const response = await handleRequest(new Request("https://example.com/api/briefs/latest", { method: "POST" }), env, now);
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });

  it("streams ready audio with HEAD, ETag, CORS, and byte ranges", async () => {
    await replaceBrief(env.DB, draft());
    const bytes = new TextEncoder().encode("0123456789");
    await env.BRIEF_AUDIO.put("briefs/2026-07-16/hash.wav", bytes, { httpMetadata: { contentType: "audio/wav" } });
    await env.DB.prepare(
      `INSERT INTO brief_audio (brief_date, content_hash, status, script_json, object_key, duration_seconds, provider, model, voice, prompt_version, attempt_count, created_at, updated_at, generated_at)
       VALUES (?, ?, 'ready', ?, ?, 180, 'xiaomi-mimo', 'mimo-v2.5-tts', '冰糖', 'narration-v1', 1, ?, ?, ?)`
    ).bind("2026-07-16", "hash", JSON.stringify({ opening_zh: "开场", items: [], closing_zh: "结尾" }), "briefs/2026-07-16/hash.wav", now.toISOString(), now.toISOString(), now.toISOString()).run();
    const full = await handleRequest(new Request("https://example.com/api/briefs/2026-07-16/audio"), env, now);
    expect(full.status).toBe(200);
    expect(full.headers.get("Accept-Ranges")).toBe("bytes");
    expect(full.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(new TextDecoder().decode(await full.arrayBuffer())).toBe("0123456789");
    const range = await handleRequest(new Request("https://example.com/api/briefs/2026-07-16/audio", { headers: { Range: "bytes=2-5" } }), env, now);
    expect(range.status).toBe(206);
    expect(range.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(new TextDecoder().decode(await range.arrayBuffer())).toBe("2345");
    const head = await handleRequest(new Request("https://example.com/api/briefs/2026-07-16/audio", { method: "HEAD" }), env, now);
    expect(head.headers.get("Content-Length")).toBe("10");
    const cached = await handleRequest(new Request("https://example.com/api/briefs/2026-07-16/audio", { headers: { "If-None-Match": head.headers.get("ETag")! } }), env, now);
    expect(cached.status).toBe(304);
  });

  it("serves a ready cover with HEAD, ETag, CORS, and nosniff", async () => {
    await replaceBrief(env.DB, draft());
    const bytes = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    await env.BRIEF_AUDIO.put("briefs/2026-07-16/hash.cover", bytes, { httpMetadata: { contentType: "image/webp" } });
    await env.DB.prepare(
      `INSERT INTO brief_covers (brief_date, content_hash, status, object_key, provider, model, prompt_version, attempt_count, created_at, updated_at, generated_at)
       VALUES (?, ?, 'ready', ?, 'fal-ai', 'fal-ai/recraft/v3/text-to-image', 'podcast-cover-v1', 1, ?, ?, ?)`
    ).bind("2026-07-16", "hash", "briefs/2026-07-16/hash.cover", now.toISOString(), now.toISOString(), now.toISOString()).run();
    const full = await handleRequest(new Request("https://example.com/api/briefs/2026-07-16/cover"), env, now);
    expect(full.status).toBe(200);
    expect(full.headers.get("Content-Type")).toBe("image/webp");
    expect(full.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(full.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(bytes);
    const head = await handleRequest(new Request("https://example.com/api/briefs/2026-07-16/cover", { method: "HEAD" }), env, now);
    expect(head.headers.get("Content-Length")).toBe(String(bytes.byteLength));
    const cached = await handleRequest(new Request("https://example.com/api/briefs/2026-07-16/cover", { headers: { "If-None-Match": head.headers.get("ETag")! } }), env, now);
    expect(cached.status).toBe(304);
  });

  it("protects and idempotently queues audio retry without public CORS", async () => {
    await replaceBrief(env.DB, draft());
    const unauthorized = await handleRequest(new Request("https://example.com/api/briefs/2026-07-16/audio/retry", { method: "POST" }), env, now);
    expect(unauthorized.status).toBe(401);
    const request = () => new Request("https://example.com/api/briefs/2026-07-16/audio/retry", { method: "POST", headers: authHeader });
    const queued = await handleRequest(request(), env, now);
    expect(await queued.json()).toMatchObject({ briefDate: "2026-07-16", status: "queued" });
    expect(queued.headers.get("Cache-Control")).toBe("no-store");
    expect(queued.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await (await handleRequest(request(), env, now)).json()).toMatchObject({ status: "already-pending" });
  });

  it("protects and idempotently queues cover retry without public CORS", async () => {
    await replaceBrief(env.DB, draft());
    const unauthorized = await handleRequest(new Request("https://example.com/api/briefs/2026-07-16/cover/retry", { method: "POST" }), env, now);
    expect(unauthorized.status).toBe(401);
    const request = () => new Request("https://example.com/api/briefs/2026-07-16/cover/retry", { method: "POST", headers: authHeader });
    const queued = await handleRequest(request(), env, now);
    expect(await queued.json()).toMatchObject({ briefDate: "2026-07-16", status: "queued" });
    expect(queued.headers.get("Cache-Control")).toBe("no-store");
    expect(queued.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await (await handleRequest(request(), env, now)).json()).toMatchObject({ status: "already-pending" });
  });

  it("authenticates, stores, reads, replaces, and clears entity feedback without caching or CORS", async () => {
    await replaceBrief(env.DB, draft());
    const brief = await handleRequest(new Request("https://example.com/api/briefs/latest"), env, now);
    const entityId = ((await brief.json()) as { items: Array<{ entityId: string }> }).items[0]!.entityId;
    const headers = { ...authHeader, "Content-Type": "application/json" };

    const verify = await handleRequest(new Request("https://example.com/api/feedback", { headers }), env, now);
    expect(verify.status).toBe(200);
    expect(await verify.json()).toEqual({ feedback: {} });
    expect(verify.headers.get("Cache-Control")).toBe("no-store");
    expect(verify.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const saved = await handleRequest(new Request(`https://example.com/api/feedback/${entityId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ value: "follow", briefDate: "2026-07-16" }),
    }), env, now);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ entityId, value: "follow" });
    expect(await env.DB.prepare("SELECT updated_by_user_id FROM entity_feedback WHERE entity_id = ?").bind(entityId).first()).toEqual({ updated_by_user_id: "apple|allowed-user" });

    const read = await handleRequest(new Request(`https://example.com/api/feedback?entityId=${entityId}`, { headers }), env, now);
    expect(await read.json()).toEqual({ feedback: { [entityId]: "follow" } });

    const cleared = await handleRequest(new Request(`https://example.com/api/feedback/${entityId}`, { method: "DELETE", headers }), env, now);
    expect(cleared.status).toBe(204);
  });

  it("rejects unauthorized and invalid feedback requests with stable errors", async () => {
    const unauthorized = await handleRequest(new Request("https://example.com/api/feedback"), env, now);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("WWW-Authenticate")).toBe("Bearer");

    const headers = { ...authHeader, "Content-Type": "application/json" };
    const invalid = await handleRequest(new Request("https://example.com/api/feedback/entity_bad", {
      method: "PUT",
      headers,
      body: JSON.stringify({ value: "liked", briefDate: "2026-02-30" }),
    }), env, now);
    expect(invalid.status).toBe(400);

    const missing = await handleRequest(new Request("https://example.com/api/feedback/entity_00000000000000000000000000000000", {
      method: "PUT",
      headers,
      body: JSON.stringify({ value: "follow", briefDate: "2026-07-16" }),
    }), env, now);
    expect(missing.status).toBe(404);
  });
});
