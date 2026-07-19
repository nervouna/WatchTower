import { FEEDBACK_VALUES, type FeedbackValue } from "../domain/types";
import {
  getBriefAudio,
  getBriefCover,
  getBrief,
  getEntityFeedback,
  getLatestBrief,
  getCandidates,
  getBriefRegeneration,
  listBriefs,
  removeEntityFeedback,
  setEntityFeedback,
  isFeedbackAllowed,
  removeAccountData,
  queueBriefRegeneration,
  finishBriefRegeneration,
} from "../storage/repository";
import { enqueueBriefAudio } from "../audio/jobs";
import { enqueueBriefCover } from "../cover/jobs";
import { handlePushSubscriptionRequest } from "../push/subscriptions";
import { authenticate, AuthError, type AuthUser } from "../auth/auth0";
import { explorationEnabled, handleExplorationRequest } from "../exploration/http";
import type { BriefRegenerationJob } from "../regeneration/jobs";
import { handleDevPipelineRequest } from "../dev-pipeline/http";

const API_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";
function audioEnabled(value: unknown): boolean { return value === "true"; }

interface ApiError {
  error: { code: string; message: string };
}

function apiError(code: string, message: string, status: number, extraHeaders?: HeadersInit): Response {
  return jsonResponse({ error: { code, message } } satisfies ApiError, status, extraHeaders, null, false);
}

function protectedResponse(value: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store");
  if (status !== 204) headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(status === 204 ? null : JSON.stringify(value), { status, headers });
}

function protectedError(code: string, message: string, status: number, extraHeaders?: HeadersInit): Response {
  return protectedResponse({ error: { code, message } } satisfies ApiError, status, extraHeaders);
}

type AuthRuntimeEnv = Pick<Env, "DB" | "AUTH0_ISSUER" | "AUTH0_TENANT_DOMAIN" | "AUTH0_AUDIENCE" | "AUTH0_WEB_CLIENT_ID" | "AUTH0_MOBILE_DEV_CLIENT_ID" | "AUTH0_MOBILE_PROD_CLIENT_ID"> &
  Partial<Pick<Env, "AUTH0_MANAGEMENT_CLIENT_ID" | "AUTH0_MANAGEMENT_CLIENT_SECRET">>;

async function requireUser(request: Request, env: AuthRuntimeEnv): Promise<AuthUser | Response> {
  try {
    return await authenticate(request, env);
  } catch (error) {
    if (error instanceof AuthError && error.kind === "unavailable") return protectedError("AUTH_UNAVAILABLE", "登录服务暂不可用，请稍后重试。", 503);
    return protectedError("UNAUTHORIZED", "登录凭证无效或已过期。", 401, { "WWW-Authenticate": "Bearer" });
  }
}

async function requireAllowedUser(request: Request, env: AuthRuntimeEnv): Promise<AuthUser | Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  return (await isFeedbackAllowed(env.DB, user.id)) ? user : protectedError("FORBIDDEN", "当前账号没有此操作权限。", 403);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ENTITY_ID_PATTERN = /^entity_[a-f0-9]{32}$/u;

async function handleFeedbackRequest(request: Request, env: AuthRuntimeEnv, now: Date): Promise<Response> {
  const user = await requireAllowedUser(request, env);
  if (user instanceof Response) return user;

  const url = new URL(request.url);
  if (url.pathname === "/api/feedback") {
    if (request.method !== "GET") {
      return protectedError("METHOD_NOT_ALLOWED", "此接口仅支持 GET。", 405, { Allow: "GET" });
    }
    const entityIds = url.searchParams.getAll("entityId");
    if (entityIds.length > 20 || entityIds.some((entityId) => !ENTITY_ID_PATTERN.test(entityId))) {
      return protectedError("INVALID_ENTITY_IDS", "entityId 必须是最多 20 个有效实体标识。", 400);
    }
    return protectedResponse({ feedback: await getEntityFeedback(env.DB, [...new Set(entityIds)]) });
  }

  const match = /^\/api\/feedback\/([^/]+)$/u.exec(url.pathname);
  if (!match?.[1]) return protectedError("API_NOT_FOUND", "未找到该 API。", 404);
  const entityId = match[1];
  if (!ENTITY_ID_PATTERN.test(entityId)) return protectedError("INVALID_ENTITY_ID", "entityId 无效。", 400);

  if (request.method === "DELETE") {
    await removeEntityFeedback(env.DB, entityId);
    return protectedResponse(null, 204);
  }
  if (request.method !== "PUT") {
    return protectedError("METHOD_NOT_ALLOWED", "此接口仅支持 PUT 和 DELETE。", 405, { Allow: "PUT, DELETE" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return protectedError("INVALID_FEEDBACK", "请求正文必须是有效 JSON。", 400);
  }
  if (!isRecord(body)) {
    return protectedError("INVALID_FEEDBACK", "反馈内容无效。", 400);
  }
  const value = body.value;
  const briefDate = body.briefDate;
  if (
    typeof value !== "string" ||
    !FEEDBACK_VALUES.includes(value as FeedbackValue) ||
    typeof briefDate !== "string" ||
    !isValidUtcDate(briefDate)
  ) {
    return protectedError("INVALID_FEEDBACK", "反馈值或简报日期无效。", 400);
  }
  const saved = await setEntityFeedback(env.DB, entityId, value as FeedbackValue, briefDate, now.toISOString(), user.id);
  return saved
    ? protectedResponse({ entityId, value })
    : protectedError("FEEDBACK_TARGET_NOT_FOUND", "未找到该简报中的反馈对象。", 404);
}

async function handleAudioRetryRequest(request: Request, env: AuthRuntimeEnv & Pick<Env, "BRIEF_AUDIO_QUEUE" | "BRIEF_AUDIO_ENABLED" | "MIMO_API_KEY">, now: Date): Promise<Response> {
  if (request.method !== "POST") return protectedError("METHOD_NOT_ALLOWED", "此接口仅支持 POST。", 405, { Allow: "POST" });
  const user = await requireAllowedUser(request, env);
  if (user instanceof Response) return user;
  const match = /^\/api\/briefs\/([^/]+)\/audio\/retry$/u.exec(new URL(request.url).pathname);
  const date = match?.[1] ?? "";
  if (!isValidUtcDate(date)) return protectedError("INVALID_DATE", "日期必须是有效的 YYYY-MM-DD UTC 日期。", 400);
  if (!audioEnabled(env.BRIEF_AUDIO_ENABLED) || env.MIMO_API_KEY.length === 0) return protectedError("BRIEF_AUDIO_UNAVAILABLE", "语音简报功能暂不可用。", 503);
  const status = await enqueueBriefAudio(env, date, now);
  if (status === "not-found") return protectedError("BRIEF_NOT_FOUND", "未找到已发布简报。", 404);
  if (status === "disabled") return protectedError("BRIEF_AUDIO_UNAVAILABLE", "语音简报功能暂不可用。", 503);
  return protectedResponse({ briefDate: date, status });
}

async function handleCoverRetryRequest(request: Request, env: AuthRuntimeEnv & Pick<Env, "BRIEF_AUDIO_QUEUE" | "BRIEF_COVER_ENABLED" | "FAL_API_KEY">, now: Date): Promise<Response> {
  if (request.method !== "POST") return protectedError("METHOD_NOT_ALLOWED", "此接口仅支持 POST。", 405, { Allow: "POST" });
  const user = await requireAllowedUser(request, env);
  if (user instanceof Response) return user;
  const match = /^\/api\/briefs\/([^/]+)\/cover\/retry$/u.exec(new URL(request.url).pathname);
  const date = match?.[1] ?? "";
  if (!isValidUtcDate(date)) return protectedError("INVALID_DATE", "日期必须是有效的 YYYY-MM-DD UTC 日期。", 400);
  if (!audioEnabled(env.BRIEF_COVER_ENABLED) || env.FAL_API_KEY.length === 0) return protectedError("BRIEF_COVER_UNAVAILABLE", "播客封面功能暂不可用。", 503);
  const status = await enqueueBriefCover(env, date, now);
  if (status === "not-found") return protectedError("BRIEF_NOT_FOUND", "未找到已发布简报。", 404);
  if (status === "disabled") return protectedError("BRIEF_COVER_UNAVAILABLE", "播客封面功能暂不可用。", 503);
  return protectedResponse({ briefDate: date, status });
}

async function handleBriefRegenerationRequest(
  request: Request,
  env: AuthRuntimeEnv & Pick<Env, "BRIEF_AUDIO_QUEUE">,
  now: Date,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return protectedError("METHOD_NOT_ALLOWED", "此接口仅支持 GET 和 POST。", 405, { Allow: "GET, POST" });
  }
  const user = await requireAllowedUser(request, env);
  if (user instanceof Response) return user;
  const match = /^\/api\/briefs\/([^/]+)\/regeneration$/u.exec(new URL(request.url).pathname);
  const date = match?.[1] ?? "";
  if (!isValidUtcDate(date)) return protectedError("INVALID_DATE", "日期必须是有效的 YYYY-MM-DD UTC 日期。", 400);

  if (request.method === "GET") {
    const row = await getBriefRegeneration(env.DB, date);
    return row
      ? protectedResponse({
        briefDate: row.brief_date,
        jobId: row.job_id,
        status: row.status,
        attemptCount: row.attempt_count,
        errorCode: row.error_code,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        finishedAt: row.finished_at,
      })
      : protectedError("BRIEF_REGENERATION_NOT_FOUND", "未找到该日期的重生成任务。", 404);
  }

  if (!(await getBrief(env.DB, date, now.toISOString()))) {
    return protectedError("BRIEF_NOT_FOUND", "未找到已发布简报。", 404);
  }
  if ((await getCandidates(env.DB, date)).length === 0) {
    return protectedError("BRIEF_REGENERATION_UNAVAILABLE", "该日期没有可重放的存量候选证据。", 409);
  }

  const jobId = crypto.randomUUID();
  const queued = await queueBriefRegeneration(env.DB, date, jobId, user.id, now.toISOString());
  if (queued.created) {
    try {
      await env.BRIEF_AUDIO_QUEUE.send({ kind: "brief-regeneration", briefDate: date, jobId } satisfies BriefRegenerationJob);
    } catch {
      await finishBriefRegeneration(env.DB, date, jobId, "failed", "BRIEF_REGENERATION_QUEUE_FAILED", new Date().toISOString());
      return protectedError("BRIEF_REGENERATION_QUEUE_FAILED", "重生成任务暂时无法排队，请稍后重试。", 503);
    }
  }
  return protectedResponse({
    briefDate: queued.row.brief_date,
    jobId: queued.row.job_id,
    status: queued.row.status,
    pollAfterSeconds: 3,
  }, 202);
}

async function deleteAuth0User(env: AuthRuntimeEnv, userId: string): Promise<"deleted" | "not-found" | "failed"> {
  if (!env.AUTH0_MANAGEMENT_CLIENT_ID || !env.AUTH0_MANAGEMENT_CLIENT_SECRET) return "failed";
  try {
    const tokenResponse = await fetch(`https://${env.AUTH0_TENANT_DOMAIN}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: env.AUTH0_MANAGEMENT_CLIENT_ID,
        client_secret: env.AUTH0_MANAGEMENT_CLIENT_SECRET,
        audience: `https://${env.AUTH0_TENANT_DOMAIN}/api/v2/`,
      }),
    });
    if (!tokenResponse.ok) return "failed";
    const tokenBody: unknown = await tokenResponse.json();
    if (!isRecord(tokenBody) || typeof tokenBody.access_token !== "string") return "failed";
    const response = await fetch(`https://${env.AUTH0_TENANT_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (response.status === 404) return "not-found";
    return response.ok ? "deleted" : "failed";
  } catch {
    return "failed";
  }
}

async function handleAuthRequest(request: Request, env: AuthRuntimeEnv & Pick<Env, "ACCOUNT_DELETION_ENABLED">): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/api/auth/config") {
    if (request.method !== "GET" && request.method !== "HEAD") return apiError("METHOD_NOT_ALLOWED", "此接口仅支持 GET 和 HEAD。", 405, { Allow: "GET, HEAD" });
    return cachedJson(request, {
      issuer: env.AUTH0_ISSUER,
      audience: env.AUTH0_AUDIENCE,
      connection: "apple",
      clientIds: { web: env.AUTH0_WEB_CLIENT_ID, mobileDev: env.AUTH0_MOBILE_DEV_CLIENT_ID, mobileProd: env.AUTH0_MOBILE_PROD_CLIENT_ID },
    }, request.method === "HEAD");
  }
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  if (path === "/api/auth/me") {
    if (request.method !== "GET") return protectedError("METHOD_NOT_ALLOWED", "此接口仅支持 GET。", 405, { Allow: "GET" });
    const allowed = await isFeedbackAllowed(env.DB, user.id);
    return protectedResponse({ user, capabilities: { feedback: allowed, audioRetry: allowed, briefRegenerate: allowed } });
  }
  if (path === "/api/auth/account") {
    if (request.method !== "DELETE") return protectedError("METHOD_NOT_ALLOWED", "此接口仅支持 DELETE。", 405, { Allow: "DELETE" });
    if (env.ACCOUNT_DELETION_ENABLED !== "true") {
      return protectedError("ACCOUNT_DELETION_DISABLED", "Dev 环境不支持删除账号。", 403);
    }
    await removeAccountData(env.DB, user.id);
    const result = await deleteAuth0User(env, user.id);
    return result === "failed"
      ? protectedError("ACCOUNT_DELETE_FAILED", "账号删除暂未完成，请稍后重试。", 502)
      : protectedResponse(null, 204);
  }
  return protectedError("API_NOT_FOUND", "未找到该 API。", 404);
}

async function etagFor(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `"${hash}"`;
}

function jsonResponse(
  value: unknown,
  status: number,
  extraHeaders: HeadersInit | undefined,
  etag: string | null,
  cacheable: boolean,
  head = false,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", cacheable ? API_CACHE_CONTROL : "no-store");
  if (etag) headers.set("ETag", etag);
  return new Response(head ? null : JSON.stringify(value), { status, headers });
}

async function cachedJson(request: Request, value: unknown, head: boolean): Promise<Response> {
  const body = JSON.stringify(value);
  const etag = await etagFor(body);
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": API_CACHE_CONTROL,
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
  return jsonResponse(value, 200, undefined, etag, true, head);
}

export function isValidUtcDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export async function handleRequest(
  request: Request,
  env: Pick<Env, "DB" | "ASSETS" | "BRIEF_AUDIO" | "BRIEF_AUDIO_QUEUE" | "BRIEF_AUDIO_ENABLED" | "BRIEF_COVER_ENABLED" | "MIMO_API_KEY" | "FAL_API_KEY" | "PUSH_TOKEN_ENCRYPTION_KEY" | "PUSH_TOKEN_HMAC_KEY" | "MOBILE_PUSH_RATE_LIMITER" | "AUTH0_ISSUER" | "AUTH0_TENANT_DOMAIN" | "AUTH0_AUDIENCE" | "AUTH0_WEB_CLIENT_ID" | "AUTH0_MOBILE_DEV_CLIENT_ID" | "AUTH0_MOBILE_PROD_CLIENT_ID" | "ITEM_EXPLORATION_QUEUE" | "EXPLORATION_RATE_LIMITER" | "ITEM_EXPLORATION_ENABLED" | "ITEM_EXPLORATION_DAILY_TAVILY_CREDITS" | "ITEM_EXPLORATION_CREDIT_RESERVATION" | "DEPLOYMENT_ENV" | "ACCOUNT_DELETION_ENABLED" | "VERSION_METADATA" | "DEV_PIPELINE_QUEUE" | "AUTH0_MANAGEMENT_CLIENT_ID" | "AUTH0_MANAGEMENT_CLIENT_SECRET">,
  now = new Date(),
): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
  if (url.pathname === "/api/meta") {
    if (request.method !== "GET" && request.method !== "HEAD") return apiError("METHOD_NOT_ALLOWED", "此接口仅支持 GET 和 HEAD。", 405, { Allow: "GET, HEAD" });
    return jsonResponse({
      environment: env.DEPLOYMENT_ENV,
      workerVersionId: env.VERSION_METADATA.id,
      workerVersionTag: env.VERSION_METADATA.tag,
      deployedAt: env.VERSION_METADATA.timestamp,
    }, 200, undefined, null, false, request.method === "HEAD");
  }
  if (url.pathname === "/api/dev/pipeline-runs" || url.pathname.startsWith("/api/dev/pipeline-runs/")) {
    if (env.DEPLOYMENT_ENV !== "dev") return apiError("API_NOT_FOUND", "未找到该 API。", 404);
    const user = await requireAllowedUser(request, env);
    if (user instanceof Response) return user;
    return handleDevPipelineRequest(request, env, user.id, now);
  }
  if (url.pathname === "/api/mobile/v1/push-subscriptions") {
    return handlePushSubscriptionRequest(request, env, now);
  }
  if (url.pathname.startsWith("/api/auth/")) return handleAuthRequest(request, env);
  if (url.pathname === "/api/feedback" || url.pathname.startsWith("/api/feedback/")) {
    return handleFeedbackRequest(request, env, now);
  }
  if (/^\/api\/briefs\/[^/]+\/audio\/retry$/u.test(url.pathname)) return handleAudioRetryRequest(request, env, now);
  if (/^\/api\/briefs\/[^/]+\/cover\/retry$/u.test(url.pathname)) return handleCoverRetryRequest(request, env, now);
  if (/^\/api\/briefs\/[^/]+\/regeneration$/u.test(url.pathname)) return handleBriefRegenerationRequest(request, env, now);

  const coverMatch = /^\/api\/briefs\/([^/]+)\/cover$/u.exec(url.pathname);
  if (coverMatch?.[1]) {
    if (request.method !== "GET" && request.method !== "HEAD") return apiError("METHOD_NOT_ALLOWED", "此接口仅支持 GET 和 HEAD。", 405, { Allow: "GET, HEAD" });
    const date = coverMatch[1];
    if (!isValidUtcDate(date)) return apiError("INVALID_DATE", "日期必须是有效的 YYYY-MM-DD UTC 日期。", 400);
    const brief = await getBrief(env.DB, date, now.toISOString());
    const cover = brief ? await getBriefCover(env.DB, date) : null;
    if (!brief || cover?.status !== "ready" || !cover.object_key) return apiError("BRIEF_COVER_NOT_FOUND", "未找到播客封面。", 404);
    const object = await env.BRIEF_AUDIO.head(cover.object_key);
    if (!object) return apiError("BRIEF_COVER_NOT_FOUND", "未找到播客封面。", 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "public, max-age=3600");
    headers.set("Content-Length", String(object.size));
    headers.set("X-Content-Type-Options", "nosniff");
    if (request.headers.get("If-None-Match") === object.httpEtag) return new Response(null, { status: 304, headers });
    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    const body = await env.BRIEF_AUDIO.get(cover.object_key);
    if (!body) return apiError("BRIEF_COVER_NOT_FOUND", "未找到播客封面。", 404);
    return new Response(body.body, { status: 200, headers });
  }

  const explorationMatch = /^\/api\/explorations\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
  if (explorationMatch?.[1] && explorationMatch[2]) {
    return handleExplorationRequest(request, env, explorationMatch[1], explorationMatch[2], now);
  }

  const audioMatch = /^\/api\/briefs\/([^/]+)\/audio$/u.exec(url.pathname);
  if (audioMatch?.[1]) {
    if (request.method !== "GET" && request.method !== "HEAD") return apiError("METHOD_NOT_ALLOWED", "此接口仅支持 GET 和 HEAD。", 405, { Allow: "GET, HEAD" });
    const date = audioMatch[1];
    if (!isValidUtcDate(date)) return apiError("INVALID_DATE", "日期必须是有效的 YYYY-MM-DD UTC 日期。", 400);
    const brief = await getBrief(env.DB, date, now.toISOString());
    const audio = brief ? await getBriefAudio(env.DB, date) : null;
    if (!brief || audio?.status !== "ready" || !audio.object_key) return apiError("BRIEF_AUDIO_NOT_FOUND", "未找到语音简报。", 404);
    const object = await env.BRIEF_AUDIO.head(audio.object_key);
    if (!object) return apiError("BRIEF_AUDIO_NOT_FOUND", "未找到语音简报。", 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "public, max-age=3600");
    if (request.headers.get("If-None-Match") === object.httpEtag) return new Response(null, { status: 304, headers });
    if (request.method === "HEAD") {
      headers.set("Content-Length", String(object.size));
      return new Response(null, { status: 200, headers });
    }
    const rangeHeader = request.headers.get("Range");
    if (!rangeHeader) {
      const body = await env.BRIEF_AUDIO.get(audio.object_key);
      if (!body) return apiError("BRIEF_AUDIO_NOT_FOUND", "未找到语音简报。", 404);
      headers.set("Content-Length", String(object.size));
      return new Response(body.body, { status: 200, headers });
    }
    const range = parseByteRange(rangeHeader, object.size);
    if (!range) return apiError("INVALID_RANGE", "Range 请求无效。", 416, { "Content-Range": `bytes */${String(object.size)}` });
    const body = await env.BRIEF_AUDIO.get(audio.object_key, { range });
    if (!body) return apiError("BRIEF_AUDIO_NOT_FOUND", "未找到语音简报。", 404);
    headers.set("Content-Length", String(range.length));
    headers.set("Content-Range", `bytes ${String(range.offset)}-${String(range.offset + range.length - 1)}/${String(object.size)}`);
    return new Response(body.body, { status: 206, headers });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return apiError("METHOD_NOT_ALLOWED", "此接口仅支持 GET 和 HEAD。", 405, { Allow: "GET, HEAD" });
  }
  const head = request.method === "HEAD";
  const nowIso = now.toISOString();

  if (url.pathname === "/api/briefs/latest") {
    const brief = await getLatestBrief(env.DB, nowIso);
    return brief
      ? cachedJson(request, { ...brief, features: { exploration: explorationEnabled(env.ITEM_EXPLORATION_ENABLED) } }, head)
      : apiError("BRIEF_NOT_FOUND", "尚无可用简报。", 404);
  }

  if (url.pathname === "/api/briefs") {
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return apiError("INVALID_LIMIT", "limit 必须是 1 到 100 之间的整数。", 400);
    }
    try {
      const payload = await listBriefs(env.DB, {
        limit,
        cursor: url.searchParams.get("cursor"),
        now: nowIso,
      });
      return await cachedJson(request, payload, head);
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_CURSOR") {
        return apiError("INVALID_CURSOR", "cursor 无效或已损坏。", 400);
      }
      throw error;
    }
  }

  const dateMatch = /^\/api\/briefs\/([^/]+)$/u.exec(url.pathname);
  if (dateMatch?.[1]) {
    const date = dateMatch[1];
    if (!isValidUtcDate(date)) return apiError("INVALID_DATE", "日期必须是有效的 YYYY-MM-DD UTC 日期。", 400);
    const brief = await getBrief(env.DB, date, nowIso);
    return brief
      ? cachedJson(request, { ...brief, features: { exploration: explorationEnabled(env.ITEM_EXPLORATION_ENABLED) } }, head)
      : apiError("BRIEF_NOT_FOUND", "未找到指定日期的简报。", 404);
  }

  return apiError("API_NOT_FOUND", "未找到该 API。", 404);
}

function parseByteRange(header: string, size: number): { offset: number; length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) return null;
  const end = Math.min(requestedEnd, size - 1);
  return { offset: start, length: end - start + 1 };
}
