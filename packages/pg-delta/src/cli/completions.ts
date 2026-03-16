import { Effect } from "effect";
import { spawnAndCaptureOutput } from "../adapters/node-child-process-spawn.ts";
import { getRuntimeProcess } from "../adapters/runtime-process.ts";

const SUPPORTED_COMPLETION_SHELLS = ["bash", "zsh", "fish", "sh"] as const;

type SupportedCompletionShell = (typeof SUPPORTED_COMPLETION_SHELLS)[number];

export function parseCompletionShell(
  argv: readonly string[],
): SupportedCompletionShell | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--completions") {
      const next = argv[i + 1];
      return isSupportedCompletionShell(next) ? next : undefined;
    }
    if (token.startsWith("--completions=")) {
      const shell = token.slice("--completions=".length);
      return isSupportedCompletionShell(shell) ? shell : undefined;
    }
  }
  return undefined;
}

export function isSupportedCompletionShell(
  value: string | undefined,
): value is SupportedCompletionShell {
  return (
    value !== undefined &&
    (SUPPORTED_COMPLETION_SHELLS as readonly string[]).includes(value)
  );
}

export const generateCompletionScript = (
  shell: SupportedCompletionShell,
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const generatorShell = shell === "sh" ? "bash" : shell;
    const runtimeProcess = yield* getRuntimeProcess().pipe(
      Effect.mapError((error) => new Error(error.message)),
    );

    const runtimeCommand = runtimeProcess.argv[0];
    const runtimeEntry = runtimeProcess.argv[1];
    if (runtimeCommand === undefined || runtimeEntry === undefined) {
      return yield* Effect.fail(
        new Error("Failed to resolve the current CLI runtime entrypoint."),
      );
    }

    const script = yield* spawnAndCaptureOutput(
      runtimeCommand,
      [runtimeEntry, "--completions", generatorShell],
      {
        cwd: runtimeProcess.cwd(),
        env: {
          ...runtimeProcess.env,
          PGDELTA_INTERNAL_RAW_COMPLETIONS: "1",
        },
      },
    );

    return sanitizeCompletionScript(script.trimEnd(), shell);
  });

export function sanitizeCompletionScript(
  script: string,
  shell: SupportedCompletionShell,
): string {
  const generatorShell = shell === "sh" ? "bash" : shell;

  switch (generatorShell) {
    case "bash":
      return sanitizeBashCompletionScript(script);
    case "zsh":
      return sanitizeZshCompletionScript(script);
    case "fish":
      return sanitizeFishCompletionScript(script);
  }
}

function sanitizeBashCompletionScript(script: string): string {
  return script
    .split("\n")
    .flatMap((line) => {
      if (line.includes("_flag_groups[--no-")) {
        return [];
      }

      const sanitizedLine = line
        .replace(/\s--no-[a-z-]+(?=[\s;)]|$)/g, "")
        .replace(/\(\s+/g, "(")
        .replace(/\s+\)/g, ")");

      return sanitizedLine.trim() === "()" ? [] : [sanitizedLine];
    })
    .join("\n");
}

function sanitizeZshCompletionScript(script: string): string {
  return script
    .split("\n")
    .flatMap((line) => {
      if (line.includes("--no-") && line.includes("Disable ")) {
        return [];
      }

      return [
        line
          .replace(/ --no-[a-z-]+/g, "")
          .replace(/\(\s+/g, "(")
          .replace(/\s+\)/g, ")"),
      ];
    })
    .join("\n");
}

function sanitizeFishCompletionScript(script: string): string {
  return script
    .split("\n")
    .flatMap((line) => {
      if (line.includes(" -l no-") || line.includes(" -a '--no-")) {
        return [];
      }

      return [line.replace(/\sno-[a-z-]+(?=[ '])/g, "")];
    })
    .join("\n");
}
