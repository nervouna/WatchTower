import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoverProcessingError } from "../src/cover/jobs";
import { handleDevPipelineRequest } from "../src/dev-pipeline/http";
import { processDevPipelineJob } from "../src/dev-pipeline/jobs";
import { getDevPipelineRun, queueDevPipelineRun } from "../src/dev-pipeline/repository";

describe("Dev pipeline queue consumer", () => {
  beforeEach(async () => { await env.DB.exec("DELETE FROM dev_pipeline_runs;"); });

  it("records a successful result and does not execute the same run twice", async () => {
    await queueDevPipelineRun(env.DB, {
      runId: "run-success", stage: "final", targetDate: "2026-07-19", requestedUserId: "apple|operator",
      workerVersionTag: "git-candidate", now: "2026-07-19T00:00:00.000Z",
    });
    const execute = vi.fn(async () => ({
      pipeline: { outcome: "published" as const, status: "complete" as const, successfulSources: 4 },
      downstream: { audio: "queued", cover: "queued", push: "queued" },
    }));
    const runtime = { ...env } as Env;
    expect(await processDevPipelineJob(runtime, { kind: "dev-pipeline-run", runId: "run-success" }, new Date("2026-07-19T00:01:00.000Z"), 1, execute)).toBe("processed");
    expect(await processDevPipelineJob(runtime, { kind: "dev-pipeline-run", runId: "run-success" }, new Date("2026-07-19T00:02:00.000Z"), 2, execute)).toBe("already-processed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await getDevPipelineRun(env.DB, "run-success")).toMatchObject({ status: "succeeded", outcome: "published", attempt_count: 1 });
  });

  it("keeps a retryable failure non-terminal and permits the queue retry to recover it", async () => {
    await queueDevPipelineRun(env.DB, {
      runId: "run-retry", stage: "collect", targetDate: "2026-07-20", requestedUserId: "apple|operator",
      workerVersionTag: "git-candidate", now: "2026-07-19T00:00:00.000Z",
    });
    const failing = vi.fn(async () => { throw new Error("TAVILY_UNAVAILABLE: upstream"); });
    await expect(processDevPipelineJob(
      { ...env } as Env,
      { kind: "dev-pipeline-run", runId: "run-retry" },
      new Date("2026-07-19T00:01:00.000Z"),
      1,
      failing,
    )).rejects.toThrow("TAVILY_UNAVAILABLE");
    expect(await getDevPipelineRun(env.DB, "run-retry")).toMatchObject({
      status: "queued",
      error_code: "TAVILY_UNAVAILABLE",
      attempt_count: 1,
      started_at: "2026-07-19T00:01:00.000Z",
      finished_at: null,
    });
    const polled = await handleDevPipelineRequest(
      new Request("https://example.com/api/dev/pipeline-runs/run-retry"),
      { ...env } as Env,
      "apple|operator",
    );
    expect(await polled.json()).toMatchObject({
      status: "queued",
      errorCode: "TAVILY_UNAVAILABLE",
      attemptCount: 1,
      finishedAt: null,
      pollAfterSeconds: 3,
    });

    const duplicate = await queueDevPipelineRun(env.DB, {
      runId: "run-duplicate", stage: "collect", targetDate: "2026-07-20", requestedUserId: "apple|operator",
      workerVersionTag: "git-candidate", now: "2026-07-19T00:01:30.000Z",
    });
    expect(duplicate).toMatchObject({ created: false, row: { run_id: "run-retry", status: "queued", error_code: "TAVILY_UNAVAILABLE" } });

    const recovered = vi.fn(async () => ({ pipeline: { outcome: "collected" as const, successfulSources: 3 } }));
    expect(await processDevPipelineJob(
      { ...env } as Env,
      { kind: "dev-pipeline-run", runId: "run-retry" },
      new Date("2026-07-19T00:02:00.000Z"),
      2,
      recovered,
    )).toBe("processed");
    expect(await getDevPipelineRun(env.DB, "run-retry")).toMatchObject({ status: "succeeded", outcome: "collected", attempt_count: 2 });
  });

  it("marks a retryable failure terminal only on the final queue delivery", async () => {
    await queueDevPipelineRun(env.DB, {
      runId: "run-exhausted", stage: "draft", targetDate: "2026-07-20", requestedUserId: "apple|operator",
      workerVersionTag: "git-candidate", now: "2026-07-19T00:00:00.000Z",
    });
    const failing = vi.fn(async () => { throw new Error("DEEPSEEK_UNAVAILABLE: upstream"); });

    for (const attempt of [1, 2, 3]) {
      await expect(processDevPipelineJob(
        { ...env } as Env,
        { kind: "dev-pipeline-run", runId: "run-exhausted" },
        new Date(`2026-07-19T00:0${String(attempt)}:00.000Z`),
        attempt,
        failing,
      )).rejects.toThrow("DEEPSEEK_UNAVAILABLE");
      const run = await getDevPipelineRun(env.DB, "run-exhausted");
      expect(run).toMatchObject({
        status: attempt < 3 ? "queued" : "failed",
        error_code: "DEEPSEEK_UNAVAILABLE",
        attempt_count: attempt,
      });
      if (attempt < 3) expect(run?.finished_at).toBeNull();
      else expect(typeof run?.finished_at).toBe("string");
    }

    const shouldNotRun = vi.fn(async () => ({ pipeline: { outcome: "collected" as const, successfulSources: 4 } }));
    expect(await processDevPipelineJob(
      { ...env } as Env,
      { kind: "dev-pipeline-run", runId: "run-exhausted" },
      new Date("2026-07-19T00:04:00.000Z"),
      4,
      shouldNotRun,
    )).toBe("already-processed");
    expect(shouldNotRun).not.toHaveBeenCalled();
  });

  it("records a non-retryable queue error as terminal on its first delivery", async () => {
    await queueDevPipelineRun(env.DB, {
      runId: "run-terminal", stage: "final", targetDate: "2026-07-20", requestedUserId: "apple|operator",
      workerVersionTag: "git-candidate", now: "2026-07-19T00:00:00.000Z",
    });
    const failing = vi.fn(async () => { throw new CoverProcessingError("FAL_PROMPT_TOO_LONG", false); });

    await expect(processDevPipelineJob(
      { ...env } as Env,
      { kind: "dev-pipeline-run", runId: "run-terminal" },
      new Date("2026-07-19T00:01:00.000Z"),
      1,
      failing,
    )).rejects.toThrow("FAL_PROMPT_TOO_LONG");
    const run = await getDevPipelineRun(env.DB, "run-terminal");
    expect(run).toMatchObject({
      status: "failed",
      error_code: "FAL_PROMPT_TOO_LONG",
      attempt_count: 1,
    });
    expect(typeof run?.finished_at).toBe("string");
  });
});
