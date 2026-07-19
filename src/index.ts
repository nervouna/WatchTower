import { resolveScheduledRun } from "./domain/schedule";
import { handleRequest } from "./http/router";
import { runPipelineStage } from "./ingestion/pipeline";
import { enqueueBriefAudio, processBriefAudioJob, type BriefAudioJob } from "./audio/jobs";
import { CoverProcessingError, enqueueBriefCover, processBriefCoverJob, type BriefCoverJob } from "./cover/jobs";
import {
  enqueueBriefPush,
  abandonBriefPushJob,
  processPushDelivery,
  processPushFanout,
  PUSH_QUEUE_NAME,
  type BriefPushJob,
} from "./push/jobs";
import {
  abandonExplorationJob,
  EXPLORATION_QUEUE_NAME,
  ExplorationProcessingError,
  processExplorationJob,
  retryExplorationJob,
  type ExplorationJob,
} from "./exploration/jobs";
import { processBriefRegenerationJob, type BriefRegenerationJob } from "./regeneration/jobs";

export function isTerminalQueueFailure(error: unknown, attempts: number): boolean {
  return attempts >= 3 ||
    (error instanceof ExplorationProcessingError && !error.retryable) ||
    (error instanceof CoverProcessingError && !error.retryable);
}

export default {
  fetch(request, env): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(controller, env): Promise<void> {
    const started = Date.now();
    const invocation = resolveScheduledRun(controller.cron, controller.scheduledTime);
    try {
      const result = await runPipelineStage(env, { ...invocation, scheduledTime: controller.scheduledTime });
      if (invocation.stage === "final" || invocation.stage === "recovery") {
        try {
          const audioStatus = await enqueueBriefAudio(env, invocation.targetDate);
          console.log(JSON.stringify({ event: "brief_audio_enqueue", briefDate: invocation.targetDate, status: audioStatus }));
        } catch {
          console.error(JSON.stringify({ event: "brief_audio_enqueue_failed", briefDate: invocation.targetDate, status: "failed", errorCode: "AUDIO_QUEUE_SEND_FAILED" }));
        }
        try {
          const coverStatus = await enqueueBriefCover(env, invocation.targetDate);
          console.log(JSON.stringify({ event: "brief_cover_enqueue", briefDate: invocation.targetDate, status: coverStatus }));
        } catch {
          console.error(JSON.stringify({ event: "brief_cover_enqueue_failed", briefDate: invocation.targetDate, status: "failed", errorCode: "COVER_QUEUE_SEND_FAILED" }));
        }
        try {
          const pushStatus = await enqueueBriefPush(env, invocation.targetDate);
          console.log(JSON.stringify({ event: "brief_push_enqueue", briefDate: invocation.targetDate, status: pushStatus }));
        } catch {
          console.error(JSON.stringify({ event: "brief_push_enqueue_failed", briefDate: invocation.targetDate, status: "failed", errorCode: "PUSH_QUEUE_SEND_FAILED" }));
        }
      }
      console.log(
        JSON.stringify({
          event: "pipeline_complete",
          targetDate: invocation.targetDate,
          stage: invocation.stage,
          outcome: result.outcome,
          ...(result.outcome === "kept-existing" || result.outcome === "model-failed"
            ? { errorCode: result.errorCode }
            : {}),
          durationMs: Date.now() - started,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "pipeline_failed",
          targetDate: invocation.targetDate,
          stage: invocation.stage,
          errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "UNKNOWN_ERROR",
          durationMs: Date.now() - started,
        }),
      );
      throw error;
    }
  },

  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      try {
        if (batch.queue === EXPLORATION_QUEUE_NAME) {
          await processExplorationJob(env, message.body as ExplorationJob, new Date());
        } else if (batch.queue === PUSH_QUEUE_NAME) {
          const job = message.body as BriefPushJob;
          if (job.kind === "brief-push-fanout") await processPushFanout(env, job, new Date(), message.attempts > 1);
          else await processPushDelivery(env, job, new Date(), message.attempts > 1);
        } else {
          const job = message.body as BriefAudioJob | BriefCoverJob | BriefRegenerationJob;
          if (job.kind === "brief-regeneration") await processBriefRegenerationJob(env, job, new Date(), message.attempts > 1);
          else if (job.kind === "brief-cover") await processBriefCoverJob(env, job, new Date(), message.attempts > 1);
          else await processBriefAudioJob(env, job, new Date(), message.attempts > 1);
        }
        message.ack();
      } catch (error) {
        const terminal = isTerminalQueueFailure(error, message.attempts);
        if (terminal) {
          if (batch.queue === PUSH_QUEUE_NAME) await abandonBriefPushJob(env.DB, message.body as BriefPushJob);
          if (batch.queue === EXPLORATION_QUEUE_NAME) await abandonExplorationJob(env.DB, message.body as ExplorationJob, error);
          message.ack();
        } else {
          if (batch.queue === EXPLORATION_QUEUE_NAME) await retryExplorationJob(env.DB, message.body as ExplorationJob);
          message.retry({ delaySeconds: 60 });
        }
      }
    }
  },
} satisfies ExportedHandler<Env, BriefAudioJob | BriefCoverJob | BriefPushJob | ExplorationJob | BriefRegenerationJob>;
