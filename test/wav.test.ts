import { describe, expect, it } from "vitest";

import { addAigcMetadata, parseWav } from "../src/audio/wav";

function pcmWav(durationSeconds = 180): Uint8Array {
  const sampleRate = 8_000;
  const dataLength = sampleRate * durationSeconds * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index);
  };
  ascii(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); ascii(8, "WAVE");
  ascii(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, dataLength, true);
  return bytes;
}

describe("WAV validation and AIGC metadata", () => {
  it("parses PCM duration from RIFF parameters", () => {
    expect(parseWav(pcmWav()).durationSeconds).toBe(180);
  });

  it("inserts exactly one AIGC chunk without changing PCM and replaces it idempotently", async () => {
    const original = pcmWav();
    const first = await addAigcMetadata(original, "content-id");
    const second = await addAigcMetadata(first, "content-id");
    expect(second).toEqual(first);
    const parsed = parseWav(second);
    expect(parsed.chunks.filter((chunk) => chunk.id === "AIGC")).toHaveLength(1);
    expect(new Uint8Array(second.buffer, parsed.dataOffset, parsed.dataLength)).toEqual(original.slice(44));
    expect(new DataView(second.buffer, second.byteOffset, second.byteLength).getUint32(4, true)).toBe(second.length - 8);
    expect(new TextDecoder().decode(second)).toContain("XiaomiMiMo");
  }, 15_000);

  it("rejects corrupt or non-PCM WAV files", () => {
    expect(() => parseWav(new Uint8Array(44))).toThrow("WAV_INVALID_RIFF");
    const wav = pcmWav();
    new DataView(wav.buffer).setUint16(20, 3, true);
    expect(() => parseWav(wav)).toThrow("WAV_UNSUPPORTED_FORMAT");
  });
});
