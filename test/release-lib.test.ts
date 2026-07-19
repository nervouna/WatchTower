import { describe, expect, it } from "vitest";
import library from "../scripts/release-lib.mjs?raw";
import release from "../scripts/release.mjs?raw";

describe("release preflight", () => {
  it("fails closed for a dirty tree, wrong branch, remote mismatch, or Dev mismatch", () => {
    expect(library).toContain('state.status !== ""');
    expect(library).toContain('state.branch !== "main"');
    expect(library).toContain("state.sha !== remoteSha");
    expect(library).toContain('metadata.environment !== "dev"');
    expect(library).toContain('metadata.workerVersionTag !== `git-${sha}`');
    expect(release).toContain("assertCiPassed(state.sha)");
    expect(release).toContain("assertDevValidatedSha");
  });

  it("bumps only to a greater explicit Flutter build number", () => {
    expect(library).toContain("Number(buildNumber) <= Number(match[2])");
    expect(library).toContain("Build number must be greater");
    expect(release).toContain('case "testflight:bump"');
  });

  it("treats Dev web surfaces as Cloudflare Access protected", () => {
    expect(library).toContain('redirect: "manual"');
    expect(library).toContain("isAccessChallenge");
    expect(library).toContain('environment === "dev"');
    expect(library).toContain("WWW-Authenticate");
  });

  it("allows a bounded propagation window for deployment metadata", () => {
    expect(library).toContain("METADATA_SMOKE_ATTEMPTS");
    expect(library).toContain("METADATA_SMOKE_DELAY_MS");
    expect(library).toContain('setTimeout as delay } from "node:timers/promises"');
    expect(library).toContain("await delay(METADATA_SMOKE_DELAY_MS)");
    expect(library).toContain("Deployment metadata smoke failed.");
  });
});
