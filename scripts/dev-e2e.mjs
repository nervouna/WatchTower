import { setTimeout as delay } from "node:timers/promises";

import {
  TARGETS,
  acquireReleaseLock,
  assertCiPassed,
  assertClean,
  assertDevValidationReceipt,
  assertDevValidatedSha,
  assertPendingDevValidationReceipt,
  assertWorkerVersionAligned,
  confirmMutation,
  devAccessToken,
  devValidationPath,
  fetchJson,
  fetchMetadata,
  fetchWithTimeout,
  printTarget,
  readDevValidationReceipt,
  repositoryState,
  run,
  saveDevValidationReceipt,
} from "./release-lib.mjs";

const PIPELINE_TIMEOUT_MS = 30 * 60 * 1000;
const DOWNSTREAM_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;
const PIPELINE_STAGES = new Set(["collect", "draft", "final", "recovery"]);

function stableErrorCode(value) {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" && /^[A-Z][A-Z0-9_]*$/u.test(value) ? value : "UNKNOWN_ERROR_CODE";
}

function validUtcDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value ?? "")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}

export function parseDevE2eArgs(args, now = new Date()) {
  const [stage, targetDate, ...options] = args;
  if (!PIPELINE_STAGES.has(stage) || !validUtcDate(targetDate)) {
    throw new Error("Usage: e2e:dev -- <stage> <YYYY-MM-DD> [--waive-audio <reason>]");
  }
  let audioWaiverReason = null;
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] !== "--waive-audio" || !options[index + 1] || audioWaiverReason) {
      throw new Error("Only one --waive-audio <reason> option is supported.");
    }
    audioWaiverReason = options[index + 1].trim();
    index += 1;
  }
  if (audioWaiverReason === "") throw new Error("The audio waiver reason must not be empty.");
  if (audioWaiverReason && stage !== "final" && stage !== "recovery") {
    throw new Error("Audio can only be waived for final or recovery Dev E2E runs.");
  }
  const currentUtcDate = now.toISOString().slice(0, 10);
  if ((stage === "final" || stage === "recovery") && targetDate > currentUtcDate) {
    throw new Error("Final and recovery Dev E2E target dates must not be in the future.");
  }
  return { stage, targetDate, audioWaiverReason };
}

function devD1Rows(sql) {
  const raw = run("npm", [
    "exec", "--", "wrangler", "d1", "execute", TARGETS.dev.database,
    "--env", "dev", "--remote", "--json", "--command", sql,
  ], { capture: true, timeout: 60_000 });
  return JSON.parse(raw)[0]?.results ?? [];
}

export function parseDownstreamAudit(row = {}) {
  return {
    subscriptionCount: Number(row.subscription_count ?? 0),
    audioStatus: row.audio_status ?? null,
    audioErrorCode: stableErrorCode(row.audio_error_code),
    audioGeneratedAt: row.audio_generated_at ?? null,
    audioUpdatedAt: row.audio_updated_at ?? null,
    coverStatus: row.cover_status ?? null,
    coverErrorCode: stableErrorCode(row.cover_error_code),
    coverGeneratedAt: row.cover_generated_at ?? null,
    pushStatus: row.push_status ?? null,
    pushErrorCode: stableErrorCode(row.push_error_code),
    pushBatchCreatedAt: row.push_batch_created_at ?? null,
    deliveredCount: Number(row.delivered_count ?? 0),
    latestDeliveredAt: row.latest_delivered_at ?? null,
    deliveryErrorCodes: typeof row.delivery_error_codes === "string"
      ? row.delivery_error_codes.split(",").filter(Boolean).map(stableErrorCode).filter(Boolean)
      : [],
  };
}

function downstreamAudit(targetDate) {
  const sql = `SELECT
    (SELECT COUNT(*) FROM push_subscriptions
      WHERE active = 1 AND environment = 'sandbox' AND app_id = 'io.damao.watchtower.dev') AS subscription_count,
    (SELECT status FROM brief_audio WHERE brief_date = '${targetDate}') AS audio_status,
    (SELECT error_code FROM brief_audio WHERE brief_date = '${targetDate}') AS audio_error_code,
    (SELECT generated_at FROM brief_audio WHERE brief_date = '${targetDate}') AS audio_generated_at,
    (SELECT updated_at FROM brief_audio WHERE brief_date = '${targetDate}') AS audio_updated_at,
    (SELECT status FROM brief_covers WHERE brief_date = '${targetDate}') AS cover_status,
    (SELECT error_code FROM brief_covers WHERE brief_date = '${targetDate}') AS cover_error_code,
    (SELECT generated_at FROM brief_covers WHERE brief_date = '${targetDate}') AS cover_generated_at,
    (SELECT status FROM brief_push_batches WHERE brief_date = '${targetDate}') AS push_status,
    (SELECT error_code FROM brief_push_batches WHERE brief_date = '${targetDate}') AS push_error_code,
    (SELECT created_at FROM brief_push_batches WHERE brief_date = '${targetDate}') AS push_batch_created_at,
    (SELECT COUNT(*) FROM brief_push_deliveries
      WHERE brief_date = '${targetDate}' AND status = 'delivered') AS delivered_count,
    (SELECT MAX(delivered_at) FROM brief_push_deliveries
      WHERE brief_date = '${targetDate}' AND status = 'delivered') AS latest_delivered_at,
    (SELECT GROUP_CONCAT(DISTINCT last_error_code) FROM brief_push_deliveries
      WHERE brief_date = '${targetDate}' AND last_error_code IS NOT NULL) AS delivery_error_codes`;
  return parseDownstreamAudit(devD1Rows(sql)[0]);
}

export function downstreamReady(audit, audioWaived, runStartedAt) {
  const started = Date.parse(runStartedAt ?? "");
  const audioGenerated = Date.parse(audit.audioGeneratedAt ?? "");
  const audioUpdated = Date.parse(audit.audioUpdatedAt ?? "");
  const coverGenerated = Date.parse(audit.coverGeneratedAt ?? "");
  const batchCreated = Date.parse(audit.pushBatchCreatedAt ?? "");
  const latestDelivered = Date.parse(audit.latestDeliveredAt ?? "");
  return audit.subscriptionCount > 0 &&
    (audioWaived
      ? audit.audioStatus === "failed" && audit.audioErrorCode && audit.audioErrorCode !== "UNKNOWN_ERROR_CODE" &&
        Number.isFinite(audioUpdated) && audioUpdated >= started
      : audit.audioStatus === "ready" && Number.isFinite(audioGenerated) && audioGenerated >= started) &&
    audit.coverStatus === "ready" && Number.isFinite(coverGenerated) && coverGenerated >= started &&
    audit.pushStatus === "sent" && audit.deliveredCount > 0 && Number.isFinite(started) &&
    Number.isFinite(batchCreated) && Number.isFinite(latestDelivered) &&
    batchCreated >= started && latestDelivered >= started;
}

async function waitForPipeline(initial, headers, deadline = Date.now() + PIPELINE_TIMEOUT_MS) {
  let state = initial;
  while (state.status === "queued" || state.status === "processing") {
    if (Date.now() >= deadline) throw new Error(`DEV_PIPELINE_TIMEOUT:${state.runId}`);
    const requestedDelay = Math.min(10, Math.max(1, Number(state.pollAfterSeconds ?? 3))) * 1000;
    await delay(Math.min(requestedDelay, Math.max(1, deadline - Date.now())));
    const requestTimeout = Math.max(1, Math.min(30_000, deadline - Date.now()));
    state = await fetchJson(`https://${TARGETS.dev.domain}/api/dev/pipeline-runs/${state.runId}`, { headers }, requestTimeout);
  }
  return state;
}

async function waitForDownstream(targetDate, audioWaived, runStartedAt, deadline = Date.now() + DOWNSTREAM_TIMEOUT_MS) {
  let audit;
  do {
    audit = downstreamAudit(targetDate);
    if (downstreamReady(audit, audioWaived, runStartedAt)) return audit;
    await delay(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  const error = new Error("DEV_DOWNSTREAM_AUDIT_TIMEOUT");
  error.audit = audit;
  throw error;
}

async function assertMediaReachable(targetDate, audioWaived) {
  const paths = [`/api/briefs/${targetDate}/cover`];
  if (!audioWaived) paths.push(`/api/briefs/${targetDate}/audio`);
  const responses = await Promise.all(paths.map((path) => fetchWithTimeout(`https://${TARGETS.dev.domain}${path}`, {
    method: "HEAD", cache: "no-store",
  })));
  if (responses.some((response) => !response.ok)) throw new Error("DEV_MEDIA_SMOKE_FAILED");
}

export async function publicBriefAudit(targetDate) {
  const brief = await fetchJson(`https://${TARGETS.dev.domain}/api/briefs/${targetDate}?e2e=${String(Date.now())}`);
  if (!Array.isArray(brief?.items) || brief.items.length < 1) throw new Error("DEV_PUBLIC_BRIEF_EMPTY");
  if (brief.status !== "complete" && brief.status !== "partial") throw new Error("DEV_PUBLIC_BRIEF_UNPUBLISHED");
  if (
    typeof brief.generatedAt !== "string" || !Array.isArray(brief.missingSources) ||
    brief.missingSources.some((source) => typeof source !== "string")
  ) {
    throw new Error("DEV_PUBLIC_BRIEF_CONTRACT_INVALID");
  }
  return {
    status: brief.status,
    itemCount: brief.items.length,
    generatedAt: brief.generatedAt,
    missingSources: brief.missingSources,
  };
}

function samePublicBrief(left, right) {
  return left?.status === right?.status && left?.itemCount === right?.itemCount &&
    left?.generatedAt === right?.generatedAt &&
    JSON.stringify(left?.missingSources ?? null) === JSON.stringify(right?.missingSources ?? null);
}

async function devCandidateBaseline() {
  const state = repositoryState();
  assertClean(state);
  assertCiPassed(state.sha, state.branch);
  const metadata = await fetchMetadata(`https://${TARGETS.dev.domain}/api/meta?candidate=${state.sha}`);
  assertDevValidatedSha(metadata, state.sha);
  assertWorkerVersionAligned(metadata, "dev");
  printTarget("dev", state);
  return { state, metadata };
}

async function executeDevE2e(args) {
  const options = parseDevE2eArgs(args);
  const { state, metadata } = await devCandidateBaseline();
  if (options.audioWaiverReason) await confirmMutation(`waive dev audio ${state.sha}`);

  if (options.stage === "final" || options.stage === "recovery") {
    const subscriptions = downstreamAudit(options.targetDate).subscriptionCount;
    if (subscriptions < 1) throw new Error("DEV_SANDBOX_SUBSCRIPTION_REQUIRED");
    console.log(JSON.stringify({ sandboxSubscriptionCount: subscriptions }));
  }
  const token = devAccessToken();
  await confirmMutation(`dev-e2e ${options.stage} ${options.targetDate} ${state.sha}`);
  if (options.stage === "final" || options.stage === "recovery") {
    saveDevValidationReceipt({
      schemaVersion: 1,
      status: "in-progress",
      gitSha: state.sha,
      workerVersionId: metadata.workerVersionId,
      workerVersionTag: metadata.workerVersionTag,
      stage: options.stage,
      targetDate: options.targetDate,
      startedAt: new Date().toISOString(),
      waivers: options.audioWaiverReason ? [{ component: "audio", reason: options.audioWaiverReason }] : [],
    });
  }

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const initial = await fetchJson(`https://${TARGETS.dev.domain}/api/dev/pipeline-runs`, {
    method: "POST", headers, body: JSON.stringify({ stage: options.stage, targetDate: options.targetDate }),
  });
  if (
    initial.acceptedNewAttempt !== true || initial.status !== "queued" ||
    initial.startedAt !== null || initial.finishedAt !== null
  ) {
    throw new Error("DEV_PIPELINE_ATTEMPT_NOT_CREATED:choose a fresh stage and target date");
  }
  const runState = await waitForPipeline(initial, headers);
  const safeRun = {
    runId: runState.runId,
    status: runState.status,
    outcome: runState.outcome ?? null,
    errorCode: stableErrorCode(runState.errorCode),
    workerVersionTag: runState.workerVersionTag ?? null,
  };
  console.log(JSON.stringify(safeRun));
  if (runState.workerVersionTag !== `git-${state.sha}`) throw new Error("DEV_PIPELINE_WORKER_SHA_MISMATCH");
  if (runState.status !== "succeeded") throw new Error("DEV_E2E_PIPELINE_FAILED");
  if (!Number.isFinite(Date.parse(runState.startedAt ?? "")) || !Number.isFinite(Date.parse(runState.finishedAt ?? ""))) {
    throw new Error("DEV_PIPELINE_TIMESTAMPS_INVALID");
  }
  if (options.stage !== "final" && options.stage !== "recovery") return safeRun;
  if (runState.outcome !== "published") {
    throw new Error(`DEV_PIPELINE_OUTCOME_NOT_PUBLISHED:${String(runState.outcome ?? "missing")}`);
  }

  const audit = await waitForDownstream(options.targetDate, Boolean(options.audioWaiverReason), runState.startedAt);
  await assertMediaReachable(options.targetDate, Boolean(options.audioWaiverReason));
  const publicBrief = await publicBriefAudit(options.targetDate);
  const waivers = options.audioWaiverReason
    ? [{ component: "audio", reason: options.audioWaiverReason, status: audit.audioStatus, errorCode: audit.audioErrorCode }]
    : [];
  const receipt = {
    schemaVersion: 1,
    status: "pending-manual",
    gitSha: state.sha,
    workerVersionId: metadata.workerVersionId,
    workerVersionTag: metadata.workerVersionTag,
    runWorkerVersionTag: runState.workerVersionTag,
    runId: runState.runId,
    stage: options.stage,
    targetDate: options.targetDate,
    outcome: runState.outcome,
    runStartedAt: runState.startedAt,
    runFinishedAt: runState.finishedAt,
    automatedAt: new Date().toISOString(),
    publicBrief,
    downstream: audit,
    waivers,
    manualAcceptanceAt: null,
  };
  assertPendingDevValidationReceipt(receipt, state.sha, metadata);
  saveDevValidationReceipt(receipt);
  console.log(JSON.stringify({
    receipt: devValidationPath(),
    status: receipt.status,
    runId: receipt.runId,
    audioStatus: audit.audioStatus,
    coverStatus: audit.coverStatus,
    pushStatus: audit.pushStatus,
    apnsAcceptedCount: audit.deliveredCount,
    errorCodes: [audit.audioErrorCode, audit.coverErrorCode, audit.pushErrorCode, ...audit.deliveryErrorCodes].filter(Boolean),
    waivers: waivers.map(({ component, reason }) => ({ component, reason })),
  }));
  return receipt;
}

export async function runDevE2e(args) {
  const releaseLock = acquireReleaseLock("dev-environment");
  try {
    return await executeDevE2e(args);
  } finally {
    releaseLock();
  }
}

async function executeAcceptDevE2e(runId) {
  if (!runId) throw new Error("Usage: e2e:dev:accept -- <run-id>");
  const receipt = readDevValidationReceipt();
  if (receipt.status !== "pending-manual" || receipt.runId !== runId) {
    throw new Error("The pending Dev validation receipt does not match this run ID.");
  }
  const { state, metadata } = await devCandidateBaseline();
  assertPendingDevValidationReceipt(receipt, state.sha, metadata);
  const audit = downstreamAudit(receipt.targetDate);
  const audioWaived = receipt.waivers?.some((waiver) => waiver?.component === "audio") ?? false;
  if (!downstreamReady(audit, audioWaived, receipt.runStartedAt)) throw new Error("DEV_ACCEPTANCE_EVIDENCE_INCOMPLETE");
  await assertMediaReachable(receipt.targetDate, audioWaived);
  const publicBrief = await publicBriefAudit(receipt.targetDate);
  if (!samePublicBrief(publicBrief, receipt.publicBrief)) throw new Error("DEV_PUBLIC_BRIEF_CHANGED_AFTER_AUTOMATION");
  console.log(JSON.stringify({
    checklist: [
      "WatchTower Dev metadata shows this exact Git SHA and Worker version",
      "latest brief and archive open from Dev",
      "offline cached text remains readable",
      "login and feedback read/write work",
      "exploration returns Chinese content with source links",
      "account deletion returns HTTP 403 with ACCOUNT_DELETION_DISABLED",
      "sandbox notification appeared on the physical device",
      "opening the notification navigates to the expected brief",
      audioWaived ? "audio waiver reason was explicitly reviewed" : "audio plays on the physical device",
    ],
    runId,
    waivers: receipt.waivers ?? [],
  }, null, 2));
  await confirmMutation(`accept dev ${runId}`);
  const rechecked = await devCandidateBaseline();
  if (rechecked.state.sha !== state.sha || rechecked.metadata.workerVersionId !== metadata.workerVersionId) {
    throw new Error("DEV_CANDIDATE_CHANGED_DURING_ACCEPTANCE");
  }
  const currentAudit = downstreamAudit(receipt.targetDate);
  if (!downstreamReady(currentAudit, audioWaived, receipt.runStartedAt)) throw new Error("DEV_ACCEPTANCE_EVIDENCE_CHANGED");
  await assertMediaReachable(receipt.targetDate, audioWaived);
  const currentBrief = await publicBriefAudit(receipt.targetDate);
  if (!samePublicBrief(currentBrief, receipt.publicBrief)) throw new Error("DEV_PUBLIC_BRIEF_CHANGED_DURING_ACCEPTANCE");
  const accepted = {
    ...receipt,
    status: "passed",
    manualAcceptanceAt: new Date().toISOString(),
    downstream: currentAudit,
    publicBrief: currentBrief,
  };
  assertDevValidationReceipt(accepted, state.sha, metadata);
  saveDevValidationReceipt(accepted);
  console.log(JSON.stringify({ receipt: devValidationPath(), status: accepted.status, runId }));
  return accepted;
}

export async function acceptDevE2e(runId) {
  const releaseLock = acquireReleaseLock("dev-environment");
  try {
    return await executeAcceptDevE2e(runId);
  } finally {
    releaseLock();
  }
}
