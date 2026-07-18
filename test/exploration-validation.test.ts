import { describe, expect, it } from "vitest";
import type { ExplorationSections, ExplorationSource } from "../src/domain/types";
import { validateExplorationOutput } from "../src/exploration/validation";

const sources: ExplorationSource[] = [
  { id: "source_01", title: "Official", url: "https://example.com/release", domain: "example.com", queryKind: "context" },
  { id: "source_02", title: "Review", url: "https://review.example/post", domain: "review.example", queryKind: "perspectives" },
];

function valid(): ExplorationSections {
  return {
    overview: { text: "这是一个有充分公开资料支持的项目背景说明，涵盖本次变化、核心能力以及为什么此刻值得关注。", sourceIds: ["source_01", "source_02"] },
    relatedProducts: [],
    perspectives: [{ label: "外部评测", summary: "评测认为它降低了使用门槛，同时对长期维护成本仍持保留意见。", sourceIds: ["source_02"] }],
    industry: null,
    watchNext: [{ signal: "继续关注后续正式版本、公开定价与实际采用数据。", sourceIds: ["source_01"] }],
  };
}

describe("exploration output validation", () => {
  it("accepts cited partial output and derives partial quality", () => {
    expect(validateExplorationOutput(valid(), sources)).toMatchObject({ ok: true, quality: "partial" });
  });

  it("accepts a structurally valid single-domain result as partial", () => {
    const singleDomain = valid();
    singleDomain.overview.sourceIds = ["source_01"];
    singleDomain.perspectives[0]!.sourceIds = ["source_01"];
    expect(validateExplorationOutput(singleDomain, [sources[0]!])).toMatchObject({ ok: true, quality: "partial" });
  });

  it("marks complete fixed sections with citations from two domains as complete", () => {
    const complete = valid();
    complete.relatedProducts = [{ name: "替代品", relation: "相近定位", summary: "该产品面向相似需求，但其集成方式和目标用户存在明确差异。", sourceIds: ["source_01"] }];
    complete.industry = { text: "它处在开发工具自动化采用持续扩大的行业趋势中。", sourceIds: ["source_02"] };
    expect(validateExplorationOutput(complete, sources)).toMatchObject({ ok: true, quality: "complete" });
  });

  it("rejects unknown source IDs, uncited claims, URL fields, and overlong text", () => {
    const unknown = valid();
    unknown.overview.sourceIds = ["invented"];
    expect(validateExplorationOutput(unknown, sources)).toMatchObject({ ok: false });
    const url = { ...valid(), relatedProducts: [{ name: "Other", relation: "替代", summary: "这是一个具有相近定位且已有独立资料说明的替代产品。", sourceIds: ["source_01"], url: "https://invented.example" }] };
    const urlResult = validateExplorationOutput(url, sources);
    expect(urlResult.ok).toBe(false);
    if (!urlResult.ok) expect(urlResult.errors).toContain("URL_FIELD_FORBIDDEN");
    const urlText = valid();
    urlText.overview.text += " https://invented.example";
    const urlTextResult = validateExplorationOutput(urlText, sources);
    expect(urlTextResult.ok).toBe(false);
    if (!urlTextResult.ok) expect(urlTextResult.errors).toContain("URL_TEXT_FORBIDDEN");
    const long = valid();
    long.watchNext[0]!.signal = "长".repeat(241);
    expect(validateExplorationOutput(long, sources)).toMatchObject({ ok: false });
  });
});
