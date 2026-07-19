import { enqueueBriefAudio } from "../audio/jobs";
import { enqueueBriefCover } from "../cover/jobs";
import type { PipelineStage } from "../domain/types";
import { runPipelineStage, type PipelineResult } from "../ingestion/pipeline";
import { enqueueBriefPush } from "../push/jobs";

export interface PipelineExecutionResult {
  pipeline: PipelineResult;
  downstream?: {
    audio: string;
    cover: string;
    push: string;
  };
}

type PipelineExecutionEnv = Pick<
  Env,
  | "DB"
  | "TAVILY_API_KEY"
  | "DEEPSEEK_API_KEY"
  | "BRIEF_AUDIO_QUEUE"
  | "BRIEF_PUSH_QUEUE"
  | "BRIEF_AUDIO_ENABLED"
  | "BRIEF_COVER_ENABLED"
  | "BRIEF_PUSH_ENABLED"
  | "MIMO_API_KEY"
  | "FAL_API_KEY"
>;

export async function executePipelineStage(
  env: PipelineExecutionEnv,
  invocation: { stage: PipelineStage; targetDate: string; scheduledTime: number },
): Promise<PipelineExecutionResult> {
  const pipeline = await runPipelineStage(env, invocation);
  if (invocation.stage !== "final" && invocation.stage !== "recovery") return { pipeline };

  const [audio, cover, push] = await Promise.all([
    enqueueBriefAudio(env, invocation.targetDate).catch(() => "failed" as const),
    enqueueBriefCover(env, invocation.targetDate).catch(() => "failed" as const),
    enqueueBriefPush(env, invocation.targetDate).catch(() => "failed" as const),
  ]);
  return { pipeline, downstream: { audio, cover, push } };
}
