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
    await env.DB.exec("DELETE FROM item_sources; DELETE FROM brief_items; DELETE FROM briefs; DELETE FROM entities;");
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
});
