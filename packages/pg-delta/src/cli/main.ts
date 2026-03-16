#!/usr/bin/env node

import { Cause, Effect, Exit, Layer, Option, Stdio } from "effect";
import { Command } from "effect/unstable/cli";
import * as CliError from "effect/unstable/cli/CliError";
import { nodePgDatabaseResolverLayer } from "../adapters/node-pg.ts";
import { nodeCliPlatformLayer } from "../adapters/node-platform.ts";
import { configurePgDeltaLogging } from "../core/logging.ts";
import {
  generateCompletionScript,
  isSupportedCompletionShell,
  parseCompletionShell,
} from "./completions.ts";
import { ChangesDetected, CliExitError, UserCancelled } from "./errors.ts";
import { PgDeltaCliOutputLive } from "./help-formatter.ts";
import { normalizeCause, normalizeCliError } from "./output/normalize-error.ts";
import { outputLayerFor } from "./output/output.layer.ts";
import { Output } from "./output/output.service.ts";
import type { OutputFormat } from "./output/types.ts";
import { root } from "./root.ts";
import { processControlLayer } from "./runtime/process-control.layer.ts";
import { ProcessControl } from "./runtime/process-control.service.ts";
import { ttyLayer } from "./runtime/tty.layer.ts";
import { PGDELTA_CLI_VERSION } from "./version.ts";

const packageVersion = PGDELTA_CLI_VERSION;

const CliRuntimeLive = Layer.mergeAll(
  nodePgDatabaseResolverLayer,
  nodeCliPlatformLayer,
);

const configureLogging = Effect.gen(function* () {
  const processControl = yield* ProcessControl;
  const debug = yield* processControl.env("DEBUG");
  const level = yield* processControl.env("PGDELTA_LOG_LEVEL");
  configurePgDeltaLogging({ debug, level });
});

function outputFormatFor(args: ReadonlyArray<string>): OutputFormat {
  const inline = args.find((arg) => arg.startsWith("--output-format="));
  if (inline) {
    const value = inline.slice("--output-format=".length);
    if (value === "json" || value === "stream-json" || value === "text") {
      return value;
    }
  }

  const formatIndex = args.indexOf("--output-format");
  const format = formatIndex !== -1 ? args[formatIndex + 1] : undefined;
  return format === "json" || format === "stream-json" ? format : "text";
}

function hasMissingCompletionsShell(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--completions") {
      const next = argv[i + 1];
      return next === undefined || next.startsWith("-");
    }
    if (token.startsWith("--completions=")) {
      return token.slice("--completions=".length).length === 0;
    }
  }
  return false;
}

function hasUnsupportedCompletionsShell(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--completions") {
      const next = argv[i + 1];
      return (
        next !== undefined &&
        !next.startsWith("-") &&
        !isSupportedCompletionShell(next)
      );
    }
    if (token.startsWith("--completions=")) {
      const shell = token.slice("--completions=".length);
      return shell.length > 0 && !isSupportedCompletionShell(shell);
    }
  }
  return false;
}

function cliProgramFor(args: ReadonlyArray<string>) {
  return Effect.gen(function* () {
    yield* configureLogging;
    return yield* Command.runWith(root, {
      version: packageVersion,
    })(args);
  }).pipe(
    Effect.provide(PgDeltaCliOutputLive),
    Effect.provide(processControlLayer),
    Effect.provide(ttyLayer),
    Effect.provide(CliRuntimeLive),
  );
}

const args = await Effect.runPromise(
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    return yield* stdio.args;
  }).pipe(Effect.provide(CliRuntimeLive)),
);

const program = Effect.gen(function* () {
  const processControl = yield* ProcessControl;
  const output = yield* Output;

  const rawCompletionMode =
    (yield* processControl.env("PGDELTA_INTERNAL_RAW_COMPLETIONS")) === "1";
  const completionShell = rawCompletionMode
    ? undefined
    : parseCompletionShell(args);

  if (!rawCompletionMode && hasMissingCompletionsShell(args)) {
    return yield* Effect.fail(
      new CliExitError({
        exitCode: 1,
        message:
          "Missing value for --completions. Supported shells: bash, zsh, fish, sh.",
      }),
    );
  }

  if (!rawCompletionMode && hasUnsupportedCompletionsShell(args)) {
    return yield* Effect.fail(
      new CliExitError({
        exitCode: 1,
        message:
          "Unsupported shell for --completions. Supported shells: bash, zsh, fish, sh.",
      }),
    );
  }

  if (completionShell) {
    const script = yield* generateCompletionScript(
      completionShell,
      root,
      packageVersion,
    );
    yield* output.write(script.endsWith("\n") ? script.trimEnd() : script);
    return;
  }

  return yield* cliProgramFor(args);
}).pipe(
  Effect.provide(outputLayerFor(outputFormatFor(args))),
  Effect.provide(processControlLayer),
  Effect.provide(ttyLayer),
  Effect.provide(CliRuntimeLive),
);

const handledProgram = <R>(program: Effect.Effect<unknown, unknown, R>) =>
  Effect.gen(function* () {
    const processControl = yield* ProcessControl;
    const output = yield* Output;
    const exit = yield* program.pipe(Effect.exit);

    if (Exit.isSuccess(exit)) {
      return yield* processControl.exit(0);
    }

    if (Cause.hasInterruptsOnly(exit.cause)) {
      return yield* processControl.exit(130);
    }

    const errorOption = Cause.findErrorOption(exit.cause);
    if (Option.isSome(errorOption)) {
      const error = errorOption.value;

      if (CliError.isCliError(error)) {
        if (error._tag === "ShowHelp") {
          return yield* processControl.exit(error.errors.length > 0 ? 1 : 0);
        }

        yield* output.fail(normalizeCliError(error));
        return yield* processControl.exit(1);
      }

      if (error instanceof ChangesDetected || error instanceof UserCancelled) {
        return yield* processControl.exit(2);
      }

      if (error instanceof CliExitError) {
        if (!error.alreadyReported) {
          yield* output.fail(normalizeCliError(error));
        }
        return yield* processControl.exit(error.exitCode);
      }
    }

    yield* output.fail(normalizeCause(exit.cause));
    return yield* processControl.exit(1);
  }).pipe(
    Effect.provide(outputLayerFor(outputFormatFor(args))),
    Effect.provide(PgDeltaCliOutputLive),
    Effect.provide(processControlLayer),
    Effect.provide(ttyLayer),
    Effect.provide(CliRuntimeLive),
  );

export async function runPgDeltaCli(): Promise<void> {
  await Effect.runPromise(handledProgram(program));
}
