import { describe, expect, it, vi } from "vitest";

import { generateNarration, validateNarration } from "../src/audio/narration";
import type { BriefPayload, NarrationScript } from "../src/domain/types";

function brief(itemCount = 6): BriefPayload {
  const sources = ["github", "hacker-news", "product-hunt", "kickstarter", "github", "hacker-news", "github"] as const;
  return {
    date: "2026-07-16",
    status: "complete",
    publishedAt: "2026-07-16T00:00:00.000Z",
    generatedAt: "2026-07-16T00:01:00.000Z",
    headline: "今日技术热点",
    intro: "本期聚焦开发工具、人工智能产品与开源生态的可靠更新。",
    missingSources: [],
    sourceCounts: { "hacker-news": 2, "product-hunt": 1, github: 2, kickstarter: 1 },
    audio: null,
    items: sources.slice(0, itemCount).map((source, index) => ({
      rank: index + 1,
      entityId: `entity_${String(index + 1).padStart(32, "0")}`,
      title: `项目甲${index + 1}`,
      summary: `项目甲${index + 1}发布公开更新，改进协作流程并说明当前能力边界。`,
      whyItMatters: "这项更新降低日常使用门槛，也让团队更容易核对实际变化。",
      tags: ["开发工具"],
      continuity: { kind: "new" },
      sources: [{ source, kind: "platform", label: source, url: `https://example.com/${index}` }],
    })),
  };
}

function validScript(itemCount = 6): NarrationScript {
  const padding = "这项变化来自公开材料，重点在于改进现有流程，让开发者更清楚地理解功能边界与实际用途，并核对公开变化。";
  return {
    opening_zh: "本期音频由人工智能语音合成。欢迎收听今天的技术与产品简报，接下来按原有排名介绍值得关注的公开变化。",
    items: brief(itemCount).items.map((item) => ({ entity_id: item.entityId, text_zh: `${item.title}发布公开更新。${padding}${padding}证据明确。` })),
    closing_zh: "以上是本期重点，完整来源与文字内容请在页面中查看，并可继续查看后续更新。",
  };
}

describe("narration validation", () => {
  it("accepts a ranked six-item script covering three sources", () => {
    const result = validateNarration(validScript(), brief());
    expect(result.ok).toBe(true);
  });

  it.each([1, 2, 3, 4])("accepts every planned item for a %i-item short brief", (itemCount) => {
    const result = validateNarration(validScript(itemCount), brief(itemCount));
    expect(result.ok).toBe(true);
  });

  it("rejects a short script with a missing or reordered planned item", () => {
    const missing = validScript(4);
    missing.items.pop();
    const missingResult = validateNarration(missing, brief(4));
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) expect(missingResult.errors).toContain("PLANNED_ITEMS");

    const reordered = validScript(4);
    [reordered.items[0], reordered.items[1]] = [reordered.items[1]!, reordered.items[0]!];
    const reorderedResult = validateNarration(reordered, brief(4));
    expect(reorderedResult.ok).toBe(false);
    if (!reorderedResult.ok) expect(reorderedResult.errors).toContain("PLANNED_ITEMS");
  });

  it("enforces adaptive total length for short briefs", () => {
    const script = validScript(1);
    script.items[0]!.text_zh = "内容过短。";
    const result = validateNarration(script, brief(1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual(expect.arrayContaining(["ITEM_LENGTH", "TOTAL_LENGTH"]));
  });

  it.each([
    ["unknown", (script: NarrationScript) => { script.items[0]!.entity_id = "entity_99999999999999999999999999999999"; }, "UNKNOWN_ENTITY"],
    ["duplicate", (script: NarrationScript) => { script.items[1]!.entity_id = script.items[0]!.entity_id; }, "DUPLICATE_ENTITY"],
    ["rank", (script: NarrationScript) => { script.items.reverse(); }, "RANK_ORDER"],
    ["url", (script: NarrationScript) => { script.items[0]!.text_zh += " https://example.com"; }, "URL_PRESENT"],
    ["number", (script: NarrationScript) => { script.items[0]!.text_zh += "新增百分之九十九"; }, "NEW_NUMBER"],
    ["term", (script: NarrationScript) => { script.items[0]!.text_zh += "支持 QuantumSDK"; }, "NEW_LATIN_TERM"],
  ])("rejects %s violations", (_name, mutate, code) => {
    const script = validScript();
    mutate(script);
    const result = validateNarration(script, brief());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain(code);
  });

  it("makes one repair request and then fails with stable validation errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ choices: [{ message: { content: "{}" } }] }));
    await expect(generateNarration("secret", brief(), { fetcher })).rejects.toThrow("NARRATION_VALIDATION_FAILED");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    [5, "116-120"],
    [6, "98-110"],
    [7, "85-100"],
  ])("uses a feasible per-item length target for a %i-item narration", async (itemCount, expectedRange) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ choices: [{ message: { content: "{}" } }] }));
    await expect(generateNarration("secret", brief(itemCount), { fetcher })).rejects.toThrow("NARRATION_VALIDATION_FAILED");

    const initialBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as { messages: Array<{ content: string }> };
    const repairBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as { messages: Array<{ content: string }> };
    expect(initialBody.messages[0]?.content).toContain(`four complete sentences totaling ${expectedRange} code points for every item`);
    expect(repairBody.messages[3]?.content).toContain(`four complete sentences totaling ${expectedRange} code points`);
    expect(repairBody.messages[3]?.content).toContain("validator hard limit of 75-130 code points");
  });
});
