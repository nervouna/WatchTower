import { describe, expect, it } from "vitest";

import { findHackerNewsOriginalUrl, normalizeSourceUrl } from "../src/ingestion/urls";

describe("normalizeSourceUrl", () => {
  it.each([
    ["hacker-news", "https://NEWS.YCOMBINATOR.com:443/item?id=123&utm_source=x#top", "hn:123", "https://news.ycombinator.com/item?id=123"],
    ["product-hunt", "https://www.producthunt.com/posts/Useful-App?ref=home", "ph:useful-app", "https://www.producthunt.com/posts/Useful-App"],
    ["github", "https://github.com/OpenAI/Codex/?utm_campaign=x", "github:openai/codex", "https://github.com/OpenAI/Codex"],
    ["kickstarter", "https://www.kickstarter.com/projects/Acme/New-Thing?source=popular", "kickstarter:acme/new-thing", "https://www.kickstarter.com/projects/Acme/New-Thing"],
  ] as const)("normalizes %s canonical URLs", (source, input, canonicalKey, url) => {
    expect(normalizeSourceUrl(source, input)).toEqual({ canonicalKey, url });
  });

  it.each([
    ["github", "http://github.com/a/b"],
    ["github", "https://github.com/trending"],
    ["github", "https://github.com/a/b/issues"],
    ["github", "https://github.com/a"],
    ["product-hunt", "https://www.producthunt.com/topics/ai"],
    ["hacker-news", "https://news.ycombinator.com/news"],
    ["kickstarter", "https://www.kickstarter.com/discover/categories/technology"],
  ] as const)("rejects invalid %s URL %s", (source, input) => {
    expect(normalizeSourceUrl(source, input)).toBeNull();
  });

  it("keeps business query parameters while removing tracking parameters", () => {
    expect(normalizeSourceUrl("hacker-news", "https://news.ycombinator.com/item?id=42&foo=bar&utm_medium=email")?.url).toBe(
      "https://news.ycombinator.com/item?id=42&foo=bar",
    );
  });
});

describe("findHackerNewsOriginalUrl", () => {
  it("returns the first verified external HTTPS link", () => {
    const evidence = "See http://unsafe.example and https://news.ycombinator.com/item?id=1 then https://example.com/release).";
    expect(findHackerNewsOriginalUrl(evidence)).toBe("https://example.com/release");
  });

  it("returns null when evidence has no external HTTPS URL", () => {
    expect(findHackerNewsOriginalUrl("https://news.ycombinator.com/item?id=1")).toBeNull();
  });
});
