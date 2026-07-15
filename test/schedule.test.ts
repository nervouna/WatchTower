import { describe, expect, it } from "vitest";

import { resolveScheduledRun } from "../src/domain/schedule";

describe("resolveScheduledRun", () => {
  const previousDay = Date.UTC(2026, 6, 15, 23, 30);

  it.each([
    ["0 21 * * *", Date.UTC(2026, 6, 15, 21), "collect", "2026-07-16"],
    ["30 22 * * *", Date.UTC(2026, 6, 15, 22, 30), "draft", "2026-07-16"],
    ["30 23 * * *", previousDay, "final", "2026-07-16"],
    ["30 0 * * *", Date.UTC(2026, 6, 16, 0, 30), "recovery", "2026-07-16"],
  ] as const)("maps %s to %s for %s", (cron, scheduledTime, stage, targetDate) => {
    expect(resolveScheduledRun(cron, scheduledTime)).toEqual({ stage, targetDate });
  });

  it("rejects unknown cron expressions", () => {
    expect(() => resolveScheduledRun("* * * * *", previousDay)).toThrow("UNSUPPORTED_CRON");
  });
});
