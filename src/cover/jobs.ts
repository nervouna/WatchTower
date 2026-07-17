import { buildCoverPrompt, COVER_MODEL, COVER_PROMPT_VERSION, generateCoverImage } from "./fal";
import {
  claimBriefCover,
  failBriefCover,
  getBrief,
  getBriefCover,
  queueBriefCover,
  readyBriefCover,
  saveBriefCoverRequest,
} from "../storage/repository";
import type { BriefPayload } from "../domain/types";

export interface BriefCoverJob { kind: "brief-cover"; briefDate: string; contentHash: string }

function enabled(value: unknown): boolean { return value === "true"; }

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function briefCoverContentHash(brief: BriefPayload): Promise<string> {
  const value = JSON.stringify({
    date: brief.date,
    headline: brief.headline,
    intro: brief.intro,
    items: brief.items.slice(0, 5).map((item) => ({ title: item.title, tags: item.tags.slice(0, 3) })),
    promptVersion: COVER_PROMPT_VERSION,
    model: COVER_MODEL,
    style: "digital_illustration/cover",
    imageSize: "square_hd",
  });
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function enqueueBriefCover(
  env: Pick<Env, "DB" | "BRIEF_AUDIO_QUEUE" | "BRIEF_COVER_ENABLED">,
  date: string,
  now = new Date(),
): Promise<"queued" | "already-pending" | "already-ready" | "disabled" | "not-found"> {
  if (!enabled(env.BRIEF_COVER_ENABLED)) return "disabled";
  const brief = await getBrief(env.DB, date, now.toISOString());
  if (!brief) return "not-found";
  const contentHash = await briefCoverContentHash(brief);
  const status = await queueBriefCover(env.DB, date, contentHash, now.toISOString());
  if (status === "queued") {
    try {
      await env.BRIEF_AUDIO_QUEUE.send({ kind: "brief-cover", briefDate: date, contentHash } satisfies BriefCoverJob);
    } catch (error) {
      await failBriefCover(env.DB, date, contentHash, "COVER_QUEUE_SEND_FAILED", now.toISOString());
      throw error;
    }
  }
  return status;
}

function stableError(error: unknown): string {
  const raw = error instanceof Error ? (error.message.split(":", 1)[0] ?? "COVER_UNKNOWN_ERROR") : "COVER_UNKNOWN_ERROR";
  return /^[A-Z][A-Z0-9_]*$/u.test(raw) ? raw : "COVER_UNKNOWN_ERROR";
}

export async function processBriefCoverJob(
  env: Pick<Env, "DB" | "BRIEF_AUDIO" | "FAL_API_KEY">,
  job: BriefCoverJob,
  now = new Date(),
  recoverProcessing = false,
): Promise<"ready" | "ignored"> {
  const started = Date.now();
  const claimed = await claimBriefCover(env.DB, job.briefDate, job.contentHash, now.toISOString(), recoverProcessing);
  if (!claimed) return "ignored";
  try {
    const brief = await getBrief(env.DB, job.briefDate, now.toISOString());
    if (!brief || (await briefCoverContentHash(brief)) !== job.contentHash) {
      await failBriefCover(env.DB, job.briefDate, job.contentHash, "COVER_STALE_JOB", now.toISOString());
      return "ignored";
    }
    const objectKey = `briefs/${job.briefDate}/${job.contentHash}.cover`;
    const existing = await env.BRIEF_AUDIO.head(objectKey);
    if (existing && existing.size > 0 && existing.size <= 10 * 1024 * 1024 && existing.httpMetadata?.contentType?.startsWith("image/")) {
      await readyBriefCover(env.DB, job.briefDate, job.contentHash, objectKey, now.toISOString());
      return "ready";
    }
    const result = await generateCoverImage(env.FAL_API_KEY, buildCoverPrompt(brief), {
      request: claimed.fal_request_id && claimed.fal_status_url && claimed.fal_response_url ? {
        requestId: claimed.fal_request_id,
        statusUrl: claimed.fal_status_url,
        responseUrl: claimed.fal_response_url,
      } : null,
      onSubmitted: async (request) => saveBriefCoverRequest(env.DB, job.briefDate, job.contentHash, request, new Date().toISOString()),
    });
    await env.BRIEF_AUDIO.put(objectKey, result.bytes, {
      httpMetadata: { contentType: result.contentType, cacheControl: "public, max-age=3600" },
      customMetadata: {
        provider: "fal-ai",
        model: COVER_MODEL,
        promptVersion: COVER_PROMPT_VERSION,
        briefDate: job.briefDate,
        requestId: result.requestId,
      },
      storageClass: "Standard",
    });
    const previousObject = claimed.object_key;
    const generatedAt = new Date().toISOString();
    await readyBriefCover(env.DB, job.briefDate, job.contentHash, objectKey, generatedAt);
    if (previousObject && previousObject !== objectKey) await env.BRIEF_AUDIO.delete(previousObject);
    console.log(JSON.stringify({
      event: "brief_cover_ready",
      briefDate: job.briefDate,
      status: "ready",
      attempt: claimed.attempt_count,
      durationMs: Date.now() - started,
      model: COVER_MODEL,
    }));
    return "ready";
  } catch (error) {
    const errorCode = stableError(error);
    await failBriefCover(env.DB, job.briefDate, job.contentHash, errorCode, new Date().toISOString());
    console.error(JSON.stringify({
      event: "brief_cover_failed",
      briefDate: job.briefDate,
      status: "failed",
      attempt: claimed.attempt_count,
      durationMs: Date.now() - started,
      model: COVER_MODEL,
      errorCode,
    }));
    throw error;
  }
}

export async function currentCoverJob(db: D1Database, date: string): Promise<BriefCoverJob | null> {
  const row = await getBriefCover(db, date);
  return row ? { kind: "brief-cover", briefDate: date, contentHash: row.content_hash } : null;
}
