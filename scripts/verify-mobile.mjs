#!/usr/bin/env node
import { run } from "./release-lib.mjs";

run("flutter", ["pub", "get"], { cwd: "mobile" });
run("flutter", ["analyze"], { cwd: "mobile" });
run("flutter", ["test"], { cwd: "mobile" });
run("flutter", ["build", "ios", "--flavor", "dev", "--debug", "--no-codesign"], { cwd: "mobile" });
run("flutter", ["build", "ios", "--flavor", "prod", "--release", "--no-codesign"], { cwd: "mobile" });
