import {
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Stdio,
  Stream,
  Terminal,
} from "effect";
import * as Prompt from "effect/unstable/cli/Prompt";
import { Tty } from "../runtime/tty.service.ts";
import { NonInteractiveError } from "./errors.ts";
import { Output } from "./output.service.ts";
import type { OutputFormat } from "./types.ts";

const NON_INTERACTIVE_CONFIRM_TIMEOUT_MS = 1_000;

const writeLine = (
  write: (value: string) => Effect.Effect<void>,
  message: string,
) => write(message.endsWith("\n") ? message : `${message}\n`);

const timestampNow = DateTime.now.pipe(Effect.map(DateTime.formatIso));

const textOutputLayer = Layer.effect(
  Output,
  Effect.gen(function* () {
    const tty = yield* Tty;
    const stdio = yield* Stdio.Stdio;
    const terminal = yield* Terminal.Terminal;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const writeStdout = (message: string) =>
      Stream.make(message).pipe(Stream.run(stdio.stdout()), Effect.orDie);
    const writeStderr = (message: string) =>
      Stream.make(message).pipe(Stream.run(stdio.stderr()), Effect.orDie);

    const confirmationReadError = () =>
      new NonInteractiveError({
        detail: "Could not read confirmation from stdin.",
      });

    const confirmFromTerminalLine = (message: string) =>
      Effect.gen(function* () {
        yield* terminal
          .display(`${message} (y/N) `)
          .pipe(Effect.mapError(() => confirmationReadError()));

        const answer = tty.stdinIsTty
          ? Option.some(
              yield* terminal.readLine.pipe(
                Effect.mapError(() => confirmationReadError()),
              ),
            )
          : yield* terminal.readLine.pipe(
              Effect.mapError(() => confirmationReadError()),
              Effect.timeoutOption(NON_INTERACTIVE_CONFIRM_TIMEOUT_MS),
            );

        const normalized = Option.isSome(answer)
          ? answer.value.trim().toLowerCase()
          : undefined;

        return normalized === "y" || normalized === "yes";
      });

    const confirmInteractively = (message: string) =>
      Prompt.confirm({
        message,
        initial: false,
      }).pipe(
        Prompt.run,
        Effect.provideService(Terminal.Terminal, terminal),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.catchTag("QuitError", () => Effect.succeed(false)),
        Effect.mapError(
          () =>
            new NonInteractiveError({
              detail: "Could not read interactive confirmation.",
            }),
        ),
      );

    return Output.of({
      stdoutColorsEnabled: tty.stdoutColorsEnabled,
      stderrColorsEnabled: tty.stderrColorsEnabled,
      write: (message: string) => writeLine(writeStdout, message),
      info: (message: string) => writeLine(writeStderr, message),
      warn: (message: string) => writeLine(writeStderr, message),
      success: (message: string) => writeLine(writeStderr, message),
      error: (message: string) => writeLine(writeStderr, message),
      confirm: (message: string) =>
        tty.stdinIsTty && tty.stdoutIsTty && !tty.isCi
          ? confirmInteractively(message)
          : confirmFromTerminalLine(message),
      fail: (error) =>
        Effect.gen(function* () {
          yield* writeLine(writeStderr, error.message);
          if (error.detail) {
            yield* writeLine(writeStderr, error.detail);
          }
          if (error.suggestion) {
            yield* writeLine(writeStderr, error.suggestion);
          }
        }),
    });
  }),
);

const jsonOutputLayer = Layer.effect(
  Output,
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;

    const writeStdout = (message: string) =>
      Stream.make(message).pipe(Stream.run(stdio.stdout()), Effect.orDie);
    const writeStderr = (message: string) =>
      Stream.make(message).pipe(Stream.run(stdio.stderr()), Effect.orDie);

    const nonInteractive = (action: string) =>
      Effect.fail(
        new NonInteractiveError({
          detail: `Cannot ${action} in JSON output mode.`,
          suggestion: "Provide all required values via flags.",
        }),
      );

    return Output.of({
      stdoutColorsEnabled: false,
      stderrColorsEnabled: false,
      write: (message: string) => writeLine(writeStdout, message),
      info: (message: string) => writeLine(writeStderr, message),
      warn: (message: string) => writeLine(writeStderr, message),
      success: (message: string) => writeLine(writeStderr, message),
      error: (message: string) => writeLine(writeStderr, message),
      confirm: () => nonInteractive("prompt for confirmation"),
      fail: (error) =>
        writeLine(writeStdout, JSON.stringify({ _tag: "Error", error })),
    });
  }),
);

const streamJsonOutputLayer = Layer.effect(
  Output,
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;

    const writeStdout = (message: string) =>
      Stream.make(message).pipe(Stream.run(stdio.stdout()), Effect.orDie);

    const emit = (event: Record<string, unknown>) =>
      writeLine(writeStdout, JSON.stringify(event));

    const emitLog = (
      level: "info" | "warn" | "success" | "error",
      message: string,
    ) =>
      timestampNow.pipe(
        Effect.flatMap((timestamp) =>
          emit({
            type: "log",
            level,
            message,
            timestamp,
          }),
        ),
      );

    return Output.of({
      stdoutColorsEnabled: false,
      stderrColorsEnabled: false,
      write: (message: string) => emitLog("info", message),
      info: (message: string) => emitLog("info", message),
      warn: (message: string) => emitLog("warn", message),
      success: (message: string) => emitLog("success", message),
      error: (message: string) => emitLog("error", message),
      confirm: () =>
        Effect.fail(
          new NonInteractiveError({
            detail:
              "Cannot prompt for confirmation in stream-json output mode.",
            suggestion: "Provide all required values via flags.",
          }),
        ),
      fail: (error) =>
        timestampNow.pipe(
          Effect.flatMap((timestamp) =>
            emit({
              type: "error",
              error,
              timestamp,
            }),
          ),
        ),
    });
  }),
);

export function outputLayerFor(format: OutputFormat) {
  switch (format) {
    case "json":
      return jsonOutputLayer;
    case "stream-json":
      return streamJsonOutputLayer;
    default:
      return textOutputLayer;
  }
}
