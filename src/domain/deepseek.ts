import { validateGeneratedBrief } from "./generated-brief";
import type { FeedbackValue, GeneratedBrief, StoredCandidate } from "./types";
import { fetchJsonWithRetry, type RetryOptions } from "../ingestion/http-client";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";

export interface EntityCatalogEntry {
  id: string;
  canonicalKey: string;
  canonicalTitle: string;
  canonicalUrl: string;
  aliases: string[];
  lastSeenDate: string;
  previousSummary: string | null;
  feedback: FeedbackValue | null;
}

type DeepSeekOptions = RetryOptions;

interface CompletionContent {
  content: string;
  totalTokens: number;
}

export interface GeneratedBriefResult {
  brief: GeneratedBrief;
  repaired: boolean;
  totalTokens: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCompletion(value: unknown): CompletionContent {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0])) throw new Error("DEEPSEEK_INVALID_RESPONSE");
  const message = value.choices[0].message;
  if (!isRecord(message) || typeof message.content !== "string") throw new Error("DEEPSEEK_INVALID_RESPONSE");
  const totalTokens = isRecord(value.usage) && typeof value.usage.total_tokens === "number" ? value.usage.total_tokens : 0;
  return { content: message.content, totalTokens };
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function buildSystemPrompt(): string {
  return `You are the editor of a Chinese daily technology brief for developers and product people.
Return JSON only. The JSON object must exactly follow this shape:
{"headline_zh":"string","intro_zh":"string","items":[{"candidate_ids":["id"],"existing_entity_id":null,"title_zh":"string","summary_zh":"string","why_it_matters_zh":"string","tags_zh":["string"],"update_kind":"new","material_change_zh":null}]}
All lengths are Unicode code points, including punctuation:
- headline_zh: 8-60
- intro_zh: 40-180
- title_zh: 2-80
- summary_zh: 60-240
- why_it_matters_zh: 20-120
- tags_zh: 2-4 tags, each 1-20
Aim for 120-180 code points in every summary_zh and 50-90 in every why_it_matters_zh. These are deliberate multi-sentence Chinese paragraphs, not short taglines.
For update_kind "continuing", existing_entity_id and non-empty material_change_zh are required. For "new", both must be null.
Return between 1 and 20 items. Each candidate ID may appear in exactly one item. If every source has at least 3 candidates, include every source in at least 3 aggregated items; a cross-source item counts for each represented source.
Never output or invent URLs. Merge only the same real product, repository, campaign, or concrete event. Do not merge items merely because they share a broad category. Use only supplied evidence. Rank by current relevance. Do not pad weak or duplicate items.`;
}

function buildCatalog(candidates: readonly StoredCandidate[], entities: readonly EntityCatalogEntry[]): string {
  const feedbackByKey = new Map(entities.map((entity) => [entity.canonicalKey, entity.feedback]));
  return JSON.stringify({
    candidate_catalog: candidates.map((candidate) => ({
      id: candidate.id,
      source: candidate.source,
      canonical_key: candidate.canonicalKey,
      title: candidate.title,
      evidence: candidate.extractedContent ?? candidate.snippet,
      feedback: feedbackByKey.get(candidate.canonicalKey) ?? null,
    })),
    entity_catalog: entities.map((entity) => ({
      id: entity.id,
      canonical_key: entity.canonicalKey,
      title: entity.canonicalTitle,
      aliases: entity.aliases,
      last_seen_date: entity.lastSeenDate,
      previous_summary: entity.previousSummary,
      feedback: entity.feedback,
    })),
    instructions: {
      continuing_requires_material_change: true,
      material_changes: ["new source", "new version", "major capability", "public launch", "funding", "crowdfunding milestone", "material popularity milestone"],
      suppress_unchanged_repeats: true,
      feedback_policy: {
        follow: "Prioritize only when there is a material change.",
        irrelevant: "Never include this entity.",
        uninteresting: "Deprioritize unless there is a major material change.",
      },
      language: "Chinese",
    },
  });
}

async function complete(
  apiKey: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: DeepSeekOptions,
): Promise<CompletionContent> {
  const response = await fetchJsonWithRetry<unknown>(
    DEEPSEEK_ENDPOINT,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 12000,
        stream: false,
      }),
    },
    { ...options, timeoutMs: 120_000 },
  );
  return parseCompletion(response.data);
}

export async function generateBrief(
  apiKey: string,
  candidates: readonly StoredCandidate[],
  entities: readonly EntityCatalogEntry[],
  options: DeepSeekOptions = {},
): Promise<GeneratedBriefResult> {
  const system = buildSystemPrompt();
  const user = buildCatalog(candidates, entities);
  const catalog = new Map(candidates.map((candidate) => [candidate.id, { source: candidate.source }]));
  const entityIds = new Set(entities.map((entity) => entity.id));
  const excludedEntityIds = new Set(entities.filter((entity) => entity.feedback === "irrelevant").map((entity) => entity.id));
  const first = await complete(apiKey, [{ role: "system", content: system }, { role: "user", content: user }], options);
  const firstValidation = validateGeneratedBrief(parseJson(first.content), {
    candidates: catalog,
    entities: entityIds,
    enforceSourceQuota: true,
    excludedEntityIds,
  });
  if (firstValidation.ok) return { brief: firstValidation.value, repaired: false, totalTokens: first.totalTokens };

  const repair = await complete(
    apiKey,
    [
      { role: "system", content: system },
      { role: "user", content: user },
      { role: "assistant", content: first.content },
      {
        role: "user",
        content:
          `Repair the response and return the complete JSON object only. Validation error codes: ${firstValidation.errors.join(",")}. ` +
          `Allowed candidate IDs: ${candidates.map((candidate) => candidate.id).join(",")}. ` +
          `Allowed entity IDs: ${entities.map((entity) => entity.id).join(",") || "none"}. ` +
          "Delete unknown IDs and never invent IDs. Use each candidate at most once. " +
          "Safe length targets in Unicode code points: headline_zh target: 12-40; intro_zh target: 60-140; " +
          "summary_zh target: 120-180; why_it_matters_zh target: 50-90; title_zh target: 6-50. " +
          "Rewrite every flagged field as a complete multi-sentence Chinese paragraph and count conservatively.",
      },
    ],
    options,
  );
  const repairValidation = validateGeneratedBrief(parseJson(repair.content), {
    candidates: catalog,
    entities: entityIds,
    enforceSourceQuota: true,
    excludedEntityIds,
  });
  if (!repairValidation.ok) throw new Error(`DEEPSEEK_VALIDATION_FAILED:${repairValidation.errors.join(",")}`);
  return { brief: repairValidation.value, repaired: true, totalTokens: first.totalTokens + repair.totalTokens };
}
