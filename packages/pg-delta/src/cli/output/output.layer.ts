import { createInterface } from "node:readline/promises";
import { styleText } from "node:util";
import { cancel, confirm, isCancel, log } from "@clack/prompts";
import { Effect, Layer, Stdio, Stream } from "effect";
import { Tty } from "../runtime/tty.service.ts";
import { NonInteractiveError } from "./errors.ts";
import { Output } from "./output.service.ts";
import type { OutputFormat, StreamEvent } from "./types.ts";

const NON_INTERACTIVE_CONFIRM_TIMEOUT_MS = 1_000;

function isAffirmativeResponse(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

const writeLine = (
  write: (value: string) => Effect.Effect<void>,
  message: string,
) => write(message.endsWith("\n") ? message : `${message}\n`);

const textOutputLayer = Layer.effect(
  Output,
  Effect.gen(function* () {
    const tty = yield* Tty;
    const stdio = yield* Stdio.Stdio;

    const writeStdout = (message: string) =>
      Stream.make(message).pipe(Stream.run(stdio.stdout()), Effect.orDie);
    const writeStderr = (message: string) =>
      Stream.make(message).pipe(Stream.run(stdio.stderr()), Effect.orDie);

    const confirmFromStdin = (message: string) =>
      Effect.tryPromise({
        try: async () => {
          const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false,
          });

          try {
            const answerPromise = rl.question(`${message} (y/N) `);
            const answer = tty.stdinIsTty
              ? await answerPromise
              : await Promise.race<string | undefined>([
                  answerPromise,
                  new Promise<undefined>((resolve) =>
                    setTimeout(
                      () => resolve(undefined),
                      NON_INTERACTIVE_CONFIRM_TIMEOUT_MS,
                    ),
                  ),
                ]);

            return isAffirmativeResponse(answer ?? "");
          } finally {
            rl.close();
          }
        },
        catch: () =>
          new NonInteractiveError({
            detail: "Could not read confirmation from stdin.",
          }),
      });

    return Output.of({
      format: "text",
      interactive: tty.stdinIsTty && tty.stdoutIsTty && !tty.isCi,
      write: (message: string) => writeLine(writeStdout, message),
      info: (message: string) =>
        tty.stdoutIsTty && !tty.isCi
          ? Effect.sync(() => log.info(message))
          : writeLine(writeStderr, message),
      warn: (message: string) =>
        tty.stdoutIsTty && !tty.isCi
          ? Effect.sync(() => log.warn(message))
          : writeLine(
              writeStderr,
              tty.stderrIsTty && !tty.isCi
                ? styleText("yellow", message)
                : message,
            ),
      success: (message: string) =>
        tty.stdoutIsTty && !tty.isCi
          ? Effect.sync(() => log.success(message))
          : writeLine(writeStderr, message),
      error: (message: string) =>
        tty.stdoutIsTty && !tty.isCi
          ? Effect.sync(() => log.error(message))
          : writeLine(writeStderr, message),
      event: (event: StreamEvent) =>
        event.type === "log"
          ? writeLine(writeStderr, `[${event.level}] ${event.message}`)
          : writeLine(writeStdout, JSON.stringify(event)),
      confirm: (message: string) =>
        tty.stdinIsTty && tty.stdoutIsTty && !tty.isCi
          ? Effect.tryPromise({
              try: async () => {
                const result = await confirm({
                  message,
                  initialValue: false,
                });
                if (isCancel(result)) {
                  cancel("Operation cancelled.");
                  return false;
                }
                return result;
              },
              catch: () =>
                new NonInteractiveError({
                  detail: "Could not read interactive confirmation.",
                }),
            })
          : confirmFromStdin(message),
      fail: (error) =>
        Effect.gen(function* () {
          yield* writeLine(
            writeStderr,
            tty.stderrIsTty && !tty.isCi
              ? styleText("red", error.message)
              : error.message,
          );
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
      format: "json",
      interactive: false,
      write: (message: string) => writeLine(writeStdout, message),
      info: (message: string) => writeLine(writeStderr, message),
      warn: (message: string) => writeLine(writeStderr, message),
      success: (message: string) => writeLine(writeStderr, message),
      error: (message: string) => writeLine(writeStderr, message),
      event: (event: StreamEvent) =>
        writeLine(writeStdout, JSON.stringify(event)),
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

    const emit = (event: StreamEvent) =>
      writeLine(writeStdout, JSON.stringify(event));

    return Output.of({
      format: "stream-json",
      interactive: false,
      write: (message: string) =>
        emit({
          type: "log",
          level: "info",
          message,
          timestamp: new Date().toISOString(),
        }),
      info: (message: string) =>
        emit({
          type: "log",
          level: "info",
          message,
          timestamp: new Date().toISOString(),
        }),
      warn: (message: string) =>
        emit({
          type: "log",
          level: "warn",
          message,
          timestamp: new Date().toISOString(),
        }),
      success: (message: string) =>
        emit({
          type: "log",
          level: "success",
          message,
          timestamp: new Date().toISOString(),
        }),
      error: (message: string) =>
        emit({
          type: "log",
          level: "error",
          message,
          timestamp: new Date().toISOString(),
        }),
      event: emit,
      confirm: () =>
        Effect.fail(
          new NonInteractiveError({
            detail:
              "Cannot prompt for confirmation in stream-json output mode.",
            suggestion: "Provide all required values via flags.",
          }),
        ),
      fail: (error) =>
        emit({
          type: "error",
          error,
          timestamp: new Date().toISOString(),
        }),
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
