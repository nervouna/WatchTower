import { createRemoteJWKSet, customFetch, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AuthUser { id: string }

export class AuthError extends Error {
  constructor(readonly kind: "unauthorized" | "unavailable") {
    super(kind);
  }
}

export interface AuthEnv {
  AUTH0_ISSUER: string;
  AUTH0_AUDIENCE: string;
  AUTH0_WEB_CLIENT_ID: string;
  AUTH0_MOBILE_DEV_CLIENT_ID: string;
  AUTH0_MOBILE_PROD_CLIENT_ID: string;
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function bearerToken(request: Request): string | null {
  const value = request.headers.get("Authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function authenticate(request: Request, env: AuthEnv): Promise<AuthUser> {
  const token = bearerToken(request);
  if (!token) throw new AuthError("unauthorized");
  const issuer = env.AUTH0_ISSUER;
  let jwksUrl: URL;
  try {
    jwksUrl = new URL(".well-known/jwks.json", issuer);
  } catch {
    throw new AuthError("unavailable");
  }
  let keySet = keySets.get(jwksUrl.href);
  if (!keySet) {
    keySet = createRemoteJWKSet(jwksUrl, {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      [customFetch]: async (url, options) => {
        const response = await fetch(url, options);
        if (!response.ok) throw new AuthError("unavailable");
        return response;
      },
    });
    keySets.set(jwksUrl.href, keySet);
  }
  return verifyAccessToken(token, env, keySet);
}

export async function verifyAccessToken(token: string, env: AuthEnv, keySet: JWTVerifyGetKey): Promise<AuthUser> {
  try {
    const { payload } = await jwtVerify(token, keySet, {
      algorithms: ["RS256"],
      issuer: env.AUTH0_ISSUER,
      audience: env.AUTH0_AUDIENCE,
      requiredClaims: ["sub", "iat", "exp", "azp"],
    });
    const clients = new Set<string>([env.AUTH0_WEB_CLIENT_ID, env.AUTH0_MOBILE_DEV_CLIENT_ID, env.AUTH0_MOBILE_PROD_CLIENT_ID]);
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.sub !== "string" || payload.sub.length === 0 || typeof payload.iat !== "number" || payload.iat > now + 60 || typeof payload.exp !== "number" || payload.exp <= payload.iat || typeof payload.azp !== "string" || !clients.has(payload.azp)) {
      throw new AuthError("unauthorized");
    }
    return { id: payload.sub };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid || error instanceof TypeError) throw new AuthError("unavailable");
    if (error instanceof errors.JOSEError) throw new AuthError("unauthorized");
    throw new AuthError("unavailable");
  }
}
