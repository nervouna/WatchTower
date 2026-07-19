import { encryptToken, hmacHex, stablePushId } from "./crypto";
import { PUSH_APP_IDS, type ApnsEnvironment, type PushAppId } from "./apns";
import { removePushSubscription, upsertPushSubscription } from "./repository";

interface MobilePushError {
  error: { code: string; message: string };
}

type RateLimiter = { limit(input: { key: string }): Promise<{ success: boolean }> };
type SubscriptionEnv = Pick<Env, "DB" | "PUSH_TOKEN_ENCRYPTION_KEY" | "PUSH_TOKEN_HMAC_KEY" | "DEPLOYMENT_ENV"> & {
  MOBILE_PUSH_RATE_LIMITER?: RateLimiter;
};

function response(value: unknown, status: number, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store");
  if (status !== 204) headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(status === 204 ? null : JSON.stringify(value), { status, headers });
}

function error(code: string, message: string, status: number, extraHeaders?: HeadersInit): Response {
  return response({ error: { code, message } } satisfies MobilePushError, status, extraHeaders);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const INSTALLATION_SECRET = /^[A-Za-z0-9_-]{43}$/u;
const DEVICE_TOKEN = /^[a-f0-9]{64}$/u;
const APP_VERSION = /^[0-9A-Za-z.+-]{1,32}$/u;

function appEnvironmentIsValid(appId: PushAppId, environment: ApnsEnvironment): boolean {
  return (appId === PUSH_APP_IDS.development && environment === "sandbox") ||
    (appId === PUSH_APP_IDS.production && environment === "production");
}

async function readBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(length) && length > 1024) throw new Error("BODY_TOO_LARGE");
  const text = await request.text();
  if (text.length > 1024) throw new Error("BODY_TOO_LARGE");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

async function rateAllowed(request: Request, env: SubscriptionEnv): Promise<boolean> {
  if (!env.MOBILE_PUSH_RATE_LIMITER) return true;
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  return (await env.MOBILE_PUSH_RATE_LIMITER.limit({ key: `${ip}:mobile-push` })).success;
}

export async function handlePushSubscriptionRequest(request: Request, env: SubscriptionEnv, now = new Date()): Promise<Response> {
  if (request.method !== "PUT" && request.method !== "DELETE") {
    return error("METHOD_NOT_ALLOWED", "此接口仅支持 PUT 和 DELETE。", 405, { Allow: "PUT, DELETE" });
  }
  if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return error("UNSUPPORTED_MEDIA_TYPE", "请求正文必须使用 application/json。", 415);
  }
  if (!(await rateAllowed(request, env))) return error("RATE_LIMITED", "请求过于频繁，请稍后重试。", 429, { "Retry-After": "60" });

  let body: unknown;
  try {
    body = await readBody(request);
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "INVALID_JSON";
    return code === "BODY_TOO_LARGE"
      ? error(code, "请求正文过大。", 413)
      : error("INVALID_JSON", "请求正文必须是有效 JSON。", 400);
  }
  if (!isRecord(body) || typeof body.installationSecret !== "string" || !INSTALLATION_SECRET.test(body.installationSecret)) {
    return error("INVALID_INSTALLATION", "安装凭证无效。", 400);
  }
  const installationHmac = await hmacHex(env.PUSH_TOKEN_HMAC_KEY, body.installationSecret);
  if (request.method === "DELETE") {
    await removePushSubscription(env.DB, installationHmac);
    return response(null, 204);
  }
  if (
    typeof body.deviceToken !== "string" || !DEVICE_TOKEN.test(body.deviceToken) ||
    (body.environment !== "sandbox" && body.environment !== "production") ||
    typeof body.appId !== "string" ||
    typeof body.appVersion !== "string" || !APP_VERSION.test(body.appVersion)
  ) {
    return error("INVALID_SUBSCRIPTION", "推送订阅内容无效。", 400);
  }
  if (
    (body.appId !== PUSH_APP_IDS.development && body.appId !== PUSH_APP_IDS.production) ||
    !appEnvironmentIsValid(body.appId, body.environment)
  ) {
    return error("INVALID_PUSH_APP_ENVIRONMENT", "推送应用与 APNs 环境不匹配。", 400);
  }
  const expected = env.DEPLOYMENT_ENV === "dev"
    ? { appId: PUSH_APP_IDS.development, environment: "sandbox" }
    : { appId: PUSH_APP_IDS.production, environment: "production" };
  if (body.appId !== expected.appId || body.environment !== expected.environment) {
    return error("PUSH_ENVIRONMENT_MISMATCH", "推送订阅与当前服务环境不匹配。", 400);
  }
  const encrypted = await encryptToken(env.PUSH_TOKEN_ENCRYPTION_KEY, body.deviceToken);
  const tokenHmac = await hmacHex(env.PUSH_TOKEN_HMAC_KEY, body.deviceToken);
  await upsertPushSubscription(env.DB, {
    id: await stablePushId("subscription", installationHmac),
    installation_hmac: installationHmac,
    token_hmac: tokenHmac,
    token_ciphertext: encrypted.ciphertext,
    token_iv: encrypted.iv,
    environment: body.environment,
    app_id: body.appId,
    app_version: body.appVersion,
    active: 1,
    createdAt: now.toISOString(),
  });
  return response(null, 204);
}
