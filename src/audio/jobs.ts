import { generateNarration, narrationTranscript } from "./narration";
import { synthesizeSpeech } from "./mimo";
import { parseWav } from "./wav";
import { claimBriefAudio, failBriefAudio, getBriefAudio, queueBriefAudio, readyBriefAudio, saveBriefAudioScript } from "../storage/repository";
import { getBrief } from "../storage/repository";
import type { BriefPayload, NarrationScript } from "../domain/types";

export interface BriefAudioJob { briefDate: string; contentHash: string }
export const AUDIO_MODEL = "mimo-v2.5-tts";
export const AUDIO_VOICE = "冰糖";
export const NARRATION_PROMPT_VERSION = "narration-v1";

function audioEnabled(value: unknown): boolean { return value === "true"; }

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function briefAudioContentHash(brief: BriefPayload): Promise<string> {
  const value = JSON.stringify({
    date: brief.date,
    headline: brief.headline,
    intro: brief.intro,
    items: brief.items.map((item) => ({ entityId: item.entityId, title: item.title, summary: item.summary, whyItMatters: item.whyItMatters })),
    promptVersion: NARRATION_PROMPT_VERSION,
    model: AUDIO_MODEL,
    voice: AUDIO_VOICE,
  });
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function enqueueBriefAudio(env: Pick<Env, "DB" | "BRIEF_AUDIO_QUEUE" | "BRIEF_AUDIO_ENABLED">, date: string, now = new Date()): Promise<"queued" | "already-pending" | "already-ready" | "disabled" | "not-found"> {
  if (!audioEnabled(env.BRIEF_AUDIO_ENABLED)) return "disabled";
  const brief = await getBrief(env.DB, date, now.toISOString());
  if (!brief) return "not-found";
  const contentHash = await briefAudioContentHash(brief);
  const status = await queueBriefAudio(env.DB, date, contentHash, now.toISOString());
  if (status === "queued") {
    try {
      await env.BRIEF_AUDIO_QUEUE.send({ briefDate: date, contentHash } satisfies BriefAudioJob);
    } catch (error) {
      await failBriefAudio(env.DB, date, contentHash, "AUDIO_QUEUE_SEND_FAILED", now.toISOString());
      throw error;
    }
  }
  return status;
}

function stableError(error: unknown): string {
  const raw = error instanceof Error ? (error.message.split(":", 1)[0] ?? "AUDIO_UNKNOWN_ERROR") : "AUDIO_UNKNOWN_ERROR";
  return /^[A-Z][A-Z0-9_]+$/u.test(raw) ? raw : "AUDIO_UNKNOWN_ERROR";
}

function parseStoredScript(value: string): NarrationScript {
  return JSON.parse(value) as NarrationScript;
}

export async function processBriefAudioJob(env: Pick<Env, "DB" | "BRIEF_AUDIO" | "DEEPSEEK_API_KEY" | "MIMO_API_KEY">, job: BriefAudioJob, now = new Date(), recoverProcessing = false): Promise<"ready" | "ignored"> {
  const started = Date.now();
  const claimed = await claimBriefAudio(env.DB, job.briefDate, job.contentHash, now.toISOString(), recoverProcessing);
  if (!claimed) return "ignored";
  try {
    const brief = await getBrief(env.DB, job.briefDate, now.toISOString());
    if (!brief || (await briefAudioContentHash(brief)) !== job.contentHash) {
      await failBriefAudio(env.DB, job.briefDate, job.contentHash, "AUDIO_STALE_JOB", now.toISOString());
      return "ignored";
    }
    const objectKey = `briefs/${job.briefDate}/${job.contentHash}.wav`;
    const existing = await env.BRIEF_AUDIO.head(objectKey);
    if (existing) {
      const duration = Number(existing.customMetadata?.durationSeconds);
      if (Number.isFinite(duration) && duration >= 135 && duration <= 225) {
        await readyBriefAudio(env.DB, job.briefDate, job.contentHash, objectKey, duration, now.toISOString());
        return "ready";
      }
    }
    const script = claimed.script_json ? parseStoredScript(claimed.script_json) : await generateNarration(env.DEEPSEEK_API_KEY, brief);
    if (!claimed.script_json) await saveBriefAudioScript(env.DB, job.briefDate, job.contentHash, JSON.stringify(script), new Date().toISOString());
    const transcript = narrationTranscript(script);
    const result = await synthesizeSpeech(env.MIMO_API_KEY, transcript, job.contentHash);
    parseWav(result.wav);
    await env.BRIEF_AUDIO.put(objectKey, result.wav, {
      httpMetadata: { contentType: "audio/wav", cacheControl: "public, max-age=3600" },
      customMetadata: { provider: "xiaomi-mimo", model: AUDIO_MODEL, voice: AUDIO_VOICE, briefDate: job.briefDate, durationSeconds: String(result.durationSeconds) },
      storageClass: "Standard",
    });
    const previousObject = claimed.object_key;
    const generatedAt = new Date().toISOString();
    await readyBriefAudio(env.DB, job.briefDate, job.contentHash, objectKey, result.durationSeconds, generatedAt);
    if (previousObject && previousObject !== objectKey) await env.BRIEF_AUDIO.delete(previousObject);
    console.log(JSON.stringify({ event: "brief_audio_ready", briefDate: job.briefDate, status: "ready", attempt: claimed.attempt_count, durationMs: Date.now() - started, model: AUDIO_MODEL }));
    return "ready";
  } catch (error) {
    const errorCode = stableError(error);
    await failBriefAudio(env.DB, job.briefDate, job.contentHash, errorCode, new Date().toISOString());
    console.error(JSON.stringify({ event: "brief_audio_failed", briefDate: job.briefDate, status: "failed", attempt: claimed.attempt_count, durationMs: Date.now() - started, model: AUDIO_MODEL, errorCode }));
    throw error;
  }
}

export async function currentAudioJob(db: D1Database, date: string): Promise<BriefAudioJob | null> {
  const row = await getBriefAudio(db, date);
  return row ? { briefDate: date, contentHash: row.content_hash } : null;
}
