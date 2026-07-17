import { FEEDBACK_VALUES, type FeedbackValue } from "../domain/types";
import {
  getBriefAudio,
  getBrief,
  getEntityFeedback,
  getLatestBrief,
  listBriefs,
  removeEntityFeedback,
  setEntityFeedback,
} from "../storage/repository";
import { enqueueBriefAudio } from "../audio/jobs";
import { handlePushSubscriptionRequest } from "../push/subscriptions";
import { explorationEnabled, handleExplorationRequest } from "../exploration/http";

const API_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";
function audioEnabled(value: unknown): boolean { return value === "true"; }

interface ApiError {
  error: { code: string; message: string };
}

function apiError(code: string, message: string, status: number, extraHeaders?: HeadersInit): Response {
  return jsonResponse({ error: { code, message } } satisfies ApiError, status, extraHeaders, null, false);
}

function feedbackResponse(value: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store");
  if (status !== 204) headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(status === 204 ? null : JSON.stringify(value), { status, headers });
}

function feedbackError(code: string, message: string, status: number, extraHeaders?: HeadersInit): Response {
  return feedbackResponse({ error: { code, message } } satisfies ApiError, status, extraHeaders);
}

async function validFeedbackToken(request: Request, configuredToken: string | undefined): Promise<boolean> {
  if (!configuredToken) return false;
  const authorization = request.headers.get("Authorization");
  const suppliedToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const encoder = new TextEncoder();
  const [suppliedDigest, configuredDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(suppliedToken)),
    crypto.subtle.digest("SHA-256", encoder.encode(configuredToken)),
  ]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
  };
  return subtle.timingSafeEqual(suppliedDigest, configuredDigest) && suppliedToken.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ENTITY_ID_PATTERN = /^entity_[a-f0-9]{32}$/u;

async function handleFeedbackRequest(request: Request, env: Pick<Env, "DB" | "WATCHTOWER_FEEDBACK_TOKEN">, now: Date): Promise<Response> {
  if (!env.WATCHTOWER_FEEDBACK_TOKEN) {
    return feedbackError("FEEDBACK_UNAVAILABLE", "反馈功能暂不可用。", 503);
  }
  if (!(await validFeedbackToken(request, env.WATCHTOWER_FEEDBACK_TOKEN))) {
    return feedbackError("UNAUTHORIZED", "反馈凭证无效。", 401, { "WWW-Authenticate": "Bearer" });
  }

  const url = new URL(request.url);
  if (url.pathname === "/api/feedback") {
    if (request.method !== "GET") {
      return feedbackError("METHOD_NOT_ALLOWED", "此接口仅支持 GET。", 405, { Allow: "GET" });
    }
    const entityIds = url.searchParams.getAll("entityId");
    if (entityIds.length > 20 || entityIds.some((entityId) => !ENTITY_ID_PATTERN.test(entityId))) {
      return feedbackError("INVALID_ENTITY_IDS", "entityId 必须是最多 20 个有效实体标识。", 400);
    }
    return feedbackResponse({ feedback: await getEntityFeedback(env.DB, [...new Set(entityIds)]) });
  }

  const match = /^\/api\/feedback\/([^/]+)$/u.exec(url.pathname);
  if (!match?.[1]) return feedbackError("API_NOT_FOUND", "未找到该 API。", 404);
  const entityId = match[1];
  if (!ENTITY_ID_PATTERN.test(entityId)) return feedbackError("INVALID_ENTITY_ID", "entityId 无效。", 400);

  if (request.method === "DELETE") {
    await removeEntityFeedback(env.DB, entityId);
    return feedbackResponse(null, 204);
  }
  if (request.method !== "PUT") {
    return feedbackError("METHOD_NOT_ALLOWED", "此接口仅支持 PUT 和 DELETE。", 405, { Allow: "PUT, DELETE" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return feedbackError("INVALID_FEEDBACK", "请求正文必须是有效 JSON。", 400);
  }
  if (!isRecord(body)) {
    return feedbackError("INVALID_FEEDBACK", "反馈内容无效。", 400);
  }
  const value = body.value;
  const briefDate = body.briefDate;
  if (
    typeof value !== "string" ||
    !FEEDBACK_VALUES.includes(value as FeedbackValue) ||
    typeof briefDate !== "string" ||
    !isValidUtcDate(briefDate)
  ) {
    return feedbackError("INVALID_FEEDBACK", "反馈值或简报日期无效。", 400);
  }
  const saved = await setEntityFeedback(env.DB, entityId, value as FeedbackValue, briefDate, now.toISOString());
  return saved
    ? feedbackResponse({ entityId, value })
    : feedbackError("FEEDBACK_TARGET_NOT_FOUND", "未找到该简报中的反馈对象。", 404);
}

async function handleAdminAudioRequest(request: Request, env: Pick<Env, "DB" | "WATCHTOWER_FEEDBACK_TOKEN" | "BRIEF_AUDIO_QUEUE" | "BRIEF_AUDIO_ENABLED" | "MIMO_API_KEY">, now: Date): Promise<Response> {
  if (request.method !== "POST") return feedbackError("METHOD_NOT_ALLOWED", "此接口仅支持 POST。", 405, { Allow: "POST" });
  if (!(await validFeedbackToken(request, env.WATCHTOWER_FEEDBACK_TOKEN))) return feedbackError("UNAUTHORIZED", "反馈凭证无效。", 401, { "WWW-Authenticate": "Bearer" });
  const match = /^\/api\/admin\/brief-audio\/([^/]+)$/u.exec(new URL(request.url).pathname);
  const date = match?.[1] ?? "";
  if (!isValidUtcDate(date)) return feedbackError("INVALID_DATE", "日期必须是有效的 YYYY-MM-DD UTC 日期。", 400);
  if (!audioEnabled(env.BRIEF_AUDIO_ENABLED) || env.MIMO_API_KEY.length === 0) return feedbackError("BRIEF_AUDIO_UNAVAILABLE", "语音简报功能暂不可用。", 503);
  const status = await enqueueBriefAudio(env, date, now);
  if (status === "not-found") return feedbackError("BRIEF_NOT_FOUND", "未找到已发布简报。", 404);
  if (status === "disabled") return feedbackError("BRIEF_AUDIO_UNAVAILABLE", "语音简报功能暂不可用。", 503);
  return feedbackResponse({ briefDate: date, status });
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
  env: Pick<Env, "DB" | "ASSETS" | "WATCHTOWER_FEEDBACK_TOKEN" | "BRIEF_AUDIO" | "BRIEF_AUDIO_QUEUE" | "BRIEF_AUDIO_ENABLED" | "MIMO_API_KEY" | "PUSH_TOKEN_ENCRYPTION_KEY" | "PUSH_TOKEN_HMAC_KEY" | "MOBILE_PUSH_RATE_LIMITER" | "ITEM_EXPLORATION_QUEUE" | "EXPLORATION_RATE_LIMITER" | "ITEM_EXPLORATION_ENABLED" | "ITEM_EXPLORATION_DAILY_TAVILY_CREDITS" | "ITEM_EXPLORATION_CREDIT_RESERVATION">,
  now = new Date(),
): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
  if (url.pathname === "/api/mobile/v1/push-subscriptions") {
    return handlePushSubscriptionRequest(request, env, now);
  }
  if (url.pathname === "/api/feedback" || url.pathname.startsWith("/api/feedback/")) {
    return handleFeedbackRequest(request, env, now);
  }
  if (url.pathname.startsWith("/api/admin/brief-audio/")) return handleAdminAudioRequest(request, env, now);
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
