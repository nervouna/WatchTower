import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { generateNarration, narrationTranscript, validateNarration } from "../src/audio/narration";
import { synthesizeSpeech } from "../src/audio/mimo";
import { parseWav } from "../src/audio/wav";
import type { BriefPayload } from "../src/domain/types";

describe.skipIf(env.RUN_AUDIO_E2E !== "true")("live audio providers", () => {
  it("generates and validates the latest public brief end to end", async () => {
    const response = await fetch("https://watchtower.damao.io/api/briefs/latest");
    expect(response.ok).toBe(true);
    const brief = await response.json<BriefPayload>();
    let script;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        script = await generateNarration(env.DEEPSEEK_API_KEY, brief);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!script) throw lastError;
    expect(validateNarration(script, brief).ok).toBe(true);
    const transcript = narrationTranscript(script);
    const result = await synthesizeSpeech(env.MIMO_API_KEY, transcript, `local-e2e-${brief.date}`, script.items.length);
    const wav = parseWav(result.wav);
    expect(wav.durationSeconds).toBeGreaterThanOrEqual(150);
    expect(wav.durationSeconds).toBeLessThanOrEqual(210);
    expect(wav.chunks.filter((chunk) => chunk.id === "AIGC")).toHaveLength(1);
  }, 15 * 60_000);
});
