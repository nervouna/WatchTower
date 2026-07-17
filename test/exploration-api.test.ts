import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleExplorationRequest } from "../src/exploration/http";
import type { ExplorationJob } from "../src/exploration/repository";
import { getBrief, replaceBrief, type BriefDraft } from "../src/storage/repository";

const now = new Date("2026-07-16T01:00:00.000Z");

function draft(): BriefDraft {
  return {
    date: "2026-07-16", status: "complete", publishAt: "2026-07-16T00:00:00.000Z",
    generatedAt: "2026-07-16T00:01:00.000Z", headline: "热点", intro: "今天的热点资料已经整理完成，可用于验证拓展阅读接口行为。",
    missingSources: [], model: "deepseek-v4-flash", promptVersion: "v1",
    items: [{
      entity: { canonicalKey: "github:acme/explore", canonicalTitle: "Acme", canonicalUrl: "https://github.com/acme/explore", aliases: [] },
      title: "Acme 发布重要更新", summary: "这是一个用于测试拓展阅读的热点摘要，包含足够的背景信息与明确的当前变化。",
      whyItMatters: "它验证了结构化研究摘要的端到端触发流程。", tags: ["开发工具", "开源"], continuity: { kind: "new" },
      sources: [{ candidateId: null, source: "github", kind: "platform", label: "GitHub", url: "https://github.com/acme/explore" }],
    }],
  };
}

async function target(): Promise<string> {
  await replaceBrief(env.DB, draft());
  return (await getBrief(env.DB, "2026-07-16", now.toISOString()))!.items[0]!.entityId;
}

function runtime(overrides: { rate?: boolean; send?: (job: ExplorationJob) => Promise<void>; limit?: string } = {}) {
  const send = vi.fn(overrides.send ?? (async () => {}));
  return {
    value: {
      DB: env.DB,
      ITEM_EXPLORATION_QUEUE: { send } as unknown as Queue<ExplorationJob>,
      EXPLORATION_RATE_LIMITER: { limit: async () => ({ success: overrides.rate ?? true }) },
      ITEM_EXPLORATION_ENABLED: "true",
      ITEM_EXPLORATION_DAILY_TAVILY_CREDITS: overrides.limit ?? "120",
      ITEM_EXPLORATION_CREDIT_RESERVATION: "12",
    },
    send,
  };
}

describe("exploration API", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM item_explorations; DELETE FROM exploration_daily_usage; DELETE FROM item_sources; DELETE FROM brief_items; DELETE FROM briefs; DELETE FROM entities;");
  });

  it("supports CORS preflight and rejects unpublished or mismatched targets", async () => {
    const entityId = await target();
    const config = runtime().value;
    const options = await handleExplorationRequest(new Request("https://example.com", { method: "OPTIONS" }), config, "2026-07-16", entityId, now);
    expect(options.status).toBe(204);
    expect(options.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect((await handleExplorationRequest(new Request("https://example.com"), config, "2026-07-15", entityId, now)).status).toBe(404);
    expect((await handleExplorationRequest(new Request("https://example.com"), config, "2026-02-30", entityId, now)).status).toBe(400);
  });

  it("idempotently reserves and queues one job, then returns the same pending resource", async () => {
    const entityId = await target();
    const config = runtime();
    const request = () => new Request("https://example.com", { method: "POST", headers: { "CF-Connecting-IP": "192.0.2.1" } });
    const first = await handleExplorationRequest(request(), config.value, "2026-07-16", entityId, now);
    const second = await handleExplorationRequest(request(), config.value, "2026-07-16", entityId, now);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(config.send).toHaveBeenCalledTimes(1);
    const usage = await env.DB.prepare("SELECT reserved_credits, jobs_started FROM exploration_daily_usage").first();
    expect(usage).toEqual({ reserved_credits: 12, jobs_started: 1 });
  });

  it("returns stable rate and budget errors without queueing", async () => {
    const entityId = await target();
    const limited = runtime({ rate: false });
    const rate = await handleExplorationRequest(new Request("https://example.com", { method: "POST" }), limited.value, "2026-07-16", entityId, now);
    expect(rate.status).toBe(429);
    expect(rate.headers.get("Retry-After")).toBe("60");
    await env.DB.exec("DELETE FROM item_explorations; DELETE FROM exploration_daily_usage;");
    await env.DB.prepare("INSERT INTO exploration_daily_usage (usage_date, reserved_credits, created_at, updated_at) VALUES (?, 120, ?, ?)")
      .bind("2026-07-16", now.toISOString(), now.toISOString()).run();
    const budgeted = runtime();
    const budget = await handleExplorationRequest(new Request("https://example.com", { method: "POST" }), budgeted.value, "2026-07-16", entityId, now);
    expect(budget.status).toBe(429);
    expect(await budget.json()).toMatchObject({ error: { code: "EXPLORATION_BUDGET_EXHAUSTED" } });
    expect(budgeted.send).not.toHaveBeenCalled();
  });

  it("returns a cacheable ready payload with ETag", async () => {
    const entityId = await target();
    const generatedAt = now.toISOString();
    await env.DB.prepare(
      `INSERT INTO item_explorations (entity_id, title, status, quality, content_json, source_catalog_json, generated_at, expires_at, created_at, updated_at)
       VALUES (?, 'Acme', 'ready', 'partial', ?, ?, ?, ?, ?, ?)`,
    ).bind(entityId, JSON.stringify({ overview: { text: "已有公开资料支持的背景说明，能够直接作为缓存结果返回给多个匿名客户端复用。", sourceIds: ["source_01"] }, relatedProducts: [], perspectives: [], industry: null, watchNext: [] }),
      JSON.stringify([{ id: "source_01", title: "Source", url: "https://example.com", domain: "example.com", queryKind: "context" }]),
      generatedAt, "2026-07-17T01:00:00.000Z", generatedAt, generatedAt).run();
    const config = runtime().value;
    const response = await handleExplorationRequest(new Request("https://example.com"), config, "2026-07-16", entityId, now);
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]+"$/u);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
  });
});
