import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { confirmAction } from "./ui.ts";
import { promptConfirmation } from "./utils.ts";

interface MockStdioOptions {
  input: string;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
}

function withMockStdio(
  { input, stdinIsTTY = false, stdoutIsTTY = false }: MockStdioOptions,
  fn: () => Promise<unknown>,
): { run: () => Promise<void>; getStdoutOutput: () => string } {
  const fakeStdin = new PassThrough();
  const fakeStdout = new PassThrough();
  const fakeStderr = new PassThrough();
  (fakeStdin as unknown as { isTTY?: boolean }).isTTY = stdinIsTTY;
  (fakeStdout as unknown as { isTTY?: boolean }).isTTY = stdoutIsTTY;
  (fakeStderr as unknown as { isTTY?: boolean }).isTTY = false;

  let stdoutOutput = "";
  fakeStdout.setEncoding("utf8");
  fakeStdout.on("data", (chunk: string) => {
    stdoutOutput += chunk;
  });

  fakeStdin.end(input);

  return {
    run: async () => {
      const origStdin = process.stdin;
      const origStdout = process.stdout;
      const origStderr = process.stderr;
      Object.defineProperty(process, "stdin", {
        value: fakeStdin,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(process, "stdout", {
        value: fakeStdout,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(process, "stderr", {
        value: fakeStderr,
        writable: true,
        configurable: true,
      });
      try {
        await fn();
      } finally {
        Object.defineProperty(process, "stdin", {
          value: origStdin,
          writable: true,
          configurable: true,
        });
        Object.defineProperty(process, "stdout", {
          value: origStdout,
          writable: true,
          configurable: true,
        });
        Object.defineProperty(process, "stderr", {
          value: origStderr,
          writable: true,
          configurable: true,
        });
      }
    },
    getStdoutOutput: () => stdoutOutput,
  };
}

describe("confirmAction", () => {
  test("accepts piped yes input in non-interactive mode", async () => {
    let result = false;
    const mock = withMockStdio({ input: "y\n" }, async () => {
      result = await confirmAction("Apply these changes?");
    });
    await mock.run();
    expect(result).toBe(true);
  });

  test("rejects piped no input in non-interactive mode", async () => {
    let result = true;
    const mock = withMockStdio({ input: "n\n" }, async () => {
      result = await confirmAction("Apply these changes?");
    });
    await mock.run();
    expect(result).toBe(false);
  });
});

describe("promptConfirmation", () => {
  test("normalizes prompt text and still accepts piped confirmation", async () => {
    let result = false;
    const mock = withMockStdio({ input: "yes\n" }, async () => {
      result = await promptConfirmation("Apply these changes? (y/N) ");
    });
    await mock.run();

    expect(result).toBe(true);
    expect(mock.getStdoutOutput()).toContain("Apply these changes (y/N) ");
    expect(mock.getStdoutOutput()).not.toContain(
      "Apply these changes? (y/N) (y/N) ",
    );
  });
});
