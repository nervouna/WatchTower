import { getBrief, getLatestBrief, listBriefs } from "../storage/repository";

const API_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";

interface ApiError {
  error: { code: string; message: string };
}

function apiError(code: string, message: string, status: number, extraHeaders?: HeadersInit): Response {
  return jsonResponse({ error: { code, message } } satisfies ApiError, status, extraHeaders, null, false);
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

export async function handleRequest(request: Request, env: Pick<Env, "DB" | "ASSETS">, now = new Date()): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return apiError("METHOD_NOT_ALLOWED", "此接口仅支持 GET 和 HEAD。", 405, { Allow: "GET, HEAD" });
  }
  const head = request.method === "HEAD";
  const nowIso = now.toISOString();

  if (url.pathname === "/api/briefs/latest") {
    const brief = await getLatestBrief(env.DB, nowIso);
    return brief
      ? cachedJson(request, brief, head)
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
      ? cachedJson(request, brief, head)
      : apiError("BRIEF_NOT_FOUND", "未找到指定日期的简报。", 404);
  }

  return apiError("API_NOT_FOUND", "未找到该 API。", 404);
}
