import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const remoteIndex = args.indexOf("--remote");
const remote = remoteIndex >= 0;
if (remote) args.splice(remoteIndex, 1);
const devIndex = args.indexOf("--dev");
const dev = devIndex >= 0;
if (dev) args.splice(devIndex, 1);
if (remote && dev) {
  console.error("Choose either --remote for production or --dev for the isolated Dev database.");
  process.exit(2);
}
const command = args.shift();
const userId = command === "add" || command === "remove" ? args.shift() : undefined;
let note = null;
if (args[0] === "--note" && command === "add") {
  args.shift();
  note = args.shift() ?? null;
}

const usage = "Usage: npm run allowlist -- list [--remote|--dev] | add <user-id> [--note <text>] [--remote|--dev] | remove <user-id> [--remote|--dev]";
if (!new Set(["list", "add", "remove"]).has(command) || args.length > 0 || ((command === "add" || command === "remove") && !userId)) {
  console.error(usage);
  process.exit(2);
}
if (userId && (!/^[A-Za-z0-9._|:@-]{1,255}$/u.test(userId))) {
  console.error("Invalid user ID.");
  process.exit(2);
}
if (note !== null && (note.length > 200 || [...note].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) {
  console.error("Note must be at most 200 characters and contain no control characters.");
  process.exit(2);
}

const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const sql = command === "list"
  ? "SELECT user_id, note, created_at FROM feedback_allowlist ORDER BY created_at, user_id;"
  : command === "add"
    ? `INSERT INTO feedback_allowlist (user_id, note, created_at) VALUES (${quote(userId)}, ${note === null ? "NULL" : quote(note)}, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(user_id) DO UPDATE SET note = excluded.note;`
    : `DELETE FROM feedback_allowlist WHERE user_id = ${quote(userId)};`;

const directory = mkdtempSync(join(tmpdir(), "watchtower-allowlist-"));
const sqlFile = join(directory, "command.sql");
try {
  writeFileSync(sqlFile, `${sql}\n`, { mode: 0o600 });
  const wrangler = join(process.cwd(), "node_modules", ".bin", "wrangler");
  const database = dev ? "watchtower-daily-brief-dev-db" : "DB";
  const location = remote || dev ? "--remote" : "--local";
  const environment = dev ? ["--env", "dev"] : [];
  const sqlInput = command === "list" ? ["--command", sql] : ["--file", sqlFile];
  const result = spawnSync(wrangler, ["d1", "execute", database, ...environment, location, ...sqlInput], {
    stdio: "inherit",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: join(tmpdir(), "watchtower-wrangler-allowlist.log"),
    },
  });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
