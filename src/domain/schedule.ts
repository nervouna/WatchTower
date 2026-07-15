import type { PipelineStage } from "./types";

const CRON_STAGES: Readonly<Record<string, PipelineStage>> = {
  "0 21 * * *": "collect",
  "30 22 * * *": "draft",
  "30 23 * * *": "final",
  "30 0 * * *": "recovery",
};

function formatUtcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function resolveScheduledRun(cron: string, scheduledTime: number): { stage: PipelineStage; targetDate: string } {
  const stage = CRON_STAGES[cron];
  if (!stage) throw new Error("UNSUPPORTED_CRON");
  const targetTimestamp = stage === "recovery" ? scheduledTime : scheduledTime + 24 * 60 * 60 * 1000;
  return { stage, targetDate: formatUtcDate(targetTimestamp) };
}
