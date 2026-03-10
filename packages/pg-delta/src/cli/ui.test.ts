import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import {
  confirmAction,
  logError,
  logInfo,
  logSuccess,
  logWarning,
  promptConfirmation,
  writeOutput,
} from "./ui.ts";

interface MockStdioOptions {
  input: string;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
}

function withMockStdio(
  { input, stdinIsTTY = false, stdoutIsTTY = false }: MockStdioOptions,
  fn: () => Promise<unknown>,
): {
  run: () => Promise<void>;
  getStdoutOutput: () => string;
  getStderrOutput: () => string;
} {
  const fakeStdin = new PassThrough();
  const fakeStdout = new PassThrough();
  const fakeStderr = new PassThrough();
  (fakeStdin as unknown as { isTTY?: boolean }).isTTY = stdinIsTTY;
  (fakeStdout as unknown as { isTTY?: boolean }).isTTY = stdoutIsTTY;
  (fakeStderr as unknown as { isTTY?: boolean }).isTTY = false;

  let stdoutOutput = "";
  let stderrOutput = "";
  fakeStdout.setEncoding("utf8");
  fakeStdout.on("data", (chunk: string) => {
    stdoutOutput += chunk;
  });
  fakeStderr.setEncoding("utf8");
  fakeStderr.on("data", (chunk: string) => {
    stderrOutput += chunk;
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
    getStderrOutput: () => stderrOutput,
  };
}

describe("output routing", () => {
  test("writes primary output to stdout in non-interactive mode", async () => {
    const mock = withMockStdio({ input: "" }, async () => {
      writeOutput("SELECT 1;");
    });

    await mock.run();

    expect(mock.getStdoutOutput()).toBe("SELECT 1;\n");
    expect(mock.getStderrOutput()).toBe("");
  });

  test("writes status logs to stderr in non-interactive mode", async () => {
    const mock = withMockStdio({ input: "" }, async () => {
      logInfo("No changes detected.");
      logSuccess("Wrote file.");
      logWarning("Careful.");
      logError("Failed.");
    });

    await mock.run();

    expect(mock.getStdoutOutput()).toBe("");
    expect(mock.getStderrOutput()).toBe(
      "No changes detected.\nWrote file.\nCareful.\nFailed.\n",
    );
  });
});

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
