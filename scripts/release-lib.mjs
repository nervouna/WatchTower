import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

export const TARGETS = {
  dev: { domain: "dev.watchtower.damao.io", worker: "watchtower-daily-brief-dev", database: "watchtower-daily-brief-dev-db", wranglerEnv: "dev" },
  production: { domain: "watchtower.damao.io", worker: "watchtower-daily-brief", database: "watchtower-daily-brief-db", wranglerEnv: "" },
};

const METADATA_SMOKE_ATTEMPTS = 10;
const METADATA_SMOKE_DELAY_MS = 3_000;

export function run(command, args, options = {}) {
  const usesWrangler = args.some((value) => value === "wrangler");
  const env = options.env ?? (usesWrangler ? { ...process.env, WRANGLER_LOG_PATH: "/tmp/watchtower-wrangler-release.log" } : process.env);
  const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8", stdio: options.capture ? "pipe" : "inherit", env });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${String(result.status)}`);
  return result.stdout?.trim() ?? "";
}

export function git(args) { return execFileSync("git", args, { encoding: "utf8" }).trim(); }

export function repositoryState() {
  return { branch: git(["branch", "--show-current"]), sha: git(["rev-parse", "HEAD"]), status: git(["status", "--porcelain"]) };
}

export function assertClean(state) {
  if (state.status !== "") throw new Error("Release requires a clean working tree.");
}

export function assertProductionBaseline(state, remoteSha) {
  assertClean(state);
  if (state.branch !== "main") throw new Error("Production and TestFlight releases require branch main.");
  if (state.sha !== remoteSha) throw new Error("Local main must exactly match origin/main.");
}

export function assertDevValidatedSha(metadata, sha) {
  if (metadata.environment !== "dev" || metadata.workerVersionTag !== `git-${sha}`) {
    throw new Error("Dev metadata does not match the production candidate SHA.");
  }
}

export function printTarget(environment, state) {
  const target = TARGETS[environment];
  console.log(JSON.stringify({ environment, domain: target.domain, database: target.database, worker: target.worker, branch: state.branch, gitSha: state.sha }, null, 2));
}

export async function confirmMutation(expected) {
  if (process.env.WATCHTOWER_RELEASE_CONFIRM === expected) return;
  const terminal = createInterface({ input: stdin, output: stdout });
  const answer = await terminal.question(`Type ${expected} to continue: `);
  terminal.close();
  if (answer !== expected) throw new Error("Confirmation did not match; no remote mutation was performed.");
}

export async function fetchJson(url, init) {
  const response = await fetch(url, { ...init, headers: { Accept: "application/json", ...init?.headers }, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP_${String(response.status)}:${JSON.stringify(body)}`);
  return body;
}

export function assertCiPassed(sha) {
  const raw = run("gh", ["run", "list", "--commit", sha, "--limit", "20", "--json", "workflowName,conclusion"], { capture: true });
  const runs = JSON.parse(raw);
  const ci = runs.find((item) => item.workflowName === "CI");
  if (!ci || ci.conclusion !== "success") throw new Error(`CI has not passed for ${sha}.`);
}

export function isAccessChallenge(response) {
  const authentication = response.headers.get("WWW-Authenticate") ?? "";
  const location = response.headers.get("Location") ?? "";
  return response.status === 302 && (
    authentication.includes("Cloudflare-Access") ||
    location.includes(".cloudflareaccess.com/cdn-cgi/access/login/")
  );
}

async function assertAccessProtected(url, label) {
  const response = await fetch(url, { cache: "no-store", redirect: "manual" });
  if (!isAccessChallenge(response)) throw new Error(`DEV_ACCESS_SMOKE_FAILED:${label}`);
}

async function waitForMetadata(base, environment, sha) {
  for (let attempt = 1; attempt <= METADATA_SMOKE_ATTEMPTS; attempt += 1) {
    try {
      const metadata = await fetchJson(`${base}/api/meta?sha=${sha}&attempt=${String(attempt)}`);
      if (metadata.environment === environment && metadata.workerVersionTag === `git-${sha}`) return metadata;
    } catch {
      // A newly deployed custom domain can briefly continue serving the previous Worker version.
    }
    if (attempt < METADATA_SMOKE_ATTEMPTS) {
      await delay(METADATA_SMOKE_DELAY_MS);
    }
  }
  throw new Error("Deployment metadata smoke failed.");
}

export async function smoke(environment, sha) {
  const target = TARGETS[environment];
  const base = `https://${target.domain}`;
  const meta = await waitForMetadata(base, environment, sha);
  await Promise.all([
    fetchJson(`${base}/api/briefs/latest?sha=${sha}`),
    fetchJson(`${base}/api/briefs?limit=1&sha=${sha}`),
    fetchJson(`${base}/api/auth/config?sha=${sha}`),
  ]);
  if (environment === "dev") {
    await Promise.all([
      assertAccessProtected(`${base}/?sha=${sha}`, "home"),
      assertAccessProtected(`${base}/archive?sha=${sha}`, "archive"),
      assertAccessProtected(`${base}/app.js?sha=${sha}`, "app.js"),
      assertAccessProtected(`${base}/styles.css?sha=${sha}`, "styles.css"),
    ]);
    return meta;
  }
  await Promise.all([
    fetch(`${base}/?sha=${sha}`, { cache: "no-store" }).then((response) => { if (!response.ok) throw new Error("HOME_SMOKE_FAILED"); }),
    fetch(`${base}/archive?sha=${sha}`, { cache: "no-store" }).then((response) => { if (!response.ok) throw new Error("ARCHIVE_SMOKE_FAILED"); }),
  ]);
  for (const asset of ["app.js", "styles.css"]) {
    const response = await fetch(`${base}/${asset}?sha=${sha}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`ASSET_SMOKE_FAILED:${asset}`);
    const remoteHash = createHash("sha256").update(new Uint8Array(await response.arrayBuffer())).digest("hex");
    if (remoteHash !== sha256(`public/${asset}`)) throw new Error(`ASSET_HASH_MISMATCH:${asset}`);
  }
  return meta;
}

export function wranglerArgs(environment) {
  return environment === "dev" ? ["--env", "dev"] : ["--env="];
}

export function deploy(environment, sha) {
  const target = TARGETS[environment];
  run("npm", ["exec", "--", "wrangler", "deploy", ...wranglerArgs(environment), "--strict", "--tag", `git-${sha}`, "--message", `${environment} ${sha}`]);
  return target;
}

export function migrate(environment) {
  const target = TARGETS[environment];
  run("npm", ["exec", "--", "wrangler", "d1", "migrations", "apply", target.database, ...wranglerArgs(environment), "--remote"]);
}

export function savePreviousProductionVersion() {
  const raw = run("npm", ["exec", "--", "wrangler", "versions", "list", "--env=", "--json"], { capture: true });
  const versions = JSON.parse(raw);
  const id = versions[0]?.id;
  if (!id) throw new Error("Unable to determine the previous production Worker version.");
  mkdirSync(".wrangler/release", { recursive: true });
  writeFileSync(".wrangler/release/production-previous-version", `${id}\n`, { mode: 0o600 });
  return id;
}

export function bumpBuildNumber(path, buildNumber) {
  if (!/^\d+$/u.test(String(buildNumber)) || Number(buildNumber) < 1) throw new Error("Build number must be a positive integer.");
  const source = readFileSync(path, "utf8");
  const match = /^version:\s*([^+\s]+)\+(\d+)$/mu.exec(source);
  if (!match) throw new Error("Unable to read Flutter version from pubspec.yaml.");
  if (Number(buildNumber) <= Number(match[2])) throw new Error("Build number must be greater than the repository build number.");
  writeFileSync(path, source.replace(match[0], `version: ${match[1]}+${String(buildNumber)}`));
  return { version: match[1], previousBuild: Number(match[2]), build: Number(buildNumber) };
}

export function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
