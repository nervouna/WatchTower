#!/usr/bin/env node
import { existsSync } from "node:fs";
import {
  TARGETS, assertCiPassed, assertClean, assertDevValidatedSha, assertProductionBaseline,
  bumpBuildNumber, confirmMutation, deploy, fetchJson, git, migrate, printTarget,
  repositoryState, run, savePreviousProductionVersion, smoke,
} from "./release-lib.mjs";

const [command, ...args] = process.argv.slice(2);

async function baseline(environment) {
  const state = repositoryState();
  assertClean(state);
  if (environment === "production") {
    git(["fetch", "origin", "main"]);
    assertProductionBaseline(state, git(["rev-parse", "origin/main"]));
    assertDevValidatedSha(await fetchJson(`https://${TARGETS.dev.domain}/api/meta?candidate=${state.sha}`), state.sha);
  }
  assertCiPassed(state.sha);
  printTarget(environment, state);
  return state;
}

async function release(environment) {
  const state = await baseline(environment);
  if (environment === "dev") {
    const current = await fetchJson(`https://${TARGETS.dev.domain}/api/meta`).catch(() => null);
    if (current && current.workerVersionTag !== `git-${state.sha}`) console.log(`Shared Dev currently runs ${current.workerVersionTag}.`);
  } else {
    const previous = savePreviousProductionVersion();
    console.log(`Rollback version: ${previous}`);
  }
  await confirmMutation(`${environment} ${state.sha}`);
  migrate(environment);
  deploy(environment, state.sha);
  try {
    await smoke(environment, state.sha);
  } catch (error) {
    if (environment === "production") {
      const previous = (await import("node:fs")).readFileSync(".wrangler/release/production-previous-version", "utf8").trim();
      console.error(`Production smoke failed; rolling Worker back to ${previous}. D1 migrations are not rolled back.`);
      run("npm", ["exec", "--", "wrangler", "rollback", previous, "--env=", "--message", `automatic smoke rollback from ${state.sha}`]);
    }
    throw error;
  }
}

async function e2eDev(stage, targetDate) {
  if (!["collect", "draft", "final", "recovery"].includes(stage) || !/^\d{4}-\d{2}-\d{2}$/u.test(targetDate ?? "")) throw new Error("Usage: e2e:dev -- <stage> <YYYY-MM-DD>");
  const token = process.env.WATCHTOWER_DEV_ACCESS_TOKEN;
  if (!token) throw new Error("WATCHTOWER_DEV_ACCESS_TOKEN is required and is never printed.");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  let runState = await fetchJson(`https://${TARGETS.dev.domain}/api/dev/pipeline-runs`, { method: "POST", headers, body: JSON.stringify({ stage, targetDate }) });
  while (runState.status === "queued" || runState.status === "processing") {
    await new Promise((resolve) => globalThis.setTimeout(resolve, Math.min(10, runState.pollAfterSeconds ?? 3) * 1000));
    runState = await fetchJson(`https://${TARGETS.dev.domain}/api/dev/pipeline-runs/${runState.runId}`, { headers });
  }
  console.log(JSON.stringify({ runId: runState.runId, status: runState.status, errorCode: runState.errorCode ?? null }));
  if (runState.status !== "succeeded") throw new Error("Dev E2E pipeline failed.");
  if (stage === "final" || stage === "recovery") {
    const deadline = Date.now() + 10 * 60 * 1000;
    let ready = false;
    while (!ready && Date.now() < deadline) {
      const responses = await Promise.all([
        fetch(`https://${TARGETS.dev.domain}/api/briefs/${targetDate}/audio`, { method: "HEAD", cache: "no-store" }),
        fetch(`https://${TARGETS.dev.domain}/api/briefs/${targetDate}/cover`, { method: "HEAD", cache: "no-store" }),
      ]);
      ready = responses.every((response) => response.ok);
      if (!ready) await new Promise((resolve) => globalThis.setTimeout(resolve, 5000));
    }
    if (!ready) throw new Error("DEV_DOWNSTREAM_NOT_READY");
    const sql = `SELECT audio.status AS audio_status, audio.error_code AS audio_error_code,
      cover.status AS cover_status, cover.error_code AS cover_error_code,
      batch.status AS push_status, batch.error_code AS push_error_code,
      COALESCE(SUM(CASE WHEN delivery.status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered_count
      FROM briefs AS brief
      LEFT JOIN brief_audio AS audio ON audio.brief_date = brief.brief_date
      LEFT JOIN brief_covers AS cover ON cover.brief_date = brief.brief_date
      LEFT JOIN brief_push_batches AS batch ON batch.brief_date = brief.brief_date
      LEFT JOIN brief_push_deliveries AS delivery ON delivery.brief_date = brief.brief_date
      WHERE brief.brief_date = '${targetDate}' GROUP BY brief.brief_date`;
    const auditDeadline = Date.now() + 10 * 60 * 1000;
    let result;
    do {
      const raw = run("npm", ["exec", "--", "wrangler", "d1", "execute", TARGETS.dev.database, "--env", "dev", "--remote", "--json", "--command", sql], { capture: true });
      result = JSON.parse(raw)[0]?.results?.[0];
      if (result?.audio_status === "ready" && result?.cover_status === "ready" && result?.push_status === "sent" && Number(result?.delivered_count ?? 0) > 0) break;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 5000));
    } while (Date.now() < auditDeadline);
    const summary = {
      runId: runState.runId,
      audioStatus: result?.audio_status ?? null,
      coverStatus: result?.cover_status ?? null,
      pushStatus: result?.push_status ?? null,
      deliveredCount: Number(result?.delivered_count ?? 0),
      errorCodes: [result?.audio_error_code, result?.cover_error_code, result?.push_error_code].filter(Boolean),
    };
    console.log(JSON.stringify(summary));
    if (summary.audioStatus !== "ready" || summary.coverStatus !== "ready" || summary.pushStatus !== "sent" || summary.deliveredCount < 1) {
      throw new Error("DEV_DOWNSTREAM_AUDIT_FAILED");
    }
  }
}

switch (command) {
  case "release:dev": await release("dev"); break;
  case "release:prod": await release("production"); break;
  case "migrate:dev": {
    const state = repositoryState(); assertClean(state); printTarget("dev", state); await confirmMutation(`dev-db ${state.sha}`); migrate("dev"); break;
  }
  case "migrate:prod": {
    const state = await baseline("production"); await confirmMutation(`production-db ${state.sha}`); migrate("production"); break;
  }
  case "rollback:prod": {
    const [versionId] = args; if (!versionId) throw new Error("A production Worker version ID is required.");
    const state = await baseline("production"); await confirmMutation(`rollback production ${versionId}`);
    run("npm", ["exec", "--", "wrangler", "rollback", versionId, "--env=", "--message", `production rollback from ${state.sha}`]); break;
  }
  case "e2e:dev": await e2eDev(args[0], args[1]); break;
  case "testflight:bump": {
    const flag = args.indexOf("--build-number");
    if (flag < 0 || !args[flag + 1]) throw new Error("--build-number is required.");
    console.log(bumpBuildNumber("mobile/pubspec.yaml", args[flag + 1])); break;
  }
  case "testflight:build": {
    await baseline("production"); run("flutter", ["build", "ipa", "--flavor", "prod", "--release"], { cwd: "mobile" }); break;
  }
  case "testflight:inspect": {
    const ipa = args[0] ?? "mobile/build/ios/ipa/watchtower.ipa";
    if (!existsSync(ipa)) throw new Error(`IPA not found: ${ipa}`);
    run("node", ["scripts/testflight-inspect.mjs", ipa]); break;
  }
  default: throw new Error(`Unknown release command: ${String(command)}`);
}
