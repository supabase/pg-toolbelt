#!/usr/bin/env node

import { run } from "@stricli/core";
import {
  configurePgDeltaLogging,
  getPgDeltaLogger,
} from "../../core/logging.ts";
import { app } from "../app.ts";
import { getCommandExitCode } from "../exit-code.ts";

await configurePgDeltaLogging({
  debug: process.env.DEBUG,
  level: process.env.PGDELTA_LOG_LEVEL,
});
const logger = getPgDeltaLogger("cli");

await run(app, process.argv.slice(2), { process }).catch((error) => {
  if (error instanceof Error) {
    logger.error("CLI command failed", error);
  } else {
    logger.error("CLI command failed: {error}", { error: String(error) });
  }
  process.exit(1);
});

const code = getCommandExitCode();
if (code !== undefined) {
  process.exitCode = code;
}
