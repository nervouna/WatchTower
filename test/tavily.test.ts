import { describe, expect, it, vi } from "vitest";

import { extractCandidates, searchSource } from "../src/ingestion/tavily";
import type { SearchCandidate } from "../src/domain/types";

describe("Tavily ingestion", () => {
  it("sends source-specific advanced search parameters and filters invalid URLs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        results: [
          { title: "Repo", url: "https://github.com/acme/repo?utm_source=tavily", content: "Useful repo", score: 0.9 },
          { title: "Issue", url: "https://github.com/acme/repo/issues/1", content: "Not a repo", score: 0.8 },
        ],
        request_id: "req-1",
        usage: { credits: 2 },
      }),
    );

    const result = await searchSource("secret", "github", "2026-07-15", { fetcher });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.canonicalKey).toBe("github:acme/repo");
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      search_depth: "advanced",
      topic: "general",
      max_results: 15,
      time_range: "day",
      include_domains: ["github.com"],
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      auto_parameters: false,
      include_usage: true,
    });
    expect(body.query).toContain("2026-07-15");
  });

  it("uses a month time range and category exclusions for Kickstarter", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [], usage: { credits: 2 } }));
    await searchSource("secret", "kickstarter", "2026-07-15", { fetcher });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.time_range).toBe("month");
    expect(body.query).toContain("exclude board games");
  });

  it("extracts at most twenty URLs per request and falls back to snippets", async () => {
    const candidates: SearchCandidate[] = Array.from({ length: 21 }, (_, index) => ({
      source: "github",
      title: `Repo ${index}`,
      platformUrl: `https://github.com/acme/repo-${index}`,
      canonicalKey: `github:acme/repo-${index}`,
      canonicalUrl: `https://github.com/acme/repo-${index}`,
      snippet: `Snippet ${index}`,
      score: 1,
      rank: index + 1,
    }));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { urls: string[] };
      return Response.json({
        results: body.urls.slice(0, -1).map((url) => ({ url, raw_content: `Evidence for ${url}` })),
        failed_results: [{ url: body.urls.at(-1), error: "failed" }],
        usage: { credits: body.urls.length },
      });
    });

    const result = await extractCandidates("secret", candidates, { fetcher });

    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const call of fetcher.mock.calls) {
      const body = JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
      expect((body.urls as unknown[]).length).toBeLessThanOrEqual(20);
      expect(body).toMatchObject({ extract_depth: "advanced", format: "markdown", chunks_per_source: 3, include_images: false, timeout: 60 });
    }
    expect(result.evidence.get(candidates[19]!.platformUrl)).toBe(candidates[19]!.snippet);
    expect(result.evidence.get(candidates[20]!.platformUrl)).toBe(candidates[20]!.snippet);
  });
});
