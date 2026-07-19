#!/usr/bin/env node
import { run } from "./release-lib.mjs";

run("node", ["scripts/check-typegen.mjs"]);
for (const task of ["lint", "typecheck", "test"]) run("npm", ["run", task]);
run("npm", ["exec", "--", "wrangler", "deploy", "--env=", "--dry-run", "--outdir", "dist/production"]);
run("npm", ["exec", "--", "wrangler", "deploy", "--env", "dev", "--dry-run", "--outdir", "dist/dev"]);
run("node", ["scripts/secret-scan.mjs"]);
