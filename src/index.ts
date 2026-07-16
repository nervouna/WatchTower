import { resolveScheduledRun } from "./domain/schedule";
import { handleRequest } from "./http/router";
import { runPipelineStage } from "./ingestion/pipeline";
import { enqueueBriefAudio, processBriefAudioJob, type BriefAudioJob } from "./audio/jobs";

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
        await processBriefAudioJob(env, message.body, new Date(), message.attempts > 1);
        message.ack();
      } catch {
        if (message.attempts >= 3) message.ack();
        else message.retry({ delaySeconds: 60 });
      }
    }
  },
} satisfies ExportedHandler<Env, BriefAudioJob>;
