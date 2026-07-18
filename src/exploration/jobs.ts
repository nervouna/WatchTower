import { getExplorationSeed } from "./repository";
import {
  claimExplorationWork,
  failExploration,
  readyExploration,
  releaseExplorationForRetry,
  saveExplorationEvidence,
  savedEvidence,
  type ExplorationJob,
} from "./repository";
import { hasEnoughExplorationEvidence, researchExploration } from "./research";
import { synthesizeExploration } from "./deepseek";

export const EXPLORATION_QUEUE_NAME = "watchtower-item-exploration-jobs";

export class ExplorationProcessingError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : "EXPLORATION_FAILED";
}

function retryableError(code: string): boolean {
  if (code.startsWith("DEEPSEEK_EXPLORATION_VALIDATION_FAILED:")) return false;
  const clientError = /^TAVILY_(?:SEARCH|EXTRACT)_HTTP_(4\d\d)$/u.exec(code)?.[1];
  return clientError === undefined || clientError === "429";
}

export async function processExplorationJob(
  env: Pick<Env, "DB" | "TAVILY_API_KEY" | "DEEPSEEK_API_KEY" | "ITEM_EXPLORATION_CACHE_TTL_HOURS">,
  job: ExplorationJob,
  now = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  const lease = new Date(now.getTime() + 16 * 60_000).toISOString();
  const row = await claimExplorationWork(env.DB, job, nowIso, lease);
  if (!row) return;
  try {
    let evidence = savedEvidence(row);
    let tavilyCredits = 0;
    if (!evidence) {
      const seed = await getExplorationSeed(env.DB, null, job.entityId, nowIso);
      if (!seed) throw new ExplorationProcessingError("EXPLORATION_TARGET_NOT_FOUND", false);
      const researchStarted = Date.now();
      const research = await researchExploration(env.TAVILY_API_KEY, seed);
      evidence = research.evidence;
      tavilyCredits = research.credits;
      await saveExplorationEvidence(env.DB, job, evidence, research.credits, nowIso);
      console.log(JSON.stringify({ event: "exploration_research_complete", entityId: job.entityId,
        durationMs: Date.now() - researchStarted, sourceCount: evidence.length, tavilyCredits }));
    }
    const ttlHours = Math.max(1, Number(env.ITEM_EXPLORATION_CACHE_TTL_HOURS) || 24);
    const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000).toISOString();
    if (!hasEnoughExplorationEvidence(evidence)) {
      if (evidence.length === 0) throw new ExplorationProcessingError("EXPLORATION_INSUFFICIENT_EVIDENCE", false);
      const sources = evidence.map(({ id, title, url, domain, queryKind }) => ({ id, title, url, domain, queryKind }));
      await readyExploration(env.DB, job, {
        quality: "partial",
        tokens: 0,
        sources,
        sections: {
          overview: {
            text: `本次检索只找到 ${String(evidence.length)} 份可用公开资料，尚不足以可靠覆盖相关产品、外部观点与行业位置。以下仅保留已确认的来源，不对缺失部分进行推测。`,
            sourceIds: evidence.slice(0, 6).map((source) => source.id),
          },
          relatedProducts: [],
          perspectives: [],
          industry: null,
          watchNext: [],
        },
      }, nowIso, expiresAt);
      console.warn(JSON.stringify({ event: "exploration_ready", entityId: job.entityId, quality: "partial",
        sourceCount: evidence.length, tavilyCredits, deepseekTokens: 0, reason: "INSUFFICIENT_EVIDENCE" }));
      return;
    }
    const synthesisStarted = Date.now();
    const result = await synthesizeExploration(env.DEEPSEEK_API_KEY, row.title, evidence);
    console.log(JSON.stringify({ event: "exploration_synthesis_complete", entityId: job.entityId,
      durationMs: Date.now() - synthesisStarted, deepseekTokens: result.tokens, repaired: result.repaired }));
    await readyExploration(env.DB, job, result, nowIso, expiresAt);
    console.log(JSON.stringify({ event: "exploration_ready", entityId: job.entityId, quality: result.quality,
      sourceCount: evidence.length, tavilyCredits, deepseekTokens: result.tokens }));
  } catch (error) {
    if (error instanceof ExplorationProcessingError) throw error;
    const code = errorCode(error);
    throw new ExplorationProcessingError(code, retryableError(code));
  }
}

export async function retryExplorationJob(db: D1Database, job: ExplorationJob, now = new Date()): Promise<void> {
  await releaseExplorationForRetry(db, job, now.toISOString());
}

export async function abandonExplorationJob(
  db: D1Database,
  job: ExplorationJob,
  error: unknown,
  now = new Date(),
): Promise<void> {
  const retryAt = new Date(now.getTime() + 15 * 60_000).toISOString();
  const code = errorCode(error);
  await failExploration(db, job, code, retryAt, now.toISOString());
  console.error(JSON.stringify({ event: "exploration_failed", entityId: job.entityId, errorCode: code }));
}

export type { ExplorationJob } from "./repository";
