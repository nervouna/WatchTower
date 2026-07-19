import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GeneratedBrief, StoredCandidate } from "../src/domain/types";
import { processBriefRegenerationJob, type RegenerationDependencies } from "../src/regeneration/jobs";
import {
  getBrief,
  getBriefRegeneration,
  queueBriefRegeneration,
  replaceBrief,
  upsertCandidates,
  type BriefDraft,
} from "../src/storage/repository";

const date = "2026-07-16";
const now = new Date("2026-07-19T01:00:00.000Z");

function draft(): BriefDraft {
  return {
    date,
    status: "partial",
    publishAt: "2026-07-16T00:15:00.000Z",
    generatedAt: "2026-07-16T00:20:00.000Z",
    headline: "旧的每日热点简报标题",
    intro: "这是旧的单日简报导语，内容来自当日保存的候选资料，并且保持足够长度以用于重生成失败后的保留断言。",
    missingSources: ["product-hunt"],
    model: "deepseek-v4-flash",
    promptVersion: "v2-feedback",
    items: [{
      entity: {
        canonicalKey: "github:acme/repo",
        canonicalTitle: "Acme Repo",
        canonicalUrl: "https://github.com/acme/repo",
        aliases: ["Acme Repo"],
      },
      title: "旧条目标题",
      summary: "这是旧简报中的项目摘要，它会在模型失败时完整保留，避免历史重生成破坏已经发布并且仍然有效的线上内容。",
      whyItMatters: "这项能力用于证明失败路径不会覆盖线上有效内容。",
      tags: ["开发工具", "开源"],
      continuity: { kind: "new" },
      sources: [{ candidateId: null, source: "github", kind: "platform", label: "GitHub", url: "https://github.com/acme/repo" }],
    }],
  };
}

const generated: GeneratedBrief = {
  headline_zh: "今日开发者热点简报更新",
  intro_zh: "今天的热点集中在开发工具与新产品发布，以下内容来自该日期保存的候选证据并经过重新聚合整理，适合快速阅读。",
  items: [{
    candidate_ids: ["candidate_saved"],
    existing_entity_id: null,
    title_zh: "重新生成后的项目标题",
    summary_zh: "这是依据历史日期已经保存的真实候选证据重新生成的项目摘要，内容覆盖公开发布事实、核心能力和开发者可以验证的实际变化。",
    why_it_matters_zh: "它证明重生成只依赖当日存量证据，并保留原有发布元数据。",
    tags_zh: ["开发工具", "开源"],
    update_kind: "new",
    material_change_zh: null,
  }],
};

async function seed(): Promise<void> {
  await replaceBrief(env.DB, draft());
  await upsertCandidates(env.DB, [{
    id: "candidate_saved",
    targetDate: date,
    source: "github",
    title: "Acme Repo",
    platformUrl: "https://github.com/acme/repo",
    canonicalKey: "github:acme/repo",
    canonicalUrl: "https://github.com/acme/repo",
    originalUrl: null,
    snippet: "Saved search evidence",
    extractedContent: "Saved extracted evidence used by DeepSeek for the historical brief.",
    score: 0.9,
    rank: 1,
    contentHash: "saved-hash",
  }], now.toISOString());
}

function dependencies(generate: RegenerationDependencies["generate"]): RegenerationDependencies {
  return {
    generate,
    enqueueAudio: vi.fn<RegenerationDependencies["enqueueAudio"]>(async () => "queued"),
    enqueueCover: vi.fn<RegenerationDependencies["enqueueCover"]>(async () => "queued"),
  };
}

describe("brief regeneration job", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM brief_regenerations; DELETE FROM brief_covers; DELETE FROM brief_audio; DELETE FROM item_sources; DELETE FROM brief_items; DELETE FROM briefs; DELETE FROM entities; DELETE FROM candidates;");
  });

  it("replaces text atomically, preserves publication metadata, and queues only audio and cover", async () => {
    await seed();
    await queueBriefRegeneration(env.DB, date, "job-success", "apple|owner", now.toISOString());
    const deps = dependencies(vi.fn(async (_key: string, targetDate: string, candidates: readonly StoredCandidate[]) => {
      expect(targetDate).toBe(date);
      expect(candidates.map((candidate) => candidate.id)).toEqual(["candidate_saved"]);
      return { brief: generated, repaired: false, totalTokens: 100 };
    }));

    expect(await processBriefRegenerationJob(env, { kind: "brief-regeneration", briefDate: date, jobId: "job-success" }, now, false, deps)).toBe("succeeded");
    const brief = await getBrief(env.DB, date, now.toISOString());
    expect(brief).toMatchObject({
      status: "partial",
      publishedAt: "2026-07-16T00:15:00.000Z",
      headline: generated.headline_zh,
      missingSources: ["product-hunt"],
    });
    expect(await env.DB.prepare("SELECT prompt_version FROM briefs WHERE brief_date = ?").bind(date).first("prompt_version")).toBe("v3-daily-date");
    expect(deps.enqueueAudio).toHaveBeenCalledOnce();
    expect(deps.enqueueCover).toHaveBeenCalledOnce();
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM brief_push_batches").first("count")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM brief_push_deliveries").first("count")).toBe(0);
    expect(await getBriefRegeneration(env.DB, date)).toMatchObject({ status: "succeeded", attempt_count: 1, error_code: null });
  });

  it("keeps the existing brief and derived rows unchanged when generation fails", async () => {
    await seed();
    await env.DB.prepare(
      `INSERT INTO brief_audio (brief_date, content_hash, status, provider, model, voice, prompt_version, created_at, updated_at)
       VALUES (?, 'old-audio', 'ready', 'xiaomi-mimo', 'mimo-v2.5-tts', '冰糖', 'narration-v2-adaptive', ?, ?)`,
    ).bind(date, now.toISOString(), now.toISOString()).run();
    await env.DB.prepare(
      `INSERT INTO brief_covers (brief_date, content_hash, status, provider, model, prompt_version, created_at, updated_at)
       VALUES (?, 'old-cover', 'ready', 'fal-ai', 'fal-ai/recraft/v3/text-to-image', 'podcast-cover-v2-bounded', ?, ?)`,
    ).bind(date, now.toISOString(), now.toISOString()).run();
    await queueBriefRegeneration(env.DB, date, "job-failed", "apple|owner", now.toISOString());
    const deps = dependencies(vi.fn(async () => { throw new Error("DEEPSEEK_TIMEOUT"); }));

    expect(await processBriefRegenerationJob(env, { kind: "brief-regeneration", briefDate: date, jobId: "job-failed" }, now, false, deps)).toBe("failed");
    expect((await getBrief(env.DB, date, now.toISOString()))?.headline).toBe("旧的每日热点简报标题");
    expect(await env.DB.prepare("SELECT content_hash, status FROM brief_audio WHERE brief_date = ?").bind(date).first()).toEqual({ content_hash: "old-audio", status: "ready" });
    expect(await env.DB.prepare("SELECT content_hash, status FROM brief_covers WHERE brief_date = ?").bind(date).first()).toEqual({ content_hash: "old-cover", status: "ready" });
    expect(deps.enqueueAudio).not.toHaveBeenCalled();
    expect(deps.enqueueCover).not.toHaveBeenCalled();
    expect(await getBriefRegeneration(env.DB, date)).toMatchObject({ status: "failed", error_code: "DEEPSEEK_TIMEOUT" });
  });

  it("safely ignores a stale or already-finished job id", async () => {
    await seed();
    await queueBriefRegeneration(env.DB, date, "active-job", "apple|owner", now.toISOString());
    const deps = dependencies(vi.fn());
    expect(await processBriefRegenerationJob(env, { kind: "brief-regeneration", briefDate: date, jobId: "stale-job" }, now, false, deps)).toBe("ignored");
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it("creates only one active job under concurrent requests", async () => {
    await seed();
    const jobs = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      queueBriefRegeneration(env.DB, date, `job-${String(index)}`, "apple|owner", now.toISOString())));
    expect(new Set(jobs.map((job) => job.row.job_id))).toHaveLength(1);
    expect(jobs.filter((job) => job.created)).toHaveLength(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM brief_regenerations").first("count")).toBe(1);
  });
});
