import { createInterface } from "node:readline/promises";
import * as clack from "@clack/prompts";
import type { CommandContext } from "@stricli/core";

const NON_INTERACTIVE_CONFIRM_TIMEOUT_MS = 1_000;

function isAffirmativeResponse(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

async function confirmFromStdin(
  context: CommandContext,
  message: string,
): Promise<boolean> {
  const io = context.process as unknown as {
    stdin?: NodeJS.ReadableStream & {
      isTTY?: boolean;
    };
  };
  const stdin = io.stdin;
  if (!stdin) {
    return false;
  }
  const typedStdin = stdin as NodeJS.ReadableStream & {
    isTTY?: boolean;
  };
  const stdout = getStdout(context);
  const rl = createInterface({
    input: typedStdin,
    output: stdout,
    terminal: false,
  });

  try {
    const answerPromise = rl.question(`${message} (y/N) `);
    const answer = typedStdin.isTTY
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
  } catch {
    return false;
  } finally {
    rl.close();
  }
}

function getStdout(context: CommandContext): NodeJS.WritableStream {
  return context.process.stdout as unknown as NodeJS.WritableStream;
}

function getStderr(context: CommandContext): NodeJS.WritableStream {
  return context.process.stderr as unknown as NodeJS.WritableStream;
}

function writeLine(stream: NodeJS.WritableStream, message: string): void {
  stream.write(message.endsWith("\n") ? message : `${message}\n`);
}

function isInteractiveCli(context: CommandContext): boolean {
  const io = context.process as unknown as {
    stdin?: { isTTY?: boolean };
    stdout?: { isTTY?: boolean };
  };
  return Boolean(io.stdin?.isTTY && io.stdout?.isTTY && !clack.isCI());
}

export function logInfo(context: CommandContext, message: string): void {
  if (isInteractiveCli(context)) {
    clack.log.info(message);
    return;
  }
  writeLine(getStdout(context), message);
}

export function logSuccess(context: CommandContext, message: string): void {
  if (isInteractiveCli(context)) {
    clack.log.success(message);
    return;
  }
  writeLine(getStdout(context), message);
}

export function logWarning(context: CommandContext, message: string): void {
  if (isInteractiveCli(context)) {
    clack.log.warn(message);
    return;
  }
  writeLine(getStderr(context), message);
}

export function logError(context: CommandContext, message: string): void {
  if (isInteractiveCli(context)) {
    clack.log.error(message);
    return;
  }
  writeLine(getStderr(context), message);
}

export async function confirmAction(
  context: CommandContext,
  message: string,
): Promise<boolean> {
  if (!isInteractiveCli(context)) {
    return confirmFromStdin(context, message);
  }

  const result = await clack.confirm({
    message,
    initialValue: false,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Operation cancelled.");
    return false;
  }
  return result;
}
