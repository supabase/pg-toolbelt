import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import type { CommandContext } from "@stricli/core";
import { confirmAction } from "./ui.ts";
import { promptConfirmation } from "./utils.ts";

interface MockContextOptions {
  input: string;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
}

function createMockContext({
  input,
  stdinIsTTY = false,
  stdoutIsTTY = false,
}: MockContextOptions): {
  context: CommandContext;
  getStdoutOutput: () => string;
  getStderrOutput: () => string;
} {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  (stdin as unknown as { isTTY?: boolean }).isTTY = stdinIsTTY;
  (stdout as unknown as { isTTY?: boolean }).isTTY = stdoutIsTTY;
  (stderr as unknown as { isTTY?: boolean }).isTTY = false;

  let stdoutOutput = "";
  stdout.setEncoding("utf8");
  stdout.on("data", (chunk: string) => {
    stdoutOutput += chunk;
  });

  let stderrOutput = "";
  stderr.setEncoding("utf8");
  stderr.on("data", (chunk: string) => {
    stderrOutput += chunk;
  });

  stdin.end(input);

  return {
    context: {
      process: {
        stdin,
        stdout,
        stderr,
      },
    } as unknown as CommandContext,
    getStdoutOutput: () => stdoutOutput,
    getStderrOutput: () => stderrOutput,
  };
}

describe("confirmAction", () => {
  test("accepts piped yes input in non-interactive mode", async () => {
    const { context } = createMockContext({ input: "y\n" });
    const result = await confirmAction(context, "Apply these changes?");
    expect(result).toBe(true);
  });

  test("rejects piped no input in non-interactive mode", async () => {
    const { context } = createMockContext({ input: "n\n" });
    const result = await confirmAction(context, "Apply these changes?");
    expect(result).toBe(false);
  });
});

describe("promptConfirmation", () => {
  test("normalizes prompt text and still accepts piped confirmation", async () => {
    const { context, getStderrOutput, getStdoutOutput } = createMockContext({
      input: "yes\n",
    });
    const result = await promptConfirmation(
      "Apply these changes? (y/N) ",
      context,
    );

    expect(result).toBe(true);
    expect(getStderrOutput()).toContain("Apply these changes (y/N) ");
    expect(getStdoutOutput()).not.toContain("Apply these changes (y/N) ");
    expect(getStderrOutput()).not.toContain(
      "Apply these changes? (y/N) (y/N) ",
    );
  });
});
