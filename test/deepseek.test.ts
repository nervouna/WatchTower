import { describe, expect, it, vi } from "vitest";

import { generateBrief } from "../src/domain/deepseek";
import type { StoredCandidate } from "../src/domain/types";

const candidate: StoredCandidate = {
  id: "c1",
  targetDate: "2026-07-16",
  source: "github",
  title: "Acme Repo",
  platformUrl: "https://github.com/acme/repo",
  canonicalKey: "github:acme/repo",
  canonicalUrl: "https://github.com/acme/repo",
  originalUrl: null,
  snippet: "A useful repo",
  extractedContent: "A useful repository with a new public release.",
  score: 0.9,
  rank: 1,
  contentHash: "hash",
};

const valid = {
  headline_zh: "今日开发者热点简报",
  intro_zh: "今天的热点集中在开发工具与新产品发布，以下内容均来自当前候选证据并经过聚合整理，适合开发者与产品团队快速阅读。",
  items: [
    {
      candidate_ids: ["c1"],
      existing_entity_id: null,
      title_zh: "值得关注的开源开发项目",
      summary_zh: "这是一个面向开发者的新项目，提供清晰的核心能力与可验证的公开发布事实，当前候选资料表明它正在持续完善产品体验并获得社区关注。",
      why_it_matters_zh: "它降低了常见工作流的使用门槛，并提供可以立即试用的实际价值。",
      tags_zh: ["开发工具", "开源"],
      update_kind: "new",
      material_change_zh: null,
    },
  ],
};

describe("generateBrief", () => {
  it("uses the DeepSeek V4 Flash non-thinking JSON contract", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ choices: [{ message: { content: JSON.stringify(valid) } }], usage: { total_tokens: 100 } }),
    );
    const result = await generateBrief("secret", [candidate], [], { fetcher });
    expect(result.brief).toEqual(valid);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 12000,
      stream: false,
    });
    expect(JSON.stringify(body)).toContain("JSON");
    expect(JSON.stringify(body)).toContain("summary_zh: 60-240");
  });

  it("makes exactly one repair request with stable validation errors", async () => {
    const invalid = { ...valid, items: [{ ...valid.items[0], candidate_ids: ["unknown"] }] };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(invalid) } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(valid) } }] }));
    const result = await generateBrief("secret", [candidate], [], { fetcher });
    expect(result.repaired).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[1]?.body)).toContain("UNKNOWN_CANDIDATE");
    expect(String(fetcher.mock.calls[1]?.[1]?.body)).toContain("Allowed candidate IDs: c1");
    expect(String(fetcher.mock.calls[1]?.[1]?.body)).toContain("summary_zh target: 120-180");
  });

  it("fails after one unsuccessful repair", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ choices: [{ message: { content: "not json" } }] }));
    await expect(generateBrief("secret", [candidate], [], { fetcher })).rejects.toThrow("DEEPSEEK_VALIDATION_FAILED");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("passes feedback policy to the model and repairs an excluded entity", async () => {
    const excludedEntity = {
      id: "entity_00000000000000000000000000000000",
      canonicalKey: candidate.canonicalKey,
      canonicalTitle: "Acme Repo",
      canonicalUrl: candidate.canonicalUrl,
      aliases: [],
      lastSeenDate: "2026-07-15",
      previousSummary: "Previous summary",
      feedback: "irrelevant" as const,
    };
    const invalid = {
      ...valid,
      items: [{
        ...valid.items[0],
        existing_entity_id: excludedEntity.id,
        update_kind: "continuing",
        material_change_zh: "发布了新的主要版本并新增核心能力。",
      }],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(invalid) } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(valid) } }] }));

    await generateBrief("secret", [candidate], [excludedEntity], { fetcher });
    const firstBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as { messages: Array<{ content: string }> };
    expect(firstBody.messages[1]?.content).toContain('"feedback":"irrelevant"');
    expect(firstBody.messages[1]?.content).toContain("Never include this entity");
    expect(String(fetcher.mock.calls[1]?.[1]?.body)).toContain("FEEDBACK_EXCLUDED_ENTITY");
  });
});
