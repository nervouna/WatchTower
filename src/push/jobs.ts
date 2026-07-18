import { PUSH_APP_IDS, sendApnsNotification, type ApnsConfig, type ApnsEnvironment, type PushAppId } from "./apns";
import { decryptToken, stablePushId } from "./crypto";
import {
  activePushSubscriptions,
  claimPushBatch,
  claimPushDelivery,
  createPushDelivery,
  failPushBatch,
  finishPushBatch,
  getPushBrief,
  reservePushBatch,
  updatePushDelivery,
} from "./repository";

export const PUSH_QUEUE_NAME = "watchtower-brief-push-jobs";
export type BriefPushJob =
  | { kind: "brief-push-fanout"; briefDate: string }
  | { kind: "brief-push-delivery"; deliveryId: string; briefDate: string; headline: string };

type PushEnv = Pick<
  Env,
  "DB" | "BRIEF_PUSH_QUEUE" | "APNS_TEAM_ID" |
  "APNS_SANDBOX_KEY_ID" | "APNS_SANDBOX_PRIVATE_KEY" |
  "APNS_PRODUCTION_KEY_ID" | "APNS_PRODUCTION_PRIVATE_KEY" |
  "PUSH_TOKEN_ENCRYPTION_KEY"
>;

function apnsConfig(
  env: PushEnv,
  environment: ApnsEnvironment,
  appId: PushAppId,
): ApnsConfig {
  if (environment === "sandbox") {
    return {
      teamId: env.APNS_TEAM_ID,
      keyId: env.APNS_SANDBOX_KEY_ID,
      privateKey: env.APNS_SANDBOX_PRIVATE_KEY,
      topic: appId,
    };
  }
  if (appId !== PUSH_APP_IDS.production) throw new Error("APNS_APP_ENVIRONMENT_INVALID");
  return {
    teamId: env.APNS_TEAM_ID,
    keyId: env.APNS_PRODUCTION_KEY_ID,
    privateKey: env.APNS_PRODUCTION_PRIVATE_KEY,
    topic: appId,
  };
}

function stableError(error: unknown): string {
  const value = error instanceof Error ? error.message.split(":", 1)[0] : "PUSH_UNKNOWN_ERROR";
  return value && /^[A-Z][A-Z0-9_]+$/u.test(value) ? value : "PUSH_UNKNOWN_ERROR";
}

export async function enqueueBriefPush(env: Pick<Env, "DB" | "BRIEF_PUSH_QUEUE" | "BRIEF_PUSH_ENABLED">, briefDate: string, now = new Date()): Promise<"queued" | "already-queued" | "disabled" | "not-found"> {
  if (env.BRIEF_PUSH_ENABLED !== "true") return "disabled";
  const brief = await getPushBrief(env.DB, briefDate);
  if (!brief) return "not-found";
  const nowIso = now.toISOString();
  if (!(await reservePushBatch(env.DB, briefDate, nowIso))) return "already-queued";
  const delaySeconds = Math.max(0, Math.min(43_200, Math.ceil((Date.parse(brief.publishAt) - now.getTime()) / 1000)));
  try {
    await env.BRIEF_PUSH_QUEUE.send(
      { kind: "brief-push-fanout", briefDate } satisfies BriefPushJob,
      delaySeconds > 0 ? { delaySeconds } : undefined,
    );
  } catch (error) {
    await failPushBatch(env.DB, briefDate, "PUSH_QUEUE_SEND_FAILED", nowIso);
    throw error;
  }
  return "queued";
}

export async function processPushFanout(env: Pick<Env, "DB" | "BRIEF_PUSH_QUEUE">, job: Extract<BriefPushJob, { kind: "brief-push-fanout" }>, now = new Date(), recover = false): Promise<void> {
  const nowIso = now.toISOString();
  if (!(await claimPushBatch(env.DB, job.briefDate, nowIso, recover))) return;
  const brief = await getPushBrief(env.DB, job.briefDate);
  if (!brief || Date.parse(brief.publishAt) > now.getTime()) {
    await failPushBatch(env.DB, job.briefDate, "PUSH_BRIEF_NOT_PUBLISHED", nowIso);
    throw new Error("PUSH_BRIEF_NOT_PUBLISHED");
  }
  try {
    for (const subscription of await activePushSubscriptions(env.DB)) {
      const deliveryId = await stablePushId("push", `${job.briefDate}:${subscription.id}`);
      const created = await createPushDelivery(env.DB, {
        id: deliveryId,
        briefDate: job.briefDate,
        subscriptionId: subscription.id,
        now: nowIso,
      });
      if (created || recover) {
        await env.BRIEF_PUSH_QUEUE.send({ kind: "brief-push-delivery", deliveryId, briefDate: job.briefDate, headline: brief.headline } satisfies BriefPushJob);
      }
    }
    await finishPushBatch(env.DB, job.briefDate, nowIso);
  } catch (error) {
    await failPushBatch(env.DB, job.briefDate, stableError(error), new Date().toISOString());
    throw error;
  }
}

export async function processPushDelivery(
  env: PushEnv,
  job: Extract<BriefPushJob, { kind: "brief-push-delivery" }>,
  now = new Date(),
  recover = false,
  transport = sendApnsNotification,
): Promise<"delivered" | "invalid" | "failed" | "retry" | "ignored"> {
  const delivery = await claimPushDelivery(env.DB, job.deliveryId, now.toISOString(), recover);
  if (!delivery) return "ignored";
  try {
    const deviceToken = await decryptToken(env.PUSH_TOKEN_ENCRYPTION_KEY, delivery.token_ciphertext, delivery.token_iv);
    const config = apnsConfig(env, delivery.environment, delivery.app_id);
    const result = await transport(config, {
      deviceToken,
      environment: delivery.environment,
      briefDate: job.briefDate,
      headline: job.headline,
    });
    if (result.kind === "delivered") {
      await updatePushDelivery(env.DB, delivery.id, "delivered", null, now.toISOString());
      return "delivered";
    }
    await updatePushDelivery(env.DB, delivery.id, result.kind, result.errorCode, now.toISOString());
    if (result.kind === "retry") throw new Error(result.errorCode);
    return result.kind;
  } catch (error) {
    const errorCode = stableError(error);
    if (errorCode === "PUSH_TOKEN_DECRYPT_FAILED") await updatePushDelivery(env.DB, delivery.id, "failed", errorCode, now.toISOString());
    throw error;
  }
}

export async function abandonBriefPushJob(db: D1Database, job: BriefPushJob, now = new Date()): Promise<void> {
  if (job.kind === "brief-push-fanout") {
    await failPushBatch(db, job.briefDate, "PUSH_RETRY_EXHAUSTED", now.toISOString());
    return;
  }
  await updatePushDelivery(db, job.deliveryId, "failed", "PUSH_RETRY_EXHAUSTED", now.toISOString());
}
