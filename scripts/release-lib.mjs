import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync,
  statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

export const TARGETS = {
  dev: { domain: "dev.watchtower.damao.io", worker: "watchtower-daily-brief-dev", database: "watchtower-daily-brief-dev-db", wranglerEnv: "dev" },
  production: { domain: "watchtower.damao.io", worker: "watchtower-daily-brief", database: "watchtower-daily-brief-db", wranglerEnv: "" },
};

const METADATA_SMOKE_ATTEMPTS = 10;
const METADATA_SMOKE_DELAY_MS = 3_000;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const READ_COMMAND_TIMEOUT_MS = 60_000;

export function run(command, args, options = {}) {
  const usesWrangler = args.some((value) => value === "wrangler");
  let env = options.env ?? process.env;
  if (usesWrangler && !options.env) {
    env = { ...process.env, WRANGLER_WRITE_LOGS: "false", WRANGLER_LOG_SANITIZE: "true" };
    for (const name of [
      "WATCHTOWER_DEV_ACCESS_TOKEN",
      "WATCHTOWER_DEV_ACCESS_TOKEN_FILE",
      "WATCHTOWER_AUTH_TOKEN",
      "WRANGLER_LOG_PATH",
    ]) delete env[name];
  }
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env,
    timeout: options.timeout,
  });
  if (result.error) {
    const suffix = result.error.code === "ETIMEDOUT" ? " timed out" : " failed to start";
    throw new Error(`${command}${suffix}`, { cause: result.error });
  }
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${String(result.status)}`);
  return result.stdout?.trim() ?? "";
}

export function git(args) {
  return execFileSync("git", args, { encoding: "utf8", timeout: READ_COMMAND_TIMEOUT_MS }).trim();
}

export function releaseDirectory() {
  return join(resolve(git(["rev-parse", "--git-common-dir"])), "watchtower-release");
}

export function devValidationPath() { return join(releaseDirectory(), "dev-validation.json"); }

export function previousProductionVersionPath() { return join(releaseDirectory(), "production-previous-version"); }

export function previousDevVersionPath() { return join(releaseDirectory(), "dev-previous-version"); }

export function testflightBuildReceiptPath() { return join(releaseDirectory(), "testflight-build.json"); }

export const TESTFLIGHT_ARCHIVE_PATH = "mobile/build/ios/archive/Runner.xcarchive";

export function acquireReleaseLock(name) {
  const directory = releaseDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const path = join(directory, `${name}.lock`);
  let descriptor;
  try {
    descriptor = openSync(path, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* Preserve the lock creation failure. */ }
    }
    if (descriptor !== undefined) {
      try { unlinkSync(path); } catch { /* Preserve the lock creation failure. */ }
    }
    if (error?.code === "EEXIST") throw new Error(`Release lock already exists: ${path}`, { cause: error });
    throw new Error(`Unable to create release lock: ${path}`, { cause: error });
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try { closeSync(descriptor); } catch { /* Best-effort cleanup must not hide the release result. */ }
    try { unlinkSync(path); } catch { /* A stale lock is visible and recoverable through the documented audit. */ }
  };
  process.once("exit", release);
  return () => {
    process.removeListener("exit", release);
    release();
  };
}

export function validUtcDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value ?? "")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}

export function validIsoTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19);
}

export function repositoryState() {
  return { branch: git(["branch", "--show-current"]), sha: git(["rev-parse", "HEAD"]), status: git(["status", "--porcelain"]) };
}

export function assertClean(state) {
  if (state.status !== "") throw new Error("Release requires a clean working tree.");
}

export function assertProductionBaseline(state, remoteSha) {
  assertClean(state);
  if (state.branch !== "main") throw new Error("Production and TestFlight releases require branch main.");
  if (state.sha !== remoteSha) throw new Error("Local main must exactly match origin/main.");
}

export function assertDevValidatedSha(metadata, sha) {
  if (metadata.environment !== "dev" || metadata.workerVersionTag !== `git-${sha}`) {
    throw new Error("Dev metadata does not match the production candidate SHA.");
  }
}

export function assertProductionDeployedSha(metadata, sha) {
  if (metadata.environment !== "production" || metadata.workerVersionTag !== `git-${sha}`) {
    throw new Error("Production metadata does not match the TestFlight candidate SHA.");
  }
}

export function readSecretFile(path) {
  if (!path) throw new Error("A secret file path is required.");
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("Secret file must be a regular file, not a symlink.");
  if ((info.mode & 0o077) !== 0) throw new Error("Secret file permissions must not grant group or other access.");
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new Error("Secret file must be owned by the current user.");
  }
  const value = readFileSync(path, "utf8").trim();
  if (!value) throw new Error("Secret file is empty.");
  return value;
}

export function devAccessToken(environment = process.env) {
  const direct = environment.WATCHTOWER_DEV_ACCESS_TOKEN?.trim();
  const path = environment.WATCHTOWER_DEV_ACCESS_TOKEN_FILE?.trim();
  if (direct && path) throw new Error("Set only one of WATCHTOWER_DEV_ACCESS_TOKEN or WATCHTOWER_DEV_ACCESS_TOKEN_FILE.");
  if (direct) return direct;
  if (path) return readSecretFile(path);
  throw new Error("WATCHTOWER_DEV_ACCESS_TOKEN or WATCHTOWER_DEV_ACCESS_TOKEN_FILE is required and is never printed.");
}

export function saveDevValidationReceipt(receipt, path = devValidationPath()) {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, path);
  return path;
}

export function readDevValidationReceipt(path = devValidationPath()) {
  if (!existsSync(path)) throw new Error(`Dev validation receipt not found: ${path}`);
  const info = lstatSync(path);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    info.isSymbolicLink() || !info.isFile() || (info.mode & 0o077) !== 0 ||
    (currentUid !== null && info.uid !== currentUid)
  ) {
    throw new Error(`Release receipt must be a private regular file owned by the current user: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Dev validation receipt is invalid JSON: ${path}`);
  }
}

function assertDevValidationReceiptEvidence(receipt, sha, metadata, status, now = Date.now()) {
  const validStage = receipt?.stage === "final" || receipt?.stage === "recovery";
  const waivers = Array.isArray(receipt?.waivers) ? receipt.waivers : [];
  const audioWaiver = waivers.find((waiver) => waiver?.component === "audio");
  const validWaivers = waivers.length <= 1 && waivers.every((waiver) =>
    waiver?.component === "audio" && typeof waiver?.reason === "string" && waiver.reason.trim() !== "");
  const downstream = receipt?.downstream;
  const runStartedAt = Date.parse(receipt?.runStartedAt ?? "");
  const runFinishedAt = Date.parse(receipt?.runFinishedAt ?? "");
  const automatedAt = Date.parse(receipt?.automatedAt ?? "");
  const manualAcceptanceAt = Date.parse(receipt?.manualAcceptanceAt ?? "");
  const audioGeneratedAt = Date.parse(downstream?.audioGeneratedAt ?? "");
  const audioUpdatedAt = Date.parse(downstream?.audioUpdatedAt ?? "");
  const coverGeneratedAt = Date.parse(downstream?.coverGeneratedAt ?? "");
  const batchCreatedAt = Date.parse(downstream?.pushBatchCreatedAt ?? "");
  const latestDeliveredAt = Date.parse(downstream?.latestDeliveredAt ?? "");
  const publicBrief = receipt?.publicBrief;
  const briefGeneratedAt = Date.parse(publicBrief?.generatedAt ?? "");
  const strictPositiveInteger = (value) => Number.isInteger(value) && value > 0;
  const downstreamPassed = strictPositiveInteger(downstream?.subscriptionCount) &&
    (downstream?.audioStatus === "ready" || Boolean(audioWaiver)) && downstream?.coverStatus === "ready" &&
    downstream?.pushStatus === "sent" && strictPositiveInteger(downstream?.deliveredCount) &&
    validIsoTimestamp(receipt?.runStartedAt) && validIsoTimestamp(receipt?.runFinishedAt) && runFinishedAt >= runStartedAt &&
    validIsoTimestamp(receipt?.automatedAt) && automatedAt >= runFinishedAt &&
    (audioWaiver
      ? (downstream?.audioStatus === "ready" && downstream?.audioErrorCode === null &&
          audioWaiver.status === "ready" && audioWaiver.errorCode === null &&
          validIsoTimestamp(downstream?.audioGeneratedAt) && audioGeneratedAt >= runStartedAt) ||
        (downstream?.audioStatus === "failed" && typeof downstream?.audioErrorCode === "string" &&
          /^[A-Z][A-Z0-9_]*$/u.test(downstream.audioErrorCode) && downstream.audioErrorCode !== "UNKNOWN_ERROR_CODE" &&
          audioWaiver.status === downstream.audioStatus && audioWaiver.errorCode === downstream.audioErrorCode &&
          validIsoTimestamp(downstream?.audioUpdatedAt) && audioUpdatedAt >= runStartedAt)
      : validIsoTimestamp(downstream?.audioGeneratedAt) && audioGeneratedAt >= runStartedAt) &&
    validIsoTimestamp(downstream?.coverGeneratedAt) && coverGeneratedAt >= runStartedAt &&
    validIsoTimestamp(downstream?.pushBatchCreatedAt) && validIsoTimestamp(downstream?.latestDeliveredAt) &&
    batchCreatedAt >= runStartedAt && latestDeliveredAt >= runStartedAt;
  const publicBriefPassed = publicBrief?.status === "complete" || publicBrief?.status === "partial";
  const publicBriefEvidence = publicBriefPassed && strictPositiveInteger(publicBrief?.itemCount) &&
    validIsoTimestamp(publicBrief?.generatedAt) && briefGeneratedAt >= runStartedAt &&
    Array.isArray(publicBrief?.missingSources) && publicBrief.missingSources.every((source) => typeof source === "string");
  const manualTimestampPassed = status === "pending-manual"
    ? receipt?.manualAcceptanceAt === null
    : validIsoTimestamp(receipt?.manualAcceptanceAt) && manualAcceptanceAt >= automatedAt;
  const latestEvidenceAt = status === "pending-manual" ? automatedAt : manualAcceptanceAt;
  const deployedAt = Date.parse(metadata?.deployedAt ?? "");
  const audioEvidenceNotFuture = audioWaiver
    ? (downstream?.audioStatus === "ready" ? audioGeneratedAt <= automatedAt : audioUpdatedAt <= automatedAt)
    : audioGeneratedAt <= automatedAt;
  const currentTimePassed = Number.isFinite(latestEvidenceAt) && latestEvidenceAt <= now + 5 * 60 * 1000 &&
    audioEvidenceNotFuture && coverGeneratedAt <= automatedAt &&
    batchCreatedAt <= automatedAt && latestDeliveredAt <= automatedAt && briefGeneratedAt <= runFinishedAt &&
    (!metadata?.deployedAt || (validIsoTimestamp(metadata.deployedAt) && runStartedAt >= deployedAt));
  if (
    receipt?.schemaVersion !== 1 || receipt?.status !== status || receipt?.gitSha !== sha ||
    receipt?.workerVersionTag !== `git-${sha}` || receipt?.runWorkerVersionTag !== `git-${sha}` ||
    !validStage || !validUtcDate(receipt?.targetDate) || typeof receipt?.runId !== "string" || !receipt.runId ||
    typeof receipt?.workerVersionId !== "string" || !receipt.workerVersionId ||
    receipt?.outcome !== "published" || !validWaivers || !downstreamPassed || !publicBriefEvidence ||
    !manualTimestampPassed || !currentTimePassed ||
    (metadata && (
      metadata.environment !== "dev" || metadata.workerVersionTag !== `git-${sha}` ||
      receipt?.workerVersionId !== metadata.workerVersionId
    ))
  ) {
    throw new Error("Dev E2E validation receipt does not match the release candidate SHA.");
  }
  return receipt;
}

export function assertPendingDevValidationReceipt(receipt, sha, metadata, now) {
  return assertDevValidationReceiptEvidence(receipt, sha, metadata, "pending-manual", now);
}

export function assertDevValidationReceipt(receipt, sha, metadata, now) {
  return assertDevValidationReceiptEvidence(receipt, sha, metadata, "passed", now);
}

export function mobileVersion(path = "mobile/pubspec.yaml") {
  const match = /^version:\s*([^+\s]+)\+(\d+)$/mu.exec(readFileSync(path, "utf8"));
  if (!match) throw new Error("Unable to read Flutter version from pubspec.yaml.");
  return { version: match[1], build: Number(match[2]) };
}

export function expectedFlutterVersion(path = ".flutter-version") {
  const version = readFileSync(path, "utf8").trim();
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error(".flutter-version must contain an exact stable Flutter version.");
  return version;
}

export function localFlutterVersion() {
  const raw = run("flutter", ["--version", "--machine"], { capture: true, timeout: READ_COMMAND_TIMEOUT_MS });
  const parsed = JSON.parse(raw);
  if (typeof parsed?.frameworkVersion !== "string") throw new Error("Unable to determine the local Flutter version.");
  return parsed.frameworkVersion;
}

export function assertExpectedFlutterVersion(actual = localFlutterVersion(), expected = expectedFlutterVersion()) {
  if (actual !== expected) throw new Error(`Flutter ${expected} is required; found ${actual}.`);
  return actual;
}

export function invalidateTestflightBuildReceipt() {
  try { unlinkSync(testflightBuildReceiptPath()); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

export function saveTestflightBuildReceipt(sha, ipaPath, buildEnvironment = {}) {
  const releaseVersion = mobileVersion();
  const archive = buildEnvironment.archiveEvidence;
  const buildStartedAt = Number(buildEnvironment.buildStartedAt);
  const ipaModifiedAt = statSync(ipaPath).mtime.toISOString();
  if (
    !archive || !Number.isFinite(buildStartedAt) ||
    Date.parse(ipaModifiedAt) < buildStartedAt - 2_000 ||
    Date.parse(archive.infoModifiedAt ?? "") < buildStartedAt - 2_000 ||
    Date.parse(archive.executableModifiedAt ?? "") < buildStartedAt - 2_000
  ) {
    throw new Error("TestFlight build did not produce fresh IPA and archive artifacts.");
  }
  const receipt = {
    schemaVersion: 2,
    gitSha: sha,
    ipaName: basename(ipaPath),
    artifactSha256: sha256(ipaPath),
    version: releaseVersion.version,
    build: releaseVersion.build,
    flutterVersion: buildEnvironment.flutterVersion ?? null,
    xcodeVersion: buildEnvironment.xcodeVersion ?? null,
    ipaModifiedAt,
    archiveName: archive.archiveName,
    archiveBundleId: archive.archiveBundleId,
    archiveVersion: archive.archiveVersion,
    archiveBuild: archive.archiveBuild,
    archiveExecutableUuidSha256: archive.archiveExecutableUuidSha256,
    archiveInfoModifiedAt: archive.infoModifiedAt,
    archiveExecutableModifiedAt: archive.executableModifiedAt,
    builtAt: new Date().toISOString(),
  };
  saveDevValidationReceipt(receipt, testflightBuildReceiptPath());
  return receipt;
}

export function readTestflightBuildReceipt() { return readDevValidationReceipt(testflightBuildReceiptPath()); }

export function assertTestflightBuildReceipt(receipt, sha, ipaPath, archive) {
  const releaseVersion = mobileVersion();
  const ipaModifiedAt = statSync(ipaPath).mtime.toISOString();
  if (
    receipt?.schemaVersion !== 2 || receipt?.gitSha !== sha ||
    receipt?.ipaName !== basename(ipaPath) || receipt?.artifactSha256 !== sha256(ipaPath) ||
    receipt?.version !== releaseVersion.version || receipt?.build !== releaseVersion.build ||
    receipt?.flutterVersion !== expectedFlutterVersion() || typeof receipt?.xcodeVersion !== "string" ||
    !receipt.xcodeVersion || receipt?.ipaModifiedAt !== ipaModifiedAt ||
    !archive || archive.archiveName !== basename(TESTFLIGHT_ARCHIVE_PATH) || receipt?.archiveName !== archive.archiveName ||
    receipt?.archiveBundleId !== archive.archiveBundleId || receipt?.archiveBundleId !== "io.damao.watchtower" ||
    receipt?.archiveVersion !== archive.archiveVersion || receipt?.archiveVersion !== releaseVersion.version ||
    receipt?.archiveBuild !== archive.archiveBuild || receipt?.archiveBuild !== String(releaseVersion.build) ||
    receipt?.archiveExecutableUuidSha256 !== archive.archiveExecutableUuidSha256 ||
    receipt?.archiveInfoModifiedAt !== archive.infoModifiedAt ||
    receipt?.archiveExecutableModifiedAt !== archive.executableModifiedAt ||
    !validIsoTimestamp(receipt?.ipaModifiedAt) || !validIsoTimestamp(receipt?.archiveInfoModifiedAt) ||
    !validIsoTimestamp(receipt?.archiveExecutableModifiedAt) || !validIsoTimestamp(receipt?.builtAt)
  ) {
    throw new Error("TestFlight IPA does not match the build receipt for this Git SHA.");
  }
  return receipt;
}

export function executableUuidSha256(path) {
  const output = run("xcrun", ["dwarfdump", "--uuid", path], { capture: true, timeout: READ_COMMAND_TIMEOUT_MS });
  return uuidOutputSha256(output);
}

export function uuidOutputSha256(output) {
  const uuids = [...output.matchAll(/^UUID:\s+([0-9A-F-]+)\s+\(([^)]+)\)/gimu)]
    .map((match) => `${match[2].toLowerCase()}:${match[1].toLowerCase()}`)
    .sort();
  if (uuids.length === 0) throw new Error("Unable to read Mach-O UUIDs from the TestFlight executable.");
  return createHash("sha256").update(uuids.join("\n")).digest("hex");
}

export function inspectTestflightArchive(path = TESTFLIGHT_ARCHIVE_PATH) {
  const infoPath = join(path, "Products", "Applications", "Runner.app", "Info.plist");
  if (!existsSync(infoPath)) throw new Error(`TestFlight archive app not found: ${path}`);
  const info = JSON.parse(run("plutil", ["-convert", "json", "-o", "-", infoPath], {
    capture: true,
    timeout: READ_COMMAND_TIMEOUT_MS,
  }));
  const executableName = info?.CFBundleExecutable;
  if (typeof executableName !== "string" || executableName === "" || basename(executableName) !== executableName) {
    throw new Error("TestFlight archive has an invalid executable name.");
  }
  const executablePath = join(dirname(infoPath), executableName);
  if (!existsSync(executablePath)) throw new Error("TestFlight archive executable is missing.");
  return {
    archiveName: basename(path),
    archiveBundleId: info.CFBundleIdentifier,
    archiveVersion: info.CFBundleShortVersionString,
    archiveBuild: String(info.CFBundleVersion),
    archiveExecutableUuidSha256: executableUuidSha256(executablePath),
    infoModifiedAt: statSync(infoPath).mtime.toISOString(),
    executableModifiedAt: statSync(executablePath).mtime.toISOString(),
  };
}

export function printTarget(environment, state) {
  const target = TARGETS[environment];
  console.log(JSON.stringify({ environment, domain: target.domain, database: target.database, worker: target.worker, branch: state.branch, gitSha: state.sha }, null, 2));
}

export async function confirmMutation(expected) {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("Release confirmations require an interactive terminal.");
  }
  const terminal = createInterface({ input: stdin, output: stdout });
  const answer = await terminal.question(`Type ${expected} to continue: `);
  terminal.close();
  if (answer !== expected) throw new Error("Confirmation did not match; no remote mutation was performed.");
}

export async function fetchWithTimeout(url, init = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...init, signal });
}

async function fetchJsonResponse(url, init, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, {
    redirect: "manual",
    ...init,
    headers: { Accept: "application/json", ...init?.headers },
    cache: "no-store",
  }, timeoutMs);
  const contentType = response.headers.get("Content-Type") ?? "";
  const isJson = /(?:application|text)\/(?:[^;]+\+)?json(?:;|$)/iu.test(contentType);
  let body = null;
  if (isJson) {
    try {
      body = await response.json();
    } catch (error) {
      throw new Error(`HTTP_${String(response.status)}:INVALID_JSON_RESPONSE`, { cause: error });
    }
  }
  if (!response.ok) {
    const rawCode = body?.error?.code;
    const code = typeof rawCode === "string" && /^[A-Z][A-Z0-9_]*$/u.test(rawCode) ? rawCode : "UPSTREAM_ERROR";
    throw new Error(`HTTP_${String(response.status)}:${code}`);
  }
  if (!isJson || body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`HTTP_${String(response.status)}:NON_JSON_RESPONSE`);
  }
  return { body, response };
}

export async function fetchJson(url, init, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  return (await fetchJsonResponse(url, init, timeoutMs)).body;
}

export async function fetchMetadata(url, init, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const { body, response } = await fetchJsonResponse(url, init, timeoutMs);
  const cacheControl = response.headers.get("Cache-Control") ?? "";
  const fields = Object.keys(body).sort();
  if (!/(?:^|,)\s*no-store\s*(?:,|$)/iu.test(cacheControl)) {
    throw new Error("METADATA_CACHE_CONTROL_INVALID");
  }
  if (
    JSON.stringify(fields) !== JSON.stringify(["deployedAt", "environment", "workerVersionId", "workerVersionTag"]) ||
    (body.environment !== "dev" && body.environment !== "production") ||
    typeof body.workerVersionId !== "string" || body.workerVersionId === "" ||
    typeof body.workerVersionTag !== "string" || body.workerVersionTag === "" ||
    !validIsoTimestamp(body.deployedAt)
  ) {
    throw new Error("METADATA_CONTRACT_INVALID");
  }
  return body;
}

export function hasSuccessfulCiRun(runs, branch) {
  if (typeof branch !== "string" || branch === "") return false;
  const latest = runs
    .filter((item) => item?.workflowName === "CI" && item?.headBranch === branch)
    .sort((left, right) => Date.parse(right?.createdAt ?? "") - Date.parse(left?.createdAt ?? ""))[0];
  return latest?.status === "completed" && latest?.conclusion === "success";
}

export function assertCiPassed(sha, branch) {
  const raw = run("gh", ["run", "list", "--commit", sha, "--limit", "20", "--json", "workflowName,headBranch,status,conclusion,createdAt"], {
    capture: true,
    timeout: READ_COMMAND_TIMEOUT_MS,
  });
  const runs = JSON.parse(raw);
  if (!Array.isArray(runs) || !hasSuccessfulCiRun(runs, branch)) {
    throw new Error(`CI has not passed for ${branch}@${sha}.`);
  }
}

export function isAccessChallenge(response) {
  const authentication = response.headers.get("WWW-Authenticate") ?? "";
  const location = response.headers.get("Location") ?? "";
  return response.status === 302 && (
    authentication.includes("Cloudflare-Access") ||
    location.includes(".cloudflareaccess.com/cdn-cgi/access/login/")
  );
}

async function assertAccessProtected(url, label) {
  const response = await fetchWithTimeout(url, { cache: "no-store", redirect: "manual" });
  if (!isAccessChallenge(response)) throw new Error(`DEV_ACCESS_SMOKE_FAILED:${label}`);
}

async function waitForMetadata(base, environment, sha) {
  for (let attempt = 1; attempt <= METADATA_SMOKE_ATTEMPTS; attempt += 1) {
    try {
      const metadata = await fetchMetadata(`${base}/api/meta?sha=${sha}&attempt=${String(attempt)}`);
      if (metadata.environment === environment && metadata.workerVersionTag === `git-${sha}`) return metadata;
    } catch {
      // A newly deployed custom domain can briefly continue serving the previous Worker version.
    }
    if (attempt < METADATA_SMOKE_ATTEMPTS) {
      await delay(METADATA_SMOKE_DELAY_MS);
    }
  }
  throw new Error("Deployment metadata smoke failed.");
}

async function waitForMetadataVersion(base, environment, versionId) {
  for (let attempt = 1; attempt <= METADATA_SMOKE_ATTEMPTS; attempt += 1) {
    try {
      const metadata = await fetchMetadata(`${base}/api/meta?version=${versionId}&attempt=${String(attempt)}`);
      if (metadata.environment === environment && metadata.workerVersionId === versionId) return metadata;
    } catch {
      // Custom-domain propagation can briefly continue serving the previous deployment.
    }
    if (attempt < METADATA_SMOKE_ATTEMPTS) await delay(METADATA_SMOKE_DELAY_MS);
  }
  throw new Error("Deployment version metadata smoke failed.");
}

export function assertLatestBriefShape(value) {
  if (
    !validUtcDate(value?.date) || (value?.status !== "complete" && value?.status !== "partial") ||
    !Array.isArray(value?.items) || value.items.length === 0
  ) throw new Error("LATEST_BRIEF_CONTRACT_INVALID");
  return value;
}

export function assertBriefListShape(value) {
  if (!Array.isArray(value?.briefs) || value.briefs.some((brief) => !validUtcDate(brief?.date))) {
    throw new Error("BRIEF_LIST_CONTRACT_INVALID");
  }
  if (value.nextCursor !== null && typeof value.nextCursor !== "string") {
    throw new Error("BRIEF_LIST_CONTRACT_INVALID");
  }
  return value;
}

export function assertAuthConfigShape(value) {
  const clientIds = value?.clientIds;
  if (
    typeof value?.issuer !== "string" || !value.issuer.startsWith("https://") ||
    typeof value?.audience !== "string" || value.audience === "" || value?.connection !== "apple" ||
    typeof clientIds?.web !== "string" || clientIds.web === "" ||
    typeof clientIds?.mobileDev !== "string" || clientIds.mobileDev === "" ||
    typeof clientIds?.mobileProd !== "string" || clientIds.mobileProd === ""
  ) throw new Error("AUTH_CONFIG_CONTRACT_INVALID");
  return value;
}

async function smokeApiAndPages(environment, base, cacheBuster) {
  const [latest, list, auth] = await Promise.all([
    fetchJson(`${base}/api/briefs/latest?${cacheBuster}`),
    fetchJson(`${base}/api/briefs?limit=1&${cacheBuster}`),
    fetchJson(`${base}/api/auth/config?${cacheBuster}`),
  ]);
  assertLatestBriefShape(latest);
  assertBriefListShape(list);
  assertAuthConfigShape(auth);
  if (environment === "dev") {
    await Promise.all([
      assertAccessProtected(`${base}/?${cacheBuster}`, "home"),
      assertAccessProtected(`${base}/archive?${cacheBuster}`, "archive"),
      assertAccessProtected(`${base}/app.js?${cacheBuster}`, "app.js"),
      assertAccessProtected(`${base}/styles.css?${cacheBuster}`, "styles.css"),
    ]);
    return;
  }
  await Promise.all([
    fetchWithTimeout(`${base}/?${cacheBuster}`, { cache: "no-store", redirect: "manual" }).then((response) => { if (!response.ok) throw new Error("HOME_SMOKE_FAILED"); }),
    fetchWithTimeout(`${base}/archive?${cacheBuster}`, { cache: "no-store", redirect: "manual" }).then((response) => { if (!response.ok) throw new Error("ARCHIVE_SMOKE_FAILED"); }),
  ]);
}

export async function smoke(environment, sha) {
  const target = TARGETS[environment];
  const base = `https://${target.domain}`;
  const meta = await waitForMetadata(base, environment, sha);
  await smokeApiAndPages(environment, base, `sha=${sha}`);
  if (environment === "dev") return meta;
  for (const asset of ["app.js", "styles.css"]) {
    const response = await fetchWithTimeout(`${base}/${asset}?sha=${sha}`, { cache: "no-store", redirect: "manual" });
    if (!response.ok) throw new Error(`ASSET_SMOKE_FAILED:${asset}`);
    const remoteHash = createHash("sha256").update(new Uint8Array(await response.arrayBuffer())).digest("hex");
    if (remoteHash !== sha256(`public/${asset}`)) throw new Error(`ASSET_HASH_MISMATCH:${asset}`);
  }
  return meta;
}

export async function smokeVersion(environment, versionId) {
  const base = `https://${TARGETS[environment].domain}`;
  const metadata = await waitForMetadataVersion(base, environment, versionId);
  await smokeApiAndPages(environment, base, `version=${versionId}`);
  return metadata;
}

export function wranglerArgs(environment) {
  return environment === "dev" ? ["--env", "dev"] : ["--env="];
}

export function deploy(environment, sha) {
  const target = TARGETS[environment];
  run("npm", ["exec", "--", "wrangler", "deploy", ...wranglerArgs(environment), "--strict", "--tag", `git-${sha}`, "--message", `${environment} ${sha}`], {
    timeout: 15 * 60 * 1000,
  });
  return target;
}

export function migrate(environment) {
  const target = TARGETS[environment];
  run("npm", ["exec", "--", "wrangler", "d1", "migrations", "apply", target.database, ...wranglerArgs(environment), "--remote"], {
    timeout: 15 * 60 * 1000,
  });
}

export function listMigrations(environment) {
  const target = TARGETS[environment];
  const raw = run("npm", ["exec", "--", "wrangler", "d1", "migrations", "list", target.database, ...wranglerArgs(environment), "--remote"], {
    capture: true,
    timeout: 2 * 60 * 1000,
  });
  const pending = parsePendingMigrations(raw);
  console.log(JSON.stringify({ environment, database: target.database, pendingMigrations: pending }, null, 2));
  return pending;
}

export function parsePendingMigrations(raw) {
  return [...new Set(String(raw).match(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu) ?? [])];
}

export function remoteWorkerVersion(environment) {
  const raw = run("npm", ["exec", "--", "wrangler", "deployments", "status", ...wranglerArgs(environment), "--json"], {
    capture: true,
    timeout: READ_COMMAND_TIMEOUT_MS,
  });
  return currentProductionVersion(raw);
}

export function remoteProductionVersion() { return remoteWorkerVersion("production"); }

export function assertWorkerVersionAligned(metadata, environment, deploymentVersion = remoteWorkerVersion(environment)) {
  if (
    metadata?.environment !== environment || typeof metadata?.workerVersionId !== "string" ||
    metadata.workerVersionId === "" || metadata.workerVersionId !== deploymentVersion
  ) {
    throw new Error(`${environment} public metadata does not match the unique 100% Wrangler deployment.`);
  }
  return metadata;
}

export function savePreviousProductionVersion(id = remoteProductionVersion()) {
  const directory = releaseDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  writeFileSync(previousProductionVersionPath(), `${id}\n`, { mode: 0o600 });
  chmodSync(previousProductionVersionPath(), 0o600);
  return id;
}

export function savePreviousDevVersion(metadata) {
  if (metadata?.environment !== "dev" || typeof metadata?.workerVersionId !== "string") {
    throw new Error("Unable to determine the previous Dev Worker version.");
  }
  saveDevValidationReceipt({
    workerVersionId: metadata.workerVersionId,
    workerVersionTag: metadata.workerVersionTag ?? null,
    recordedAt: new Date().toISOString(),
  }, previousDevVersionPath());
  return metadata.workerVersionId;
}

export function currentProductionVersion(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const deployment = parsed?.latestDeployment ?? parsed;
  const versions = Array.isArray(deployment?.versions)
    ? deployment.versions.filter((version) => Number(version?.percentage) > 0)
    : [];
  if (versions.length !== 1 || Number(versions[0]?.percentage) !== 100 || typeof versions[0]?.version_id !== "string") {
    throw new Error("Worker deployment is split or has no single 100% version.");
  }
  return versions[0].version_id;
}

export function bumpBuildNumber(path, buildNumber) {
  if (!/^\d+$/u.test(String(buildNumber)) || !Number.isSafeInteger(Number(buildNumber)) || Number(buildNumber) < 1) {
    throw new Error("Build number must be a positive safe integer.");
  }
  const source = readFileSync(path, "utf8");
  const match = /^version:\s*([^+\s]+)\+(\d+)$/mu.exec(source);
  if (!match) throw new Error("Unable to read Flutter version from pubspec.yaml.");
  if (Number(buildNumber) <= Number(match[2])) throw new Error("Build number must be greater than the repository build number.");
  writeFileSync(path, source.replace(match[0], `version: ${match[1]}+${String(buildNumber)}`));
  return { version: match[1], previousBuild: Number(match[2]), build: Number(buildNumber) };
}

export function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
