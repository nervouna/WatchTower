import { describe, expect, it } from "vitest";
import contract from "../contracts/openapi/watchtower-v1.yaml?raw";

function between(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`OPENAPI_SECTION_NOT_FOUND:${start}`);
  return value.slice(startIndex, endIndex);
}

describe("checked-in OpenAPI contract", () => {
  it("documents Auth0 security, account APIs, allowlist failures, and audio retry", () => {
    expect(contract).toContain("auth0:");
    for (const path of ["/api/auth/config", "/api/auth/me", "/api/auth/account", "/api/feedback", "/api/feedback/{entityId}", "/api/briefs/{date}/audio/retry", "/api/briefs/{date}/regeneration"]) {
      expect(contract).toContain(`  ${path}:`);
    }
    for (const status of ["'401'", "'403'", "'502'", "'503'"]) expect(contract).toContain(status);
    expect(contract).toContain("const: no-store");
  });

  it("documents allowlisted evidence-only brief regeneration without publication push", () => {
    expect(contract).toContain("version: 1.3.0");
    const path = between(contract, "  /api/briefs/{date}/regeneration:\n", "  /api/mobile/v1/push-subscriptions:\n");
    expect(path).toContain("operationId: getBriefRegeneration");
    expect(path).toContain("operationId: regenerateBrief");
    expect(path).toContain("already stored for this date");
    expect(path).toContain("never re-runs Tavily");
    expect(path).toContain("never sends a publication push");
    for (const status of ["'202'", "'400'", "'401'", "'403'", "'404'", "'409'", "'503'"]) expect(path).toContain(status);
    expect(contract).toContain("briefRegenerate:");
    expect(contract).toContain("BriefRegeneration:");
  });

  it("documents the optional generated podcast cover and image endpoint", () => {
    expect(contract).toContain("/api/briefs/{date}/cover:");
    expect(contract).toContain("/api/briefs/{date}/cover/retry:");
    const schema = between(contract, "    BriefCover:\n", "    BriefAudio:\n");
    expect(schema).toContain("pending");
    expect(schema).toContain("failed");
    expect(schema).toContain("ready");
    expect(schema).toContain("fal-ai/recraft/v3/text-to-image");
    expect(between(contract, "    BriefAudio:\n", "    Brief:\n")).toContain("cover:");
  });

  it("retains the exploration resource and optional brief feature switch", () => {
    expect(contract).toContain("version: 1.3.0");
    expect(contract).toContain("/api/explorations/{briefDate}/{entityId}:");
    expect(contract).toContain("operationId: triggerItemExploration");
    expect(contract).toContain("ExplorationSections:");
    const brief = between(contract, "    Brief:\n", "    BriefSummary:\n");
    expect(brief).toContain("features:");
    expect(brief).toContain("exploration:");
  });

  it("documents the runtime push subscription app and environment contract", () => {
    const schema = between(contract, "    PushSubscription:\n", "    ApiError:\n");
    expect(schema).toMatch(/required: \[[^\]]*appId[^\]]*\]/u);
    expect(schema).toContain("appId:");
    expect(schema).toContain("io.damao.watchtower.dev");
    expect(schema).toContain("io.damao.watchtower");
    expect(schema).toContain("sandbox");
    expect(schema).toContain("production");
  });

  it("distinguishes a newly accepted Dev pipeline attempt from an idempotent response", () => {
    expect(contract).toContain("acceptedNewAttempt:");
    expect(contract).toContain("true only when this request created or re-queued an attempt");
  });

  it.each(["put", "delete"])("documents %s push errors and no-store responses", (method) => {
    const path = between(contract, "  /api/mobile/v1/push-subscriptions:\n", "components:\n");
    const end = method === "put" ? "    delete:\n" : "components:\n";
    const operation = method === "put" ? between(path, "    put:\n", end) : path.slice(path.indexOf("    delete:\n"));
    for (const status of ["204", "400", "413", "415", "429"]) expect(operation).toContain(`'${status}'`);
    expect(operation).toContain("#/components/responses/MobilePushNoContent");
    expect(operation).toContain("#/components/responses/MobilePushError");
    expect(operation).toContain("#/components/responses/MobilePushRateLimited");
  });

  it("documents no-store and retry headers for push responses", () => {
    const responses = between(contract, "  responses:\n", "  schemas:\n");
    expect(responses).toContain("MobilePushNoContent:");
    expect(responses).toContain("MobilePushError:");
    expect(responses).toContain("MobilePushRateLimited:");
    expect(responses).toContain("Cache-Control:");
    expect(responses).toContain("Retry-After:");
  });
});
