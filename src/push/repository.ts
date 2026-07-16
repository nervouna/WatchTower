import type { ApnsEnvironment } from "./apns";

export interface PushSubscriptionRow {
  id: string;
  installation_hmac: string;
  token_hmac: string;
  token_ciphertext: string;
  token_iv: string;
  environment: ApnsEnvironment;
  app_version: string;
  active: number;
}

export interface PushDeliveryRow {
  id: string;
  brief_date: string;
  subscription_id: string;
  status: "queued" | "sending" | "delivered" | "retry" | "invalid" | "failed";
  attempt_count: number;
  token_ciphertext: string;
  token_iv: string;
  environment: ApnsEnvironment;
}

export async function upsertPushSubscription(
  db: D1Database,
  input: PushSubscriptionRow & { createdAt: string },
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM push_subscriptions WHERE token_hmac = ? AND installation_hmac <> ?")
      .bind(input.token_hmac, input.installation_hmac),
    db.prepare(
      `INSERT INTO push_subscriptions (
         id, installation_hmac, token_hmac, token_ciphertext, token_iv, environment,
         app_version, active, created_at, updated_at, disabled_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)
       ON CONFLICT(installation_hmac) DO UPDATE SET
         token_hmac = excluded.token_hmac, token_ciphertext = excluded.token_ciphertext,
         token_iv = excluded.token_iv, environment = excluded.environment,
         app_version = excluded.app_version, active = 1, updated_at = excluded.updated_at,
         disabled_at = NULL`,
    ).bind(
      input.id,
      input.installation_hmac,
      input.token_hmac,
      input.token_ciphertext,
      input.token_iv,
      input.environment,
      input.app_version,
      input.createdAt,
      input.createdAt,
    ),
  ]);
}

export async function removePushSubscription(db: D1Database, installationHmac: string): Promise<void> {
  await db.prepare("DELETE FROM push_subscriptions WHERE installation_hmac = ?").bind(installationHmac).run();
}

export async function getPushBrief(db: D1Database, briefDate: string): Promise<{ headline: string; publishAt: string } | null> {
  return db.prepare("SELECT headline, publish_at AS publishAt FROM briefs WHERE brief_date = ?")
    .bind(briefDate)
    .first<{ headline: string; publishAt: string }>();
}

export async function reservePushBatch(db: D1Database, briefDate: string, now: string): Promise<boolean> {
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO brief_push_batches (brief_date, status, created_at, updated_at)
     VALUES (?, 'queued', ?, ?)`,
  ).bind(briefDate, now, now).run();
  if (inserted.meta.changes > 0) return true;
  const retried = await db.prepare(
    "UPDATE brief_push_batches SET status = 'queued', error_code = NULL, updated_at = ? WHERE brief_date = ? AND status = 'failed'",
  ).bind(now, briefDate).run();
  return retried.meta.changes > 0;
}

export async function failPushBatch(db: D1Database, briefDate: string, errorCode: string, now: string): Promise<void> {
  await db.prepare("UPDATE brief_push_batches SET status = 'failed', error_code = ?, updated_at = ? WHERE brief_date = ?")
    .bind(errorCode, now, briefDate).run();
}

export async function claimPushBatch(db: D1Database, briefDate: string, now: string, recover = false): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE brief_push_batches SET status = 'processing', attempt_count = attempt_count + 1, updated_at = ?, error_code = NULL
     WHERE brief_date = ? AND (status = 'queued' OR (status IN ('processing', 'failed') AND ? = 1))`,
  ).bind(now, briefDate, recover ? 1 : 0).run();
  return result.meta.changes > 0;
}

export async function activePushSubscriptions(db: D1Database): Promise<PushSubscriptionRow[]> {
  const result = await db.prepare(
    `SELECT id, installation_hmac, token_hmac, token_ciphertext, token_iv, environment, app_version, active
     FROM push_subscriptions WHERE active = 1 ORDER BY id`,
  ).all<PushSubscriptionRow>();
  return result.results;
}

export async function createPushDelivery(
  db: D1Database,
  input: { id: string; briefDate: string; subscriptionId: string; now: string },
): Promise<boolean> {
  const result = await db.prepare(
    `INSERT OR IGNORE INTO brief_push_deliveries (id, brief_date, subscription_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'queued', ?, ?)`,
  ).bind(input.id, input.briefDate, input.subscriptionId, input.now, input.now).run();
  return result.meta.changes > 0;
}

export async function finishPushBatch(db: D1Database, briefDate: string, now: string): Promise<void> {
  await db.prepare("UPDATE brief_push_batches SET status = 'sent', updated_at = ? WHERE brief_date = ?")
    .bind(now, briefDate).run();
}

export async function claimPushDelivery(db: D1Database, id: string, now: string, recover = false): Promise<PushDeliveryRow | null> {
  const result = await db.prepare(
    `UPDATE brief_push_deliveries SET status = 'sending', attempt_count = attempt_count + 1, updated_at = ?
     WHERE id = ? AND (status IN ('queued', 'retry') OR (status = 'sending' AND ? = 1))`,
  ).bind(now, id, recover ? 1 : 0).run();
  if (result.meta.changes === 0) return null;
  return db.prepare(
    `SELECT delivery.id, delivery.brief_date, delivery.subscription_id, delivery.status, delivery.attempt_count,
            subscription.token_ciphertext, subscription.token_iv, subscription.environment
     FROM brief_push_deliveries AS delivery
     JOIN push_subscriptions AS subscription ON subscription.id = delivery.subscription_id
     WHERE delivery.id = ?`,
  ).bind(id).first<PushDeliveryRow>();
}

export async function updatePushDelivery(
  db: D1Database,
  id: string,
  status: "delivered" | "retry" | "invalid" | "failed",
  errorCode: string | null,
  now: string,
): Promise<void> {
  await db.prepare(
    `UPDATE brief_push_deliveries SET status = ?, last_error_code = ?, updated_at = ?,
       delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END WHERE id = ?`,
  ).bind(status, errorCode, now, status, now, id).run();
  if (status === "delivered") {
    await db.prepare(
      `UPDATE push_subscriptions SET last_success_at = ?, updated_at = ?
       WHERE id = (SELECT subscription_id FROM brief_push_deliveries WHERE id = ?)`,
    ).bind(now, now, id).run();
  }
  if (status === "invalid") {
    await db.prepare(
      `UPDATE push_subscriptions SET active = 0, disabled_at = ?, updated_at = ?
       WHERE id = (SELECT subscription_id FROM brief_push_deliveries WHERE id = ?)`,
    ).bind(now, now, id).run();
  }
}
