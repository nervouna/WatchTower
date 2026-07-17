import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { verifyAccessToken } from "../src/auth/auth0";

const authEnv = {
  AUTH0_ISSUER: "https://auth.watchtower.damao.io/",
  AUTH0_AUDIENCE: "https://watchtower.damao.io/api",
  AUTH0_WEB_CLIENT_ID: "web",
  AUTH0_MOBILE_DEV_CLIENT_ID: "dev",
  AUTH0_MOBILE_PROD_CLIENT_ID: "prod",
};

let privateKey: CryptoKey;
let keySet: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  keySet = createLocalJWKSet({ keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }] });
});

async function token(overrides: Record<string, unknown> = {}, secret = privateKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: "https://auth.watchtower.damao.io/",
    aud: "https://watchtower.damao.io/api",
    sub: "apple|user-1",
    iat: now,
    exp: now + 300,
    azp: "web",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .sign(secret);
}

describe("Auth0 access token verification", () => {
  it("accepts a signed token from a configured client", async () => {
    await expect(verifyAccessToken(await token(), authEnv, keySet)).resolves.toEqual({ id: "apple|user-1" });
  });

  it.each([
    ["issuer", { iss: "https://evil.invalid/" }],
    ["audience", { aud: "https://evil.invalid/api" }],
    ["authorized party", { azp: "unknown" }],
    ["subject", { sub: "" }],
    ["missing subject", { sub: undefined }],
    ["missing issued-at", { iat: undefined }],
    ["future issued-at", { iat: Math.floor(Date.now() / 1000) + 3600 }],
    ["expiry", { exp: 1 }],
  ])("rejects an invalid %s", async (_label, overrides) => {
    await expect(verifyAccessToken(await token(overrides), authEnv, keySet)).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("rejects a bad signature", async () => {
    const other = await generateKeyPair("RS256");
    await expect(verifyAccessToken(await token({}, other.privateKey), authEnv, keySet)).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("distinguishes an unavailable JWKS upstream from invalid credentials", async () => {
    await expect(verifyAccessToken(await token(), authEnv, async () => { throw new TypeError("network unavailable"); })).rejects.toMatchObject({ kind: "unavailable" });
  });
});
