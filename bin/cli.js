#!/usr/bin/env node
import { runCli } from "../src/cli.js";

runCli(process.argv.slice(2))
  .then((code) => {
    if (typeof code === "number") {
      process.exitCode = code;
    }
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });

