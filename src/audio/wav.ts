const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface WavChunk { id: string; offset: number; dataOffset: number; length: number; totalLength: number }
export interface ParsedWav {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  durationSeconds: number;
  dataOffset: number;
  dataLength: number;
  chunks: WavChunk[];
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return decoder.decode(bytes.subarray(offset, offset + length));
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  bytes.set(encoder.encode(value), offset);
}

export function parseWav(bytes: Uint8Array): ParsedWav {
  if (bytes.length < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") throw new Error("WAV_INVALID_RIFF");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error("WAV_INVALID_LENGTH");
  const chunks: WavChunk[] = [];
  let cursor = 12;
  while (cursor + 8 <= bytes.length) {
    const id = ascii(bytes, cursor, 4);
    const length = view.getUint32(cursor + 4, true);
    const totalLength = 8 + length + (length % 2);
    if (cursor + totalLength > bytes.length) throw new Error("WAV_INVALID_CHUNK");
    chunks.push({ id, offset: cursor, dataOffset: cursor + 8, length, totalLength });
    cursor += totalLength;
  }
  if (cursor !== bytes.length) throw new Error("WAV_INVALID_CHUNK");
  const format = chunks.find((chunk) => chunk.id === "fmt ");
  const data = chunks.find((chunk) => chunk.id === "data");
  if (!format || format.length < 16) throw new Error("WAV_MISSING_FORMAT");
  if (!data || data.length === 0) throw new Error("WAV_MISSING_DATA");
  const audioFormat = view.getUint16(format.dataOffset, true);
  const channels = view.getUint16(format.dataOffset + 2, true);
  const sampleRate = view.getUint32(format.dataOffset + 4, true);
  const byteRate = view.getUint32(format.dataOffset + 8, true);
  const bitsPerSample = view.getUint16(format.dataOffset + 14, true);
  if (audioFormat !== 1 || channels < 1 || channels > 2 || sampleRate < 8_000 || sampleRate > 192_000 || ![8, 16, 24, 32].includes(bitsPerSample)) throw new Error("WAV_UNSUPPORTED_FORMAT");
  const expectedByteRate = sampleRate * channels * (bitsPerSample / 8);
  if (byteRate !== expectedByteRate) throw new Error("WAV_INVALID_FORMAT");
  return { channels, sampleRate, bitsPerSample, durationSeconds: data.length / byteRate, dataOffset: data.dataOffset, dataLength: data.length, chunks };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function addAigcMetadata(input: Uint8Array, contentId: string): Promise<Uint8Array> {
  const parsed = parseWav(input);
  const retained = parsed.chunks.filter((chunk) => chunk.id !== "AIGC");
  const replacing = retained.length !== parsed.chunks.length;
  let base = input;
  if (replacing) {
    const cleanLength = 12 + retained.reduce((sum, chunk) => sum + chunk.totalLength, 0);
    base = new Uint8Array(cleanLength);
    writeAscii(base, 0, "RIFF");
    new DataView(base.buffer).setUint32(4, cleanLength - 8, true);
    writeAscii(base, 8, "WAVE");
    let baseCursor = 12;
    for (const chunk of retained) {
      base.set(input.subarray(chunk.offset, chunk.offset + chunk.totalLength), baseCursor);
      baseCursor += chunk.totalLength;
    }
  }
  const integrity = await sha256(base);
  const payload = encoder.encode(JSON.stringify({
    Label: "1",
    ContentProducer: "XiaomiMiMo",
    ProduceID: contentId,
    ReservedCode1: integrity,
    ContentPropagator: "WatchTower",
    PropagateID: `watchtower:${contentId}`,
    ReservedCode2: integrity,
  }));
  const chunkLength = 8 + payload.length + (payload.length % 2);
  const outputLength = base.length + chunkLength;
  const output = new Uint8Array(outputLength);
  output.set(base);
  new DataView(output.buffer).setUint32(4, outputLength - 8, true);
  const cursor = base.length;
  writeAscii(output, cursor, "AIGC");
  new DataView(output.buffer).setUint32(cursor + 4, payload.length, true);
  output.set(payload, cursor + 8);
  parseWav(output);
  return output;
}
