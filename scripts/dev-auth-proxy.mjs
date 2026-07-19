#!/usr/bin/env node
import { createServer } from "node:http";
import { isIP } from "node:net";
import { chmodSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const DEV_UPSTREAM = "https://dev.watchtower.damao.io";
const DEFAULT_TOKEN_FILE = ".wrangler/release/dev-access-token";
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const HOP_BY_HOP_HEADERS = new Set([
  "connection", "content-encoding", "content-length", "host", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
]);

export function isAllowedListenHost(value) {
  const host = value?.toLowerCase();
  if (host === "localhost") return true;
  const version = isIP(host ?? "");
  if (version === 4) {
    const octets = host.split(".").map(Number);
    return octets[0] === 127 || octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168);
  }
  if (version === 6) {
    return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || /^fe[89ab]/u.test(host);
  }
  return false;
}

function isLoopbackHost(value) {
  const host = value?.toLowerCase();
  return host === "localhost" || host === "::1" || host?.startsWith("127.");
}

export function parseProxyArgs(args) {
  const result = { host: "127.0.0.1", port: 0, tokenFile: resolve(DEFAULT_TOKEN_FILE), allowInsecureLan: false };
  for (let index = 0; index < args.length;) {
    const flag = args[index];
    if (flag === "--allow-insecure-lan") {
      result.allowInsecureLan = true;
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (!value || !["--host", "--port"].includes(flag)) {
      throw new Error("Usage: dev:auth-proxy -- [--host <private-ip> --allow-insecure-lan] [--port <port>]");
    }
    if (flag === "--host") result.host = value;
    if (flag === "--port") result.port = Number(value);
    index += 2;
  }
  if (!isAllowedListenHost(result.host)) throw new Error("Proxy host must be localhost, loopback, or an explicit private IP address.");
  if (!isLoopbackHost(result.host) && !result.allowInsecureLan) {
    throw new Error("Private-LAN token capture requires the explicit --allow-insecure-lan acknowledgement.");
  }
  if (!Number.isInteger(result.port) || result.port < 0 || result.port > 65_535) throw new Error("Proxy port must be an integer from 0 to 65535.");
  return result;
}

export function writeCapturedToken(path, token) {
  const value = token.trim();
  if (!value) throw new Error("Captured access token is empty.");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  const temporaryPath = `${path}.tmp`;
  try {
    writeFileSync(temporaryPath, `${value}\n`, { mode: 0o600, flag: "wx" });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
  } catch (error) {
    removeCapturedToken(temporaryPath);
    throw error;
  }
}

export function removeCapturedToken(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function upstreamHeaders(requestHeaders) {
  const headers = new Headers();
  for (const [name, raw] of Object.entries(requestHeaders)) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase()) || raw === undefined) continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) headers.append(name, value);
  }
  return headers;
}

export async function startDevAuthProxy(args = process.argv.slice(2)) {
  const options = parseProxyArgs(args);
  if (existsSync(options.tokenFile)) throw new Error(`Token file already exists; remove the stale file first: ${options.tokenFile}`);
  if (existsSync(`${options.tokenFile}.tmp`)) {
    throw new Error(`Temporary token file already exists; remove the stale file first: ${options.tokenFile}.tmp`);
  }
  let ownsTokenFile = false;
  let closing = false;
  let clientAddress = null;
  const server = createServer(async (request, response) => {
    try {
      const remoteAddress = request.socket.remoteAddress ?? "unknown";
      if (clientAddress && remoteAddress !== clientAddress) {
        response.statusCode = 403;
        response.end();
        return;
      }
      clientAddress ??= remoteAddress;
      const incoming = new URL(request.url ?? "/", "http://watchtower-proxy.invalid");
      const upstreamUrl = new URL(`${incoming.pathname}${incoming.search}`, DEV_UPSTREAM);
      const authorization = request.headers.authorization;
      const method = request.method ?? "GET";
      const init = {
        method,
        headers: upstreamHeaders(request.headers),
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      };
      if (method !== "GET" && method !== "HEAD") init.body = await requestBody(request);
      const upstream = await fetch(upstreamUrl, init);
      if (
        incoming.pathname === "/api/auth/me" && upstream.ok && !ownsTokenFile &&
        typeof authorization === "string" &&
        /^Bearer\s+\S+$/u.test(authorization)
      ) {
        writeCapturedToken(options.tokenFile, authorization.replace(/^Bearer\s+/u, ""));
        ownsTokenFile = true;
        console.log(JSON.stringify({ event: "dev_access_token_captured", tokenFile: options.tokenFile }));
      }
      response.statusCode = upstream.status;
      upstream.headers.forEach((value, name) => {
        if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) response.setHeader(name, value);
      });
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response);
      else response.end();
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.statusCode = error?.message === "REQUEST_TOO_LARGE" ? 413 : 502;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: { code: "DEV_AUTH_PROXY_FAILED" } }));
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 60_000;

  const cleanup = () => {
    if (closing) return;
    closing = true;
    if (ownsTokenFile) {
      removeCapturedToken(options.tokenFile);
      ownsTokenFile = false;
    }
    server.close();
    server.closeAllConnections?.();
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  process.once("exit", () => {
    if (ownsTokenFile) removeCapturedToken(options.tokenFile);
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port, options.host, resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to determine Dev auth proxy address.");
  const displayHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
  console.log(JSON.stringify({
    event: "dev_auth_proxy_ready",
    upstream: DEV_UPSTREAM,
    apiBaseUrl: `http://${displayHost}:${String(address.port)}`,
    tokenFile: options.tokenFile,
  }, null, 2));
  return { server, options: { ...options, port: address.port }, cleanup };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await startDevAuthProxy();
