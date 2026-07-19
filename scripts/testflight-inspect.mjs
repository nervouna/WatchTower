#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executableUuidSha256 } from "./release-lib.mjs";

const [ipa, expectedArtifactSha256, expectedExecutableUuidSha256, ...extraArgs] = process.argv.slice(2);
if (
  !ipa || !/^[a-f0-9]{64}$/u.test(expectedArtifactSha256 ?? "") ||
  !/^[a-f0-9]{64}$/u.test(expectedExecutableUuidSha256 ?? "") || extraArgs.length > 0
) {
  throw new Error("Usage: testflight-inspect.mjs <ipa-path> <expected-sha256> <archive-executable-uuid-sha256>");
}
const COMMAND_TIMEOUT_MS = 60_000;
const TEAM_ID = "T7976FL2LP";
const BUNDLE_ID = "io.damao.watchtower";
const APPLICATION_IDENTIFIER = `${TEAM_ID}.${BUNDLE_ID}`;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pubspec = readFileSync(join(repositoryRoot, "mobile/pubspec.yaml"), "utf8");
const expectedVersion = /^version:\s*([^+\s]+)\+(\d+)$/mu.exec(pubspec);
if (!expectedVersion) throw new Error("Unable to read the expected Flutter version from mobile/pubspec.yaml.");
const artifactSha256 = createHash("sha256").update(readFileSync(ipa)).digest("hex");
if (artifactSha256 !== expectedArtifactSha256) {
  throw new Error("IPA bytes do not match the expected TestFlight build receipt.");
}
const directory = mkdtempSync(join(tmpdir(), "watchtower-ipa-"));
try {
  execFileSync("unzip", ["-q", ipa, "-d", directory], { timeout: COMMAND_TIMEOUT_MS });
  const payload = join(directory, "Payload");
  const apps = readdirSync(payload, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  if (apps.length !== 1) throw new Error("IPA Payload must contain exactly one top-level app bundle.");
  const app = join(payload, apps[0].name);

  function plistJson(path) {
    return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path], {
      encoding: "utf8",
      timeout: COMMAND_TIMEOUT_MS,
    }));
  }

  const info = plistJson(join(app, "Info.plist"));
  const executableName = info.CFBundleExecutable;
  if (typeof executableName !== "string" || executableName === "" || basename(executableName) !== executableName) {
    throw new Error("IPA has an invalid executable name.");
  }
  const executableUuid = executableUuidSha256(join(app, executableName));
  const entitlementsXml = execFileSync("codesign", ["-d", "--entitlements", ":-", app], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: COMMAND_TIMEOUT_MS,
  });
  const entitlementsPath = join(directory, "entitlements.plist");
  writeFileSync(entitlementsPath, entitlementsXml, { mode: 0o600 });
  const entitlements = plistJson(entitlementsPath);
  const verification = spawnSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], {
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
  });
  if (verification.error || verification.status !== 0) throw new Error("IPA code signature verification failed.", { cause: verification.error });
  const signatureResult = spawnSync("codesign", ["-dvv", app], { encoding: "utf8", timeout: COMMAND_TIMEOUT_MS });
  if (signatureResult.error || signatureResult.status !== 0) throw new Error("Unable to inspect the IPA signature.", { cause: signatureResult.error });
  const signature = `${signatureResult.stdout ?? ""}\n${signatureResult.stderr ?? ""}`;

  const profilePath = join(app, "embedded.mobileprovision");
  const profileXml = execFileSync("security", ["cms", "-D", "-i", profilePath], {
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
  });
  const profileFile = join(directory, "profile.plist");
  writeFileSync(profileFile, profileXml, { mode: 0o600 });
  const profile = plistJson(profileFile);

  const profileEntitlements = profile.Entitlements ?? {};
  const profileTeamIdentifiers = Array.isArray(profile.TeamIdentifier) ? profile.TeamIdentifier : [];
  const profileExpiration = Date.parse(profile.ExpirationDate ?? "");
  const checks = {
    artifactMatchesReceipt: artifactSha256 === expectedArtifactSha256,
    executableMatchesArchive: executableUuid === expectedExecutableUuidSha256,
    singleTopLevelApp: apps.length === 1,
    bundleId: info.CFBundleIdentifier === BUNDLE_ID,
    version: info.CFBundleShortVersionString === expectedVersion[1] && String(info.CFBundleVersion) === expectedVersion[2],
    signatureValid: verification.status === 0,
    distributionSigning: signature.includes("Authority=Apple Distribution"),
    productionApns: entitlements["aps-environment"] === "production",
    noDebugEntitlement: entitlements["get-task-allow"] === false,
    signedTeam: entitlements["com.apple.developer.team-identifier"] === TEAM_ID,
    signedApplicationIdentifier: entitlements["application-identifier"] === APPLICATION_IDENTIFIER,
    profileNotExpired: Number.isFinite(profileExpiration) && profileExpiration > Date.now(),
    profileTeam: profileTeamIdentifiers.length === 1 && profileTeamIdentifiers[0] === TEAM_ID,
    profileApplicationIdentifier: profileEntitlements["application-identifier"] === APPLICATION_IDENTIFIER,
    profileProductionApns: profileEntitlements["aps-environment"] === "production",
    profileNoDebugEntitlement: profileEntitlements["get-task-allow"] === false,
    profileMatchesSignedEntitlements:
      profileEntitlements["application-identifier"] === entitlements["application-identifier"] &&
      profileEntitlements["com.apple.developer.team-identifier"] === entitlements["com.apple.developer.team-identifier"] &&
      profileEntitlements["aps-environment"] === entitlements["aps-environment"],
    betaReportsActive: profileEntitlements["beta-reports-active"] === true,
    exportCompliance: info.ITSAppUsesNonExemptEncryption === false,
  };
  console.log(JSON.stringify({
    ipa: basename(ipa),
    artifactSha256,
    version: info.CFBundleShortVersionString,
    build: info.CFBundleVersion,
    expectedVersion: expectedVersion[1],
    expectedBuild: expectedVersion[2],
    checks,
  }, null, 2));
  if (Object.values(checks).some((value) => !value)) throw new Error("IPA inspection failed.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
