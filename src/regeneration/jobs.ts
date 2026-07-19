import { enqueueBriefAudio } from "../audio/jobs";
import { enqueueBriefCover } from "../cover/jobs";
import { generateBrief, type EntityCatalogEntry, type GeneratedBriefResult } from "../domain/deepseek";
import type { StoredCandidate } from "../domain/types";
import { buildBriefDraft } from "../ingestion/pipeline";
import {
  claimBriefRegeneration,
  finishBriefRegeneration,
  getBrief,
  getCandidates,
  getEntityCatalog,
  replaceBrief,
} from "../storage/repository";

export interface BriefRegenerationJob {
  kind: "brief-regeneration";
  briefDate: string;
  jobId: string;
}

export interface RegenerationDependencies {
  generate: (
    apiKey: string,
    targetDate: string,
    candidates: readonly StoredCandidate[],
    entities: readonly EntityCatalogEntry[],
  ) => Promise<GeneratedBriefResult>;
  enqueueAudio: typeof enqueueBriefAudio;
  enqueueCover: typeof enqueueBriefCover;
}

const DEFAULT_DEPENDENCIES: RegenerationDependencies = {
  generate: generateBrief,
  enqueueAudio: enqueueBriefAudio,
  enqueueCover: enqueueBriefCover,
};

function stableError(error: unknown): string {
  const raw = error instanceof Error ? (error.message.split(":", 1)[0] ?? "BRIEF_REGENERATION_FAILED") : "BRIEF_REGENERATION_FAILED";
  return /^[A-Z][A-Z0-9_]*$/u.test(raw) ? raw : "BRIEF_REGENERATION_FAILED";
}

export async function processBriefRegenerationJob(
  env: Pick<Env, "DB" | "DEEPSEEK_API_KEY" | "BRIEF_AUDIO_QUEUE" | "BRIEF_AUDIO_ENABLED" | "BRIEF_COVER_ENABLED">,
  job: BriefRegenerationJob,
  now = new Date(),
  recoverProcessing = false,
  dependencies: RegenerationDependencies = DEFAULT_DEPENDENCIES,
): Promise<"succeeded" | "failed" | "ignored"> {
  const claimed = await claimBriefRegeneration(env.DB, job.briefDate, job.jobId, now.toISOString(), recoverProcessing);
  if (!claimed) return "ignored";

  try {
    const brief = await getBrief(env.DB, job.briefDate, now.toISOString());
    if (!brief) throw new Error("BRIEF_NOT_FOUND");
    const candidates = await getCandidates(env.DB, job.briefDate);
    if (candidates.length === 0) throw new Error("BRIEF_REGENERATION_UNAVAILABLE");
    const entities = await getEntityCatalog(env.DB, job.briefDate);
    const generated = await dependencies.generate(env.DEEPSEEK_API_KEY, job.briefDate, candidates, entities);
    if (generated.brief.items.length === 0) throw new Error("EMPTY_GENERATED_BRIEF");

    await replaceBrief(
      env.DB,
      buildBriefDraft(
        generated.brief,
        candidates,
        entities,
        job.briefDate,
        brief.status,
        brief.missingSources,
        new Date().toISOString(),
        brief.publishedAt,
      ),
    );
    await finishBriefRegeneration(env.DB, job.briefDate, job.jobId, "succeeded", null, new Date().toISOString());

    try {
      await dependencies.enqueueAudio(env, job.briefDate, new Date());
    } catch {
      console.error(JSON.stringify({ event: "brief_regeneration_audio_enqueue_failed", briefDate: job.briefDate, jobId: job.jobId, errorCode: "AUDIO_QUEUE_SEND_FAILED" }));
    }
    try {
      await dependencies.enqueueCover(env, job.briefDate, new Date());
    } catch {
      console.error(JSON.stringify({ event: "brief_regeneration_cover_enqueue_failed", briefDate: job.briefDate, jobId: job.jobId, errorCode: "COVER_QUEUE_SEND_FAILED" }));
    }
    console.log(JSON.stringify({ event: "brief_regeneration_succeeded", briefDate: job.briefDate, jobId: job.jobId, status: "succeeded", attempt: claimed.attempt_count }));
    return "succeeded";
  } catch (error) {
    const errorCode = stableError(error);
    await finishBriefRegeneration(env.DB, job.briefDate, job.jobId, "failed", errorCode, new Date().toISOString());
    console.error(JSON.stringify({ event: "brief_regeneration_failed", briefDate: job.briefDate, jobId: job.jobId, status: "failed", attempt: claimed.attempt_count, errorCode }));
    return "failed";
  }
}
