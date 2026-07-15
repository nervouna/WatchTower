import type { SearchCandidate, SourceKind } from "../domain/types";
import { fetchJsonWithRetry, type RetryOptions } from "./http-client";
import { normalizeSourceUrl } from "./urls";

const SEARCH_ENDPOINT = "https://api.tavily.com/search";
const EXTRACT_ENDPOINT = "https://api.tavily.com/extract";

type TavilyOptions = RetryOptions;

interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface SearchSourceResult {
  candidates: SearchCandidate[];
  credits: number;
  requestId: string | null;
}

export interface ExtractCandidatesResult {
  evidence: Map<string, string>;
  credits: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSearchResults(value: unknown): SearchResult[] {
  if (!isRecord(value) || !Array.isArray(value.results)) throw new Error("TAVILY_INVALID_RESPONSE");
  return value.results.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.title !== "string" ||
      typeof entry.url !== "string" ||
      typeof entry.content !== "string" ||
      typeof entry.score !== "number"
    ) {
      return [];
    }
    return [{ title: entry.title, url: entry.url, content: entry.content, score: entry.score }];
  });
}

function readCredits(value: unknown): number {
  if (!isRecord(value) || !isRecord(value.usage) || typeof value.usage.credits !== "number") return 0;
  return value.usage.credits;
}

function sourceQuery(source: SourceKind, date: string): { query: string; domain: string; timeRange: "day" | "month" } {
  switch (source) {
    case "hacker-news":
      return {
        query: `${date} Hacker News Top Stories Show HN popular projects launches`,
        domain: "news.ycombinator.com",
        timeRange: "day",
      };
    case "product-hunt":
      return {
        query: `${date} Product Hunt popular products today's launches`,
        domain: "producthunt.com",
        timeRange: "day",
      };
    case "github":
      return {
        query: `${date} GitHub trending repositories significant growth projects`,
        domain: "github.com",
        timeRange: "day",
      };
    case "kickstarter":
      return {
        query:
          `${date} Kickstarter live popular projects Technology Product Design Interactive Design Gaming Hardware Video Games ` +
          "exclude board games card games puzzles graphic design and general culture projects",
        domain: "kickstarter.com",
        timeRange: "month",
      };
  }
}

export async function searchSource(
  apiKey: string,
  source: SourceKind,
  collectionDate: string,
  options: TavilyOptions = {},
): Promise<SearchSourceResult> {
  const config = sourceQuery(source, collectionDate);
  const response = await fetchJsonWithRetry<unknown>(
    SEARCH_ENDPOINT,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: config.query,
        search_depth: "advanced",
        topic: "general",
        chunks_per_source: 3,
        max_results: 15,
        time_range: config.timeRange,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        include_image_descriptions: false,
        include_favicon: false,
        include_domains: [config.domain],
        exclude_domains: [],
        auto_parameters: false,
        exact_match: false,
        include_usage: true,
        safe_search: false,
      }),
    },
    { ...options, timeoutMs: 30_000 },
  );
  const seen = new Set<string>();
  const candidates = parseSearchResults(response.data).flatMap((result, index) => {
    if (!result.title.trim()) return [];
    const normalized = normalizeSourceUrl(source, result.url);
    if (!normalized || seen.has(normalized.canonicalKey)) return [];
    seen.add(normalized.canonicalKey);
    return [
      {
        source,
        title: result.title.trim(),
        platformUrl: normalized.url,
        canonicalKey: normalized.canonicalKey,
        canonicalUrl: normalized.url,
        snippet: result.content.trim(),
        score: result.score,
        rank: index + 1,
      },
    ];
  });
  return { candidates, credits: readCredits(response.data), requestId: response.requestId };
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function parseExtractEvidence(value: unknown): Map<string, string> {
  const evidence = new Map<string, string>();
  if (!isRecord(value) || !Array.isArray(value.results)) return evidence;
  for (const result of value.results) {
    if (isRecord(result) && typeof result.url === "string" && typeof result.raw_content === "string" && result.raw_content.trim()) {
      evidence.set(result.url, result.raw_content.trim());
    }
  }
  return evidence;
}

export async function extractCandidates(
  apiKey: string,
  candidates: readonly SearchCandidate[],
  options: TavilyOptions = {},
): Promise<ExtractCandidatesResult> {
  const evidence = new Map(candidates.map((candidate) => [candidate.platformUrl, candidate.snippet]));
  let credits = 0;
  for (const batch of chunk(candidates, 20)) {
    try {
      const response = await fetchJsonWithRetry<unknown>(
        EXTRACT_ENDPOINT,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            urls: batch.map((candidate) => candidate.platformUrl),
            query:
              "Extract what the project is, core capabilities, release version funding or crowdfunding facts, " +
              "verifiable popularity metrics, and recent material changes.",
            chunks_per_source: 3,
            extract_depth: "advanced",
            include_images: false,
            include_favicon: false,
            format: "markdown",
            timeout: 60,
            include_usage: true,
          }),
        },
        { ...options, timeoutMs: 60_000 },
      );
      for (const [url, content] of parseExtractEvidence(response.data)) evidence.set(url, content);
      credits += readCredits(response.data);
    } catch {
      // Search snippets already provide a low-confidence fallback for this batch.
    }
  }
  return { evidence, credits };
}
