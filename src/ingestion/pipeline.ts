import { generateBrief, type EntityCatalogEntry, type GeneratedBriefResult } from "../domain/deepseek";
import type {
  BriefStatus,
  GeneratedBrief,
  PipelineStage,
  SearchCandidate,
  SourceKind,
  StoredCandidate,
} from "../domain/types";
import { SOURCE_KINDS } from "../domain/types";
import {
  beginRun,
  deleteExpiredStaging,
  finishRun,
  getBriefState,
  getCandidates,
  getEntityCatalog,
  getFeedbackPreferences,
  replaceBrief,
  updateBriefStatus,
  upsertCandidates,
  type BriefDraft,
  type BriefDraftItem,
} from "../storage/repository";
import { selectCandidates } from "./selection";
import { extractCandidates, searchSource, type ExtractCandidatesResult, type SearchSourceResult } from "./tavily";
import { findHackerNewsOriginalUrl } from "./urls";

export interface PipelineDependencies {
  search: (
    apiKey: string,
    source: SourceKind,
    collectionDate: string,
  ) => Promise<SearchSourceResult>;
  extract: (apiKey: string, candidates: readonly SearchCandidate[]) => Promise<ExtractCandidatesResult>;
  generate: (
    apiKey: string,
    targetDate: string,
    candidates: readonly StoredCandidate[],
    entities: readonly EntityCatalogEntry[],
  ) => Promise<GeneratedBriefResult>;
}

export interface PipelineInvocation {
  stage: PipelineStage;
  targetDate: string;
  scheduledTime: number;
}

export type PipelineResult =
  | { outcome: "idempotent-skip" | "complete-noop" }
  | { outcome: "collected"; successfulSources: number }
  | { outcome: "no-candidates"; successfulSources: number }
  | { outcome: "published"; status: BriefStatus; successfulSources: number }
  | { outcome: "unchanged-noop"; status: BriefStatus; successfulSources: number }
  | { outcome: "kept-existing" | "model-failed"; successfulSources: number; errorCode: string };

const DEFAULT_DEPENDENCIES: PipelineDependencies = {
  search: searchSource,
  extract: extractCandidates,
  generate: generateBrief,
};

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function cutoffDate(targetDate: string): string {
  const timestamp = Date.parse(`${targetDate}T00:00:00.000Z`) - 30 * 24 * 60 * 60 * 1000;
  return isoDate(timestamp);
}

function sourceLabel(source: SourceKind): string {
  switch (source) {
    case "hacker-news":
      return "Hacker News";
    case "product-hunt":
      return "Product Hunt";
    case "github":
      return "GitHub";
    case "kickstarter":
      return "Kickstarter";
  }
}

async function refreshCandidates(
  env: Pick<Env, "DB" | "TAVILY_API_KEY">,
  invocation: PipelineInvocation,
  sources: readonly SourceKind[],
  dependencies: PipelineDependencies,
): Promise<{
  successful: SourceKind[];
  failed: SourceKind[];
  credits: number;
  changed: boolean;
}> {
  const collectionDate = isoDate(invocation.scheduledTime);
  const settled = await Promise.all(
    sources.map(async (source) => {
      try {
        return { source, result: await dependencies.search(env.TAVILY_API_KEY, source, collectionDate) };
      } catch {
        return { source, result: null };
      }
    }),
  );
  const successful = settled
    .filter((entry) => entry.result !== null && entry.result.candidates.length > 0)
    .map((entry) => entry.source);
  const failed = settled
    .filter((entry) => entry.result === null || entry.result.candidates.length === 0)
    .map((entry) => entry.source);
  const discovered = settled.flatMap((entry) => entry.result?.candidates ?? []);
  let credits = settled.reduce((total, entry) => total + (entry.result?.credits ?? 0), 0);
  const preferences = await getFeedbackPreferences(env.DB);
  const selected = selectCandidates(discovered, 30, preferences);
  const existing = await getCandidates(env.DB, invocation.targetDate);
  const existingByKey = new Map(existing.map((candidate) => [`${candidate.source}\u0000${candidate.canonicalKey}`, candidate]));
  const fingerprints = new Map<string, string>();
  await Promise.all(
    selected.map(async (candidate) => {
      fingerprints.set(candidate.platformUrl, await hash(`${candidate.title}\n${candidate.snippet}`));
    }),
  );
  const needsExtract = selected.filter((candidate) => {
    const previous = existingByKey.get(`${candidate.source}\u0000${candidate.canonicalKey}`);
    return !previous || previous.contentHash !== fingerprints.get(candidate.platformUrl);
  });
  const extraction = await dependencies.extract(env.TAVILY_API_KEY, needsExtract);
  credits += extraction.credits;
  const now = new Date(invocation.scheduledTime).toISOString();
  const stored = await Promise.all(
    selected.map(async (candidate): Promise<StoredCandidate> => {
      const previous = existingByKey.get(`${candidate.source}\u0000${candidate.canonicalKey}`);
      const evidence = extraction.evidence.get(candidate.platformUrl) ?? previous?.extractedContent ?? candidate.snippet;
      const originalUrl =
        candidate.source === "hacker-news" ? findHackerNewsOriginalUrl(evidence) : previous?.originalUrl ?? null;
      return {
        ...candidate,
        id: previous?.id ?? `candidate_${(await hash(`${invocation.targetDate}:${candidate.source}:${candidate.platformUrl}`)).slice(0, 32)}`,
        targetDate: invocation.targetDate,
        originalUrl,
        extractedContent: evidence,
        contentHash: fingerprints.get(candidate.platformUrl) ?? (await hash(`${candidate.title}\n${candidate.snippet}`)),
      };
    }),
  );
  await upsertCandidates(env.DB, stored, now);
  return { successful, failed, credits, changed: needsExtract.length > 0 };
}

function canonicalCandidate(candidates: readonly StoredCandidate[]): StoredCandidate {
  const priorities: SourceKind[] = ["github", "product-hunt", "kickstarter", "hacker-news"];
  const first = candidates.slice().sort((a, b) => priorities.indexOf(a.source) - priorities.indexOf(b.source))[0];
  if (!first) throw new Error("EMPTY_CANDIDATE_GROUP");
  return first;
}

export function buildBriefDraft(
  generated: GeneratedBrief,
  candidates: readonly StoredCandidate[],
  entities: readonly EntityCatalogEntry[],
  targetDate: string,
  status: BriefStatus,
  missingSources: SourceKind[],
  generatedAt: string,
  publishAt = `${targetDate}T00:00:00.000Z`,
): BriefDraft {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const items: BriefDraftItem[] = generated.items.map((item) => {
    const itemCandidates = item.candidate_ids.flatMap((id) => {
      const candidate = candidateById.get(id);
      return candidate ? [candidate] : [];
    });
    if (itemCandidates.length === 0) throw new Error("EMPTY_BRIEF_ITEM");
    const selected = canonicalCandidate(itemCandidates);
    const existing = item.existing_entity_id ? entityById.get(item.existing_entity_id) : null;
    if (item.existing_entity_id && !existing) throw new Error("UNKNOWN_ENTITY");
    const aliases = [...new Set(itemCandidates.map((candidate) => candidate.title))];
    const links = itemCandidates.flatMap((candidate) => {
      const platform = {
        candidateId: candidate.id,
        source: candidate.source,
        kind: "platform" as const,
        label: sourceLabel(candidate.source),
        url: candidate.platformUrl,
      };
      return candidate.originalUrl && candidate.originalUrl !== candidate.platformUrl
        ? [
            platform,
            {
              candidateId: candidate.id,
              source: candidate.source,
              kind: "original" as const,
              label: "原文",
              url: candidate.originalUrl,
            },
          ]
        : [platform];
    });
    const uniqueLinks = links.filter(
      (link, index) => links.findIndex((other) => other.source === link.source && other.url === link.url) === index,
    );
    return {
      entity: existing
        ? {
            canonicalKey: existing.canonicalKey,
            canonicalTitle: existing.canonicalTitle,
            canonicalUrl: existing.canonicalUrl,
            aliases: [...new Set([...existing.aliases, ...aliases])],
          }
        : {
            canonicalKey: selected.canonicalKey,
            canonicalTitle: selected.title,
            canonicalUrl: selected.originalUrl ?? selected.canonicalUrl,
            aliases,
          },
      title: item.title_zh,
      summary: item.summary_zh,
      whyItMatters: item.why_it_matters_zh,
      tags: item.tags_zh,
      continuity:
        item.update_kind === "continuing" && existing && item.material_change_zh
          ? { kind: "continuing", previousDate: existing.lastSeenDate, materialChange: item.material_change_zh }
          : { kind: "new" },
      sources: uniqueLinks,
    };
  });
  return {
    date: targetDate,
    status,
    publishAt,
    generatedAt,
    headline: generated.headline_zh,
    intro: generated.intro_zh,
    missingSources,
    model: "deepseek-v4-flash",
    promptVersion: "v3-daily-date",
    items,
  };
}

export async function runPipelineStage(
  env: Pick<Env, "DB" | "TAVILY_API_KEY" | "DEEPSEEK_API_KEY">,
  invocation: PipelineInvocation,
  dependencies: PipelineDependencies = DEFAULT_DEPENDENCIES,
): Promise<PipelineResult> {
  const existingBrief = await getBriefState(env.DB, invocation.targetDate);
  if (invocation.stage === "recovery" && existingBrief?.status === "complete") return { outcome: "complete-noop" };

  const startedAt = new Date(invocation.scheduledTime).toISOString();
  const run = await beginRun(env.DB, invocation.targetDate, invocation.stage, startedAt);
  if (run.skipped) return { outcome: "idempotent-skip" };
  const attemptedSources =
    invocation.stage === "recovery" && existingBrief ? existingBrief.missingSources : SOURCE_KINDS;
  const refresh = await refreshCandidates(env, invocation, attemptedSources, dependencies);
  const missingSources =
    invocation.stage === "recovery" && existingBrief
      ? existingBrief.missingSources.filter((source) => !refresh.successful.includes(source))
      : refresh.failed;
  const successfulSources = SOURCE_KINDS.length - missingSources.length;
  const sourceStatus = Object.fromEntries(
    SOURCE_KINDS.map((source) => [source, missingSources.includes(source) ? "failed" : "succeeded"]),
  );

  if (invocation.stage === "collect") {
    await deleteExpiredStaging(env.DB, cutoffDate(invocation.targetDate));
    await finishRun(env.DB, run.id, {
      status: "succeeded",
      sourceStatus,
      errorCode: null,
      usageCredits: refresh.credits,
      finishedAt: new Date().toISOString(),
    });
    return { outcome: "collected", successfulSources };
  }

  const candidates = await getCandidates(env.DB, invocation.targetDate);
  if (candidates.length === 0) {
    await finishRun(env.DB, run.id, {
      status: "failed",
      sourceStatus,
      errorCode: "NO_USABLE_CANDIDATES",
      usageCredits: refresh.credits,
      finishedAt: new Date().toISOString(),
    });
    return { outcome: "no-candidates", successfulSources };
  }

  const desiredStatus: BriefStatus = missingSources.length === 0 ? "complete" : "partial";
  if (existingBrief && !refresh.changed) {
    await updateBriefStatus(env.DB, invocation.targetDate, desiredStatus, missingSources);
    await finishRun(env.DB, run.id, {
      status: "succeeded",
      sourceStatus,
      errorCode: null,
      usageCredits: refresh.credits,
      finishedAt: new Date().toISOString(),
    });
    return { outcome: "unchanged-noop", status: desiredStatus, successfulSources };
  }

  try {
    const entities = await getEntityCatalog(env.DB, invocation.targetDate);
    const generated = await dependencies.generate(env.DEEPSEEK_API_KEY, invocation.targetDate, candidates, entities);
    if (generated.brief.items.length === 0) throw new Error("EMPTY_GENERATED_BRIEF");
    const status = desiredStatus;
    await replaceBrief(
      env.DB,
      buildBriefDraft(generated.brief, candidates, entities, invocation.targetDate, status, missingSources, new Date().toISOString()),
    );
    await finishRun(env.DB, run.id, {
      status: "succeeded",
      sourceStatus,
      errorCode: null,
      usageCredits: refresh.credits,
      finishedAt: new Date().toISOString(),
    });
    return { outcome: "published", status, successfulSources };
  } catch (error) {
    const rawCode = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const errorCode = /^[A-Z][A-Z0-9_]*(?::[A-Z0-9_,]+)?$/u.test(rawCode) ? rawCode : "UNKNOWN_ERROR";
    await finishRun(env.DB, run.id, {
      status: "failed",
      sourceStatus,
      errorCode,
      usageCredits: refresh.credits,
      finishedAt: new Date().toISOString(),
    });
    return { outcome: existingBrief ? "kept-existing" : "model-failed", successfulSources, errorCode };
  }
}
