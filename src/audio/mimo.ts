import { fetchJsonWithRetry, type RetryOptions } from "../ingestion/http-client";
import { addAigcMetadata, parseWav } from "./wav";

const MIMO_ENDPOINT = "https://api.xiaomimimo.com/v1/chat/completions";
const MAX_WAV_BYTES = 16 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_WAV_BYTES / 3) * 4 + 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeAudio(value: unknown): Uint8Array {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0]) || !isRecord(value.choices[0].message) || !isRecord(value.choices[0].message.audio) || typeof value.choices[0].message.audio.data !== "string") {
    throw new Error("MIMO_MISSING_AUDIO");
  }
  const data = value.choices[0].message.audio.data;
  if (data.length === 0 || data.length > MAX_BASE64_LENGTH || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(data)) throw new Error("MIMO_INVALID_BASE64");
  let binary: string;
  try { binary = atob(data); } catch { throw new Error("MIMO_INVALID_BASE64"); }
  if (binary.length === 0 || binary.length > MAX_WAV_BYTES) throw new Error("MIMO_AUDIO_TOO_LARGE");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function audioDurationRange(itemCount: number): { minimum: number; maximum: number } {
  switch (itemCount) {
    case 1: return { minimum: 20, maximum: 75 };
    case 2: return { minimum: 40, maximum: 105 };
    case 3: return { minimum: 60, maximum: 135 };
    case 4: return { minimum: 80, maximum: 165 };
    case 5: return { minimum: 120, maximum: 225 };
    default: return { minimum: 135, maximum: 225 };
  }
}

export async function synthesizeSpeech(apiKey: string, transcript: string, contentId: string, itemCount: number, options: RetryOptions = {}): Promise<{ wav: Uint8Array; durationSeconds: number }> {
  const response = await fetchJsonWithRetry<unknown>(MIMO_ENDPOINT, {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "mimo-v2.5-tts",
      messages: [
        { role: "user", content: "请用冷静、清晰、亲切的科技播客风格朗读。比普通科技播客语速放慢约两成，节奏舒展但不拖沓，句间和条目间保留清楚的自然停顿。避免夸张情绪和传统播音腔。严格逐字朗读，不要改写、增删或解释。" },
        { role: "assistant", content: transcript },
      ],
      audio: { format: "wav", voice: "冰糖" },
      stream: false,
    }),
  }, { ...options, timeoutMs: 8 * 60_000, maxAttempts: 1 });
  const raw = decodeAudio(response.data);
  const parsed = parseWav(raw);
  const range = audioDurationRange(itemCount);
  if (parsed.durationSeconds < range.minimum || parsed.durationSeconds > range.maximum) throw new Error("MIMO_DURATION_OUT_OF_RANGE");
  const wav = await addAigcMetadata(raw, contentId);
  if (wav.length > MAX_WAV_BYTES) throw new Error("MIMO_AUDIO_TOO_LARGE");
  return { wav, durationSeconds: parsed.durationSeconds };
}
