import type {
  ExplorationEvidenceSource,
  ExplorationPayload,
  ExplorationQuality,
  ExplorationSections,
  ExplorationSeed,
  ExplorationSource,
  ExplorationStatus,
} from "../domain/types";

export interface ExplorationRow {
  entity_id: string;
  title: string;
  status: ExplorationStatus;
  quality: ExplorationQuality | null;
  active_job_id: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  content_json: string | null;
  source_catalog_json: string | null;
  evidence_json: string | null;
  prompt_version: string;
  query_version: string;
  generated_at: string | null;
  expires_at: string | null;
  retry_at: string | null;
  last_error_code: string | null;
  tavily_credits: number;
  deepseek_tokens: number;
}

export interface ExplorationJob {
  kind: "item-exploration";
  entityId: string;
  jobId: string;
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function getExplorationSeed(
  db: D1Database,
  briefDate: string | null,
  entityId: string,
  now: string,
): Promise<ExplorationSeed | null> {
  if (briefDate !== null) {
    const validTarget = await db.prepare(
      `SELECT 1 FROM brief_items AS item
       JOIN briefs AS brief ON brief.brief_date = item.brief_date
       WHERE item.brief_date = ? AND item.entity_id = ? AND brief.publish_at <= ? LIMIT 1`,
    ).bind(briefDate, entityId, now).first();
    if (!validTarget) return null;
  }
  const row = await db.prepare(
    `SELECT item.entity_id, item.title, item.summary, item.why_it_matters, item.tags_json,
            entity.canonical_url, item.id AS brief_item_id
     FROM brief_items AS item
     JOIN briefs AS brief ON brief.brief_date = item.brief_date
     JOIN entities AS entity ON entity.id = item.entity_id
     WHERE item.entity_id = ? AND brief.publish_at <= ?
     ORDER BY item.brief_date DESC LIMIT 1`,
  ).bind(entityId, now).first<{
    entity_id: string;
    title: string;
    summary: string;
    why_it_matters: string;
    tags_json: string;
    canonical_url: string;
    brief_item_id: string;
  }>();
  if (!row) return null;
  const parsedTags = parseJson(row.tags_json);
  const links = await db.prepare("SELECT url FROM item_sources WHERE brief_item_id = ? ORDER BY id")
    .bind(row.brief_item_id).all<{ url: string }>();
  return {
    entityId: row.entity_id,
    title: row.title,
    summary: row.summary,
    whyItMatters: row.why_it_matters,
    tags: Array.isArray(parsedTags)
      ? parsedTags.filter((tag): tag is string => typeof tag === "string")
      : [],
    canonicalUrl: row.canonical_url,
    sourceUrls: links.results.map((link) => link.url),
  };
}

export async function getExplorationRow(db: D1Database, entityId: string): Promise<ExplorationRow | null> {
  return db.prepare(
    `SELECT entity_id, title, status, quality, active_job_id, lease_expires_at, attempt_count,
            content_json, source_catalog_json, evidence_json, generated_at, expires_at,
            prompt_version, query_version, retry_at, last_error_code, tavily_credits, deepseek_tokens
     FROM item_explorations WHERE entity_id = ?`,
  ).bind(entityId).first<ExplorationRow>();
}

export function explorationPayload(row: ExplorationRow, now: string): ExplorationPayload {
  const sections = parseJson(row.content_json) as ExplorationSections | null;
  const sources = parseJson(row.source_catalog_json) as ExplorationSource[] | null;
  if (sections && sources && row.generated_at && row.expires_at) {
    const stale = row.expires_at <= now;
    const refreshing = row.status === "queued" || row.status === "researching" || row.status === "synthesizing";
    return {
      entityId: row.entity_id,
      title: row.title,
      status: "ready",
      quality: row.quality ?? "partial",
      generatedAt: row.generated_at,
      expiresAt: row.expires_at,
      stale,
      refreshing,
      sections,
      sources,
      ...(refreshing ? { pollAfterSeconds: 3 } : {}),
      ...(row.last_error_code === "EXPLORATION_BUDGET_EXHAUSTED" ? { refreshLimited: true } : {}),
    };
  }
  return {
    entityId: row.entity_id,
    title: row.title,
    status: row.status,
    ...(row.status === "queued" || row.status === "researching" || row.status === "synthesizing"
      ? { pollAfterSeconds: 3 }
      : {}),
    ...(row.retry_at ? { retryAt: row.retry_at } : {}),
  };
}

export async function recordCacheHit(db: D1Database, now: string): Promise<void> {
  const date = now.slice(0, 10);
  await db.prepare(
    `INSERT INTO exploration_daily_usage (usage_date, cache_hits, created_at, updated_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(usage_date) DO UPDATE SET cache_hits = cache_hits + 1, updated_at = excluded.updated_at`,
  ).bind(date, now, now).run();
}

export async function claimExplorationTrigger(
  db: D1Database,
  seed: ExplorationSeed,
  jobId: string,
  now: string,
  leaseExpiresAt: string,
): Promise<boolean> {
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO item_explorations (
       entity_id, title, status, active_job_id, lease_expires_at, prompt_version, query_version, created_at, updated_at
     ) VALUES (?, ?, 'queued', ?, ?, 'exploration-v3-chinese', 'exploration-v2-bounded', ?, ?)`,
  ).bind(seed.entityId, seed.title, jobId, leaseExpiresAt, now, now).run();
  if (inserted.meta.changes > 0) return true;
  const claimed = await db.prepare(
    `UPDATE item_explorations
     SET title = ?, status = 'queued', active_job_id = ?, lease_expires_at = ?,
         prompt_version = 'exploration-v3-chinese', query_version = 'exploration-v2-bounded',
         retry_at = NULL, last_error_code = NULL, updated_at = ?
     WHERE entity_id = ?
       AND (active_job_id IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)
       AND (
         status = 'failed'
         OR (expires_at IS NOT NULL AND expires_at <= ?)
         OR (status IN ('queued', 'researching', 'synthesizing') AND lease_expires_at <= ?)
       )`,
  ).bind(seed.title, jobId, leaseExpiresAt, now, seed.entityId, now, now, now).run();
  return claimed.meta.changes > 0;
}

export async function reserveExplorationCredits(
  db: D1Database,
  now: string,
  reservation: number,
  dailyLimit: number,
): Promise<boolean> {
  const date = now.slice(0, 10);
  const result = await db.prepare(
    `INSERT INTO exploration_daily_usage (
       usage_date, reserved_credits, jobs_started, created_at, updated_at
     ) SELECT ?, ?, 1, ?, ? WHERE ? <= ?
     ON CONFLICT(usage_date) DO UPDATE SET
       reserved_credits = reserved_credits + excluded.reserved_credits,
       jobs_started = jobs_started + 1,
       updated_at = excluded.updated_at
     WHERE exploration_daily_usage.reserved_credits + excluded.reserved_credits <= ?`,
  ).bind(date, reservation, now, now, reservation, dailyLimit, dailyLimit).run();
  return result.meta.changes > 0;
}

export async function rejectExplorationClaim(
  db: D1Database,
  entityId: string,
  jobId: string,
  errorCode: string,
  retryAt: string,
  now: string,
): Promise<void> {
  await db.prepare(
    `UPDATE item_explorations SET status = 'failed', active_job_id = NULL,
       lease_expires_at = NULL, retry_at = ?, last_error_code = ?, updated_at = ?
     WHERE entity_id = ? AND active_job_id = ?`,
  ).bind(retryAt, errorCode, now, entityId, jobId).run();
}

export async function claimExplorationWork(
  db: D1Database,
  job: ExplorationJob,
  now: string,
  leaseExpiresAt: string,
): Promise<ExplorationRow | null> {
  const result = await db.prepare(
    `UPDATE item_explorations SET status = 'researching', lease_expires_at = ?,
       attempt_count = attempt_count + 1, updated_at = ?
     WHERE entity_id = ? AND active_job_id = ?
       AND status IN ('queued', 'failed')
       AND (lease_expires_at IS NULL OR lease_expires_at <= ? OR status = 'queued')`,
  ).bind(leaseExpiresAt, now, job.entityId, job.jobId, now).run();
  return result.meta.changes > 0 ? getExplorationRow(db, job.entityId) : null;
}

export function savedEvidence(row: ExplorationRow): ExplorationEvidenceSource[] | null {
  return parseJson(row.evidence_json) as ExplorationEvidenceSource[] | null;
}

export async function saveExplorationEvidence(
  db: D1Database,
  job: ExplorationJob,
  evidence: readonly ExplorationEvidenceSource[],
  credits: number,
  now: string,
): Promise<void> {
  await db.batch([
    db.prepare(
      `UPDATE item_explorations SET status = 'synthesizing', evidence_json = ?,
         tavily_credits = tavily_credits + ?, query_version = 'exploration-v2-bounded',
         updated_at = ? WHERE entity_id = ? AND active_job_id = ?`,
    ).bind(JSON.stringify(evidence), credits, now, job.entityId, job.jobId),
    db.prepare(
      `UPDATE exploration_daily_usage SET used_credits = used_credits + ?, updated_at = ?
       WHERE usage_date = ?`,
    ).bind(credits, now, now.slice(0, 10)),
  ]);
}

export async function recordExplorationResearchUsage(
  db: D1Database,
  job: ExplorationJob,
  credits: number,
  now: string,
): Promise<void> {
  if (credits <= 0) return;
  await db.batch([
    db.prepare(
      `UPDATE item_explorations SET tavily_credits = tavily_credits + ?, query_version = 'exploration-v2-bounded',
         updated_at = ? WHERE entity_id = ? AND active_job_id = ?`,
    ).bind(credits, now, job.entityId, job.jobId),
    db.prepare(
      `UPDATE exploration_daily_usage SET used_credits = used_credits + ?, updated_at = ? WHERE usage_date = ?`,
    ).bind(credits, now, now.slice(0, 10)),
  ]);
}

export async function recordExplorationSynthesisUsage(
  db: D1Database,
  job: ExplorationJob,
  tokens: number,
  now: string,
): Promise<void> {
  if (tokens <= 0) return;
  await db.prepare(
    `UPDATE item_explorations SET deepseek_tokens = deepseek_tokens + ?, prompt_version = 'exploration-v3-chinese',
       updated_at = ? WHERE entity_id = ? AND active_job_id = ?`,
  ).bind(tokens, now, job.entityId, job.jobId).run();
}

export async function readyExploration(
  db: D1Database,
  job: ExplorationJob,
  result: { sections: ExplorationSections; sources: ExplorationSource[]; quality: ExplorationQuality; tokens: number },
  generatedAt: string,
  expiresAt: string,
): Promise<void> {
  await db.batch([
    db.prepare(
      `UPDATE item_explorations SET status = 'ready', quality = ?, content_json = ?,
         source_catalog_json = ?, evidence_json = NULL, generated_at = ?, expires_at = ?,
         active_job_id = NULL, lease_expires_at = NULL, retry_at = NULL, last_error_code = NULL,
         deepseek_tokens = deepseek_tokens + ?, prompt_version = 'exploration-v3-chinese',
         updated_at = ? WHERE entity_id = ? AND active_job_id = ?`,
    ).bind(result.quality, JSON.stringify(result.sections), JSON.stringify(result.sources), generatedAt,
      expiresAt, result.tokens, generatedAt, job.entityId, job.jobId),
    db.prepare(
      `UPDATE exploration_daily_usage SET jobs_succeeded = jobs_succeeded + 1, updated_at = ?
       WHERE usage_date = ?`,
    ).bind(generatedAt, generatedAt.slice(0, 10)),
  ]);
}

export async function releaseExplorationForRetry(
  db: D1Database,
  job: ExplorationJob,
  now: string,
): Promise<void> {
  await db.prepare(
    `UPDATE item_explorations SET status = 'queued', lease_expires_at = ?, updated_at = ?
     WHERE entity_id = ? AND active_job_id = ?`,
  ).bind(now, now, job.entityId, job.jobId).run();
}

export async function failExploration(
  db: D1Database,
  job: ExplorationJob,
  errorCode: string,
  retryAt: string,
  now: string,
): Promise<void> {
  await db.batch([
    db.prepare(
      `UPDATE item_explorations SET status = 'failed', active_job_id = NULL,
         lease_expires_at = NULL, retry_at = ?, last_error_code = ?, updated_at = ?
       WHERE entity_id = ? AND active_job_id = ?`,
    ).bind(retryAt, errorCode, now, job.entityId, job.jobId),
    db.prepare(
      `UPDATE exploration_daily_usage SET jobs_failed = jobs_failed + 1, updated_at = ?
       WHERE usage_date = ?`,
    ).bind(now, now.slice(0, 10)),
  ]);
}
