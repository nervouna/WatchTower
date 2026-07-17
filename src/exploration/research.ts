import type {
  ExplorationEvidenceSource,
  ExplorationQueryKind,
  ExplorationSeed,
} from "../domain/types";
import { fetchJsonWithRetry, type RetryOptions } from "../ingestion/http-client";
import { normalizePublicUrl } from "../ingestion/urls";

const SEARCH_ENDPOINT = "https://api.tavily.com/search";
const EXTRACT_ENDPOINT = "https://api.tavily.com/extract";

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
  const subject = [
    seed.title,
    seed.tags.join(" "),
    seed.summary.slice(0, 240),
    seed.whyItMatters.slice(0, 120),
    seed.canonicalUrl,
    ...seed.sourceUrls.slice(0, 4),
  ].filter(Boolean).join(" ");
  return {
    context: `${subject} official documentation background latest release changes`,
    products: `${subject} alternatives competitors complementary products comparison`,
    perspectives: `${subject} review community discussion criticism user experience`,
    industry: `${subject} industry trend adoption market position ecosystem impact`,
  };
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
  const searchCredits = successful.reduce((total, result) => total + result.credits, 0);
  const selected = selectExplorationPages(successful.flatMap((result) => result.candidates));
  if (selected.length === 0) return { evidence: [], credits: searchCredits };

  let extractData: unknown;
  let extractCredits: number;
  try {
    const response = await fetchJsonWithRetry<unknown>(EXTRACT_ENDPOINT, {
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
    extractData = response.data;
    extractCredits = credits(response.data);
  } catch {
    return { evidence: [], credits: searchCredits };
  }
  const contents = extracted(extractData);
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
  return { evidence, credits: searchCredits + extractCredits };
}

export function hasEnoughExplorationEvidence(evidence: readonly ExplorationEvidenceSource[]): boolean {
  return evidence.length >= 4 && new Set(evidence.map((item) => item.domain)).size >= 2 &&
    new Set(evidence.map((item) => item.queryKind)).size >= 2;
}
