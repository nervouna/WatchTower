#!/usr/bin/env node
const replacement = process.argv[2] ?? "an explicit environment command";
console.error(`This ambiguous production mutation command is disabled. Use ${replacement}.`);
process.exitCode = 2;
