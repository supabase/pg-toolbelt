import { createInterface } from "node:readline/promises";
import * as clack from "@clack/prompts";

const NON_INTERACTIVE_CONFIRM_TIMEOUT_MS = 1_000;

function isAffirmativeResponse(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

async function confirmFromStdin(message: string): Promise<boolean> {
  const stdin = process.stdin as NodeJS.ReadableStream & {
    isTTY?: boolean;
  };
  const stdout = process.stdout;
  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: false,
  });

  try {
    const answerPromise = rl.question(`${message} (y/N) `);
    const answer = stdin.isTTY
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

function writeLine(stream: NodeJS.WritableStream, message: string): void {
  stream.write(message.endsWith("\n") ? message : `${message}\n`);
}

export function writeOutput(message: string): void {
  writeLine(process.stdout, message);
}

function isInteractiveCli(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !clack.isCI());
}

export function logInfo(message: string): void {
  if (isInteractiveCli()) {
    clack.log.info(message);
    return;
  }
  writeLine(process.stderr, message);
}

export function logSuccess(message: string): void {
  if (isInteractiveCli()) {
    clack.log.success(message);
    return;
  }
  writeLine(process.stderr, message);
}

export function logWarning(message: string): void {
  if (isInteractiveCli()) {
    clack.log.warn(message);
    return;
  }
  writeLine(process.stderr, message);
}

export function logError(message: string): void {
  if (isInteractiveCli()) {
    clack.log.error(message);
    return;
  }
  writeLine(process.stderr, message);
}

export async function confirmAction(message: string): Promise<boolean> {
  if (!isInteractiveCli()) {
    return confirmFromStdin(message);
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

export function promptConfirmation(question: string): Promise<boolean> {
  const promptMessage = question
    .replace(/\(y\/N\)\s*$/i, "")
    .trim()
    .replace(/\?$/, "");
  return confirmAction(promptMessage);
}
