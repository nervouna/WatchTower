import { describe, expect, it } from "vitest";

import { validateGeneratedBrief } from "../src/domain/generated-brief";
import type { GeneratedBrief } from "../src/domain/types";

const candidates = new Map([
  ["c1", { source: "github" as const }],
  ["c2", { source: "hacker-news" as const }],
]);
const entities = new Set(["entity-1"]);

function validBrief(): GeneratedBrief {
  return {
    headline_zh: "今日开发者热点简报",
    intro_zh: "今天的热点集中在开发工具、人工智能产品与新硬件发布，以下内容均来自当前候选证据并经过聚合整理。",
    items: [
      {
        candidate_ids: ["c1"],
        existing_entity_id: null,
        title_zh: "一个值得关注的新项目",
        summary_zh: "这是一个面向开发者的新项目，提供清晰的核心能力与可验证的发布事实，当前候选资料说明它正在获得社区关注并持续完善产品体验。",
        why_it_matters_zh: "它降低了常见工作流的使用门槛，并提供了可以立即尝试的实际价值。",
        tags_zh: ["开发工具", "开源"],
        update_kind: "new",
        material_change_zh: null,
      },
    ],
  };
}

describe("validateGeneratedBrief", () => {
  it("accepts a valid model response", () => {
    expect(validateGeneratedBrief(validBrief(), { candidates, entities, enforceSourceQuota: false }).ok).toBe(true);
  });

  it.each([
    ["UNKNOWN_CANDIDATE", (brief: ReturnType<typeof validBrief>) => (brief.items[0]!.candidate_ids = ["missing"])],
    ["UNKNOWN_ENTITY", (brief: ReturnType<typeof validBrief>) => (brief.items[0]!.existing_entity_id = "missing")],
    ["INVALID_CONTINUITY", (brief: ReturnType<typeof validBrief>) => (brief.items[0]!.update_kind = "continuing")],
    ["MODEL_URL_FORBIDDEN", (brief: ReturnType<typeof validBrief>) => (brief.items[0]!.summary_zh += " https://example.com")],
    ["FIELD_LENGTH", (brief: ReturnType<typeof validBrief>) => (brief.items[0]!.title_zh = "标题".repeat(50))],
  ])("returns stable validation code %s", (code, mutate) => {
    const brief = validBrief();
    mutate(brief);
    const result = validateGeneratedBrief(brief, { candidates, entities, enforceSourceQuota: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(code);
      if (code === "FIELD_LENGTH") expect(result.errors).toContain("FIELD_LENGTH_TITLE");
    }
  });

  it("rejects a candidate assigned to multiple items", () => {
    const brief = validBrief();
    brief.items.push({ ...brief.items[0]!, title_zh: "另一个聚合条目" });
    const result = validateGeneratedBrief(brief, { candidates, entities, enforceSourceQuota: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("DUPLICATE_CANDIDATE");
  });
});
