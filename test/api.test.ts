import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

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

describe("public API", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM item_explorations; DELETE FROM exploration_daily_usage; DELETE FROM brief_audio; DELETE FROM item_sources; DELETE FROM brief_items; DELETE FROM briefs; DELETE FROM entities;");
    await env.BRIEF_AUDIO.delete("briefs/2026-07-16/hash.wav");
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

  it("protects and idempotently queues the admin audio endpoint without public CORS", async () => {
    await replaceBrief(env.DB, draft());
    const unauthorized = await handleRequest(new Request("https://example.com/api/admin/brief-audio/2026-07-16", { method: "POST" }), env, now);
    expect(unauthorized.status).toBe(401);
    const request = () => new Request("https://example.com/api/admin/brief-audio/2026-07-16", { method: "POST", headers: { Authorization: "Bearer test-feedback-token" } });
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
    const headers = { Authorization: "Bearer test-feedback-token", "Content-Type": "application/json" };

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

    const read = await handleRequest(new Request(`https://example.com/api/feedback?entityId=${entityId}`, { headers }), env, now);
    expect(await read.json()).toEqual({ feedback: { [entityId]: "follow" } });

    const cleared = await handleRequest(new Request(`https://example.com/api/feedback/${entityId}`, { method: "DELETE", headers }), env, now);
    expect(cleared.status).toBe(204);
  });

  it("rejects unauthorized and invalid feedback requests with stable errors", async () => {
    const unauthorized = await handleRequest(new Request("https://example.com/api/feedback"), env, now);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("WWW-Authenticate")).toBe("Bearer");

    const headers = { Authorization: "Bearer test-feedback-token", "Content-Type": "application/json" };
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
