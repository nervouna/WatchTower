import { executePipelineStage } from "../pipeline/execution";
import { claimDevPipelineRun, finishDevPipelineRun } from "./repository";

export const DEV_PIPELINE_QUEUE_NAME = "watchtower-dev-pipeline-runs";

export interface DevPipelineJob {
  kind: "dev-pipeline-run";
  runId: string;
}

function stableErrorCode(error: unknown): string {
  const raw = error instanceof Error ? (error.message.split(":", 1)[0] ?? "UNKNOWN_ERROR") : "UNKNOWN_ERROR";
  return /^[A-Z][A-Z0-9_]*$/u.test(raw) ? raw : "UNKNOWN_ERROR";
}

export async function processDevPipelineJob(
  env: Env,
  job: DevPipelineJob,
  now = new Date(),
  recover = false,
  execute = executePipelineStage,
): Promise<"processed" | "already-processed"> {
  const run = await claimDevPipelineRun(env.DB, job.runId, now.toISOString(), recover);
  if (!run) return "already-processed";
  try {
    const result = await execute(env, {
      stage: run.stage,
      targetDate: run.target_date,
      scheduledTime: now.getTime(),
    });
    const errorCode = result.pipeline.outcome === "model-failed" || result.pipeline.outcome === "kept-existing"
      ? result.pipeline.errorCode
      : null;
    await finishDevPipelineRun(env.DB, job.runId, {
      status: errorCode ? "failed" : "succeeded",
      outcome: result.pipeline.outcome,
      errorCode,
      now: new Date().toISOString(),
    });
    return "processed";
  } catch (error) {
    await finishDevPipelineRun(env.DB, job.runId, {
      status: "failed", outcome: null, errorCode: stableErrorCode(error), now: new Date().toISOString(),
    });
    throw error;
  }
}
