import { base64Url } from "./crypto";

export type ApnsEnvironment = "sandbox" | "production";
export type PushAppId = "io.damao.watchtower" | "io.damao.watchtower.dev";

export const PUSH_APP_IDS = {
  development: "io.damao.watchtower.dev",
  production: "io.damao.watchtower",
} as const satisfies Record<"development" | "production", PushAppId>;
export type ApnsResult =
  | { kind: "delivered" }
  | { kind: "invalid"; errorCode: string }
  | { kind: "retry"; errorCode: string }
  | { kind: "failed"; errorCode: string };

export interface ApnsConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
  topic: string;
}

function pemBytes(pem: string): Uint8Array<ArrayBuffer> {
  const value = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/gu, "");
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error("APNS_PRIVATE_KEY_INVALID");
  }
}

export async function createApnsJwt(config: Pick<ApnsConfig, "teamId" | "keyId" | "privateKey">, now = new Date()): Promise<string> {
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: config.keyId })));
  const claims = base64Url(new TextEncoder().encode(JSON.stringify({ iss: config.teamId, iat: Math.floor(now.getTime() / 1000) })));
  const signingInput = `${header}.${claims}`;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemBytes(config.privateKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new Error("APNS_PRIVATE_KEY_INVALID");
  }
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

async function responseReason(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && typeof Reflect.get(body, "reason") === "string") {
      return Reflect.get(body, "reason") as string;
    }
  } catch {
    // APNs may return an empty body for transport errors.
  }
  return `HTTP_${String(response.status)}`;
}

export async function sendApnsNotification(
  config: ApnsConfig,
  input: { deviceToken: string; environment: ApnsEnvironment; briefDate: string; headline: string },
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<ApnsResult> {
  const jwt = await createApnsJwt(config, now);
  const host = input.environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  let response: Response;
  try {
    response = await fetcher(`https://${host}/3/device/${input.deviceToken}`, {
      method: "POST",
      headers: {
        Authorization: `bearer ${jwt}`,
        "Content-Type": "application/json",
        "apns-topic": config.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-collapse-id": input.briefDate,
      },
      body: JSON.stringify({
        aps: { alert: { title: "WatchTower 今日简报", body: input.headline }, sound: "default" },
        briefDate: input.briefDate,
      }),
    });
  } catch {
    return { kind: "retry", errorCode: "APNS_NETWORK_ERROR" };
  }
  if (response.ok) return { kind: "delivered" };
  const reason = await responseReason(response);
  if (response.status === 410 || ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(reason)) {
    return { kind: "invalid", errorCode: reason };
  }
  if (response.status === 429 || response.status >= 500) return { kind: "retry", errorCode: reason };
  return { kind: "failed", errorCode: reason };
}
