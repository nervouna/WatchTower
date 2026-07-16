import {
  SOURCE_KINDS,
  type BriefListPayload,
  type BriefPayload,
  type BriefStatus,
  type Continuity,
  type FeedbackValue,
  type PipelineStage,
  type SourceKind,
  type SourceLink,
  type StoredCandidate,
} from "../domain/types";
import type { EntityCatalogEntry } from "../domain/deepseek";

export interface BriefDraftEntity {
  canonicalKey: string;
  canonicalTitle: string;
  canonicalUrl: string;
  aliases: string[];
}

export interface BriefDraftSource extends SourceLink {
  candidateId: string | null;
}

export interface BriefDraftItem {
  entity: BriefDraftEntity;
  title: string;
  summary: string;
  whyItMatters: string;
  tags: string[];
  continuity: Continuity;
  sources: BriefDraftSource[];
}

export interface BriefDraft {
  date: string;
  status: BriefStatus;
  publishAt: string;
  generatedAt: string;
  headline: string;
  intro: string;
  missingSources: SourceKind[];
  model: string;
  promptVersion: string;
  items: BriefDraftItem[];
}

export type FeedbackMap = Record<string, FeedbackValue>;

interface BriefRow {
  brief_date: string;
  status: BriefStatus;
  publish_at: string;
  generated_at: string;
  headline: string;
  intro: string;
  missing_sources_json: string;
}

interface BriefItemRow {
  id: string;
  rank: number;
  entity_id: string;
  title: string;
  summary: string;
  why_it_matters: string;
  tags_json: string;
  continuity: "new" | "continuing";
  material_change: string | null;
  previous_brief_date: string | null;
}

interface SourceRow {
  brief_item_id: string;
  source: SourceKind;
  kind: "platform" | "original";
  label: string;
  url: string;
}

interface RunRow {
  id: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  attempt_count: number;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function parseSourceArray(value: string): SourceKind[] {
  return parseStringArray(value).filter((source): source is SourceKind => SOURCE_KINDS.includes(source as SourceKind));
}

async function stableId(prefix: string, value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hash.slice(0, 32)}`;
}

export async function beginRun(
  db: D1Database,
  targetDate: string,
  stage: PipelineStage,
  startedAt: string,
): Promise<{ id: string; skipped: boolean; attempt: number }> {
  const existing = await db
    .prepare("SELECT id, status, attempt_count FROM ingestion_runs WHERE target_date = ? AND stage = ?")
    .bind(targetDate, stage)
    .first<RunRow>();
  if (existing?.status === "succeeded") return { id: existing.id, skipped: true, attempt: existing.attempt_count };

  const id = existing?.id ?? (await stableId("run", `${targetDate}:${stage}`));
  const attempt = (existing?.attempt_count ?? 0) + 1;
  await db
    .prepare(
      `INSERT INTO ingestion_runs (id, target_date, stage, status, attempt_count, started_at)
       VALUES (?, ?, ?, 'running', ?, ?)
       ON CONFLICT(target_date, stage) DO UPDATE SET
         status = 'running', attempt_count = excluded.attempt_count, error_code = NULL,
         started_at = excluded.started_at, finished_at = NULL`,
    )
    .bind(id, targetDate, stage, attempt, startedAt)
    .run();
  return { id, skipped: false, attempt };
}

export async function finishRun(
  db: D1Database,
  id: string,
  result: {
    status: "succeeded" | "failed" | "skipped";
    sourceStatus: Partial<Record<SourceKind, string>>;
    errorCode: string | null;
    usageCredits: number;
    finishedAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE ingestion_runs
       SET status = ?, source_status_json = ?, error_code = ?, usage_credits = ?, finished_at = ?
       WHERE id = ?`,
    )
    .bind(result.status, JSON.stringify(result.sourceStatus), result.errorCode, result.usageCredits, result.finishedAt, id)
    .run();
}

export async function upsertCandidates(db: D1Database, candidates: readonly StoredCandidate[], updatedAt: string): Promise<void> {
  if (candidates.length === 0) return;
  const statements = candidates.map((candidate) =>
    db
      .prepare(
        `INSERT INTO candidates (
           id, target_date, source, platform_url, canonical_key, canonical_url, original_url,
           title, snippet, extracted_content, search_score, search_rank, content_hash, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(target_date, source, platform_url) DO UPDATE SET
           canonical_key = excluded.canonical_key, canonical_url = excluded.canonical_url,
           original_url = excluded.original_url, title = excluded.title, snippet = excluded.snippet,
           extracted_content = excluded.extracted_content, search_score = excluded.search_score,
           search_rank = excluded.search_rank, content_hash = excluded.content_hash,
           updated_at = excluded.updated_at`,
      )
      .bind(
        candidate.id,
        candidate.targetDate,
        candidate.source,
        candidate.platformUrl,
        candidate.canonicalKey,
        candidate.canonicalUrl,
        candidate.originalUrl,
        candidate.title,
        candidate.snippet,
        candidate.extractedContent,
        candidate.score,
        candidate.rank,
        candidate.contentHash,
        updatedAt,
        updatedAt,
      ),
  );
  await db.batch(statements);
}

export async function getCandidates(db: D1Database, targetDate: string): Promise<StoredCandidate[]> {
  const result = await db
    .prepare(
      `SELECT id, target_date, source, platform_url, canonical_key, canonical_url, original_url,
              title, snippet, extracted_content, search_score, search_rank, content_hash
       FROM candidates WHERE target_date = ? ORDER BY source, search_rank`,
    )
    .bind(targetDate)
    .all<{
      id: string;
      target_date: string;
      source: SourceKind;
      platform_url: string;
      canonical_key: string;
      canonical_url: string;
      original_url: string | null;
      title: string;
      snippet: string;
      extracted_content: string | null;
      search_score: number;
      search_rank: number;
      content_hash: string;
    }>();
  return result.results.map((row) => ({
    id: row.id,
    targetDate: row.target_date,
    source: row.source,
    platformUrl: row.platform_url,
    canonicalKey: row.canonical_key,
    canonicalUrl: row.canonical_url,
    originalUrl: row.original_url,
    title: row.title,
    snippet: row.snippet,
    extractedContent: row.extracted_content,
    score: row.search_score,
    rank: row.search_rank,
    contentHash: row.content_hash,
  }));
}

export async function getEntityCatalog(db: D1Database, targetDate: string): Promise<EntityCatalogEntry[]> {
  const result = await db
    .prepare(
      `SELECT entity.id, entity.canonical_key, entity.canonical_title, entity.canonical_url,
              entity.aliases_json, entity.last_seen_date, feedback.feedback,
              (SELECT item.summary FROM brief_items AS item
               WHERE item.entity_id = entity.id AND item.brief_date < ?
               ORDER BY item.brief_date DESC LIMIT 1) AS previous_summary
       FROM entities AS entity
       LEFT JOIN entity_feedback AS feedback ON feedback.entity_id = entity.id
       WHERE entity.canonical_key NOT LIKE 'event:%'
          OR entity.last_seen_date >= date(?, '-14 day')
       ORDER BY entity.last_seen_date DESC LIMIT 500`,
    )
    .bind(targetDate, targetDate)
    .all<{
      id: string;
      canonical_key: string;
      canonical_title: string;
      canonical_url: string;
      aliases_json: string;
      last_seen_date: string;
      previous_summary: string | null;
      feedback: FeedbackValue | null;
    }>();
  return result.results.map((row) => ({
    id: row.id,
    canonicalKey: row.canonical_key,
    canonicalTitle: row.canonical_title,
    canonicalUrl: row.canonical_url,
    aliases: parseStringArray(row.aliases_json),
    lastSeenDate: row.last_seen_date,
    previousSummary: row.previous_summary,
    feedback: row.feedback,
  }));
}

export async function getFeedbackPreferences(db: D1Database): Promise<Map<string, FeedbackValue>> {
  const result = await db
    .prepare(
      `SELECT entity.canonical_key, feedback.feedback
       FROM entity_feedback AS feedback
       JOIN entities AS entity ON entity.id = feedback.entity_id`,
    )
    .all<{ canonical_key: string; feedback: FeedbackValue }>();
  return new Map(result.results.map((row) => [row.canonical_key, row.feedback]));
}

export async function getEntityFeedback(db: D1Database, entityIds: readonly string[]): Promise<FeedbackMap> {
  if (entityIds.length === 0) return {};
  const placeholders = entityIds.map(() => "?").join(", ");
  const result = await db
    .prepare(`SELECT entity_id, feedback FROM entity_feedback WHERE entity_id IN (${placeholders})`)
    .bind(...entityIds)
    .all<{ entity_id: string; feedback: FeedbackValue }>();
  return Object.fromEntries(result.results.map((row) => [row.entity_id, row.feedback]));
}

export async function setEntityFeedback(
  db: D1Database,
  entityId: string,
  value: FeedbackValue,
  sourceBriefDate: string,
  updatedAt: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO entity_feedback (entity_id, feedback, source_brief_date, created_at, updated_at)
       SELECT item.entity_id, ?, ?, ?, ?
       FROM brief_items AS item
       JOIN briefs AS brief ON brief.brief_date = item.brief_date
       WHERE item.entity_id = ? AND item.brief_date = ? AND brief.publish_at <= ?
       LIMIT 1
       ON CONFLICT(entity_id) DO UPDATE SET
         feedback = excluded.feedback,
         source_brief_date = excluded.source_brief_date,
         updated_at = excluded.updated_at`,
    )
    .bind(value, sourceBriefDate, updatedAt, updatedAt, entityId, sourceBriefDate, updatedAt)
    .run();
  return result.meta.changes > 0;
}

export async function removeEntityFeedback(db: D1Database, entityId: string): Promise<void> {
  await db.prepare("DELETE FROM entity_feedback WHERE entity_id = ?").bind(entityId).run();
}

export async function getBriefState(
  db: D1Database,
  date: string,
): Promise<{ status: BriefStatus; missingSources: SourceKind[] } | null> {
  const row = await db
    .prepare("SELECT status, missing_sources_json FROM briefs WHERE brief_date = ?")
    .bind(date)
    .first<{ status: BriefStatus; missing_sources_json: string }>();
  return row ? { status: row.status, missingSources: parseSourceArray(row.missing_sources_json) } : null;
}

export async function updateBriefStatus(
  db: D1Database,
  date: string,
  status: BriefStatus,
  missingSources: readonly SourceKind[],
): Promise<void> {
  await db
    .prepare("UPDATE briefs SET status = ?, missing_sources_json = ? WHERE brief_date = ?")
    .bind(status, JSON.stringify(missingSources), date)
    .run();
}

export async function replaceBrief(db: D1Database, draft: BriefDraft): Promise<void> {
  const entityIds = await Promise.all(draft.items.map((item) => stableId("entity", item.entity.canonicalKey)));
  const itemIds = await Promise.all(draft.items.map((_, index) => stableId("item", `${draft.date}:${String(index + 1)}`)));
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO briefs (
           brief_date, status, publish_at, generated_at, headline, intro,
           missing_sources_json, model, prompt_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(brief_date) DO UPDATE SET
           status = excluded.status, publish_at = excluded.publish_at, generated_at = excluded.generated_at,
           headline = excluded.headline, intro = excluded.intro,
           missing_sources_json = excluded.missing_sources_json, model = excluded.model,
           prompt_version = excluded.prompt_version`,
      )
      .bind(
        draft.date,
        draft.status,
        draft.publishAt,
        draft.generatedAt,
        draft.headline,
        draft.intro,
        JSON.stringify(draft.missingSources),
        draft.model,
        draft.promptVersion,
      ),
    db.prepare("DELETE FROM brief_items WHERE brief_date = ?").bind(draft.date),
  ];

  for (const [index, item] of draft.items.entries()) {
    const entityId = entityIds[index];
    const itemId = itemIds[index];
    if (!entityId || !itemId) throw new Error("INVALID_DRAFT_INDEX");
    statements.push(
      db
        .prepare(
          `INSERT INTO entities (
             id, canonical_key, canonical_title, canonical_url, aliases_json,
             first_seen_date, last_seen_date, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(canonical_key) DO UPDATE SET
             canonical_title = excluded.canonical_title, canonical_url = excluded.canonical_url,
             aliases_json = excluded.aliases_json, last_seen_date = excluded.last_seen_date,
             updated_at = excluded.updated_at`,
        )
        .bind(
          entityId,
          item.entity.canonicalKey,
          item.entity.canonicalTitle,
          item.entity.canonicalUrl,
          JSON.stringify(item.entity.aliases),
          draft.date,
          draft.date,
          draft.generatedAt,
          draft.generatedAt,
        ),
      db
        .prepare(
          `INSERT INTO brief_items (
             id, brief_date, rank, entity_id, title, summary, why_it_matters, tags_json,
             continuity, material_change, previous_brief_date
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          itemId,
          draft.date,
          index + 1,
          entityId,
          item.title,
          item.summary,
          item.whyItMatters,
          JSON.stringify(item.tags),
          item.continuity.kind,
          item.continuity.kind === "continuing" ? item.continuity.materialChange : null,
          item.continuity.kind === "continuing" ? item.continuity.previousDate : null,
        ),
    );
    for (const [sourceIndex, source] of item.sources.entries()) {
      const sourceId = await stableId("source", `${itemId}:${source.source}:${source.url}:${String(sourceIndex)}`);
      statements.push(
        db
          .prepare(
            `INSERT INTO item_sources (id, brief_item_id, candidate_id, source, kind, label, url)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(sourceId, itemId, source.candidateId, source.source, source.kind, source.label, source.url),
      );
    }
  }
  await db.batch(statements);
}

async function hydrateBrief(db: D1Database, row: BriefRow): Promise<BriefPayload> {
  const itemsResult = await db
    .prepare(
      `SELECT id, rank, entity_id, title, summary, why_it_matters, tags_json,
              continuity, material_change, previous_brief_date
       FROM brief_items WHERE brief_date = ? ORDER BY rank`,
    )
    .bind(row.brief_date)
    .all<BriefItemRow>();
  const sourcesResult = await db
    .prepare(
      `SELECT source.brief_item_id, source.source, source.kind, source.label, source.url
       FROM item_sources AS source
       JOIN brief_items AS item ON item.id = source.brief_item_id
       WHERE item.brief_date = ? ORDER BY item.rank, source.kind DESC, source.source`,
    )
    .bind(row.brief_date)
    .all<SourceRow>();
  const sourcesByItem = new Map<string, SourceLink[]>();
  for (const source of sourcesResult.results) {
    const values = sourcesByItem.get(source.brief_item_id) ?? [];
    values.push({ source: source.source, kind: source.kind, label: source.label, url: source.url });
    sourcesByItem.set(source.brief_item_id, values);
  }
  const sourceItems = new Map<SourceKind, Set<string>>(SOURCE_KINDS.map((source) => [source, new Set()]));
  const items = itemsResult.results.map((item) => {
    const sources = sourcesByItem.get(item.id) ?? [];
    for (const source of sources) sourceItems.get(source.source)?.add(item.id);
    const continuity: Continuity =
      item.continuity === "continuing" && item.previous_brief_date && item.material_change
        ? { kind: "continuing", previousDate: item.previous_brief_date, materialChange: item.material_change }
        : { kind: "new" };
    return {
      rank: item.rank,
      entityId: item.entity_id,
      title: item.title,
      summary: item.summary,
      whyItMatters: item.why_it_matters,
      tags: parseStringArray(item.tags_json),
      continuity,
      sources,
    };
  });
  return {
    date: row.brief_date,
    status: row.status,
    publishedAt: row.publish_at,
    generatedAt: row.generated_at,
    headline: row.headline,
    intro: row.intro,
    missingSources: parseSourceArray(row.missing_sources_json),
    sourceCounts: {
      "hacker-news": sourceItems.get("hacker-news")?.size ?? 0,
      "product-hunt": sourceItems.get("product-hunt")?.size ?? 0,
      github: sourceItems.get("github")?.size ?? 0,
      kickstarter: sourceItems.get("kickstarter")?.size ?? 0,
    },
    items,
  };
}

export async function getBrief(db: D1Database, date: string, now: string): Promise<BriefPayload | null> {
  const row = await db
    .prepare(
      `SELECT brief_date, status, publish_at, generated_at, headline, intro, missing_sources_json
       FROM briefs WHERE brief_date = ? AND publish_at <= ?`,
    )
    .bind(date, now)
    .first<BriefRow>();
  return row ? hydrateBrief(db, row) : null;
}

export async function getLatestBrief(db: D1Database, now: string): Promise<BriefPayload | null> {
  const row = await db
    .prepare(
      `SELECT brief_date, status, publish_at, generated_at, headline, intro, missing_sources_json
       FROM briefs WHERE publish_at <= ? ORDER BY brief_date DESC LIMIT 1`,
    )
    .bind(now)
    .first<BriefRow>();
  return row ? hydrateBrief(db, row) : null;
}

async function cursorChecksum(date: string): Promise<string> {
  return (await stableId("cursor", `watchtower-cursor-v1:${date}`)).slice(-12);
}

async function encodeCursor(date: string): Promise<string> {
  const value = JSON.stringify({ date, check: await cursorChecksum(date) });
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function decodeCursor(cursor: string): Promise<string | null> {
  try {
    const normalized = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== "object" || parsed === null || !("date" in parsed) || !("check" in parsed)) return null;
    const date = Reflect.get(parsed, "date");
    const check = Reflect.get(parsed, "check");
    if (typeof date !== "string" || typeof check !== "string" || check !== (await cursorChecksum(date))) return null;
    return date;
  } catch {
    return null;
  }
}

export async function listBriefs(
  db: D1Database,
  options: { limit: number; cursor?: string | null; now: string },
): Promise<BriefListPayload> {
  const cursorDate = options.cursor ? await decodeCursor(options.cursor) : null;
  if (options.cursor && !cursorDate) throw new Error("INVALID_CURSOR");
  const query = cursorDate
    ? `SELECT brief.brief_date, brief.status, brief.publish_at, brief.missing_sources_json,
              COUNT(item.id) AS item_count
       FROM briefs AS brief LEFT JOIN brief_items AS item ON item.brief_date = brief.brief_date
       WHERE brief.publish_at <= ? AND brief.brief_date < ?
       GROUP BY brief.brief_date ORDER BY brief.brief_date DESC LIMIT ?`
    : `SELECT brief.brief_date, brief.status, brief.publish_at, brief.missing_sources_json,
              COUNT(item.id) AS item_count
       FROM briefs AS brief LEFT JOIN brief_items AS item ON item.brief_date = brief.brief_date
       WHERE brief.publish_at <= ?
       GROUP BY brief.brief_date ORDER BY brief.brief_date DESC LIMIT ?`;
  const statement = cursorDate
    ? db.prepare(query).bind(options.now, cursorDate, options.limit + 1)
    : db.prepare(query).bind(options.now, options.limit + 1);
  const result = await statement.all<{
    brief_date: string;
    status: BriefStatus;
    publish_at: string;
    missing_sources_json: string;
    item_count: number;
  }>();
  const hasMore = result.results.length > options.limit;
  const rows = result.results.slice(0, options.limit);
  const lastRow = rows.at(-1);
  return {
    briefs: rows.map((row) => ({
      date: row.brief_date,
      status: row.status,
      publishedAt: row.publish_at,
      itemCount: row.item_count,
      missingSources: parseSourceArray(row.missing_sources_json),
    })),
    nextCursor: hasMore && lastRow ? await encodeCursor(lastRow.brief_date) : null,
  };
}

export async function deleteExpiredStaging(db: D1Database, cutoffDate: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM candidates WHERE target_date < ?").bind(cutoffDate),
    db.prepare("DELETE FROM ingestion_runs WHERE target_date < ?").bind(cutoffDate),
  ]);
}
