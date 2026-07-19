#!/usr/bin/env node
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { acceptDevE2e, runDevE2e } from "./dev-e2e.mjs";
import {
  TARGETS, TESTFLIGHT_ARCHIVE_PATH, acquireReleaseLock, assertCiPassed, assertClean, assertDevValidatedSha,
  assertDevValidationReceipt, assertProductionBaseline, assertProductionDeployedSha,
  assertExpectedFlutterVersion, assertTestflightBuildReceipt, assertWorkerVersionAligned, bumpBuildNumber, confirmMutation,
  deploy, fetchMetadata, git, inspectTestflightArchive, invalidateTestflightBuildReceipt, listMigrations, migrate, printTarget,
  readDevValidationReceipt, readTestflightBuildReceipt,
  remoteWorkerVersion, repositoryState, run, savePreviousDevVersion,
  savePreviousProductionVersion, saveTestflightBuildReceipt, smoke, smokeVersion, wranglerArgs,
} from "./release-lib.mjs";

const [command, ...args] = process.argv.slice(2);

async function baseline(environment, report = true) {
  const state = repositoryState();
  assertClean(state);
  if (environment === "production") {
    git(["fetch", "origin", "main"]);
    assertProductionBaseline(state, git(["rev-parse", "origin/main"]));
    const devMetadata = await fetchMetadata(`https://${TARGETS.dev.domain}/api/meta?candidate=${state.sha}`);
    assertDevValidatedSha(devMetadata, state.sha);
    const receipt = assertDevValidationReceipt(readDevValidationReceipt(), state.sha, devMetadata);
    if (report) {
      console.log(JSON.stringify({ devValidation: {
        runId: receipt.runId,
        stage: receipt.stage,
        targetDate: receipt.targetDate,
        validatedAt: receipt.manualAcceptanceAt,
        waivers: receipt.waivers ?? [],
      } }, null, 2));
    }
  }
  assertCiPassed(state.sha, state.branch);
  if (report) printTarget(environment, state);
  return state;
}

function assertSameCandidate(expected, environment) {
  const current = repositoryState();
  assertClean(current);
  if (current.branch !== expected.branch || current.sha !== expected.sha) {
    throw new Error("Release candidate changed after preflight confirmation.");
  }
  if (environment === "production") {
    git(["fetch", "origin", "main"]);
    assertProductionBaseline(current, git(["rev-parse", "origin/main"]));
  }
  return current;
}

function assertNoArgs(values, usage) {
  if (values.length !== 0) throw new Error(`Usage: ${usage}`);
}

function assertEnvironmentMetadata(metadata, environment) {
  if (metadata?.environment !== environment || typeof metadata?.workerVersionId !== "string" || !metadata.workerVersionId) {
    throw new Error(`Unable to resolve the current ${environment} Worker metadata.`);
  }
  return metadata;
}

function sameWorkerVersion(left, right) {
  if (!left || !right) return left === right;
  return left.environment === right.environment && left.workerVersionId === right.workerVersionId &&
    left.workerVersionTag === right.workerVersionTag;
}

async function environmentMetadata(environment) {
  return assertEnvironmentMetadata(
    await fetchMetadata(`https://${TARGETS[environment].domain}/api/meta?preflight=${String(Date.now())}`),
    environment,
  );
}

async function alignedEnvironment(environment) {
  const metadata = await environmentMetadata(environment);
  return assertWorkerVersionAligned(metadata, environment);
}

async function incidentEnvironmentSnapshot(environment) {
  const deploymentVersion = remoteWorkerVersion(environment);
  try {
    const metadata = await environmentMetadata(environment);
    assertWorkerVersionAligned(metadata, environment, deploymentVersion);
    return { deploymentVersion, metadata };
  } catch (error) {
    if (error?.message?.includes("does not match the unique 100% Wrangler deployment")) throw error;
    console.warn(`${environment} public metadata is unavailable during incident preflight; rollback will use Wrangler traffic as the current-version truth.`);
    return { deploymentVersion, metadata: null };
  }
}

async function waitForWorkerVersion(environment, expected, attempts = 10) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (remoteWorkerVersion(environment) === expected) return expected;
      lastError = new Error(`${environment} is not yet serving Worker version ${expected}.`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await delay(3_000);
  }
  throw new Error("WORKER_DEPLOYMENT_VERIFICATION_FAILED", { cause: lastError });
}

function acquireEnvironmentLocks(environment) {
  const names = environment === "production"
    ? ["dev-environment", "production-environment"]
    : ["dev-environment"];
  const releases = [];
  try {
    for (const name of names) releases.push(acquireReleaseLock(name));
  } catch (error) {
    for (const release of releases.reverse()) release();
    throw error;
  }
  return () => {
    for (const release of releases.reverse()) release();
  };
}

async function rollbackWorker(environment, versionId, state, reason) {
  run("npm", [
    "exec", "--", "wrangler", "rollback", versionId, ...wranglerArgs(environment),
    "--message", `${reason} from ${state.sha}`, "--yes",
  ], { timeout: 15 * 60 * 1000 });
  await waitForWorkerVersion(environment, versionId);
  const metadata = await smokeVersion(environment, versionId);
  if (remoteWorkerVersion(environment) !== metadata.workerVersionId) {
    throw new Error(`${environment} rollback traffic and public metadata do not match.`);
  }
  return metadata;
}

async function release(environment) {
  const releaseLock = acquireEnvironmentLocks(environment);
  try {
    const state = await baseline(environment);
    const current = await alignedEnvironment(environment);
    const pendingMigrations = listMigrations(environment);
    const sameSha = current.workerVersionTag === `git-${state.sha}`;
    if (sameSha && pendingMigrations.length === 0) {
      console.log(`Environment already runs git-${state.sha} with no pending migrations; repeating smoke only.`);
      const metadata = await smoke(environment, state.sha);
      await waitForWorkerVersion(environment, metadata.workerVersionId);
      if (remoteWorkerVersion(environment) !== metadata.workerVersionId) {
        throw new Error(`${environment} traffic changed during smoke.`);
      }
      return;
    }

    const previous = current.workerVersionId;
    if (environment === "dev") {
      console.log(JSON.stringify({ sharedDev: {
        workerVersionId: current.workerVersionId,
        workerVersionTag: current.workerVersionTag,
      } }, null, 2));
    } else {
      console.log(`Rollback version: ${previous}`);
    }

    const confirmation = environment === "dev"
      ? sameSha
        ? `dev-db ${state.sha}`
        : `replace dev ${current.workerVersionTag ?? "untagged"}@${current.workerVersionId} with ${state.sha}`
      : `production ${state.sha}`;
    await confirmMutation(confirmation);

    const rechecked = await baseline(environment, false);
    if (rechecked.sha !== state.sha || rechecked.branch !== state.branch) throw new Error("Release candidate changed during confirmation.");
    if (!sameWorkerVersion(current, await alignedEnvironment(environment))) {
      throw new Error(`${environment} Worker changed during confirmation; restart preflight.`);
    }
    const confirmedMigrations = listMigrations(environment);
    if (JSON.stringify(confirmedMigrations) !== JSON.stringify(pendingMigrations)) {
      throw new Error(`${environment} pending migrations changed during confirmation; restart preflight.`);
    }
    if (!sameSha) {
      if (environment === "dev") savePreviousDevVersion(current);
      else savePreviousProductionVersion(previous);
    }

    if (pendingMigrations.length > 0) migrate(environment);
    assertSameCandidate(state, environment);
    if (environment === "production") await baseline(environment, false);
    if (!sameWorkerVersion(current, await alignedEnvironment(environment))) {
      throw new Error(`${environment} Worker changed while migrations were applied; deployment aborted.`);
    }
    if (sameSha) {
      const metadata = await smoke(environment, state.sha);
      await waitForWorkerVersion(environment, metadata.workerVersionId);
      return;
    }

    let deploymentAttempted = false;
    try {
      deploymentAttempted = true;
      deploy(environment, state.sha);
      assertSameCandidate(state, environment);
      if (environment === "production") await baseline(environment, false);
      const deployedMetadata = await smoke(environment, state.sha);
      await waitForWorkerVersion(environment, deployedMetadata.workerVersionId);
      if (remoteWorkerVersion(environment) !== deployedMetadata.workerVersionId) {
        throw new Error(`${environment} public metadata does not match deployed traffic.`);
      }
    } catch (error) {
      if (!deploymentAttempted || !previous) throw error;
      console.error(`${environment} release failed; rolling Worker back to ${previous}. D1 migrations are not rolled back.`);
      try {
        await rollbackWorker(environment, previous, state, "automatic release rollback");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `${environment} release and automatic Worker rollback both failed.`,
          { cause: rollbackError },
        );
      }
      throw error;
    }
  } finally {
    releaseLock();
  }
}

async function migrateOnly(environment) {
  const releaseLock = acquireEnvironmentLocks(environment);
  try {
    const state = await baseline(environment);
    const current = await alignedEnvironment(environment);
    const pendingMigrations = listMigrations(environment);
    if (pendingMigrations.length === 0) {
      console.log(`${environment} has no pending D1 migrations; no mutation was performed.`);
      return;
    }
    await confirmMutation(`${environment === "dev" ? "dev" : "production"}-db ${state.sha}`);
    const rechecked = await baseline(environment, false);
    if (rechecked.sha !== state.sha || rechecked.branch !== state.branch) throw new Error("Migration candidate changed during confirmation.");
    if (!sameWorkerVersion(current, await alignedEnvironment(environment))) {
      throw new Error(`${environment} Worker changed during confirmation; migration aborted.`);
    }
    const confirmedMigrations = listMigrations(environment);
    if (JSON.stringify(confirmedMigrations) !== JSON.stringify(pendingMigrations)) {
      throw new Error(`${environment} pending migrations changed during confirmation; migration aborted.`);
    }
    migrate(environment);
    assertSameCandidate(state, environment);
    if (environment === "production") await baseline(environment, false);
    if (!sameWorkerVersion(current, await alignedEnvironment(environment))) {
      throw new Error(`${environment} Worker changed while migrations were applied.`);
    }
    await smokeVersion(environment, current.workerVersionId);
  } finally {
    releaseLock();
  }
}

async function rollback(environment, versionId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(versionId ?? "")) {
    throw new Error(`A valid ${environment} Worker version ID is required.`);
  }
  const releaseLock = acquireReleaseLock(`${environment}-environment`);
  try {
    const state = repositoryState(); assertClean(state); printTarget(environment, state);
    const current = await incidentEnvironmentSnapshot(environment);
    console.log(`Current ${environment} version: ${current.deploymentVersion}`);
    await confirmMutation(`rollback ${environment} ${versionId}`);
    assertSameCandidate(state, "dev");
    const rechecked = await incidentEnvironmentSnapshot(environment);
    if (rechecked.deploymentVersion !== current.deploymentVersion) {
      throw new Error(`${environment} deployment changed during rollback confirmation; restart.`);
    }
    await rollbackWorker(environment, versionId, state, `${environment} rollback requested`);
  } finally {
    releaseLock();
  }
}

async function buildTestflight() {
  const releaseLock = acquireEnvironmentLocks("production");
  try {
    const state = await baseline("production");
    const metadata = await smoke("production", state.sha);
    assertProductionDeployedSha(metadata, state.sha);
    await waitForWorkerVersion("production", metadata.workerVersionId);
    if (!sameWorkerVersion(metadata, await alignedEnvironment("production"))) {
      throw new Error("Production public metadata does not match the active deployment.");
    }
    const flutterVersion = assertExpectedFlutterVersion();
    const xcodeVersion = run("xcodebuild", ["-version"], { capture: true, timeout: 60_000 });
    await confirmMutation(`testflight-build ${state.sha}`);
    const rechecked = await baseline("production", false);
    if (rechecked.sha !== state.sha) throw new Error("TestFlight candidate changed during confirmation.");
    const confirmedMetadata = await alignedEnvironment("production");
    if (!sameWorkerVersion(metadata, confirmedMetadata)) {
      throw new Error("Production Worker changed during TestFlight build confirmation; restart preflight.");
    }
    await waitForWorkerVersion("production", metadata.workerVersionId);
    const ipa = "mobile/build/ios/ipa/watchtower.ipa";
    invalidateTestflightBuildReceipt();
    const buildStartedAt = Date.now();
    run("flutter", ["build", "ipa", "--flavor", "prod", "--release"], {
      cwd: "mobile",
      timeout: 60 * 60 * 1000,
    });
    await baseline("production", false);
    const currentMetadata = await smoke("production", state.sha);
    if (!sameWorkerVersion(metadata, currentMetadata)) {
      throw new Error("Production Worker changed while the TestFlight IPA was built; discard the artifact and restart.");
    }
    await waitForWorkerVersion("production", currentMetadata.workerVersionId);
    if (!sameWorkerVersion(currentMetadata, await alignedEnvironment("production"))) {
      throw new Error("Production changed before the TestFlight build receipt was saved.");
    }
    if (!existsSync(ipa)) throw new Error(`IPA not found after build: ${ipa}`);
    const archiveEvidence = inspectTestflightArchive();
    const buildReceipt = saveTestflightBuildReceipt(state.sha, ipa, {
      flutterVersion, xcodeVersion, archiveEvidence, buildStartedAt,
    });
    console.log(JSON.stringify({
      testflightArtifacts: { ipa, archive: TESTFLIGHT_ARCHIVE_PATH },
      testflightBuild: buildReceipt,
    }, null, 2));
  } finally {
    releaseLock();
  }
}

async function inspectTestflight(ipa) {
  const releaseLock = acquireEnvironmentLocks("production");
  try {
    if (!existsSync(ipa)) throw new Error(`IPA not found: ${ipa}`);
    const state = await baseline("production");
    const metadata = await smoke("production", state.sha);
    assertProductionDeployedSha(metadata, state.sha);
    await waitForWorkerVersion("production", metadata.workerVersionId);
    if (!sameWorkerVersion(metadata, await alignedEnvironment("production"))) {
      throw new Error("Production public metadata does not match the active deployment.");
    }
    const archiveEvidence = inspectTestflightArchive();
    const buildReceipt = assertTestflightBuildReceipt(readTestflightBuildReceipt(), state.sha, ipa, archiveEvidence);
    console.log(JSON.stringify({ testflightBuild: buildReceipt }, null, 2));
    run("node", [
      "scripts/testflight-inspect.mjs", ipa, buildReceipt.artifactSha256,
      buildReceipt.archiveExecutableUuidSha256,
    ], { timeout: 5 * 60 * 1000 });
    await baseline("production", false);
    assertTestflightBuildReceipt(readTestflightBuildReceipt(), state.sha, ipa, inspectTestflightArchive());
    if (!sameWorkerVersion(metadata, await alignedEnvironment("production"))) {
      throw new Error("Production changed while the TestFlight IPA was inspected.");
    }
  } finally {
    releaseLock();
  }
}

switch (command) {
  case "release:dev": assertNoArgs(args, "release:dev"); await release("dev"); break;
  case "release:prod": assertNoArgs(args, "release:prod"); await release("production"); break;
  case "migrate:dev": assertNoArgs(args, "migrate:dev"); await migrateOnly("dev"); break;
  case "migrate:prod": assertNoArgs(args, "migrate:prod"); await migrateOnly("production"); break;
  case "rollback:dev": {
    if (args.length !== 1) throw new Error("Usage: rollback:dev -- <version-id>");
    await rollback("dev", args[0]); break;
  }
  case "rollback:prod": {
    if (args.length !== 1) throw new Error("Usage: rollback:prod -- <version-id>");
    await rollback("production", args[0]); break;
  }
  case "e2e:dev": await runDevE2e(args); break;
  case "e2e:dev:accept": {
    if (args.length !== 1) throw new Error("Usage: e2e:dev:accept -- <run-id>");
    await acceptDevE2e(args[0]); break;
  }
  case "testflight:bump": {
    if (args.length !== 2 || args[0] !== "--build-number") {
      throw new Error("Usage: testflight:bump -- --build-number <positive-integer>");
    }
    const state = repositoryState();
    assertClean(state);
    console.log(JSON.stringify({
      gitSha: state.sha,
      result: bumpBuildNumber("mobile/pubspec.yaml", args[1]),
    }, null, 2));
    break;
  }
  case "testflight:build": assertNoArgs(args, "testflight:build"); await buildTestflight(); break;
  case "testflight:inspect": {
    if (args.length > 1) throw new Error("Usage: testflight:inspect -- [ipa-path]");
    await inspectTestflight(args[0] ?? "mobile/build/ios/ipa/watchtower.ipa"); break;
  }
  default: throw new Error(`Unknown release command: ${String(command)}`);
}
