import { fetchJsonWithRetry, type RetryOptions } from "../ingestion/http-client";
import type { BriefPayload, NarrationScript, SourceKind } from "../domain/types";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/iu;
const LATIN_TERM_PATTERN = /[A-Za-z][A-Za-z0-9.+#_-]{1,}/gu;
const NUMBER_PATTERN = /\d+(?:[.,]\d+)*(?:%|％)?|百分之[零一二三四五六七八九十百千万两]+/gu;

type Validation = { ok: true; value: NarrationScript } | { ok: false; errors: string[] };

function codePoints(value: string): number {
  return Array.from(value).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseScript(value: unknown): NarrationScript | null {
  if (!isRecord(value) || typeof value.opening_zh !== "string" || typeof value.closing_zh !== "string" || !Array.isArray(value.items)) return null;
  const items: NarrationScript["items"] = [];
  for (const item of value.items) {
    if (!isRecord(item) || typeof item.entity_id !== "string" || typeof item.text_zh !== "string") return null;
    items.push({ entity_id: item.entity_id, text_zh: item.text_zh });
  }
  return { opening_zh: value.opening_zh, items, closing_zh: value.closing_zh };
}

function newTokens(text: string, evidence: string, pattern: RegExp): boolean {
  return [...text.matchAll(pattern)].some((match) => !evidence.toLocaleLowerCase().includes(match[0].toLocaleLowerCase()));
}

export function validateNarration(value: unknown, brief: BriefPayload): Validation {
  const script = parseScript(value);
  if (!script) return { ok: false, errors: ["INVALID_SHAPE"] };
  const errors = new Set<string>();
  if (!script.opening_zh.startsWith("本期音频由人工智能语音合成。")) errors.add("MISSING_SYNTHETIC_NOTICE");
  if (script.items.length < 5 || script.items.length > 7) errors.add("ITEM_COUNT");
  if (codePoints(script.opening_zh) < 40 || codePoints(script.opening_zh) > 100) errors.add("OPENING_LENGTH");
  if (codePoints(script.closing_zh) < 20 || codePoints(script.closing_zh) > 60) errors.add("CLOSING_LENGTH");
  const totalLength = codePoints(script.opening_zh) + codePoints(script.closing_zh) + script.items.reduce((sum, item) => sum + codePoints(item.text_zh), 0);
  if (totalLength < 650 || totalLength > 900) errors.add("TOTAL_LENGTH");

  const itemById = new Map(brief.items.map((item) => [item.entityId, item]));
  const ranks: number[] = [];
  const seen = new Set<string>();
  const coveredSources = new Set<SourceKind>();
  for (const narrationItem of script.items) {
    const item = itemById.get(narrationItem.entity_id);
    if (!item) {
      errors.add("UNKNOWN_ENTITY");
      continue;
    }
    if (seen.has(item.entityId)) errors.add("DUPLICATE_ENTITY");
    seen.add(item.entityId);
    ranks.push(item.rank);
    if (codePoints(narrationItem.text_zh) < 75 || codePoints(narrationItem.text_zh) > 130) errors.add("ITEM_LENGTH");
    if (URL_PATTERN.test(narrationItem.text_zh)) errors.add("URL_PRESENT");
    const evidence = `${item.title}\n${item.summary}\n${item.whyItMatters}`;
    if (newTokens(narrationItem.text_zh, evidence, NUMBER_PATTERN)) errors.add("NEW_NUMBER");
    if (newTokens(narrationItem.text_zh, evidence, LATIN_TERM_PATTERN)) errors.add("NEW_LATIN_TERM");
    for (const source of item.sources) coveredSources.add(source.source);
  }
  if (ranks.some((rank, index) => index > 0 && rank <= (ranks[index - 1] ?? 0))) errors.add("RANK_ORDER");
  const briefSources = new Set(brief.items.flatMap((item) => item.sources.map((source) => source.source)));
  if (briefSources.size >= 3 && coveredSources.size < 3) errors.add("SOURCE_COVERAGE");
  if (URL_PATTERN.test(`${script.opening_zh}\n${script.closing_zh}`)) errors.add("URL_PRESENT");
  return errors.size === 0 ? { ok: true, value: script } : { ok: false, errors: [...errors].sort() };
}

function systemPrompt(): string {
  return `You write a factual Chinese spoken script for a daily technology brief. Return JSON only:
{"opening_zh":"string","items":[{"entity_id":"string","text_zh":"string"}],"closing_zh":"string"}
Use exactly the required_entity_ids supplied by the user, once each and in that order. Total Unicode code points: 650-900. Set opening_zh exactly to: 本期音频由人工智能语音合成。欢迎收听今天的技术与产品简报，接下来按原有排名介绍值得关注的公开变化。 Write exactly four complete sentences totaling 115-125 code points for every item. The closing must be exactly two complete sentences totaling 30-45 code points: summarize that the brief is complete, then direct listeners to the page for text and sources. Hard limits are opening 40-100, each item 75-130, closing 20-60.
Do not read tags, URLs, source lists, or feedback. Do not add facts, advice, predictions, evaluations, numbers, versions, percentages, or Latin technical names absent from the corresponding item evidence.`;
}

function plannedItems(brief: BriefPayload): BriefPayload["items"] {
  const selected = brief.items.slice(0, Math.min(5, brief.items.length));
  const allSources = new Set(brief.items.flatMap((item) => item.sources.map((source) => source.source)));
  const selectedSources = new Set(selected.flatMap((item) => item.sources.map((source) => source.source)));
  if (allSources.size >= 3) {
    for (const item of brief.items) {
      if (selected.length >= 7 || selectedSources.size >= 3) break;
      if (selected.includes(item)) continue;
      const addsSource = item.sources.some((source) => !selectedSources.has(source.source));
      if (!addsSource) continue;
      selected.push(item);
      for (const source of item.sources) selectedSources.add(source.source);
    }
  }
  for (const item of brief.items) {
    if (selected.length >= 7) break;
    if (!selected.includes(item)) selected.push(item);
  }
  return selected.sort((left, right) => left.rank - right.rank);
}

function lengthDiagnostics(value: unknown): string {
  const script = parseScript(value);
  if (!script) return "invalid-shape";
  const lengths = script.items.map((item) => codePoints(item.text_zh));
  const total = codePoints(script.opening_zh) + codePoints(script.closing_zh) + lengths.reduce((sum, length) => sum + length, 0);
  return `opening=${String(codePoints(script.opening_zh))};items=${lengths.join("/")};closing=${String(codePoints(script.closing_zh))};total=${String(total)}`;
}

function briefInput(brief: BriefPayload): string {
  const items = plannedItems(brief);
  return JSON.stringify({
    date: brief.date,
    headline: brief.headline,
    intro: brief.intro,
    required_entity_ids: items.map((item) => item.entityId),
    items: items.map((item) => ({
      rank: item.rank,
      entity_id: item.entityId,
      title: item.title,
      summary: item.summary,
      why_it_matters: item.whyItMatters,
      source_kinds: [...new Set(item.sources.map((source) => source.source))],
    })),
  });
}

async function complete(apiKey: string, messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, options: RetryOptions): Promise<string> {
  const response = await fetchJsonWithRetry<unknown>(DEEPSEEK_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages,
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 5000,
      stream: false,
    }),
  }, { ...options, timeoutMs: 120_000 });
  if (!isRecord(response.data) || !Array.isArray(response.data.choices) || !isRecord(response.data.choices[0]) || !isRecord(response.data.choices[0].message) || typeof response.data.choices[0].message.content !== "string") {
    throw new Error("NARRATION_INVALID_RESPONSE");
  }
  return response.data.choices[0].message.content;
}

function parseJson(content: string): unknown {
  try { return JSON.parse(content); } catch { return null; }
}

export async function generateNarration(apiKey: string, brief: BriefPayload, options: RetryOptions = {}): Promise<NarrationScript> {
  const system = systemPrompt();
  const user = briefInput(brief);
  const first = await complete(apiKey, [{ role: "system", content: system }, { role: "user", content: user }], options);
  const firstValidation = validateNarration(parseJson(first), brief);
  if (firstValidation.ok) return firstValidation.value;
  const repaired = await complete(apiKey, [
    { role: "system", content: system },
    { role: "user", content: user },
    { role: "assistant", content: first },
    { role: "user", content: `Rewrite the complete response once; do not reuse short item text. Validation error codes: ${firstValidation.errors.join(",")}. Measured Unicode code point lengths: ${lengthDiagnostics(parseJson(first))}. Use exactly the required_entity_ids in order. Set opening_zh exactly to: 本期音频由人工智能语音合成。欢迎收听今天的技术与产品简报，接下来按原有排名介绍值得关注的公开变化。 Every item must contain exactly four complete sentences totaling 115-125 code points, using only that item's supplied evidence. Write two complete sentences totaling 35-45 for the closing. Keep the complete script between 750 and 880 code points. Do not introduce any number, percentage, version, or Latin technical name unless copied verbatim from that item's evidence. Return the complete JSON only.` },
  ], options);
  const repairValidation = validateNarration(parseJson(repaired), brief);
  if (!repairValidation.ok) throw new Error(`NARRATION_VALIDATION_FAILED:${repairValidation.errors.join(",")}`);
  return repairValidation.value;
}

export function narrationTranscript(script: NarrationScript): string {
  return [script.opening_zh, ...script.items.map((item) => item.text_zh), script.closing_zh].join("\n\n");
}
