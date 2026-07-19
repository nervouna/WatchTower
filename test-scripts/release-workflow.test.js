import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as devE2e from "../scripts/dev-e2e.mjs";
import {
  TARGETS,
  assertClean,
  assertDevValidatedSha,
  assertDevValidationReceipt,
  assertPendingDevValidationReceipt,
  assertProductionBaseline,
  assertProductionDeployedSha,
  assertTestflightBuildReceipt,
  assertWorkerVersionAligned,
  assertAuthConfigShape,
  assertBriefListShape,
  assertLatestBriefShape,
  bumpBuildNumber,
  currentProductionVersion,
  devAccessToken,
  devValidationPath,
  expectedFlutterVersion,
  fetchJson,
  fetchMetadata,
  hasSuccessfulCiRun,
  mobileVersion,
  parsePendingMigrations,
  readSecretFile,
  releaseDirectory,
  sha256,
  testflightBuildReceiptPath,
  uuidOutputSha256,
} from "../scripts/release-lib.mjs";
import {
  isAllowedListenHost,
  parseProxyArgs,
  removeCapturedToken,
  writeCapturedToken,
} from "../scripts/dev-auth-proxy.mjs";
import { containsPotentialSecret, requiredSecretNames } from "../scripts/secret-scan.mjs";

const temporaryDirectories = [];

function temporaryDirectory() {
  const path = mkdtempSync(join(tmpdir(), "watchtower-release-test-"));
  temporaryDirectories.push(path);
  return path;
}

const TEST_SHA = "a".repeat(40);
const TEST_NOW = Date.parse("2026-07-20T00:02:00.000Z");

function validDevReceipt(overrides = {}) {
  const { downstream: downstreamOverrides, ...receiptOverrides } = overrides;
  const downstream = {
    subscriptionCount: 1,
    audioStatus: "ready",
    audioErrorCode: null,
    audioGeneratedAt: "2026-07-20T00:01:01.000Z",
    audioUpdatedAt: "2026-07-20T00:01:01.000Z",
    coverStatus: "ready",
    coverErrorCode: null,
    coverGeneratedAt: "2026-07-20T00:01:02.000Z",
    pushStatus: "sent",
    pushErrorCode: null,
    pushBatchCreatedAt: "2026-07-20T00:01:03.000Z",
    deliveredCount: 1,
    latestDeliveredAt: "2026-07-20T00:01:04.000Z",
    deliveryErrorCodes: [],
    ...downstreamOverrides,
  };
  return {
    schemaVersion: 1,
    status: "passed",
    gitSha: TEST_SHA,
    workerVersionId: "dev-version",
    workerVersionTag: `git-${TEST_SHA}`,
    runWorkerVersionTag: `git-${TEST_SHA}`,
    runId: "run-id",
    stage: "final",
    outcome: "published",
    targetDate: "2026-07-20",
    runStartedAt: "2026-07-20T00:00:00.000Z",
    runFinishedAt: "2026-07-20T00:01:00.000Z",
    automatedAt: "2026-07-20T00:01:05.000Z",
    publicBrief: {
      status: "partial",
      itemCount: 1,
      generatedAt: "2026-07-20T00:01:00.000Z",
      missingSources: ["kickstarter"],
    },
    waivers: [],
    manualAcceptanceAt: "2026-07-20T00:01:06.000Z",
    ...receiptOverrides,
    downstream,
  };
}

function devMetadata(overrides = {}) {
  return {
    environment: "dev",
    workerVersionTag: `git-${TEST_SHA}`,
    workerVersionId: "dev-version",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("release candidate gates", () => {
  it("keeps release targets identical to the authoritative Wrangler environments", () => {
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
    expect(TARGETS.production).toMatchObject({
      worker: config.name,
      domain: config.routes[0].pattern,
      database: config.d1_databases[0].database_name,
      wranglerEnv: "",
    });
    expect(TARGETS.dev).toMatchObject({
      worker: config.env.dev.name,
      domain: config.env.dev.routes[0].pattern,
      database: config.env.dev.d1_databases[0].database_name,
      wranglerEnv: "dev",
    });
  });

  it("fails closed for dirty, wrong-branch, and unsynchronized repository states", () => {
    expect(() => assertClean({ status: " M README.md" })).toThrow("clean working tree");
    expect(() => assertProductionBaseline({ branch: "feat/test", sha: "a", status: "" }, "a")).toThrow("branch main");
    expect(() => assertProductionBaseline({ branch: "main", sha: "a", status: "" }, "b")).toThrow("origin/main");
  });

  it("requires exact Dev, receipt, and production SHA continuity", () => {
    expect(() => assertDevValidatedSha({ environment: "production", workerVersionTag: `git-${TEST_SHA}` }, TEST_SHA)).toThrow();
    expect(() => assertProductionDeployedSha({ environment: "production", workerVersionTag: "git-other" }, TEST_SHA)).toThrow();
    const receipt = validDevReceipt();
    expect(assertDevValidationReceipt(receipt, TEST_SHA, devMetadata(), TEST_NOW)).toBe(receipt);
    expect(() => assertDevValidationReceipt({ ...receipt, status: "pending-manual" }, TEST_SHA)).toThrow();
    expect(() => assertDevValidationReceipt({ ...receipt, runWorkerVersionTag: "git-stale" }, TEST_SHA)).toThrow();
    expect(() => assertDevValidationReceipt(receipt, TEST_SHA, {
      environment: "dev", workerVersionTag: `git-${TEST_SHA}`, workerVersionId: "other-version",
    })).toThrow();
  });

  it("requires ordered, valid receipt timestamps", () => {
    const cases = [
      validDevReceipt({ runFinishedAt: "2026-07-19T23:59:59.000Z" }),
      validDevReceipt({ automatedAt: "2026-07-20T00:00:59.000Z" }),
      validDevReceipt({ manualAcceptanceAt: "2026-07-20T00:01:04.000Z" }),
      validDevReceipt({ manualAcceptanceAt: "not-a-timestamp" }),
    ];
    for (const receipt of cases) {
      expect(() => assertDevValidationReceipt(receipt, TEST_SHA, devMetadata())).toThrow();
    }
  });

  it("requires integer downstream counters instead of coercing strings or fractions", () => {
    for (const downstream of [
      { subscriptionCount: "1" },
      { deliveredCount: "1" },
      { subscriptionCount: 1.5 },
      { deliveredCount: 1.5 },
    ]) {
      expect(() => assertDevValidationReceipt(validDevReceipt({ downstream }), TEST_SHA, devMetadata())).toThrow();
    }
  });

  it("rejects stale audio, cover, push-batch, and APNs-delivery evidence", () => {
    for (const downstream of [
      { audioGeneratedAt: "2026-07-19T23:59:59.000Z" },
      { coverGeneratedAt: "2026-07-19T23:59:59.000Z" },
      { pushBatchCreatedAt: "2026-07-19T23:59:59.000Z" },
      { latestDeliveredAt: "2026-07-19T23:59:59.000Z" },
    ]) {
      expect(() => assertDevValidationReceipt(validDevReceipt({ downstream }), TEST_SHA, devMetadata())).toThrow();
    }
  });

  it("limits an explicit audio waiver to audio evidence only", () => {
    const waived = validDevReceipt({
      waivers: [{
        component: "audio",
        reason: "provider incident",
        status: "failed",
        errorCode: "MIMO_PROVIDER_UNAVAILABLE",
      }],
      downstream: {
        audioStatus: "failed",
        audioErrorCode: "MIMO_PROVIDER_UNAVAILABLE",
        audioGeneratedAt: null,
        audioUpdatedAt: "2026-07-20T00:01:01.000Z",
      },
    });
    expect(assertDevValidationReceipt(waived, TEST_SHA, devMetadata(), TEST_NOW)).toBe(waived);
    for (const downstream of [
      { audioStatus: "pending", audioErrorCode: null },
      { audioStatus: "failed", audioErrorCode: null },
      { audioStatus: "failed", audioErrorCode: "MIMO_PROVIDER_UNAVAILABLE", audioUpdatedAt: "2026-07-19T23:59:59.000Z" },
    ]) {
      expect(() => assertDevValidationReceipt({ ...waived, downstream: { ...waived.downstream, ...downstream } }, TEST_SHA, devMetadata())).toThrow();
    }
    expect(() => assertDevValidationReceipt(validDevReceipt({
      waivers: [{
        component: "audio",
        reason: "provider incident",
        status: "failed",
        errorCode: "MIMO_PROVIDER_UNAVAILABLE",
      }],
      downstream: {
        audioStatus: "failed",
        audioErrorCode: "MIMO_PROVIDER_UNAVAILABLE",
        audioGeneratedAt: null,
        audioUpdatedAt: "2026-07-20T00:01:01.000Z",
        coverGeneratedAt: "2026-07-19T23:59:59.000Z",
      },
    }), TEST_SHA, devMetadata())).toThrow();
  });

  it("requires an active sandbox subscription in pending and accepted evidence", () => {
    const pending = validDevReceipt({
      status: "pending-manual",
      manualAcceptanceAt: null,
      downstream: { subscriptionCount: 0 },
    });
    expect(() => assertPendingDevValidationReceipt(pending, TEST_SHA, devMetadata())).toThrow();
    expect(() => assertDevValidationReceipt(
      validDevReceipt({ downstream: { subscriptionCount: 0 } }), TEST_SHA, devMetadata(),
    )).toThrow();
  });

  it("revalidates the current sandbox subscription in the acceptance readiness check", () => {
    expect(devE2e.downstreamReady).toBeTypeOf("function");
    expect(devE2e.downstreamReady(
      validDevReceipt({ downstream: { subscriptionCount: 0 } }).downstream,
      false,
      "2026-07-20T00:00:00.000Z",
    )).toBe(false);
  });

  it("uses the single Worker version receiving all production traffic", () => {
    const version = "11111111-1111-4111-8111-111111111111";
    expect(currentProductionVersion({ latestDeployment: { versions: [{ version_id: version, percentage: 100 }] } })).toBe(version);
    expect(() => currentProductionVersion({ versions: [
      { version_id: "one", percentage: 90 },
      { version_id: "two", percentage: 10 },
    ] })).toThrow("split");
  });

  it("requires public metadata to match the selected Wrangler deployment", () => {
    expect(assertWorkerVersionAligned(devMetadata(), "dev", "dev-version")).toEqual(devMetadata());
    expect(() => assertWorkerVersionAligned(devMetadata(), "dev", "other-version")).toThrow("100% Wrangler deployment");
  });

  it("requires CI success for the candidate's exact branch", () => {
    const runs = [
      { workflowName: "CI", headBranch: "feat/example", status: "completed", conclusion: "success", createdAt: "2026-07-20T00:00:00Z" },
      { workflowName: "CI", headBranch: "main", status: "completed", conclusion: "failure", createdAt: "2026-07-20T00:00:00Z" },
    ];
    expect(hasSuccessfulCiRun(runs, "feat/example")).toBe(true);
    expect(hasSuccessfulCiRun(runs, "main")).toBe(false);
    expect(hasSuccessfulCiRun(runs, "")).toBe(false);
    expect(hasSuccessfulCiRun([
      ...runs,
      { workflowName: "CI", headBranch: "feat/example", status: "completed", conclusion: "failure", createdAt: "2026-07-20T00:01:00Z" },
    ], "feat/example")).toBe(false);
  });
});

describe("secret-file and local proxy safety", () => {
  it("reads only a private regular token file and rejects ambiguous input", () => {
    const path = join(temporaryDirectory(), "token");
    writeFileSync(path, "test-access-value\n", { mode: 0o600 });
    expect(readSecretFile(path)).toBe("test-access-value");
    expect(devAccessToken({ WATCHTOWER_DEV_ACCESS_TOKEN_FILE: path })).toBe("test-access-value");
    expect(() => devAccessToken({
      WATCHTOWER_DEV_ACCESS_TOKEN: "direct",
      WATCHTOWER_DEV_ACCESS_TOKEN_FILE: path,
    })).toThrow("only one");
    chmodSync(path, 0o644);
    expect(() => readSecretFile(path)).toThrow("permissions");
  });

  it("limits the capture proxy to loopback or private addresses", () => {
    for (const host of ["127.0.0.1", "10.0.0.2", "172.16.1.2", "192.168.1.2", "::1", "fd00::1"]) {
      expect(isAllowedListenHost(host)).toBe(true);
    }
    for (const host of ["0.0.0.0", "8.8.8.8", "example.com", "fcorp.example.com"]) expect(isAllowedListenHost(host)).toBe(false);
    expect(parseProxyArgs([
      "--host", "192.168.1.20", "--allow-insecure-lan", "--port", "8787",
    ]).port).toBe(8787);
    expect(() => parseProxyArgs(["--token-file", "tracked-token"])).toThrow("Usage");
    expect(() => parseProxyArgs(["--host", "192.168.1.20"])).toThrow("allow-insecure-lan");
    expect(() => parseProxyArgs(["--host", "0.0.0.0"])).toThrow("private IP");
  });

  it("writes captured tokens with private permissions and removes them", () => {
    const path = join(temporaryDirectory(), "capture", "token");
    writeCapturedToken(path, "captured-value");
    expect(readFileSync(path, "utf8").trim()).toBe("captured-value");
    expect(lstatSync(path).mode & 0o077).toBe(0);
    removeCapturedToken(path);
    expect(() => lstatSync(path)).toThrow();
  });
});

describe("release smoke contracts", () => {
  it("rejects HTML and invalid JSON instead of accepting an empty payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new globalThis.Response("<html>Access</html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    })));
    await expect(fetchJson("https://example.com/api/briefs/latest")).rejects.toThrow("NON_JSON_RESPONSE");
    vi.stubGlobal("fetch", vi.fn(async () => new globalThis.Response("{", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    await expect(fetchJson("https://example.com/api/briefs/latest")).rejects.toThrow("INVALID_JSON_RESPONSE");
  });

  it("requires no-store and a complete deployment metadata contract", async () => {
    const metadata = {
      environment: "dev",
      workerVersionId: "version-id",
      workerVersionTag: `git-${TEST_SHA}`,
      deployedAt: "2026-07-20T00:00:00.000Z",
    };
    vi.stubGlobal("fetch", vi.fn(async () => new globalThis.Response(JSON.stringify(metadata), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    })));
    await expect(fetchMetadata("https://example.com/api/meta")).resolves.toEqual(metadata);
    vi.stubGlobal("fetch", vi.fn(async () => new globalThis.Response(JSON.stringify(metadata), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
    })));
    await expect(fetchMetadata("https://example.com/api/meta")).rejects.toThrow("CACHE_CONTROL");
    vi.stubGlobal("fetch", vi.fn(async () => new globalThis.Response(JSON.stringify({ ...metadata, accountId: "leak" }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    })));
    await expect(fetchMetadata("https://example.com/api/meta")).rejects.toThrow("CONTRACT_INVALID");
  });

  it("validates brief and Auth config smoke shapes", () => {
    expect(assertLatestBriefShape({ date: "2026-07-20", status: "partial", items: [{}] })).toBeTruthy();
    expect(() => assertLatestBriefShape({ date: "2026-07-20", status: "partial", items: [] })).toThrow();
    expect(assertBriefListShape({ briefs: [{ date: "2026-07-20" }], nextCursor: null })).toBeTruthy();
    expect(() => assertBriefListShape({ briefs: {}, nextCursor: null })).toThrow();
    expect(assertAuthConfigShape({
      issuer: "https://auth.example.com/",
      audience: "https://example.com/api",
      connection: "apple",
      clientIds: { web: "web", mobileDev: "dev", mobileProd: "prod" },
    })).toBeTruthy();
    expect(() => assertAuthConfigShape({ issuer: "https://auth.example.com/", clientIds: {} })).toThrow();
  });

  it("extracts and deduplicates pending D1 migration names", () => {
    expect(parsePendingMigrations("0009_example.sql\n0010_next-step.sql\n0009_example.sql")).toEqual([
      "0009_example.sql", "0010_next-step.sql",
    ]);
    expect(parsePendingMigrations("No migrations to apply")).toEqual([]);
  });
});

describe("Dev E2E and TestFlight inputs", () => {
  it("validates stage, date, and explicit audio waivers", () => {
    const now = new Date(TEST_NOW);
    expect(devE2e.parseDevE2eArgs(["final", "2026-07-20"], now)).toEqual({
      stage: "final", targetDate: "2026-07-20", audioWaiverReason: null,
    });
    expect(devE2e.parseDevE2eArgs(["recovery", "2026-07-20", "--waive-audio", "provider incident"], now).audioWaiverReason).toBe("provider incident");
    expect(() => devE2e.parseDevE2eArgs(["final", "2026-07-21"], now)).toThrow("future");
    expect(() => devE2e.parseDevE2eArgs(["final", "2026-02-30"], now)).toThrow("Usage");
    expect(() => devE2e.parseDevE2eArgs(["collect", "2026-07-20", "--waive-audio", "not applicable"], now)).toThrow("only");
  });

  it("reduces remote D1 rows to a secret-free downstream audit", () => {
    expect(devE2e.parseDownstreamAudit({
      subscription_count: 1,
      audio_status: "failed",
      audio_error_code: "MIMO_DURATION_OUT_OF_RANGE",
      audio_generated_at: "2026-07-20T00:01:01.000Z",
      audio_updated_at: "2026-07-20T00:01:02.000Z",
      cover_status: "ready",
      cover_generated_at: "2026-07-20T00:01:02.000Z",
      push_status: "sent",
      delivered_count: 1,
      delivery_error_codes: "APNS_ONE,APNS_TWO",
      token_ciphertext: "must-not-appear",
    })).toEqual({
      subscriptionCount: 1,
      audioStatus: "failed",
      audioErrorCode: "MIMO_DURATION_OUT_OF_RANGE",
      audioGeneratedAt: "2026-07-20T00:01:01.000Z",
      audioUpdatedAt: "2026-07-20T00:01:02.000Z",
      coverStatus: "ready",
      coverErrorCode: null,
      coverGeneratedAt: "2026-07-20T00:01:02.000Z",
      pushStatus: "sent",
      pushErrorCode: null,
      pushBatchCreatedAt: null,
      deliveredCount: 1,
      latestDeliveredAt: null,
      deliveryErrorCodes: ["APNS_ONE", "APNS_TWO"],
    });
  });

  it("bumps a Flutter build only beyond the repository value", () => {
    const path = join(temporaryDirectory(), "pubspec.yaml");
    writeFileSync(path, "name: watchtower\nversion: 1.0.0+8\n");
    expect(() => bumpBuildNumber(path, "8")).toThrow("greater");
    expect(bumpBuildNumber(path, "9")).toEqual({ version: "1.0.0", previousBuild: 8, build: 9 });
    expect(readFileSync(path, "utf8")).toContain("version: 1.0.0+9");
  });

  it("binds TestFlight inspection to the candidate SHA and exact IPA bytes", () => {
    const directory = temporaryDirectory();
    const ipaPath = join(directory, "watchtower.ipa");
    writeFileSync(ipaPath, "signed-ipa-fixture");
    const releaseVersion = mobileVersion();
    const archiveEvidence = {
      archiveName: "Runner.xcarchive",
      archiveBundleId: "io.damao.watchtower",
      archiveVersion: releaseVersion.version,
      archiveBuild: String(releaseVersion.build),
      archiveExecutableUuidSha256: "c".repeat(64),
      infoModifiedAt: "2026-07-20T00:00:00.000Z",
      executableModifiedAt: "2026-07-20T00:00:00.000Z",
    };
    const receipt = {
      schemaVersion: 2,
      gitSha: TEST_SHA,
      ipaName: basename(ipaPath),
      artifactSha256: sha256(ipaPath),
      ...releaseVersion,
      flutterVersion: expectedFlutterVersion(),
      xcodeVersion: "Xcode 26.0\nBuild version 17A100",
      ipaModifiedAt: statSync(ipaPath).mtime.toISOString(),
      archiveName: archiveEvidence.archiveName,
      archiveBundleId: archiveEvidence.archiveBundleId,
      archiveVersion: archiveEvidence.archiveVersion,
      archiveBuild: archiveEvidence.archiveBuild,
      archiveExecutableUuidSha256: archiveEvidence.archiveExecutableUuidSha256,
      archiveInfoModifiedAt: archiveEvidence.infoModifiedAt,
      archiveExecutableModifiedAt: archiveEvidence.executableModifiedAt,
      builtAt: "2026-07-20T00:00:00.000Z",
    };
    expect(assertTestflightBuildReceipt(receipt, TEST_SHA, ipaPath, archiveEvidence)).toBe(receipt);
    expect(() => assertTestflightBuildReceipt(receipt, "b".repeat(40), ipaPath, archiveEvidence)).toThrow();
    expect(() => assertTestflightBuildReceipt(receipt, TEST_SHA, ipaPath, {
      ...archiveEvidence,
      archiveExecutableUuidSha256: "d".repeat(64),
    })).toThrow();
    writeFileSync(ipaPath, "tampered-ipa-fixture");
    expect(() => assertTestflightBuildReceipt(receipt, TEST_SHA, ipaPath, archiveEvidence)).toThrow();
  });

  it("binds archive and IPA executables by path-independent Mach-O UUID evidence", () => {
    const first = uuidOutputSha256([
      "UUID: AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE (arm64) /archive/Runner",
      "UUID: 11111111-2222-4333-8444-555555555555 (arm64e) /archive/Runner",
    ].join("\n"));
    const second = uuidOutputSha256([
      "UUID: 11111111-2222-4333-8444-555555555555 (arm64e) /ipa/Runner",
      "UUID: AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE (arm64) /ipa/Runner",
    ].join("\n"));
    expect(second).toBe(first);
    expect(() => uuidOutputSha256("not a Mach-O executable")).toThrow("Mach-O UUIDs");
  });
});

describe("repository-local release evidence", () => {
  it("stores release receipts under the Git common directory shared by worktrees", () => {
    const commonDirectory = resolve(execFileSync("git", ["rev-parse", "--git-common-dir"], {
      encoding: "utf8",
    }).trim());
    const expected = join(commonDirectory, "watchtower-release");
    expect(releaseDirectory()).toBe(expected);
    expect(devValidationPath()).toBe(join(expected, "dev-validation.json"));
    expect(testflightBuildReceiptPath()).toBe(join(expected, "testflight-build.json"));
    expect(releaseDirectory()).not.toContain(`${join(".wrangler", "release")}`);
  });

  it("scans tracked and untracked nonignored commit candidates for secrets", () => {
    const source = readFileSync(resolve("scripts/secret-scan.mjs"), "utf8");
    expect(source).toContain('"ls-files", "--cached", "--others", "--exclude-standard", "-z"');
  });

  it("derives declared secret names and detects real-looking assignments", () => {
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
    const names = requiredSecretNames(config);
    const encryptionName = ["PUSH", "TOKEN", "ENCRYPTION", "KEY"].join("_");
    const hmacName = ["PUSH", "TOKEN", "HMAC", "KEY"].join("_");
    expect(names).toEqual(expect.arrayContaining([encryptionName, hmacName]));
    expect(containsPotentialSecret(`${encryptionName}=${"a".repeat(32)}`, names)).toBe(true);
    expect(containsPotentialSecret(`"${hmacName}": "${"b".repeat(32)}"`, names)).toBe(true);
    expect(containsPotentialSecret(`${encryptionName}=placeholder`, names)).toBe(false);
    expect(containsPotentialSecret(`${hmacName}=test-key`, names)).toBe(false);
  });
});
