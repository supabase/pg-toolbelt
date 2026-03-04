#!/usr/bin/env node

import { run } from "@stricli/core";
import { app } from "../app.ts";
import { getCommandExitCode } from "../exit-code.ts";

await run(app, process.argv.slice(2), { process }).catch((error) => {
  console.error(error);
  process.exit(1);
});

const code = getCommandExitCode();
if (code !== undefined) {
  process.exitCode = code;
}
