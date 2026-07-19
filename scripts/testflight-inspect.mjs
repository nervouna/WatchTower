#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const [ipa] = process.argv.slice(2);
if (!ipa) throw new Error("Usage: testflight-inspect.mjs <ipa-path>");
const directory = mkdtempSync(join(tmpdir(), "watchtower-ipa-"));
execFileSync("unzip", ["-q", ipa, "-d", directory]);
const payload = join(directory, "Payload");
const appName = readdirSync(payload).find((name) => name.endsWith(".app"));
if (!appName) throw new Error("IPA does not contain a Payload app bundle.");
const app = join(payload, appName);

function plistJson(path) {
  return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path], { encoding: "utf8" }));
}

const info = plistJson(join(app, "Info.plist"));
const entitlementsXml = execFileSync("codesign", ["-d", "--entitlements", ":-", app], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const entitlementsPath = join(directory, "entitlements.plist");
await import("node:fs").then(({ writeFileSync }) => writeFileSync(entitlementsPath, entitlementsXml));
const entitlements = plistJson(entitlementsPath);
const signatureResult = spawnSync("codesign", ["-dvv", app], { encoding: "utf8" });
if (signatureResult.status !== 0) throw new Error("Unable to inspect the IPA signature.");
const signature = `${signatureResult.stdout ?? ""}\n${signatureResult.stderr ?? ""}`;

const profilePath = join(app, "embedded.mobileprovision");
const profileXml = execFileSync("security", ["cms", "-D", "-i", profilePath], { encoding: "utf8" });
const profileFile = join(directory, "profile.plist");
await import("node:fs").then(({ writeFileSync }) => writeFileSync(profileFile, profileXml));
const profile = plistJson(profileFile);

const checks = {
  bundleId: info.CFBundleIdentifier === "io.damao.watchtower",
  version: typeof info.CFBundleShortVersionString === "string" && typeof info.CFBundleVersion === "string",
  distributionSigning: signature.includes("Authority=Apple Distribution"),
  productionApns: entitlements["aps-environment"] === "production",
  noDebugEntitlement: entitlements["get-task-allow"] === false,
  betaReportsActive: profile.Entitlements?.["beta-reports-active"] === true,
  exportCompliance: info.ITSAppUsesNonExemptEncryption === false,
};
console.log(JSON.stringify({ ipa: basename(ipa), version: info.CFBundleShortVersionString, build: info.CFBundleVersion, checks }, null, 2));
if (Object.values(checks).some((value) => !value)) throw new Error("IPA inspection failed.");
