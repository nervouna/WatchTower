import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExplorationEvidenceSource } from "../src/domain/types";
import { abandonExplorationJob, processExplorationJob } from "../src/exploration/jobs";
import {
  claimExplorationTrigger,
  claimExplorationWork,
  getExplorationRow,
  releaseExplorationForRetry,
  saveExplorationEvidence,
  type ExplorationJob,
} from "../src/exploration/repository";
import { getBrief, replaceBrief, type BriefDraft } from "../src/storage/repository";

const now = new Date("2026-07-18T01:00:00.000Z");
const evidence: ExplorationEvidenceSource[] = [
  { id: "source_01", title: "Official", url: "https://official.test/release", domain: "official.test", queryKind: "context", snippet: "Official evidence", score: 1 },
  { id: "source_02", title: "Review", url: "https://review.test/post", domain: "review.test", queryKind: "perspectives", snippet: "Review evidence", score: 0.9 },
  { id: "source_03", title: "Product", url: "https://product.test/post", domain: "product.test", queryKind: "products", snippet: "Product evidence", score: 0.8 },
  { id: "source_04", title: "Industry", url: "https://industry.test/post", domain: "industry.test", queryKind: "industry", snippet: "Industry evidence", score: 0.7 },
];
const valid = {
  overview: { text: "这是一个有公开资料支持的背景说明，涵盖项目定位、本次变化以及当前值得关注的具体原因。", sourceIds: ["source_01", "source_02"] },
  relatedProducts: [{ name: "Other", relation: "替代产品", summary: "该产品覆盖相似需求，但在集成方式与目标用户上存在可验证差异。", sourceIds: ["source_03"] }],
  perspectives: [{ label: "独立评测", summary: "评测认可它降低了使用门槛，同时对长期维护成本持保留意见。", sourceIds: ["source_02"] }],
  industry: { text: "它处在开发工具简化与自动化采用持续扩大的行业趋势中。", sourceIds: ["source_04"] },
  watchNext: [{ signal: "继续关注正式版本、定价变化与公开采用数据。", sourceIds: ["source_01"] }],
};

function draft(): BriefDraft {
  return {
    date: "2026-07-18", status: "complete", publishAt: "2026-07-18T00:00:00.000Z",
    generatedAt: "2026-07-18T00:01:00.000Z", headline: "热点", intro: "用于探索任务测试的已发布简报。",
    missingSources: [], model: "deepseek-v4-flash", promptVersion: "v1",
    items: [{
      entity: { canonicalKey: "github:acme/explore", canonicalTitle: "Acme", canonicalUrl: "https://github.com/acme/explore", aliases: [] },
      title: "Acme 发布更新", summary: "用于测试探索任务恢复行为的完整摘要内容。", whyItMatters: "验证证据复用。", tags: ["开发工具"], continuity: { kind: "new" },
      sources: [{ candidateId: null, source: "github", kind: "platform", label: "GitHub", url: "https://github.com/acme/explore" }],
    }],
  };
}

async function queuedJob(withEvidence: boolean): Promise<ExplorationJob> {
  await replaceBrief(env.DB, draft());
  const entityId = (await getBrief(env.DB, "2026-07-18", now.toISOString()))!.items[0]!.entityId;
  const job: ExplorationJob = { kind: "item-exploration", entityId, jobId: crypto.randomUUID() };
  const seed = { entityId, title: "Acme", summary: "Summary", whyItMatters: "Why", tags: [], canonicalUrl: "https://github.com/acme/explore", sourceUrls: [] };
  await claimExplorationTrigger(env.DB, seed, job.jobId, now.toISOString(), now.toISOString());
  if (withEvidence) {
    await claimExplorationWork(env.DB, job, now.toISOString(), now.toISOString());
    await saveExplorationEvidence(env.DB, job, evidence, 8, now.toISOString());
    await releaseExplorationForRetry(env.DB, job, now.toISOString());
  }
  return job;
}

function runtime() {
  return { DB: env.DB, TAVILY_API_KEY: "test-tavily", DEEPSEEK_API_KEY: "test-deepseek", ITEM_EXPLORATION_CACHE_TTL_HOURS: "24" as const };
}

describe("exploration jobs", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await env.DB.exec("DELETE FROM item_explorations; DELETE FROM exploration_daily_usage; DELETE FROM item_sources; DELETE FROM brief_items; DELETE FROM briefs; DELETE FROM entities;");
  });

  it("reuses saved evidence and skips Tavily on a manual synthesis retry", async () => {
    const job = await queuedJob(true);
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(valid) }, finish_reason: "stop" }], usage: { total_tokens: 21 } }));
    await processExplorationJob(runtime(), job, now);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("api.deepseek.com");
    expect(await getExplorationRow(env.DB, job.entityId)).toMatchObject({
      status: "ready", evidence_json: null, tavily_credits: 8, deepseek_tokens: 21,
      prompt_version: "exploration-v2-contract", query_version: "exploration-v2-bounded",
    });
  });

  it("preserves evidence, validation detail, and failed-call tokens after terminal synthesis failure", async () => {
    const job = await queuedJob(true);
    const invalid = { ...valid, overview: { text: "太短", sourceIds: ["source_01"] } };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(invalid) }, finish_reason: "stop" }], usage: { total_tokens: 11 } }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(invalid) }, finish_reason: "stop" }], usage: { total_tokens: 13 } }));
    let failure: unknown;
    try { await processExplorationJob(runtime(), job, now); } catch (error) { failure = error; }
    await abandonExplorationJob(env.DB, job, failure, now);
    expect(await getExplorationRow(env.DB, job.entityId)).toMatchObject({
      status: "failed",
      last_error_code: "DEEPSEEK_EXPLORATION_VALIDATION_FAILED:INVALID_OVERVIEW",
      deepseek_tokens: 24,
    });
    expect(JSON.parse((await getExplorationRow(env.DB, job.entityId))!.evidence_json!)).toHaveLength(4);
  });

  it("does not persist an empty evidence array for a genuine zero-result research run", async () => {
    const job = await queuedJob(false);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ results: [], usage: { credits: 1 } }));
    let failure: unknown;
    try { await processExplorationJob(runtime(), job, now); } catch (error) { failure = error; }
    await abandonExplorationJob(env.DB, job, failure, now);
    expect(await getExplorationRow(env.DB, job.entityId)).toMatchObject({
      status: "failed", last_error_code: "EXPLORATION_INSUFFICIENT_EVIDENCE", evidence_json: null, tavily_credits: 4,
    });
  });
});
