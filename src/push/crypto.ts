const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function secretBytes(value: string, name: string): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(value);
  } catch {
    throw new Error(`${name}_INVALID`);
  }
  if (bytes.length !== 32) throw new Error(`${name}_INVALID`);
  return bytes;
}

export async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes(secret, "PUSH_TOKEN_HMAC_KEY"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function encryptToken(secret: string, token: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await crypto.subtle.importKey("raw", secretBytes(secret, "PUSH_TOKEN_ENCRYPTION_KEY"), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(token));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

export async function decryptToken(secret: string, ciphertext: string, iv: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secretBytes(secret, "PUSH_TOKEN_ENCRYPTION_KEY"), "AES-GCM", false, ["decrypt"]);
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(iv) },
      key,
      base64ToBytes(ciphertext),
    );
    return decoder.decode(decrypted);
  } catch {
    throw new Error("PUSH_TOKEN_DECRYPT_FAILED");
  }
}

export async function stablePushId(prefix: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hash.slice(0, 32)}`;
}
