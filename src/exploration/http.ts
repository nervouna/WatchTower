import {
  claimExplorationTrigger,
  explorationPayload,
  getExplorationRow,
  getExplorationSeed,
  recordCacheHit,
  rejectExplorationClaim,
  reserveExplorationCredits,
  type ExplorationJob,
} from "./repository";

const ENTITY_ID_PATTERN = /^entity_[a-f0-9]{32}$/u;
const PUBLIC_CACHE = "public, max-age=300";

interface ExplorationEnv {
  DB: D1Database;
  ITEM_EXPLORATION_QUEUE: Queue<ExplorationJob>;
  EXPLORATION_RATE_LIMITER: { limit(input: { key: string }): Promise<{ success: boolean }> };
  ITEM_EXPLORATION_ENABLED: string;
  ITEM_EXPLORATION_DAILY_TAVILY_CREDITS: string;
  ITEM_EXPLORATION_CREDIT_RESERVATION: string;
}

function json(value: unknown, status: number, headers?: HeadersInit): Response {
  const output = new Headers(headers);
  output.set("Content-Type", "application/json; charset=utf-8");
  output.set("Access-Control-Allow-Origin", "*");
  if (!output.has("Cache-Control")) output.set("Cache-Control", status === 200 ? PUBLIC_CACHE : "no-store");
  return new Response(JSON.stringify(value), { status, headers: output });
}

function error(code: string, message: string, status: number, headers?: HeadersInit): Response {
  return json({ error: { code, message } }, status, headers);
}

async function etag(value: unknown): Promise<string> {
  const body = JSON.stringify(value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return `"${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
}

async function sourceKey(request: Request): Promise<string> {
  const raw = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function explorationEnabled(value: unknown): boolean { return value === "true"; }

function validUtcDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export async function handleExplorationRequest(
  request: Request,
  env: ExplorationEnv,
  briefDate: string,
  entityId: string,
  now = new Date(),
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
      "Access-Control-Max-Age": "86400",
    } });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return error("METHOD_NOT_ALLOWED", "此接口仅支持 GET、POST 和 OPTIONS。", 405, { Allow: "GET, POST, OPTIONS" });
  }
  if (!explorationEnabled(env.ITEM_EXPLORATION_ENABLED)) {
    return error("EXPLORATION_DISABLED", "拓展阅读功能暂未开放。", 503);
  }
  if (!validUtcDate(briefDate) || !ENTITY_ID_PATTERN.test(entityId)) {
    return error("INVALID_EXPLORATION_TARGET", "简报日期或实体标识无效。", 400);
  }
  const nowIso = now.toISOString();
  const seed = await getExplorationSeed(env.DB, briefDate, entityId, nowIso);
  if (!seed) return error("EXPLORATION_TARGET_NOT_FOUND", "未找到已发布简报中的该热点。", 404);
  let row = await getExplorationRow(env.DB, entityId);
  if (request.method === "GET") {
    if (!row) return error("EXPLORATION_NOT_FOUND", "该热点尚未生成拓展阅读。", 404);
    const payload = explorationPayload(row, nowIso);
    const tag = payload.status === "ready" && !payload.refreshing ? await etag(payload) : null;
    if (tag && request.headers.get("If-None-Match") === tag) {
      return new Response(null, { status: 304, headers: { ETag: tag, "Cache-Control": PUBLIC_CACHE, "Access-Control-Allow-Origin": "*" } });
    }
    return json(payload, 200, tag ? { ETag: tag } : { "Cache-Control": "no-store" });
  }

  if (row) {
    const payload = explorationPayload(row, nowIso);
    if (payload.status === "ready" && !payload.stale) {
      await recordCacheHit(env.DB, nowIso);
      console.log(JSON.stringify({ event: "exploration_cache_hit", entityId }));
      return json(payload, 200);
    }
    const active = payload.refreshing && row.active_job_id !== null && row.lease_expires_at !== null && row.lease_expires_at > nowIso;
    if (active || (row.status === "failed" && row.retry_at && row.retry_at > nowIso)) {
      return json(payload, payload.status === "ready" ? 200 : 202, { "Cache-Control": "no-store" });
    }
  }

  const jobId = crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
  const claimed = await claimExplorationTrigger(env.DB, seed, jobId, nowIso, leaseExpiresAt);
  if (!claimed) {
    row = await getExplorationRow(env.DB, entityId);
    if (!row) return error("EXPLORATION_UNAVAILABLE", "暂时无法创建拓展阅读。", 503);
    const payload = explorationPayload(row, nowIso);
    return json(payload, payload.status === "ready" ? 200 : 202, { "Cache-Control": "no-store" });
  }

  const rateLimit = await env.EXPLORATION_RATE_LIMITER.limit({ key: await sourceKey(request) });
  if (!rateLimit.success) {
    await rejectExplorationClaim(env.DB, entityId, jobId, "EXPLORATION_RATE_LIMITED",
      new Date(now.getTime() + 60_000).toISOString(), nowIso);
    row = await getExplorationRow(env.DB, entityId);
    if (row?.content_json) return json({ ...explorationPayload(row, nowIso), refreshLimited: true }, 200);
    return error("EXPLORATION_RATE_LIMITED", "操作过于频繁，请稍后再试。", 429, { "Retry-After": "60" });
  }

  const reservation = Math.max(1, Number(env.ITEM_EXPLORATION_CREDIT_RESERVATION) || 12);
  const dailyLimit = Math.max(1, Number(env.ITEM_EXPLORATION_DAILY_TAVILY_CREDITS) || 120);
  if (!(await reserveExplorationCredits(env.DB, nowIso, reservation, dailyLimit))) {
    await rejectExplorationClaim(env.DB, entityId, jobId, "EXPLORATION_BUDGET_EXHAUSTED",
      `${nowIso.slice(0, 10)}T23:59:59.999Z`, nowIso);
    row = await getExplorationRow(env.DB, entityId);
    console.warn(JSON.stringify({ event: "exploration_budget_exhausted", entityId }));
    if (row?.content_json) return json({ ...explorationPayload(row, nowIso), refreshLimited: true }, 200);
    return error("EXPLORATION_BUDGET_EXHAUSTED", "今日探索额度已用完，请明日再试。", 429, { "Retry-After": "3600" });
  }

  const job: ExplorationJob = { kind: "item-exploration", entityId, jobId };
  try {
    await env.ITEM_EXPLORATION_QUEUE.send(job);
  } catch {
    await rejectExplorationClaim(env.DB, entityId, jobId, "EXPLORATION_QUEUE_SEND_FAILED",
      new Date(now.getTime() + 5 * 60_000).toISOString(), nowIso);
    return error("EXPLORATION_UNAVAILABLE", "本次探索未能开始，可稍后重试。", 503);
  }
  console.log(JSON.stringify({ event: "exploration_requested", entityId, jobId }));
  row = await getExplorationRow(env.DB, entityId);
  return json(row ? explorationPayload(row, nowIso) : { entityId, title: seed.title, status: "queued", pollAfterSeconds: 3 }, 202,
    { "Cache-Control": "no-store" });
}
