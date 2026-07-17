import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { generateCoverImage } from "../src/cover/fal";

describe.skipIf(env.RUN_COVER_E2E !== "true")("live cover provider", () => {
  it("generates and downloads one valid Recraft V3 square cover", async () => {
    const result = await generateCoverImage(
      env.FAL_API_KEY,
      "A square editorial technology podcast cover with one abstract radar focal point, cool neutral surfaces, Radar Cyan as the only accent, generous negative space, and no words, letters, numbers, logos, or watermarks.",
    );
    expect(["image/jpeg", "image/png", "image/webp"]).toContain(result.contentType);
    expect(result.bytes.byteLength).toBeGreaterThan(1_000);
  }, 9 * 60 * 1000);
});
