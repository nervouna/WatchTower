import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    expect(await processDevPipelineJob(runtime, { kind: "dev-pipeline-run", runId: "run-success" }, new Date("2026-07-19T00:01:00.000Z"), false, execute)).toBe("processed");
    expect(await processDevPipelineJob(runtime, { kind: "dev-pipeline-run", runId: "run-success" }, new Date("2026-07-19T00:02:00.000Z"), true, execute)).toBe("already-processed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await getDevPipelineRun(env.DB, "run-success")).toMatchObject({ status: "succeeded", outcome: "published", attempt_count: 1 });
  });

  it("records a stable failure and permits the queue retry to recover it", async () => {
    await queueDevPipelineRun(env.DB, {
      runId: "run-retry", stage: "collect", targetDate: "2026-07-20", requestedUserId: "apple|operator",
      workerVersionTag: "git-candidate", now: "2026-07-19T00:00:00.000Z",
    });
    const failing = vi.fn(async () => { throw new Error("TAVILY_UNAVAILABLE: upstream"); });
    await expect(processDevPipelineJob({ ...env } as Env, { kind: "dev-pipeline-run", runId: "run-retry" }, new Date(), false, failing)).rejects.toThrow("TAVILY_UNAVAILABLE");
    expect(await getDevPipelineRun(env.DB, "run-retry")).toMatchObject({ status: "failed", error_code: "TAVILY_UNAVAILABLE", attempt_count: 1 });

    const recovered = vi.fn(async () => ({ pipeline: { outcome: "collected" as const, successfulSources: 3 } }));
    expect(await processDevPipelineJob({ ...env } as Env, { kind: "dev-pipeline-run", runId: "run-retry" }, new Date(), true, recovered)).toBe("processed");
    expect(await getDevPipelineRun(env.DB, "run-retry")).toMatchObject({ status: "succeeded", outcome: "collected", attempt_count: 2 });
  });
});
