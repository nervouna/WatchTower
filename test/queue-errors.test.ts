import { describe, expect, it } from "vitest";

import { CoverProcessingError } from "../src/cover/jobs";
import { ExplorationProcessingError } from "../src/exploration/jobs";
import { isTerminalQueueFailure } from "../src/index";

describe("queue failure classification", () => {
  it("terminates non-retryable cover failures on the first delivery", () => {
    expect(isTerminalQueueFailure(new CoverProcessingError("FAL_PROMPT_TOO_LONG", false), 1)).toBe(true);
  });

  it("retries transient cover failures before the third delivery", () => {
    expect(isTerminalQueueFailure(new CoverProcessingError("FAL_SUBMIT_FAILED_HTTP_500", true), 1)).toBe(false);
  });

  it("preserves exploration terminal failures and the global third-attempt limit", () => {
    expect(isTerminalQueueFailure(new ExplorationProcessingError("EXPLORATION_TARGET_NOT_FOUND", false), 1)).toBe(true);
    expect(isTerminalQueueFailure(new Error("NETWORK_ERROR"), 3)).toBe(true);
  });
});
