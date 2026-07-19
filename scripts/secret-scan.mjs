#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"]).toString("utf8").split("\0").filter(Boolean);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/]{40,}/u,
  /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{20,}\b/u,
  /(?:API_KEY|CLIENT_SECRET|PRIVATE_KEY)\s*[:=]\s*["'](?!test[-_]|your_|example)[A-Za-z0-9+/=_]{24,}["']/u,
];
const findings = [];
for (const file of files) {
  if (statSync(file).size > 2_000_000) continue;
  let source;
  try { source = readFileSync(file, "utf8"); } catch { continue; }
  if (patterns.some((pattern) => pattern.test(source))) findings.push(file);
}
if (findings.length > 0) {
  console.error(`Potential committed secrets detected in: ${findings.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("No potential committed secrets detected.");
}
