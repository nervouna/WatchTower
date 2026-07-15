import { resolveScheduledRun } from "./domain/schedule";
import { handleRequest } from "./http/router";
import { runPipelineStage } from "./ingestion/pipeline";

export default {
  fetch(request, env): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(controller, env): Promise<void> {
    const started = Date.now();
    const invocation = resolveScheduledRun(controller.cron, controller.scheduledTime);
    try {
      const result = await runPipelineStage(env, { ...invocation, scheduledTime: controller.scheduledTime });
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
} satisfies ExportedHandler<Env>;
