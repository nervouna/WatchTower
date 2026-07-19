import { describe, expect, it } from "vitest";
import source from "../scripts/regenerate-briefs.mjs?raw";

describe("brief regeneration CLI safety contract", () => {
  it("uses only the temporary token environment variable and processes dates serially", () => {
    expect(source).toContain("process.env.WATCHTOWER_AUTH_TOKEN");
    expect(source).toContain("for (const date of dates)");
    expect(source).toContain('await request(date, "POST")');
    expect(source).toContain('await request(date, "GET")');
    expect(source).not.toContain("writeFile");
    expect(source).not.toContain("spawn");
    expect(source).not.toContain("console.log(token)");
    expect(source).not.toContain("console.error(token)");
    expect(source).not.toContain("JSON.stringify({ token");
  });
});
