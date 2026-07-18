import type { BriefPayload } from "../domain/types";

export const COVER_MODEL = "fal-ai/recraft/v3/text-to-image";
export const COVER_PROMPT_VERSION = "podcast-cover-v2-bounded";
export const COVER_PROMPT_MAX_CHARS = 1_000;
export const COVER_PROMPT_TARGET_CHARS = 980;
const FAL_QUEUE_BASE = `https://queue.fal.run/${COVER_MODEL}`;
const MAX_ERROR_BODY_BYTES = 32 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

interface GenerateOptions {
  request?: FalRequestTracking | null;
  fetcher?: typeof fetch;
  onSubmitted?: (request: FalRequestTracking) => Promise<void>;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

export interface FalRequestTracking {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
}

export interface GeneratedCoverImage {
  requestId: string;
  bytes: ArrayBuffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
}

export class FalProviderError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) {
    super(message);
    this.name = "FalProviderError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function limitedErrorPayload(response: Response): Promise<Record<string, unknown> | null> {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_ERROR_BODY_BYTES) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  async function readNext(): Promise<boolean> {
    const result = await reader.read();
    if (result.done) return true;
    total += result.value.byteLength;
    if (total > MAX_ERROR_BODY_BYTES) {
      await reader.cancel();
      return false;
    }
    chunks.push(result.value);
    return readNext();
  }
  if (!(await readNext())) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return record(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  } catch {
    return null;
  }
}

function promptTooLong(payload: Record<string, unknown> | null): boolean {
  if (!payload || !Array.isArray(payload.detail)) return false;
  return payload.detail.some((value) => {
    const detail = record(value);
    if (!detail || !Array.isArray(detail.loc) || detail.loc.join(".") !== "body.prompt") return false;
    if (detail.type === "string_too_long") return true;
    return typeof detail.msg === "string" && /at most\s+\d+\s+characters/iu.test(detail.msg);
  });
}

function retryableHttpStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 409 || status === 425 || status === 429;
}

async function httpError(response: Response, code: string): Promise<FalProviderError> {
  const payload = await limitedErrorPayload(response);
  if ((response.status === 400 || response.status === 422) && promptTooLong(payload)) {
    return new FalProviderError("FAL_PROMPT_TOO_LONG", false, response.status);
  }
  return new FalProviderError(`${code}_HTTP_${String(response.status)}`, retryableHttpStatus(response.status), response.status);
}

async function json(response: Response, code: string): Promise<Record<string, unknown>> {
  if (!response.ok) throw await httpError(response, code);
  try {
    const value: unknown = await response.json();
    const result = record(value);
    if (!result) throw new Error(code);
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(code)) throw error;
    throw new Error(code, { cause: error });
  }
}

function auth(apiKey: string): HeadersInit {
  return { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" };
}

function normalized(value: string): string {
  return value.replaceAll(/\s+/gu, " ").trim();
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function clip(value: string, length: number): string {
  return Array.from(normalized(value)).slice(0, Math.max(0, length)).join("");
}

function signalText(title: string, tags: string[], budget: number): string {
  const clippedTitle = clip(title, 80);
  if (budget <= 0 || clippedTitle.length === 0) return "";
  const tagText = tags.slice(0, 2).map((tag) => clip(tag, 24)).filter(Boolean).join(", ");
  const withTags = tagText ? `${clippedTitle} (${tagText})` : clippedTitle;
  return codePointLength(withTags) <= budget ? withTags : clip(clippedTitle, budget);
}

export function buildCoverPrompt(brief: BriefPayload): string {
  const opening = "Square editorial podcast cover for WatchTower, a calm, precise Chinese technology and product briefing.";
  const style = "Modern digital illustration with one focal point, radar and signal-scanning motifs, cool neutral surfaces, and Radar Cyan (#0E7490) as the only decorative accent.";
  const layout = "Keep generous negative space in the upper-left and center-left for a client-rendered title overlay.";
  const restrictions = "Artwork must contain no words, letters, numbers, logos, or watermarks; no UI screenshots, device mockups, borders, or recognizable trademarks.";
  const scaffold = [opening, "Theme: .", "Context: .", "Signals: .", style, layout, restrictions].join(" ");
  let remaining = COVER_PROMPT_TARGET_CHARS - codePointLength(scaffold);

  const headline = clip(brief.headline, Math.min(140, remaining));
  remaining -= codePointLength(headline);

  const rankedItems = brief.items.slice(0, 5);
  const signals: string[] = [];
  const first = rankedItems[0];
  if (first && remaining > 0) {
    const text = signalText(first.title, first.tags, Math.min(120, remaining));
    if (text) signals.push(text);
    remaining -= codePointLength(text);
  } else if (!first && remaining > 0) {
    const fallback = clip("Trustworthy technology signals and product discovery", Math.min(80, remaining));
    signals.push(fallback);
    remaining -= codePointLength(fallback);
  }

  const intro = clip(brief.intro, Math.min(180, remaining));
  remaining -= codePointLength(intro);

  for (const item of rankedItems.slice(1)) {
    if (remaining < 24) break;
    const separatorLength = signals.length > 0 ? 2 : 0;
    if (remaining <= separatorLength) break;
    const text = signalText(item.title, item.tags, Math.min(105, remaining - separatorLength));
    if (!text) continue;
    signals.push(text);
    remaining -= codePointLength(text) + separatorLength;
  }

  const prompt = [
    opening,
    `Theme: ${headline}.`,
    `Context: ${intro}.`,
    `Signals: ${signals.join("; ")}.`,
    style,
    layout,
    restrictions,
  ].join(" ");
  if (codePointLength(prompt) > COVER_PROMPT_TARGET_CHARS) throw new Error("COVER_PROMPT_BUDGET_EXCEEDED");
  return prompt;
}

function trustedMediaUrl(value: unknown): URL {
  if (typeof value !== "string") throw new Error("FAL_MISSING_IMAGE");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("FAL_UNTRUSTED_MEDIA_URL"); }
  if (url.protocol !== "https:" || (url.hostname !== "fal.media" && !url.hostname.endsWith(".fal.media"))) {
    throw new Error("FAL_UNTRUSTED_MEDIA_URL");
  }
  return url;
}

function trustedQueueUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("FAL_MISSING_TRACKING_URL");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("FAL_UNTRUSTED_TRACKING_URL"); }
  if (url.protocol !== "https:" || url.hostname !== "queue.fal.run") throw new Error("FAL_UNTRUSTED_TRACKING_URL");
  return url.toString();
}

function validMagic(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}

async function limitedBytes(response: Response): Promise<ArrayBuffer> {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw new Error("FAL_IMAGE_TOO_LARGE");
  if (!response.body) throw new Error("FAL_EMPTY_IMAGE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  async function readNext(): Promise<void> {
    const result = await reader.read();
    if (result.done) return;
    total += result.value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("FAL_IMAGE_TOO_LARGE");
    }
    chunks.push(result.value);
    await readNext();
  }
  await readNext();
  if (total === 0) throw new Error("FAL_EMPTY_IMAGE");
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output.buffer;
}

async function pause(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function generateCoverImage(apiKey: string, prompt: string, options: GenerateOptions = {}): Promise<GeneratedCoverImage> {
  if (codePointLength(prompt) > COVER_PROMPT_MAX_CHARS) throw new FalProviderError("FAL_PROMPT_TOO_LONG", false);
  const fetcher = options.fetcher ?? fetch;
  let tracking = options.request ? {
    requestId: options.request.requestId,
    statusUrl: trustedQueueUrl(options.request.statusUrl),
    responseUrl: trustedQueueUrl(options.request.responseUrl),
  } : null;
  if (!tracking) {
    const submitted = await json(await fetcher(FAL_QUEUE_BASE, {
      method: "POST",
      headers: auth(apiKey),
      body: JSON.stringify({
        prompt,
        image_size: "square_hd",
        style: "digital_illustration/cover",
        colors: [{ r: 14, g: 116, b: 144 }],
        enable_safety_checker: true,
      }),
    }), "FAL_SUBMIT_FAILED");
    if (typeof submitted.request_id !== "string" || submitted.request_id.length === 0) throw new Error("FAL_MISSING_REQUEST_ID");
    tracking = {
      requestId: submitted.request_id,
      statusUrl: trustedQueueUrl(submitted.status_url),
      responseUrl: trustedQueueUrl(submitted.response_url),
    };
    await options.onSubmitted?.(tracking);
  }

  const started = Date.now();
  const maxWaitMs = options.maxWaitMs ?? 8 * 60 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  let complete = false;
  do {
    const status = await json(await fetcher(tracking.statusUrl, { headers: auth(apiKey) }), "FAL_STATUS_FAILED");
    if (status.status === "COMPLETED") {
      if (typeof status.error === "string" && status.error.length > 0) throw new Error("FAL_GENERATION_FAILED");
      complete = true;
    } else {
      if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") throw new Error("FAL_INVALID_STATUS");
      if (Date.now() - started >= maxWaitMs) throw new Error("FAL_POLL_TIMEOUT");
      await pause(pollIntervalMs);
    }
  } while (!complete);

  const result = await json(await fetcher(tracking.responseUrl, { headers: auth(apiKey) }), "FAL_RESULT_FAILED");
  const images = Array.isArray(result.images) ? result.images : [];
  const image = record(images[0]);
  const mediaUrl = trustedMediaUrl(image?.url);
  const media = await fetcher(mediaUrl, { redirect: "manual" });
  if (!media.ok) throw new Error(`FAL_MEDIA_HTTP_${String(media.status)}`);
  const fallbackType = typeof image?.content_type === "string" ? image.content_type : "";
  const rawType = media.headers.get("Content-Type") ?? fallbackType;
  const contentType = (rawType.split(";", 1)[0] ?? "").trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) throw new Error("FAL_INVALID_IMAGE_TYPE");
  const bytes = await limitedBytes(media);
  if (!validMagic(new Uint8Array(bytes), contentType)) throw new Error("FAL_INVALID_IMAGE");
  return { requestId: tracking.requestId, bytes, contentType: contentType as GeneratedCoverImage["contentType"] };
}
