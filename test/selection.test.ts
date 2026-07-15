import { describe, expect, it } from "vitest";

import { selectCandidates } from "../src/ingestion/selection";
import type { SearchCandidate, SourceKind } from "../src/domain/types";

const sources: SourceKind[] = ["hacker-news", "product-hunt", "github", "kickstarter"];

function candidate(source: SourceKind, rank: number, key = `${source}:${rank}`): SearchCandidate {
  return {
    source,
    title: key,
    platformUrl: `https://example.com/${key}`,
    canonicalKey: key,
    canonicalUrl: `https://example.com/${key}`,
    snippet: "snippet",
    score: 1 - rank / 100,
    rank,
  };
}

describe("selectCandidates", () => {
  it("reserves seven per source and fills two global slots", () => {
    const input = sources.flatMap((source) => Array.from({ length: 10 }, (_, index) => candidate(source, index + 1)));
    const selected = selectCandidates(input, 30);

    expect(selected).toHaveLength(30);
    for (const source of sources) {
      expect(selected.filter((entry) => entry.source === source).length).toBeGreaterThanOrEqual(7);
    }
  });

  it("backfills unused source quotas globally", () => {
    const input = sources.flatMap((source) =>
      Array.from({ length: source === "hacker-news" ? 2 : 12 }, (_, index) => candidate(source, index + 1)),
    );
    expect(selectCandidates(input, 30)).toHaveLength(30);
  });

  it("deduplicates canonical candidates within a source", () => {
    const input = [candidate("github", 1, "github:a/b"), candidate("github", 2, "github:a/b")];
    expect(selectCandidates(input, 30)).toEqual([input[0]]);
  });
});
