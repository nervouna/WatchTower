import type { PipelineStage } from "../domain/types";
import { isValidUtcDate } from "../http/router";
import { finishDevPipelineRun, getDevPipelineRun, queueDevPipelineRun, type DevPipelineRunRow } from "./repository";
import type { DevPipelineJob } from "./jobs";

const STAGES: readonly PipelineStage[] = ["collect", "draft", "final", "recovery"];

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function error(code: string, message: string, status: number): Response {
  return response({ error: { code, message } }, status);
}

function payload(row: DevPipelineRunRow): Record<string, unknown> {
  return {
    runId: row.run_id,
    stage: row.stage,
    targetDate: row.target_date,
    status: row.status,
    outcome: row.outcome,
    errorCode: row.error_code,
    attemptCount: row.attempt_count,
    workerVersionTag: row.worker_version_tag,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ...(row.status === "queued" || row.status === "processing" ? { pollAfterSeconds: 3 } : {}),
  };
}

export async function handleDevPipelineRequest(
  request: Request,
  env: Pick<Env, "DB" | "DEV_PIPELINE_QUEUE" | "VERSION_METADATA">,
  userId: string,
  now = new Date(),
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const match = /^\/api\/dev\/pipeline-runs\/([^/]+)$/u.exec(path);
  if (match?.[1]) {
    if (request.method !== "GET") return error("METHOD_NOT_ALLOWED", "此接口仅支持 GET。", 405);
    const row = await getDevPipelineRun(env.DB, match[1]);
    return row ? response(payload(row)) : error("DEV_PIPELINE_RUN_NOT_FOUND", "未找到该 Dev 流水线任务。", 404);
  }
  if (path !== "/api/dev/pipeline-runs") return error("API_NOT_FOUND", "未找到该 API。", 404);
  if (request.method !== "POST") return error("METHOD_NOT_ALLOWED", "此接口仅支持 POST。", 405);

  let body: unknown;
  try { body = await request.json(); } catch { return error("INVALID_DEV_PIPELINE_RUN", "请求正文必须是有效 JSON。", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return error("INVALID_DEV_PIPELINE_RUN", "流水线参数无效。", 400);
  const { stage, targetDate } = body as Record<string, unknown>;
  if (typeof stage !== "string" || !STAGES.includes(stage as PipelineStage) || typeof targetDate !== "string" || !isValidUtcDate(targetDate)) {
    return error("INVALID_DEV_PIPELINE_RUN", "stage 或 targetDate 无效。", 400);
  }

  const queued = await queueDevPipelineRun(env.DB, {
    runId: crypto.randomUUID(), stage: stage as PipelineStage, targetDate, requestedUserId: userId,
    workerVersionTag: env.VERSION_METADATA.tag, now: now.toISOString(),
  });
  if (queued.created) {
    if (!env.DEV_PIPELINE_QUEUE) return error("DEV_PIPELINE_QUEUE_UNAVAILABLE", "Dev 流水线队列未配置。", 503);
    try {
      await env.DEV_PIPELINE_QUEUE.send({ kind: "dev-pipeline-run", runId: queued.row.run_id } satisfies DevPipelineJob);
    } catch {
      await finishDevPipelineRun(env.DB, queued.row.run_id, {
        status: "failed", outcome: null, errorCode: "DEV_PIPELINE_QUEUE_FAILED", now: new Date().toISOString(),
      });
      return error("DEV_PIPELINE_QUEUE_FAILED", "Dev 流水线任务暂时无法排队。", 503);
    }
  }
  return response({ ...payload(queued.row), acceptedNewAttempt: queued.created }, 202);
}
