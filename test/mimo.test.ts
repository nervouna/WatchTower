import { describe, expect, it, vi } from "vitest";

import { audioDurationRange, synthesizeSpeech } from "../src/audio/mimo";

function wavBase64(durationSeconds = 180): string {
  const sampleRate = 8_000;
  const dataLength = sampleRate * durationSeconds * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  ascii(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, dataLength, true);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return btoa(binary);
}

describe("MiMo speech synthesis", () => {
  it("uses server authentication, the TTS model, Bing Tang voice, and exact transcript", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { audio: { data: wavBase64() } } }] }));
    const result = await synthesizeSpeech("secret", "精确逐字稿", "content-id", 6, { fetcher });
    expect(result.durationSeconds).toBe(180);
    const init = fetcher.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("api-key")).toBe("secret");
    const body = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ role: string; content: string }>; audio: { format: string; voice: string } };
    expect(body).toMatchObject({ model: "mimo-v2.5-tts", audio: { format: "wav", voice: "冰糖" } });
    expect(body.messages.at(-1)).toEqual({ role: "assistant", content: "精确逐字稿" });
  });

  it.each([
    ["missing audio", { choices: [{ message: {} }] }, "MIMO_MISSING_AUDIO"],
    ["invalid base64", { choices: [{ message: { audio: { data: "%%%=" } } }] }, "MIMO_INVALID_BASE64"],
  ])("rejects %s", async (_name, response, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    await expect(synthesizeSpeech("secret", "逐字稿", "id", 6, { fetcher })).rejects.toThrow(code);
  });

  it.each([
    [1, 20, 75],
    [2, 40, 105],
    [3, 60, 135],
    [4, 80, 165],
    [5, 135, 225],
    [7, 135, 225],
  ])("uses the %i-item duration profile", (itemCount, minimum, maximum) => {
    expect(audioDurationRange(itemCount)).toEqual({ minimum, maximum });
  });

  it("rejects audio outside the matching item-count duration", async () => {
    const tooShort = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { audio: { data: wavBase64(19) } } }] }));
    await expect(synthesizeSpeech("secret", "逐字稿", "id", 1, { fetcher: tooShort })).rejects.toThrow("MIMO_DURATION_OUT_OF_RANGE");
    const tooLong = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { audio: { data: wavBase64(76) } } }] }));
    await expect(synthesizeSpeech("secret", "逐字稿", "id", 1, { fetcher: tooLong })).rejects.toThrow("MIMO_DURATION_OUT_OF_RANGE");
  });

  it.each([
    ["server failure", vi.fn<typeof fetch>().mockResolvedValue(new Response("unavailable", { status: 503 })), "HTTP_503"],
    ["network failure", vi.fn<typeof fetch>().mockRejectedValue(new Error("network")), "NETWORK_ERROR"],
  ])("leaves %s retries to the queue", async (_name, fetcher, code) => {
    await expect(synthesizeSpeech("secret", "逐字稿", "id", 1, { fetcher, sleep: async () => undefined, maxAttempts: 3 }))
      .rejects.toMatchObject({ code, attempts: 1 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("uses one eight-minute provider attempt for timeouts", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        }, { once: true });
      }));
      const result = synthesizeSpeech("secret", "逐字稿", "id", 1, { fetcher, maxAttempts: 3 });
      const rejected = expect(result).rejects.toMatchObject({ code: "TIMEOUT", attempts: 1 });
      await vi.advanceTimersByTimeAsync(8 * 60_000);
      await rejected;
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
