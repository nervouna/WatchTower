import { resolveScheduledRun } from "./domain/schedule";
import { handleRequest } from "./http/router";
import { processBriefAudioJob, type BriefAudioJob } from "./audio/jobs";
import { processBriefCoverJob, type BriefCoverJob } from "./cover/jobs";
import {
  abandonBriefPushJob,
  processPushDelivery,
  processPushFanout,
  type BriefPushJob,
} from "./push/jobs";
import {
  abandonExplorationJob,
  processExplorationJob,
  retryExplorationJob,
  type ExplorationJob,
} from "./exploration/jobs";
import { processBriefRegenerationJob, type BriefRegenerationJob } from "./regeneration/jobs";
import { executePipelineStage } from "./pipeline/execution";
import { processDevPipelineJob, type DevPipelineJob } from "./dev-pipeline/jobs";
import { isTerminalQueueFailure } from "./queue/failures";

export { isTerminalQueueFailure } from "./queue/failures";

export default {
  fetch(request, env): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(controller, env): Promise<void> {
    const started = Date.now();
    const invocation = resolveScheduledRun(controller.cron, controller.scheduledTime);
    try {
      const execution = await executePipelineStage(env, { ...invocation, scheduledTime: controller.scheduledTime });
      const result = execution.pipeline;
      if (execution.downstream) console.log(JSON.stringify({ event: "brief_downstream_enqueue", briefDate: invocation.targetDate, ...execution.downstream }));
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
      const job = message.body;
      try {
        if (job.kind === "dev-pipeline-run") {
          await processDevPipelineJob(env, job, new Date(), message.attempts);
        } else if (job.kind === "item-exploration") {
          await processExplorationJob(env, job, new Date());
        } else if (job.kind === "brief-push-fanout" || job.kind === "brief-push-delivery") {
          if (job.kind === "brief-push-fanout") await processPushFanout(env, job, new Date(), message.attempts > 1);
          else await processPushDelivery(env, job, new Date(), message.attempts > 1);
        } else {
          if (job.kind === "brief-regeneration") await processBriefRegenerationJob(env, job, new Date(), message.attempts > 1);
          else if (job.kind === "brief-cover") await processBriefCoverJob(env, job, new Date(), message.attempts > 1);
          else await processBriefAudioJob(env, job, new Date(), message.attempts);
        }
        message.ack();
      } catch (error) {
        const terminal = isTerminalQueueFailure(error, message.attempts);
        if (terminal) {
          if (job.kind === "brief-push-fanout" || job.kind === "brief-push-delivery") await abandonBriefPushJob(env.DB, job);
          if (job.kind === "item-exploration") await abandonExplorationJob(env.DB, job, error);
          message.ack();
        } else {
          if (job.kind === "item-exploration") await retryExplorationJob(env.DB, job);
          message.retry({ delaySeconds: 60 });
        }
      }
    }
  },
} satisfies ExportedHandler<Env, BriefAudioJob | BriefCoverJob | BriefPushJob | ExplorationJob | BriefRegenerationJob | DevPipelineJob>;
