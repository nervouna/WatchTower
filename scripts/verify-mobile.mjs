#!/usr/bin/env node
import { assertExpectedFlutterVersion, run } from "./release-lib.mjs";

assertExpectedFlutterVersion();
run("flutter", ["pub", "get"], { cwd: "mobile" });
run("flutter", ["analyze"], { cwd: "mobile" });
run("flutter", ["test"], { cwd: "mobile" });
run("flutter", ["build", "ios", "--flavor", "dev", "--debug", "--no-codesign"], { cwd: "mobile" });
run(process.execPath, ["scripts/check-ios-flavor-build.mjs", "dev"]);
run("flutter", ["build", "ios", "--flavor", "prod", "--release", "--no-codesign"], { cwd: "mobile" });
run(process.execPath, ["scripts/check-ios-flavor-build.mjs", "prod"]);
