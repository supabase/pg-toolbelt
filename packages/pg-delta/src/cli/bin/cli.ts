#!/usr/bin/env node

import { createRequire } from "node:module";
import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
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

const cli = Command.run(rootCommand, {
  name: "pgdelta",
  version: packageJson.version,
});

cli(process.argv).pipe(
  Effect.catchTags({
    CliExitError: (err) =>
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
  Effect.tapErrorCause((cause) =>
    Effect.sync(() => {
      const error = cause.toJSON();
      if (error && typeof error === "object" && "error" in error) {
        logger.error("CLI command failed: {error}", {
          error: String(error.error),
        });
      } else {
        logger.error("CLI command failed: {error}", {
          error: String(cause),
        });
      }
    }),
  ),
  Effect.provide(BunContext.layer),
  BunRuntime.runMain,
);
