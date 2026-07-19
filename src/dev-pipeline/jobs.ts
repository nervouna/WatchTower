import { executePipelineStage } from "../pipeline/execution";
import { isTerminalQueueFailure } from "../queue/failures";
import { claimDevPipelineRun, finishDevPipelineRun, retryDevPipelineRun } from "./repository";

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
  queueDeliveryAttempt = 1,
  execute = executePipelineStage,
): Promise<"processed" | "already-processed"> {
  const run = await claimDevPipelineRun(env.DB, job.runId, now.toISOString(), queueDeliveryAttempt > 1);
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
    const errorCode = stableErrorCode(error);
    if (isTerminalQueueFailure(error, queueDeliveryAttempt)) {
      await finishDevPipelineRun(env.DB, job.runId, {
        status: "failed", outcome: null, errorCode, now: new Date().toISOString(),
      });
    } else {
      await retryDevPipelineRun(env.DB, job.runId, errorCode);
    }
    throw error;
  }
}
