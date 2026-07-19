#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { run } from "./release-lib.mjs";

const output = process.argv[2] ?? "worker-configuration.d.ts";
run("npm", ["exec", "--", "wrangler", "types", output, "--env="]);
const source = readFileSync(output, "utf8");
writeFileSync(output, source.replace(/[ \t]+$/gmu, ""));
