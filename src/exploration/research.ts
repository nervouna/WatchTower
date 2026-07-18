import type {
  ExplorationEvidenceSource,
  ExplorationQueryKind,
  ExplorationSeed,
} from "../domain/types";
import { fetchJsonWithRetry, type RetryOptions } from "../ingestion/http-client";
import { normalizePublicUrl } from "../ingestion/urls";

const SEARCH_ENDPOINT = "https://api.tavily.com/search";
const EXTRACT_ENDPOINT = "https://api.tavily.com/extract";
export const EXPLORATION_QUERY_VERSION = "exploration-v2-bounded";
const MAX_QUERY_CODE_POINTS = 380;

interface RawSearchResult { title: string; url: string; content: string; score: number }
interface Candidate extends RawSearchResult { queryKind: ExplorationQueryKind; domain: string }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function credits(value: unknown): number {
  return record(value) && record(value.usage) && typeof value.usage.credits === "number" ? value.usage.credits : 0;
}

function results(value: unknown): RawSearchResult[] {
  if (!record(value) || !Array.isArray(value.results)) return [];
  return value.results.flatMap((item) => record(item) && typeof item.title === "string" &&
    typeof item.url === "string" && typeof item.content === "string" && typeof item.score === "number"
    ? [{ title: item.title.trim(), url: item.url, content: item.content.trim(), score: item.score }]
    : []);
}

export function explorationQueries(seed: ExplorationSeed): Record<ExplorationQueryKind, string> {
  const canonicalLocation = (() => {
    try {
      const url = new URL(seed.canonicalUrl);
      return `${url.hostname}${url.pathname}`;
    } catch {
      return "";
    }
  })();
  const subject = [seed.title, seed.tags.slice(0, 4).join(" "), canonicalLocation,
    Array.from(seed.summary.trim()).slice(0, 120).join("")].filter(Boolean).join(" ");
  const bounded = (intent: string): string => Array.from(`${intent} ${subject}`).slice(0, MAX_QUERY_CODE_POINTS).join("");
  return {
    context: bounded("official documentation background latest release changes"),
    products: bounded("alternatives competitors complementary products comparison"),
    perspectives: bounded("review community discussion criticism user experience"),
    industry: bounded("industry trend adoption market position ecosystem impact"),
  };
}

function stageError(stage: "SEARCH" | "EXTRACT", error: unknown): Error {
  const code = error instanceof Error ? (error.message.split(":", 1)[0] ?? "UNKNOWN_ERROR") : "UNKNOWN_ERROR";
  return new Error(`TAVILY_${stage}_${code}`);
}

async function search(
  apiKey: string,
  queryKind: ExplorationQueryKind,
  query: string,
  options: RetryOptions,
): Promise<{ candidates: Candidate[]; credits: number }> {
  const response = await fetchJsonWithRetry<unknown>(SEARCH_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      search_depth: "advanced",
      topic: "general",
      chunks_per_source: 3,
      max_results: 8,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_image_descriptions: false,
      include_favicon: false,
      auto_parameters: false,
      include_usage: true,
      safe_search: false,
    }),
  }, { ...options, timeoutMs: 30_000 });
  return {
    credits: credits(response.data),
    candidates: results(response.data).flatMap((item) => {
      const normalized = normalizePublicUrl(item.url);
      return normalized && item.title ? [{ ...item, ...normalized, queryKind }] : [];
    }),
  };
}

export function selectExplorationPages(candidates: readonly Candidate[], limit = 10): Candidate[] {
  const deduped = new Map<string, Candidate>();
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const existing = deduped.get(candidate.url);
    if (!existing || candidate.score > existing.score) deduped.set(candidate.url, candidate);
  }
  const byKind = new Map<ExplorationQueryKind, Candidate[]>();
  for (const kind of ["context", "products", "perspectives", "industry"] as const) {
    byKind.set(kind, [...deduped.values()].filter((item) => item.queryKind === kind));
  }
  const selected: Candidate[] = [];
  const domains = new Map<string, number>();
  while (selected.length < limit) {
    let added = false;
    for (const kind of ["context", "products", "perspectives", "industry"] as const) {
      const pool = byKind.get(kind) ?? [];
      const index = pool.findIndex((item) => (domains.get(item.domain) ?? 0) < 2 && !selected.some((value) => value.url === item.url));
      if (index < 0) continue;
      const [item] = pool.splice(index, 1);
      if (!item) continue;
      selected.push(item);
      domains.set(item.domain, (domains.get(item.domain) ?? 0) + 1);
      added = true;
      if (selected.length === limit) break;
    }
    if (!added) break;
  }
  return selected;
}

function extracted(value: unknown): Map<string, string> {
  const mapped = new Map<string, string>();
  if (!record(value) || !Array.isArray(value.results)) return mapped;
  for (const item of value.results) {
    if (!record(item) || typeof item.url !== "string" || typeof item.raw_content !== "string") continue;
    const normalized = normalizePublicUrl(item.url);
    const content = item.raw_content.trim();
    if (normalized && content) mapped.set(normalized.url, content.slice(0, 8_000));
  }
  return mapped;
}

export async function researchExploration(
  apiKey: string,
  seed: ExplorationSeed,
  options: RetryOptions = {},
): Promise<{ evidence: ExplorationEvidenceSource[]; credits: number }> {
  const queries = explorationQueries(seed);
  const searches = await Promise.allSettled(
    (Object.entries(queries) as Array<[ExplorationQueryKind, string]>).map(([kind, query]) => search(apiKey, kind, query, options)),
  );
  const successful = searches.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failed: unknown[] = [];
  for (const result of searches) if (result.status === "rejected") failed.push(result.reason as unknown);
  const searchCredits = successful.reduce((total, result) => total + result.credits, 0);
  const selected = selectExplorationPages(successful.flatMap((result) => result.candidates));
  if (selected.length === 0) {
    if (failed[0] !== undefined) throw stageError("SEARCH", failed[0]);
    return { evidence: [], credits: searchCredits };
  }

  let response;
  try {
    response = await fetchJsonWithRetry<unknown>(EXTRACT_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        urls: selected.map((item) => item.url),
        query: `Extract facts relevant to ${seed.title}: background, recent changes, related products, independent perspectives, industry position, and verifiable next signals.`,
        chunks_per_source: 3,
        extract_depth: "advanced",
        include_images: false,
        include_favicon: false,
        format: "markdown",
        timeout: 60,
        include_usage: true,
      }),
    }, { ...options, timeoutMs: 60_000 });
  } catch (error) {
    throw stageError("EXTRACT", error);
  }
  const contents = extracted(response.data);
  const evidence = selected.flatMap((item, index) => {
    const snippet = contents.get(item.url);
    return snippet ? [{
      id: `source_${String(index + 1).padStart(2, "0")}`,
      title: item.title,
      url: item.url,
      domain: item.domain,
      queryKind: item.queryKind,
      snippet,
      score: item.score,
    }] : [];
  });
  return { evidence, credits: searchCredits + credits(response.data) };
}

export function hasEnoughExplorationEvidence(evidence: readonly ExplorationEvidenceSource[]): boolean {
  return evidence.length >= 4 && new Set(evidence.map((item) => item.domain)).size >= 2 &&
    new Set(evidence.map((item) => item.queryKind)).size >= 2;
}
