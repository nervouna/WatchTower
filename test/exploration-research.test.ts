import { describe, expect, it, vi } from "vitest";
import { explorationQueries, hasEnoughExplorationEvidence, researchExploration, selectExplorationPages } from "../src/exploration/research";

describe("exploration research", () => {
  it("constructs all four fixed query kinds without user-provided free text", () => {
    const queries = explorationQueries({ entityId: "entity_x", title: "Acme", summary: "Summary", whyItMatters: "Why", tags: ["AI"], canonicalUrl: "https://acme.test", sourceUrls: [] });
    expect(Object.keys(queries)).toEqual(["context", "products", "perspectives", "industry"]);
    expect(queries.products).toContain("alternatives");
    expect(queries.perspectives).toContain("criticism");
  });

  it("bounds every query to 380 Unicode code points without splitting surrogate pairs", () => {
    const queries = explorationQueries({
      entityId: "entity_x",
      title: `今日第一条 ${"超长标题😀".repeat(80)}`,
      summary: `摘要 ${"证据🚀".repeat(200)}`,
      whyItMatters: "不得进入查询".repeat(100),
      tags: Array.from({ length: 20 }, (_, index) => `标签${String(index)}✨`),
      canonicalUrl: `https://example.com/${"路径/".repeat(100)}`,
      sourceUrls: ["https://source.example/should-not-be-included"],
    });
    for (const query of Object.values(queries)) {
      expect(Array.from(query).length).toBeLessThanOrEqual(380);
      expect(query).not.toContain("不得进入查询");
      expect(query).not.toContain("should-not-be-included");
      expect(query).not.toContain("\uFFFD");
    }
  });

  it("deduplicates URLs, covers query kinds, caps hosts at two, and selects at most ten", () => {
    const kinds = ["context", "products", "perspectives", "industry"] as const;
    const candidates = Array.from({ length: 16 }, (_, index) => ({
      title: `Result ${String(index)}`,
      url: index === 15 ? "https://d0.test/0" : `https://d${String(index % 5)}.test/${String(index)}`,
      content: "snippet",
      score: 1 - index / 100,
      queryKind: kinds[index % 4]!,
      domain: `d${String(index % 5)}.test`,
    }));
    const selected = selectExplorationPages(candidates);
    expect(selected.length).toBeLessThanOrEqual(10);
    expect(new Set(selected.map((item) => item.url)).size).toBe(selected.length);
    for (const domain of new Set(selected.map((item) => item.domain))) {
      expect(selected.filter((item) => item.domain === domain).length).toBeLessThanOrEqual(2);
    }
    expect(new Set(selected.map((item) => item.queryKind)).size).toBe(4);
  });

  it("requires four sources, two domains, and two query kinds", () => {
    const evidence = Array.from({ length: 4 }, (_, index) => ({ id: `source_0${String(index + 1)}`, title: "Title", url: `https://${index % 2 ? "b" : "a"}.test/${String(index)}`, domain: index % 2 ? "b.test" : "a.test", queryKind: index % 2 ? "industry" as const : "context" as const, snippet: "evidence", score: 1 }));
    expect(hasEnoughExplorationEvidence(evidence)).toBe(true);
    expect(hasEnoughExplorationEvidence(evidence.slice(0, 3))).toBe(false);
  });

  it("runs four advanced searches and one advanced extract while counting usage", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { query?: string; urls?: string[] };
      if (String(input).endsWith("/search")) {
        const index = fetcher.mock.calls.length;
        return Response.json({ results: [{ title: `Result ${String(index)}`, url: `https://host${String(index)}.test/page`, content: "snippet", score: 0.9 }], usage: { credits: 2 } });
      }
      return Response.json({ results: body.urls!.map((url) => ({ url, raw_content: `Extracted evidence for ${url}` })), usage: { credits: 2 } });
    });
    const result = await researchExploration("secret", { entityId: "entity_x", title: "Acme", summary: "Summary", whyItMatters: "Why", tags: [], canonicalUrl: "https://acme.test", sourceUrls: [] }, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(result.credits).toBe(10);
    expect(result.evidence).toHaveLength(4);
    for (const call of fetcher.mock.calls.slice(0, 4)) {
      const body = JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ search_depth: "advanced", max_results: 8, include_usage: true });
    }
    const extract = JSON.parse(String(fetcher.mock.calls[4]?.[1]?.body)) as Record<string, unknown>;
    expect(extract).toMatchObject({ extract_depth: "advanced", chunks_per_source: 3, include_usage: true });
  });

  it("continues after a partial search failure", async () => {
    let searchCount = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { urls?: string[] };
      if (String(input).endsWith("/search")) {
        searchCount += 1;
        if (searchCount === 1) return new Response("bad request", { status: 400 });
        return Response.json({ results: [{ title: `Result ${String(searchCount)}`, url: `https://host${String(searchCount)}.test/page`, content: "snippet", score: 0.9 }], usage: { credits: 2 } });
      }
      return Response.json({ results: body.urls!.map((url) => ({ url, raw_content: `Evidence for ${url}` })), usage: { credits: 2 } });
    });
    const result = await researchExploration("secret", { entityId: "entity_x", title: "Acme", summary: "Summary", whyItMatters: "Why", tags: [], canonicalUrl: "https://acme.test", sourceUrls: [] }, { fetcher, sleep: async () => {} });
    expect(result.evidence).toHaveLength(3);
    expect(result.credits).toBe(8);
  });

  it("surfaces search failures when no successful search yields candidates", async () => {
    const failed = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad request", { status: 400 }));
    await expect(researchExploration("secret", { entityId: "entity_x", title: "Acme", summary: "Summary", whyItMatters: "Why", tags: [], canonicalUrl: "https://acme.test", sourceUrls: [] }, { fetcher: failed, sleep: async () => {} }))
      .rejects.toThrow("TAVILY_SEARCH_HTTP_400");

    let calls = 0;
    const partialFailure = vi.fn<typeof fetch>().mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? new Response("bad request", { status: 400 }) : Response.json({ results: [], usage: { credits: 1 } });
    });
    await expect(researchExploration("secret", { entityId: "entity_x", title: "Acme", summary: "Summary", whyItMatters: "Why", tags: [], canonicalUrl: "https://acme.test", sourceUrls: [] }, { fetcher: partialFailure, sleep: async () => {} }))
      .rejects.toThrow("TAVILY_SEARCH_HTTP_400");
  });

  it("returns genuine zero evidence only when every search succeeds with no candidates", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ results: [], usage: { credits: 1 } }));
    await expect(researchExploration("secret", { entityId: "entity_x", title: "Acme", summary: "Summary", whyItMatters: "Why", tags: [], canonicalUrl: "https://acme.test", sourceUrls: [] }, { fetcher }))
      .resolves.toEqual({ evidence: [], credits: 4 });
  });

  it("propagates extract failures with a stable stage code", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => String(input).endsWith("/search")
      ? Response.json({ results: [{ title: "Result", url: `https://host${String(fetcher.mock.calls.length)}.test/page`, content: "snippet", score: 0.9 }], usage: { credits: 2 } })
      : new Response("rate limited", { status: 429 }));
    await expect(researchExploration("secret", { entityId: "entity_x", title: "Acme", summary: "Summary", whyItMatters: "Why", tags: [], canonicalUrl: "https://acme.test", sourceUrls: [] }, { fetcher, sleep: async () => {} }))
      .rejects.toThrow("TAVILY_EXTRACT_HTTP_429");
  });
});
