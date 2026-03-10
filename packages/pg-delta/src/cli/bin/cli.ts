#!/usr/bin/env node

import { createRequire } from "node:module";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import {
  configurePgDeltaLogging,
  getPgDeltaLogger,
} from "../../core/logging.ts";
import { rootCommand } from "../app.ts";
import { logError } from "../ui.ts";

const require = createRequire(import.meta.url);
const packageJson = require("../../../package.json") as { version: string };

await configurePgDeltaLogging({
  debug: process.env.DEBUG,
  level: process.env.PGDELTA_LOG_LEVEL,
});
const logger = getPgDeltaLogger("cli");

rootCommand.pipe(
  Command.run({
    version: packageJson.version,
  }),
  Effect.catchTags({
    CliExitError: (err: { message?: string; exitCode: number }) =>
      Effect.sync(() => {
        if (err.message) {
          logError(err.message);
        }
        process.exitCode = err.exitCode;
      }),
    ChangesDetected: () =>
      Effect.sync(() => {
        process.exitCode = 2;
      }),
    UserCancelled: () =>
      Effect.sync(() => {
        process.exitCode = 2;
      }),
  }),
  Effect.tapCause((cause) =>
    Effect.sync(() => {
      logger.error("CLI command failed: {error}", {
        error: String(cause),
      });
    }),
  ),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
