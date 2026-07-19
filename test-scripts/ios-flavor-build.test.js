import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validateIosFlavorContract } from "../scripts/check-ios-flavor-build.mjs";

const project = readFileSync("mobile/ios/Runner.xcodeproj/project.pbxproj", "utf8");
const entitlementSource = { "aps-environment": "$(APS_ENVIRONMENT)" };
const localNetworkDescription = "用于在开发验证期间连接同一局域网内的 WatchTower 调试代理。";

function devInfo(overrides = {}) {
  return {
    CFBundleIdentifier: "io.damao.watchtower.dev",
    WatchTowerAPNSEnvironment: "development",
    NSLocalNetworkUsageDescription: localNetworkDescription,
    NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    ...overrides,
  };
}

function prodInfo(overrides = {}) {
  return {
    CFBundleIdentifier: "io.damao.watchtower",
    WatchTowerAPNSEnvironment: "production",
    ...overrides,
  };
}

describe("iOS flavor build contract", () => {
  it("accepts the Dev-only local network and sandbox APNs contract", () => {
    expect(validateIosFlavorContract({
      flavor: "dev",
      info: devInfo(),
      entitlements: entitlementSource,
      project,
    }).bundleId).toBe("io.damao.watchtower.dev");
  });

  it("accepts the production contract without local network exceptions", () => {
    expect(validateIosFlavorContract({
      flavor: "prod",
      info: prodInfo(),
      entitlements: {
        "aps-environment": "production",
        "application-identifier": "T7976FL2LP.io.damao.watchtower",
        "get-task-allow": false,
      },
      project,
    }).bundleId).toBe("io.damao.watchtower");
  });

  it("rejects missing or broadened local network configuration", () => {
    expect(() => validateIosFlavorContract({
      flavor: "dev",
      info: devInfo({ NSAppTransportSecurity: undefined }),
      entitlements: entitlementSource,
      project,
    })).toThrow("allow local networking");
    expect(() => validateIosFlavorContract({
      flavor: "prod",
      info: prodInfo({
        NSLocalNetworkUsageDescription: localNetworkDescription,
        NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
      }),
      entitlements: entitlementSource,
      project,
    })).toThrow("prod must not include");
  });

  it("rejects crossed bundle IDs and APNs environments", () => {
    expect(() => validateIosFlavorContract({
      flavor: "dev",
      info: devInfo({ CFBundleIdentifier: "io.damao.watchtower" }),
      entitlements: entitlementSource,
      project,
    })).toThrow("bundle ID");
    expect(() => validateIosFlavorContract({
      flavor: "prod",
      info: prodInfo(),
      entitlements: { "aps-environment": "development" },
      project,
    })).toThrow("aps-environment");
  });

  it("locks the Dev plist to the Runner Debug-dev configuration only", () => {
    const crossed = project.replace("INFOPLIST_FILE = Runner/Info-Dev.plist;", "INFOPLIST_FILE = Runner/Info.plist;");
    expect(() => validateIosFlavorContract({
      flavor: "dev",
      info: devInfo(),
      entitlements: entitlementSource,
      project: crossed,
    })).toThrow("Info-Dev.plist");
  });
});
