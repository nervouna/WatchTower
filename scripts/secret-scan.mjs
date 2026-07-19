#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BASE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/]{40,}/u,
  /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{20,}\b/u,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{16,}\b/u,
  /(?:API_KEY|CLIENT_SECRET|PRIVATE_KEY)\s*[:=]\s*["'](?!test[-_]|your_|example)[A-Za-z0-9+/=_]{24,}["']/u,
];

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }

export function requiredSecretNames(config) {
  return [...new Set([
    ...(config?.secrets?.required ?? []),
    ...Object.values(config?.env ?? {}).flatMap((environment) => environment?.secrets?.required ?? []),
  ].filter((name) => typeof name === "string" && /^[A-Z][A-Z0-9_]+$/u.test(name)))];
}

export function containsPotentialSecret(source, secretNames) {
  if (BASE_PATTERNS.some((pattern) => pattern.test(source))) return true;
  if (secretNames.length === 0) return false;
  const names = secretNames.map(escapeRegExp).join("|");
  const assignment = new RegExp(
    `(?:^|[\\s,{])["']?(?:${names})["']?[ \\t]*[:=][ \\t]*` +
    `(?!["']?(?:test[-_]|your_|example|placeholder))` +
    `(?:"[^"\\r\\n]{16,}"|'[^'\\r\\n]{16,}'|[A-Za-z0-9+/=_-]{16,})`,
    "mu",
  );
  return assignment.test(source);
}

function main() {
  const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
  const secretNames = requiredSecretNames(config);
  const files = execFileSync("git", [
    "ls-files", "--cached", "--others", "--exclude-standard", "-z",
  ]).toString("utf8").split("\0").filter(Boolean);
  const findings = [];
  for (const file of files) {
    if (statSync(file).size > 2_000_000) continue;
    let source;
    try { source = readFileSync(file, "utf8"); } catch { continue; }
    if (containsPotentialSecret(source, secretNames)) findings.push(file);
  }
  if (findings.length > 0) {
    console.error(`Potential secrets detected in commit candidates: ${findings.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("No potential secrets detected in commit candidates.");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
