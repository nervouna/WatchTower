import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  beginRun,
  deleteExpiredStaging,
  getBrief,
  listBriefs,
  getEntityFeedback,
  removeEntityFeedback,
  getBriefAudio,
  getBriefCover,
  getEntityCatalog,
  queueBriefAudio,
  queueBriefCover,
  claimBriefAudio,
  claimBriefCover,
  saveBriefAudioScript,
  readyBriefAudio,
  readyBriefCover,
  failBriefCover,
  saveBriefCoverRequest,
  replaceBrief,
  setEntityFeedback,
  upsertCandidates,
  type BriefDraft,
} from "../src/storage/repository";
import {
  claimExplorationTrigger,
  claimExplorationWork,
  getExplorationRow,
  releaseExplorationForRetry,
  reserveExplorationCredits,
  saveExplorationEvidence,
  savedEvidence,
  type ExplorationJob,
} from "../src/exploration/repository";
import type { StoredCandidate } from "../src/domain/types";

function storedCandidate(id: string, targetDate = "2026-07-16"): StoredCandidate {
  return {
    id,
    targetDate,
    source: "github",
    title: "Example repo",
    platformUrl: `https://github.com/acme/${id}`,
    canonicalKey: `github:acme/${id}`,
    canonicalUrl: `https://github.com/acme/${id}`,
    originalUrl: null,
    snippet: "A useful repository",
    extractedContent: "Focused extracted evidence",
    score: 0.9,
    rank: 1,
    contentHash: `hash-${id}`,
  };
}

function briefDraft(date: string, title = "首个热点项目"): BriefDraft {
  return {
    date,
    status: "complete",
    publishAt: `${date}T00:00:00.000Z`,
    generatedAt: `${date}T00:01:00.000Z`,
    headline: "今日值得关注的开发者热点",
    intro: "今天的热点涵盖开发工具、人工智能与新产品发布，以下内容均来自可验证的当前候选资料并经过聚合整理。",
    missingSources: [],
    model: "deepseek-v4-flash",
    promptVersion: "v1",
    items: [
      {
        entity: {
          canonicalKey: "github:acme/repo",
          canonicalTitle: "Acme Repo",
          canonicalUrl: "https://github.com/acme/repo",
          aliases: ["Acme"],
        },
        title,
        summary: "这是一个面向开发者的新项目，提供清晰的核心能力与可验证的发布事实，当前资料表明它正在持续获得社区关注。",
        whyItMatters: "它降低了常见工作流的门槛，并带来可以立即尝试的实际价值。",
        tags: ["开发工具", "开源"],
        continuity: { kind: "new" },
        sources: [
          { candidateId: null, source: "github", kind: "platform", label: "GitHub", url: "https://github.com/acme/repo" },
        ],
      },
    ],
  };
}

describe("D1 repository", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM item_explorations; DELETE FROM exploration_daily_usage; DELETE FROM brief_regenerations; DELETE FROM brief_covers; DELETE FROM brief_audio; DELETE FROM item_sources; DELETE FROM brief_items; DELETE FROM briefs; DELETE FROM entities; DELETE FROM candidates; DELETE FROM ingestion_runs;");
  });

  it("creates all required tables through migrations", async () => {
    const result = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
    const names = result.results.map((row) => row.name);
    expect(names).toEqual(expect.arrayContaining([
      "ingestion_runs", "candidates", "entities", "briefs", "brief_items", "item_sources",
      "entity_feedback", "brief_audio", "brief_covers", "push_subscriptions", "brief_push_batches", "brief_push_deliveries",
      "item_explorations", "exploration_daily_usage",
      "brief_regenerations",
    ]));
    const pushColumns = await env.DB.prepare("PRAGMA table_info(push_subscriptions)").all<{ name: string }>();
    expect(pushColumns.results.map((column) => column.name)).toContain("app_id");
  });

  it("atomically prevents concurrent exploration reservations from exceeding the daily limit", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      reserveExplorationCredits(env.DB, "2026-07-16T01:00:00.000Z", 12, 12)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const usage = await env.DB.prepare(
      "SELECT reserved_credits, jobs_started FROM exploration_daily_usage WHERE usage_date = ?",
    ).bind("2026-07-16").first<{ reserved_credits: number; jobs_started: number }>();
    expect(usage).toEqual({ reserved_credits: 12, jobs_started: 1 });
    expect(await reserveExplorationCredits(env.DB, "2026-07-17T01:00:00.000Z", 24, 12)).toBe(false);
  });

  it("claims duplicate exploration messages once and resumes from saved evidence after retry", async () => {
    await replaceBrief(env.DB, briefDraft("2026-07-16"));
    const entityId = (await getBrief(env.DB, "2026-07-16", "2026-07-16T01:00:00.000Z"))!.items[0]!.entityId;
    const seed = { entityId, title: "Acme", summary: "Summary", whyItMatters: "Why", tags: [], canonicalUrl: "https://example.com", sourceUrls: [] };
    const job: ExplorationJob = { kind: "item-exploration", entityId, jobId: "job-one" };
    expect(await claimExplorationTrigger(env.DB, seed, job.jobId, "2026-07-16T01:00:00.000Z", "2026-07-16T01:15:00.000Z")).toBe(true);
    expect(await claimExplorationTrigger(env.DB, seed, "job-two", "2026-07-16T01:00:01.000Z", "2026-07-16T01:15:01.000Z")).toBe(false);
    expect(await claimExplorationWork(env.DB, job, "2026-07-16T01:01:00.000Z", "2026-07-16T01:11:00.000Z")).not.toBeNull();
    expect(await claimExplorationWork(env.DB, job, "2026-07-16T01:01:01.000Z", "2026-07-16T01:11:01.000Z")).toBeNull();
    const evidence = [{ id: "source_01", title: "Source", url: "https://example.com", domain: "example.com", queryKind: "context" as const, snippet: "Evidence", score: 1 }];
    await saveExplorationEvidence(env.DB, job, evidence, 10, "2026-07-16T01:02:00.000Z");
    await releaseExplorationForRetry(env.DB, job, "2026-07-16T01:03:00.000Z");
    const retried = await claimExplorationWork(env.DB, job, "2026-07-16T01:04:00.000Z", "2026-07-16T01:14:00.000Z");
    expect(savedEvidence(retried!)).toEqual(evidence);
    expect((await getExplorationRow(env.DB, entityId))?.attempt_count).toBe(2);
    expect(await getExplorationRow(env.DB, entityId)).toMatchObject({
      prompt_version: "exploration-v2-contract",
      query_version: "exploration-v2-bounded",
    });
  });

  it("recovers an exploration whose active lease expired", async () => {
    await replaceBrief(env.DB, briefDraft("2026-07-16"));
    const entityId = (await getBrief(env.DB, "2026-07-16", "2026-07-16T01:00:00.000Z"))!.items[0]!.entityId;
    const seed = { entityId, title: "Acme", summary: "Summary", whyItMatters: "Why", tags: [], canonicalUrl: "https://example.com", sourceUrls: [] };
    expect(await claimExplorationTrigger(env.DB, seed, "lost-job", "2026-07-16T01:00:00.000Z", "2026-07-16T01:05:00.000Z")).toBe(true);
    expect(await claimExplorationTrigger(env.DB, seed, "recovery-job", "2026-07-16T01:06:00.000Z", "2026-07-16T01:21:00.000Z")).toBe(true);
    expect((await getExplorationRow(env.DB, entityId))?.active_job_id).toBe("recovery-job");
  });

  it("hydrates audio states and claims one content hash idempotently", async () => {
    await replaceBrief(env.DB, briefDraft("2026-07-16"));
    expect((await getBrief(env.DB, "2026-07-16", "2026-07-16T01:00:00.000Z"))?.audio).toBeNull();
    expect(await queueBriefAudio(env.DB, "2026-07-16", "hash-a", "narration-v2-adaptive", "2026-07-16T01:00:00.000Z")).toBe("queued");
    expect(await queueBriefAudio(env.DB, "2026-07-16", "hash-a", "narration-v2-adaptive", "2026-07-16T01:01:00.000Z")).toBe("already-pending");
    expect((await claimBriefAudio(env.DB, "2026-07-16", "hash-a", "2026-07-16T01:02:00.000Z"))?.attempt_count).toBe(1);
    expect(await claimBriefAudio(env.DB, "2026-07-16", "hash-a", "2026-07-16T01:03:00.000Z")).toBeNull();
    expect((await claimBriefAudio(env.DB, "2026-07-16", "hash-a", "2026-07-16T01:04:00.000Z", true))?.attempt_count).toBe(2);
    const script = { opening_zh: "开场", items: [{ entity_id: "id", text_zh: "正文" }], closing_zh: "结尾" };
    await saveBriefAudioScript(env.DB, "2026-07-16", "hash-a", JSON.stringify(script), "2026-07-16T01:04:00.000Z");
    await readyBriefAudio(env.DB, "2026-07-16", "hash-a", "briefs/a.wav", 180, "2026-07-16T01:05:00.000Z");
    expect(await queueBriefAudio(env.DB, "2026-07-16", "hash-a", "narration-v2-adaptive", "2026-07-16T01:06:00.000Z")).toBe("already-ready");
    expect((await getBriefAudio(env.DB, "2026-07-16"))?.prompt_version).toBe("narration-v2-adaptive");
    expect((await getBrief(env.DB, "2026-07-16", "2026-07-16T02:00:00.000Z"))?.audio).toMatchObject({ status: "ready", durationSeconds: 180, transcript: "开场\n\n正文\n\n结尾" });
    expect((await getBriefAudio(env.DB, "2026-07-16"))?.object_key).toBe("briefs/a.wav");
  });

  it("hydrates cover states and resumes one fal request idempotently", async () => {
    await replaceBrief(env.DB, briefDraft("2026-07-16"));
    expect(await queueBriefCover(env.DB, "2026-07-16", "cover-a", "podcast-cover-v2-bounded", "2026-07-16T01:00:00.000Z")).toBe("queued");
    expect(await queueBriefCover(env.DB, "2026-07-16", "cover-a", "podcast-cover-v2-bounded", "2026-07-16T01:01:00.000Z")).toBe("already-pending");
    expect((await claimBriefCover(env.DB, "2026-07-16", "cover-a", "2026-07-16T01:02:00.000Z"))?.attempt_count).toBe(1);
    await saveBriefCoverRequest(env.DB, "2026-07-16", "cover-a", {
      requestId: "fal-request",
      statusUrl: "https://queue.fal.run/status",
      responseUrl: "https://queue.fal.run/response",
    }, "2026-07-16T01:03:00.000Z");
    expect((await getBriefCover(env.DB, "2026-07-16"))?.fal_request_id).toBe("fal-request");
    expect((await getBriefCover(env.DB, "2026-07-16"))?.prompt_version).toBe("podcast-cover-v2-bounded");
    await readyBriefCover(env.DB, "2026-07-16", "cover-a", "briefs/cover.image", "2026-07-16T01:04:00.000Z");
    expect(await queueBriefCover(env.DB, "2026-07-16", "cover-a", "podcast-cover-v2-bounded", "2026-07-16T01:05:00.000Z")).toBe("already-ready");
    expect((await getBrief(env.DB, "2026-07-16", "2026-07-16T02:00:00.000Z"))?.audio).toBeNull();

    await queueBriefAudio(env.DB, "2026-07-16", "audio-a", "narration-v2-adaptive", "2026-07-16T01:06:00.000Z");
    expect((await getBrief(env.DB, "2026-07-16", "2026-07-16T02:00:00.000Z"))?.audio?.cover).toMatchObject({
      status: "ready",
      url: "/api/briefs/2026-07-16/cover",
      provider: "fal-ai",
      synthetic: true,
    });

    expect(await queueBriefCover(env.DB, "2026-07-16", "cover-b", "podcast-cover-v3", "2026-07-16T01:07:00.000Z")).toBe("queued");
    expect(await getBriefCover(env.DB, "2026-07-16")).toMatchObject({
      content_hash: "cover-b",
      prompt_version: "podcast-cover-v3",
      fal_request_id: null,
      fal_status_url: null,
      fal_response_url: null,
    });
  });

  it("keeps ready audio available when cover generation fails", async () => {
    await replaceBrief(env.DB, briefDraft("2026-07-16"));
    await queueBriefAudio(env.DB, "2026-07-16", "audio", "narration-v2-adaptive", "2026-07-16T01:00:00.000Z");
    await saveBriefAudioScript(env.DB, "2026-07-16", "audio", JSON.stringify({ opening_zh: "开场", items: [], closing_zh: "结尾" }), "2026-07-16T01:01:00.000Z");
    await readyBriefAudio(env.DB, "2026-07-16", "audio", "briefs/audio.wav", 180, "2026-07-16T01:02:00.000Z");
    await queueBriefCover(env.DB, "2026-07-16", "cover", "podcast-cover-v2-bounded", "2026-07-16T01:03:00.000Z");
    await failBriefCover(env.DB, "2026-07-16", "cover", "FAL_GENERATION_FAILED", "2026-07-16T01:04:00.000Z");
    expect((await getBrief(env.DB, "2026-07-16", "2026-07-16T02:00:00.000Z"))?.audio).toMatchObject({
      status: "ready",
      durationSeconds: 180,
      cover: { status: "failed" },
    });
  });

  it("skips a successfully completed idempotent stage", async () => {
    const first = await beginRun(env.DB, "2026-07-16", "collect", "2026-07-15T21:00:00.000Z");
    await env.DB.prepare("UPDATE ingestion_runs SET status = 'succeeded', finished_at = ? WHERE id = ?")
      .bind("2026-07-15T21:01:00.000Z", first.id)
      .run();
    const duplicate = await beginRun(env.DB, "2026-07-16", "collect", "2026-07-15T21:02:00.000Z");
    expect(duplicate).toMatchObject({ id: first.id, skipped: true });
  });

  it("upserts candidates without duplicates", async () => {
    const candidate = storedCandidate("repo");
    await upsertCandidates(env.DB, [candidate], "2026-07-15T21:00:00.000Z");
    await upsertCandidates(env.DB, [{ ...candidate, snippet: "Updated" }], "2026-07-15T22:30:00.000Z");
    const row = await env.DB.prepare("SELECT COUNT(*) AS count, snippet FROM candidates").first<{ count: number; snippet: string }>();
    expect(row).toEqual({ count: 1, snippet: "Updated" });
  });

  it("atomically replaces a brief and exposes the full payload", async () => {
    await replaceBrief(env.DB, briefDraft("2026-07-16"));
    await replaceBrief(env.DB, briefDraft("2026-07-16", "更新后的热点项目"));
    const payload = await getBrief(env.DB, "2026-07-16", "2026-07-16T00:01:00.000Z");
    expect(payload?.items).toHaveLength(1);
    expect(payload?.items[0]?.title).toBe("更新后的热点项目");
    expect(payload?.sourceCounts.github).toBe(1);
  });

  it("builds historical entity context only from the nearest earlier brief", async () => {
    await replaceBrief(env.DB, briefDraft("2026-07-15", "十五日摘要"));
    await replaceBrief(env.DB, briefDraft("2026-07-17", "十七日摘要"));

    const onSixteenth = await getEntityCatalog(env.DB, "2026-07-16");
    expect(onSixteenth).toEqual([
      expect.objectContaining({ lastSeenDate: "2026-07-15", previousSummary: briefDraft("2026-07-15", "十五日摘要").items[0]!.summary }),
    ]);
    const onSeventeenth = await getEntityCatalog(env.DB, "2026-07-17");
    expect(onSeventeenth[0]).toMatchObject({ lastSeenDate: "2026-07-15" });
    const onEighteenth = await getEntityCatalog(env.DB, "2026-07-18");
    expect(onEighteenth[0]).toMatchObject({ lastSeenDate: "2026-07-17" });
  });

  it("excludes entities first seen after a historical target date", async () => {
    await replaceBrief(env.DB, briefDraft("2026-07-18"));
    expect(await getEntityCatalog(env.DB, "2026-07-16")).toEqual([]);
  });

  it("does not move global entity date boundaries backward during historical replacement", async () => {
    await replaceBrief(env.DB, briefDraft("2026-07-18"));
    await replaceBrief(env.DB, briefDraft("2026-07-16"));
    const row = await env.DB.prepare(
      "SELECT first_seen_date, last_seen_date FROM entities WHERE canonical_key = ?",
    ).bind("github:acme/repo").first<{ first_seen_date: string; last_seen_date: string }>();
    expect(row).toEqual({ first_seen_date: "2026-07-16", last_seen_date: "2026-07-18" });
  });

  it("stores one mutable feedback value per entity and preserves it across brief replacement", async () => {
    await replaceBrief(env.DB, briefDraft("2026-07-16"));
    const brief = await getBrief(env.DB, "2026-07-16", "2026-07-16T00:01:00.000Z");
    const entityId = brief!.items[0]!.entityId;

    expect(await setEntityFeedback(env.DB, entityId, "follow", "2026-07-16", "2026-07-16T01:00:00.000Z", "auth0|user-a")).toBe(true);
    expect(await getEntityFeedback(env.DB, [entityId])).toEqual({ [entityId]: "follow" });
    expect(await setEntityFeedback(env.DB, entityId, "uninteresting", "2026-07-16", "2026-07-16T02:00:00.000Z", "auth0|user-b")).toBe(true);
    expect(await env.DB.prepare("SELECT updated_by_user_id FROM entity_feedback WHERE entity_id = ?").bind(entityId).first()).toEqual({ updated_by_user_id: "auth0|user-b" });
    await replaceBrief(env.DB, briefDraft("2026-07-16", "更新后的热点项目"));
    expect(await getEntityFeedback(env.DB, [entityId])).toEqual({ [entityId]: "uninteresting" });

    await removeEntityFeedback(env.DB, entityId);
    expect(await getEntityFeedback(env.DB, [entityId])).toEqual({});
  });

  it("rejects feedback for an entity that is not present in the claimed published brief", async () => {
    await replaceBrief(env.DB, briefDraft("2026-07-16"));
    const brief = await getBrief(env.DB, "2026-07-16", "2026-07-16T00:01:00.000Z");
    expect(await setEntityFeedback(env.DB, brief!.items[0]!.entityId, "follow", "2026-07-15", "2026-07-16T01:00:00.000Z", "auth0|user-a")).toBe(false);
  });

  it("rolls back an invalid replacement and preserves the old brief", async () => {
    await replaceBrief(env.DB, briefDraft("2026-07-16"));
    const invalid = briefDraft("2026-07-16", "不应写入");
    invalid.items[0]!.sources[0]!.source = "invalid" as "github";
    await expect(replaceBrief(env.DB, invalid)).rejects.toThrow();
    const payload = await getBrief(env.DB, "2026-07-16", "2026-07-16T00:01:00.000Z");
    expect(payload?.items[0]?.title).toBe("首个热点项目");
  });

  it("lists published briefs with stable cursor pagination", async () => {
    await replaceBrief(env.DB, briefDraft("2026-07-15"));
    await replaceBrief(env.DB, briefDraft("2026-07-16"));
    const first = await listBriefs(env.DB, { limit: 1, now: "2026-07-16T01:00:00.000Z" });
    expect(first.briefs.map((brief) => brief.date)).toEqual(["2026-07-16"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await listBriefs(env.DB, { limit: 1, cursor: first.nextCursor, now: "2026-07-16T01:00:00.000Z" });
    expect(second.briefs.map((brief) => brief.date)).toEqual(["2026-07-15"]);
  });

  it("deletes only expired staging data", async () => {
    await upsertCandidates(env.DB, [storedCandidate("old", "2026-06-01"), storedCandidate("new")], "2026-07-15T21:00:00.000Z");
    await beginRun(env.DB, "2026-06-01", "collect", "2026-06-01T21:00:00.000Z");
    await replaceBrief(env.DB, briefDraft("2026-06-01"));
    await deleteExpiredStaging(env.DB, "2026-06-16");
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM candidates").first("count")).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM ingestion_runs").first("count")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM briefs").first("count")).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM entities").first("count")).toBe(1);
  });
});
