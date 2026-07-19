import type { PipelineStage } from "../domain/types";

export type DevPipelineRunStatus = "queued" | "processing" | "succeeded" | "failed";

export interface DevPipelineRunRow {
  run_id: string;
  stage: PipelineStage;
  target_date: string;
  requested_user_id: string;
  status: DevPipelineRunStatus;
  outcome: string | null;
  error_code: string | null;
  worker_version_tag: string;
  attempt_count: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const SELECT_RUN = `SELECT run_id, stage, target_date, requested_user_id, status, outcome,
  error_code, worker_version_tag, attempt_count, created_at, started_at, finished_at
  FROM dev_pipeline_runs`;

export async function getDevPipelineRun(db: D1Database, runId: string): Promise<DevPipelineRunRow | null> {
  return db.prepare(`${SELECT_RUN} WHERE run_id = ?`).bind(runId).first<DevPipelineRunRow>();
}

export async function queueDevPipelineRun(
  db: D1Database,
  input: { runId: string; stage: PipelineStage; targetDate: string; requestedUserId: string; workerVersionTag: string; now: string },
): Promise<{ row: DevPipelineRunRow; created: boolean }> {
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO dev_pipeline_runs
      (run_id, stage, target_date, requested_user_id, status, worker_version_tag, created_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
  ).bind(input.runId, input.stage, input.targetDate, input.requestedUserId, input.workerVersionTag, input.now).run();
  const retried = inserted.meta.changes > 0 ? null : await db.prepare(
    `UPDATE dev_pipeline_runs SET status = 'queued', requested_user_id = ?, worker_version_tag = ?,
       error_code = NULL, outcome = NULL, started_at = NULL, finished_at = NULL
     WHERE stage = ? AND target_date = ? AND status = 'failed'`,
  ).bind(input.requestedUserId, input.workerVersionTag, input.stage, input.targetDate).run();
  const created = inserted.meta.changes > 0 || (retried?.meta.changes ?? 0) > 0;
  const row = inserted.meta.changes > 0
    ? await getDevPipelineRun(db, input.runId)
    : await db.prepare(`${SELECT_RUN} WHERE stage = ? AND target_date = ?`).bind(input.stage, input.targetDate).first<DevPipelineRunRow>();
  if (!row) throw new Error("DEV_PIPELINE_RUN_CREATE_FAILED");
  return { row, created };
}

export async function claimDevPipelineRun(db: D1Database, runId: string, now: string, recover = false): Promise<DevPipelineRunRow | null> {
  const result = await db.prepare(
    `UPDATE dev_pipeline_runs
     SET status = 'processing', attempt_count = attempt_count + 1, error_code = NULL,
         started_at = ?, finished_at = NULL
     WHERE run_id = ? AND (status = 'queued' OR (status IN ('processing', 'failed') AND ? = 1))`,
  ).bind(now, runId, recover ? 1 : 0).run();
  return result.meta.changes > 0 ? getDevPipelineRun(db, runId) : null;
}

export async function finishDevPipelineRun(
  db: D1Database,
  runId: string,
  result: { status: "succeeded" | "failed"; outcome: string | null; errorCode: string | null; now: string },
): Promise<void> {
  await db.prepare(
    `UPDATE dev_pipeline_runs SET status = ?, outcome = ?, error_code = ?, finished_at = ? WHERE run_id = ?`,
  ).bind(result.status, result.outcome, result.errorCode, result.now, runId).run();
}
