#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_APP_PATH = join(repositoryRoot, "mobile/build/ios/iphoneos/Runner.app");
const ENTITLEMENTS_PATH = join(repositoryRoot, "mobile/ios/Runner/Runner.entitlements");
const PROJECT_PATH = join(repositoryRoot, "mobile/ios/Runner.xcodeproj/project.pbxproj");
const LOCAL_NETWORK_DESCRIPTION = "用于在开发验证期间连接同一局域网内的 WatchTower 调试代理。";
const COMMAND_TIMEOUT_MS = 60_000;

const FLAVOR_CONTRACTS = Object.freeze({
  dev: Object.freeze({
    apnsEnvironment: "development",
    bundleId: "io.damao.watchtower.dev",
    configurationId: "97C147061CF9000F007C117D",
    infoPlist: "Runner/Info-Dev.plist",
  }),
  prod: Object.freeze({
    apnsEnvironment: "production",
    bundleId: "io.damao.watchtower",
    configurationId: "74BF596426B0F3AEDED67158",
    infoPlist: "Runner/Info.plist",
  }),
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function plistJson(path) {
  try {
    return JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", path], {
      encoding: "utf8",
      timeout: COMMAND_TIMEOUT_MS,
    }));
  } catch (error) {
    throw new Error(`Unable to inspect plist: ${path}`, { cause: error });
  }
}

function plistDataJson(data) {
  const result = spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], {
    encoding: "utf8",
    input: data,
    timeout: COMMAND_TIMEOUT_MS,
  });
  if (result.error || result.status !== 0) {
    throw new Error("Unable to parse the embedded app entitlements.", { cause: result.error });
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error("Embedded app entitlements are not valid plist JSON.", { cause: error });
  }
}

function signedEntitlements(appPath) {
  const signature = spawnSync("/usr/bin/codesign", ["-d", appPath], {
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
  });
  if (signature.error) throw new Error("Unable to inspect the app signature.", { cause: signature.error });
  if (signature.status !== 0) return null;

  const result = spawnSync("/usr/bin/codesign", ["-d", "--entitlements", ":-", appPath], {
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
  });
  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    throw new Error("Signed app does not expose inspectable entitlements.", { cause: result.error });
  }
  return plistDataJson(result.stdout);
}

function xcodeConfigurationBlock(project, configurationId) {
  const escapedId = configurationId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`\\t\\t${escapedId} \\/\\* [^*]+ \\*\\/ = \\{[\\s\\S]*?\\n\\t\\t\\};`, "u").exec(project);
  assert(match, `Unable to find Runner build configuration ${configurationId}.`);
  return match[0];
}

export function validateIosFlavorContract({ flavor, info, entitlements, project }) {
  const contract = FLAVOR_CONTRACTS[flavor];
  assert(contract, `Unsupported iOS flavor: ${String(flavor)}`);
  assert(info?.CFBundleIdentifier === contract.bundleId, `${flavor} bundle ID must be ${contract.bundleId}.`);
  assert(
    info?.WatchTowerAPNSEnvironment === contract.apnsEnvironment,
    `${flavor} Info.plist APNs environment must be ${contract.apnsEnvironment}.`,
  );

  const rawEntitlement = entitlements?.["aps-environment"];
  assert(
    rawEntitlement === contract.apnsEnvironment || rawEntitlement === "$(APS_ENVIRONMENT)",
    `${flavor} aps-environment entitlement must resolve to ${contract.apnsEnvironment}.`,
  );
  const applicationIdentifier = entitlements?.["application-identifier"];
  if (applicationIdentifier !== undefined) {
    assert(
      applicationIdentifier === `T7976FL2LP.${contract.bundleId}`,
      `${flavor} application-identifier entitlement does not match the bundle ID.`,
    );
  }
  if (entitlements?.["get-task-allow"] !== undefined) {
    assert(
      entitlements["get-task-allow"] === (flavor === "dev"),
      `${flavor} get-task-allow entitlement does not match the build contract.`,
    );
  }

  const localNetworking = info?.NSAppTransportSecurity?.NSAllowsLocalNetworking;
  if (flavor === "dev") {
    assert(
      info?.NSLocalNetworkUsageDescription === LOCAL_NETWORK_DESCRIPTION,
      "dev must include the repository-controlled local network usage description.",
    );
    assert(localNetworking === true, "dev must allow local networking for the authenticated debug proxy.");
  } else {
    assert(info?.NSLocalNetworkUsageDescription === undefined, "prod must not include a local network usage description.");
    assert(localNetworking === undefined, "prod must not include an NSAllowsLocalNetworking exception.");
  }

  const block = xcodeConfigurationBlock(project, contract.configurationId);
  const devInfoPlistReferences = project.match(/INFOPLIST_FILE = Runner\/Info-Dev\.plist;/gu) ?? [];
  assert(devInfoPlistReferences.length === 1, "Info-Dev.plist must be limited to one Runner build configuration.");
  assert(
    block.includes(`INFOPLIST_FILE = ${contract.infoPlist};`),
    `${flavor} build configuration must use ${contract.infoPlist}.`,
  );
  assert(
    block.includes("CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;"),
    `${flavor} build configuration must use Runner/Runner.entitlements.`,
  );
  return contract;
}

export function inspectIosFlavorBuild(flavor, appPath = DEFAULT_APP_PATH) {
  const resolvedAppPath = resolve(appPath);
  assert(existsSync(resolvedAppPath) && statSync(resolvedAppPath).isDirectory(), `App bundle not found: ${resolvedAppPath}`);
  const info = plistJson(join(resolvedAppPath, "Info.plist"));
  const embeddedEntitlements = signedEntitlements(resolvedAppPath);
  const entitlements = embeddedEntitlements ?? plistJson(ENTITLEMENTS_PATH);
  const project = readFileSync(PROJECT_PATH, "utf8");
  const contract = validateIosFlavorContract({ flavor, info, entitlements, project });
  const result = {
    flavor,
    app: resolvedAppPath,
    bundleId: info.CFBundleIdentifier,
    apnsEnvironment: contract.apnsEnvironment,
    entitlementsSource: embeddedEntitlements ? "code-signature" : "Runner.entitlements (unsigned build)",
    localNetworking: flavor === "dev",
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2 || !FLAVOR_CONTRACTS[args[0]]) {
    throw new Error("Usage: check-ios-flavor-build.mjs <dev|prod> [app-path]");
  }
  inspectIosFlavorBuild(args[0], args[1] ?? DEFAULT_APP_PATH);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
