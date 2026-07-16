import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";

const envPath = new globalThis.URL("../.env", import.meta.url);
const variable = "WATCHTOWER_FEEDBACK_TOKEN";
const token = randomBytes(32).toString("hex");

let contents = "";
try {
  contents = await readFile(envPath, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const line = `${variable}=${token}`;
const pattern = new RegExp(`^${variable}=.*$`, "mu");
const updated = pattern.test(contents)
  ? contents.replace(pattern, line)
  : `${contents}${contents.length > 0 && !contents.endsWith("\n") ? "\n" : ""}${line}\n`;

await writeFile(envPath, updated, { encoding: "utf8", mode: 0o600 });
await chmod(envPath, 0o600);
globalThis.console.log("Feedback token generated and stored in the ignored .env file.");
