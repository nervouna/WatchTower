import { describe, expect, it } from "vitest";
import source from "../scripts/allowlist.mjs?raw";

describe("allowlist CLI safety contract", () => {
  it("defaults to local D1, requires explicit production or dev remote flags, and never invokes a shell", async () => {
    expect(source).toContain('args.indexOf("--remote")');
    expect(source).toContain('args.indexOf("--dev")');
    expect(source).toContain('database = dev ? "watchtower-daily-brief-dev-db" : "DB"');
    expect(source).toContain('location = remote || dev ? "--remote" : "--local"');
    expect(source).toContain('environment = dev ? ["--env", "dev"] : []');
    expect(source).toContain('WRANGLER_LOG_PATH: join(tmpdir(), "watchtower-wrangler-allowlist.log")');
    expect(source).toContain('command === "list" ? ["--command", sql] : ["--file", sqlFile]');
    expect(source).toContain('if (remote && dev)');
    expect(source).toContain("spawnSync(wrangler,");
    expect(source).not.toMatch(/shell\s*:\s*true/u);
    expect(source).not.toContain("execSync");
  });
});
