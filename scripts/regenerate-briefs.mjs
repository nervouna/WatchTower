import { setTimeout as delay } from "node:timers/promises";

const dates = process.argv.slice(2);
const token = process.env.WATCHTOWER_AUTH_TOKEN;
const baseUrl = (process.env.WATCHTOWER_BASE_URL ?? "https://watchtower.damao.io").replace(/\/$/u, "");
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

function validDate(value) {
  if (!datePattern.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

if (!token || dates.length === 0 || dates.some((date) => !validDate(date))) {
  console.error("Usage: WATCHTOWER_AUTH_TOKEN=<token> npm run brief:regenerate -- YYYY-MM-DD [YYYY-MM-DD ...]");
  process.exit(2);
}

async function request(date, method) {
  const response = await fetch(`${baseUrl}/api/briefs/${date}/regeneration`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const code = body?.error?.code ?? `HTTP_${response.status}`;
    throw new Error(code);
  }
  return body;
}

function report(date, job) {
  console.log(JSON.stringify({
    briefDate: date,
    jobId: job.jobId,
    status: job.status,
    ...(job.errorCode ? { errorCode: job.errorCode } : {}),
  }));
}

for (const date of dates) {
  try {
    let job = await request(date, "POST");
    report(date, job);
    const deadline = Date.now() + 20 * 60 * 1000;
    while (job.status === "queued" || job.status === "processing") {
      if (Date.now() >= deadline) throw new Error("BRIEF_REGENERATION_POLL_TIMEOUT");
      await delay(Math.max(1, job.pollAfterSeconds ?? 3) * 1000);
      job = await request(date, "GET");
      report(date, job);
    }
    if (job.status !== "succeeded") throw new Error(job.errorCode ?? "BRIEF_REGENERATION_FAILED");
  } catch (error) {
    const errorCode = error instanceof Error && /^[A-Z][A-Z0-9_]*$/u.test(error.message)
      ? error.message
      : "BRIEF_REGENERATION_REQUEST_FAILED";
    console.error(JSON.stringify({ briefDate: date, status: "failed", errorCode }));
    process.exit(1);
  }
}
