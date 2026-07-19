import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runPipelineStage, type PipelineDependencies } from "../src/ingestion/pipeline";
import type { GeneratedBrief, SearchCandidate, SourceKind } from "../src/domain/types";

function candidate(source: SourceKind, evidenceSuffix = ""): SearchCandidate {
  const urls: Record<SourceKind, string> = {
    "hacker-news": "https://news.ycombinator.com/item?id=1",
    "product-hunt": "https://www.producthunt.com/posts/example",
    github: "https://github.com/acme/example",
    kickstarter: "https://www.kickstarter.com/projects/acme/example",
  };
  return {
    source,
    title: `${source} example project`,
    platformUrl: urls[source],
    canonicalKey: `${source}:example`,
    canonicalUrl: urls[source],
    snippet: `Current evidence for ${source}${evidenceSuffix}`,
    score: 0.9,
    rank: 1,
  };
}

const generated: GeneratedBrief = {
  headline_zh: "今日开发者热点简报",
  intro_zh: "今天的热点集中在开发工具与新产品发布，以下内容来自多个平台的当前候选资料并经过聚合整理，适合快速阅读。",
  items: [
    {
      candidate_ids: [],
      existing_entity_id: null,
      title_zh: "多平台关注的新开发项目",
      summary_zh: "这是一个面向开发者的新项目，提供清晰的核心能力与可验证的公开发布事实，当前候选资料表明它正在获得多个平台的持续关注。",
      why_it_matters_zh: "它降低了常见工作流门槛，并提供可以立即尝试的实际产品价值。",
      tags_zh: ["开发工具", "新品"],
      update_kind: "new",
      material_change_zh: null,
    },
  ],
};

function dependencies(
  failing: SourceKind[] = [],
  evidenceSuffix = "",
  empty: SourceKind[] = [],
): PipelineDependencies {
  return {
    search: vi.fn(async (_key, source) => {
      if (failing.includes(source)) throw new Error("SEARCH_FAILED");
      if (empty.includes(source)) return { candidates: [], credits: 2, requestId: `req-${source}` };
      return { candidates: [candidate(source, evidenceSuffix)], credits: 2, requestId: `req-${source}` };
    }),
    extract: vi.fn(async (_key: string, candidates: readonly SearchCandidate[]) => ({
      evidence: new Map(candidates.map((entry) => [entry.platformUrl, entry.snippet])),
      credits: candidates.length,
    })),
    generate: vi.fn(async (_key: string, _targetDate: string, candidates: readonly import("../src/domain/types").StoredCandidate[]) => ({
      brief: { ...generated, items: [{ ...generated.items[0]!, candidate_ids: candidates.map((entry) => entry.id) }] },
      repaired: false,
      totalTokens: 100,
    })),
  };
}

describe("scheduled pipeline", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM item_sources; DELETE FROM brief_items; DELETE FROM briefs; DELETE FROM entities; DELETE FROM candidates; DELETE FROM ingestion_runs;");
  });

  it("collects all sources without generating a brief", async () => {
    const deps = dependencies();
    const result = await runPipelineStage(env, { stage: "collect", targetDate: "2026-07-16", scheduledTime: Date.UTC(2026, 6, 15, 21) }, deps);
    expect(result).toMatchObject({ outcome: "collected", successfulSources: 4 });
    expect(deps.generate).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM candidates").first("count")).toBe(4);
  });

  it("publishes a future-dated partial backup with three successful sources", async () => {
    const result = await runPipelineStage(
      env,
      { stage: "draft", targetDate: "2026-07-16", scheduledTime: Date.UTC(2026, 6, 15, 22, 30) },
      dependencies(["kickstarter"]),
    );
    expect(result).toMatchObject({ outcome: "published", status: "partial" });
    const row = await env.DB.prepare("SELECT status, publish_at FROM briefs").first<{ status: string; publish_at: string }>();
    expect(row).toEqual({ status: "partial", publish_at: "2026-07-16T00:00:00.000Z" });
  });

  it("publishes a partial brief when only Hacker News and Product Hunt succeed", async () => {
    const result = await runPipelineStage(
      env,
      { stage: "final", targetDate: "2026-07-16", scheduledTime: Date.UTC(2026, 6, 15, 23, 30) },
      dependencies(["github", "kickstarter"]),
    );
    expect(result).toMatchObject({ outcome: "published", status: "partial", successfulSources: 2 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM briefs").first("count")).toBe(1);
  });

  it("publishes a partial brief from one usable source", async () => {
    const result = await runPipelineStage(
      env,
      { stage: "final", targetDate: "2026-07-16", scheduledTime: Date.UTC(2026, 6, 15, 23, 30) },
      dependencies(["product-hunt", "github", "kickstarter"]),
    );
    expect(result).toMatchObject({ outcome: "published", status: "partial", successfulSources: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM briefs").first("count")).toBe(1);
  });

  it("does not count empty normalized search results as successful sources", async () => {
    const deps = dependencies([], "", ["hacker-news", "product-hunt", "github", "kickstarter"]);
    const result = await runPipelineStage(
      env,
      { stage: "final", targetDate: "2026-07-16", scheduledTime: Date.UTC(2026, 6, 15, 23, 30) },
      deps,
    );
    expect(result).toMatchObject({ outcome: "no-candidates", successfulSources: 0 });
    expect(deps.generate).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM briefs").first("count")).toBe(0);
    expect(await env.DB.prepare("SELECT error_code FROM ingestion_runs ORDER BY id DESC LIMIT 1").first("error_code"))
      .toBe("NO_USABLE_CANDIDATES");
  });

  it("uses candidates saved by collect when every draft refresh fails", async () => {
    await runPipelineStage(
      env,
      { stage: "collect", targetDate: "2026-07-16", scheduledTime: Date.UTC(2026, 6, 15, 21) },
      dependencies(),
    );
    const deps = dependencies(["hacker-news", "product-hunt", "github", "kickstarter"]);
    const result = await runPipelineStage(
      env,
      { stage: "draft", targetDate: "2026-07-16", scheduledTime: Date.UTC(2026, 6, 15, 22, 30) },
      deps,
    );
    expect(result).toMatchObject({ outcome: "published", status: "partial", successfulSources: 0 });
    expect(vi.mocked(deps.generate).mock.calls[0]?.[1]).toBe("2026-07-16");
    expect(vi.mocked(deps.generate).mock.calls[0]?.[2]).toEqual(
      expect.arrayContaining([expect.objectContaining({ targetDate: "2026-07-16" })]),
    );
  });

  it("never persists a generated brief with zero items", async () => {
    const deps = dependencies();
    vi.mocked(deps.generate).mockResolvedValue({
      brief: { ...generated, items: [] },
      repaired: false,
      totalTokens: 100,
    });
    const result = await runPipelineStage(
      env,
      { stage: "draft", targetDate: "2026-07-16", scheduledTime: Date.UTC(2026, 6, 15, 22, 30) },
      deps,
    );
    expect(result).toMatchObject({ outcome: "model-failed", errorCode: "EMPTY_GENERATED_BRIEF" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM briefs").first("count")).toBe(0);
  });

  it("publishes partial when one successful search returns no usable candidates", async () => {
    const result = await runPipelineStage(
      env,
      { stage: "draft", targetDate: "2026-07-16", scheduledTime: Date.UTC(2026, 6, 15, 22, 30) },
      dependencies([], "", ["kickstarter"]),
    );
    expect(result).toMatchObject({ outcome: "published", status: "partial", successfulSources: 3 });
    const row = await env.DB.prepare("SELECT status, missing_sources_json FROM briefs").first<{
      status: string;
      missing_sources_json: string;
    }>();
    expect(row).toEqual({ status: "partial", missing_sources_json: '["kickstarter"]' });
  });

  it("preserves a valid draft when the final model call fails", async () => {
    await runPipelineStage(
      env,
      { stage: "draft", targetDate: "2026-07-16", scheduledTime: Date.UTC(2026, 6, 15, 22, 30) },
      dependencies(),
    );
    const deps = dependencies([], " with a material update");
    vi.mocked(deps.generate).mockRejectedValue(new Error("MODEL_FAILED"));
    const result = await runPipelineStage(
      env,
      { stage: "final", targetDate: "2026-07-16", scheduledTime: Date.UTC(2026, 6, 15, 23, 30) },
      deps,
    );
    expect(result).toMatchObject({ outcome: "kept-existing", errorCode: "MODEL_FAILED" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM briefs").first("count")).toBe(1);
  });

  it("keeps an unchanged draft without another model call", async () => {
    await runPipelineStage(
      env,
      { stage: "draft", targetDate: "2026-07-16", scheduledTime: Date.UTC(2026, 6, 15, 22, 30) },
      dependencies(),
    );
    const deps = dependencies();
    const result = await runPipelineStage(
      env,
      { stage: "final", targetDate: "2026-07-16", scheduledTime: Date.UTC(2026, 6, 15, 23, 30) },
      deps,
    );
    expect(result).toMatchObject({ outcome: "unchanged-noop", status: "complete" });
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it("makes recovery a no-op for a complete brief", async () => {
    await runPipelineStage(
      env,
      { stage: "final", targetDate: "2026-07-16", scheduledTime: Date.UTC(2026, 6, 15, 23, 30) },
      dependencies(),
    );
    const deps = dependencies();
    const result = await runPipelineStage(
      env,
      { stage: "recovery", targetDate: "2026-07-16", scheduledTime: Date.UTC(2026, 6, 16, 0, 30) },
      deps,
    );
    expect(result.outcome).toBe("complete-noop");
    expect(deps.search).not.toHaveBeenCalled();
  });
});
